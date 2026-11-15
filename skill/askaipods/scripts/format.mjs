// Output formatting for askaipods.
//
// Two render targets:
//   - JSON  → consumed by host agents (Claude Code, Codex, etc.) that
//             will parse the structured payload and reformat it per the
//             instructions in SKILL.md
//   - Markdown → consumed by humans running the CLI directly in a
//                terminal; not used by the agent path
//
// Both share the same sort: time descending (newest first). The host
// agent's job is to optionally split that into "Latest" and "Top
// Relevant" sub-views — see SKILL.md.

import { codeToken, lineOr, oneLine, stripInvisible, waitlistLink } from "./shared.mjs";

// The tier's --days cap as the server reported it (meta.restrictions
// .max_days), so the copy stays right on servers with different caps.
// Falls back to the given default when the field is absent or malformed
// (restrictions is passthrough, not validated).
function capDays(data, fallback) {
  const d = data.meta.restrictions?.max_days;
  return Number.isSafeInteger(d) && d > 0 ? d : fallback;
}

// The server's first window when --days is omitted (recency): the last
// 30 days, widened up to the tier cap when fewer than 20 match.
const DEFAULT_WINDOW_DAYS = 30;
// Results per response.
const PAGE_SIZE = 20;
// Smallest gap (days) between the newest result and the newest indexed
// episode that is worth a note.
const LAG_NOTE_MIN_DAYS = 14;

function omittedDays(cap) {
  return cap > DEFAULT_WINDOW_DAYS
    ? `omitted = ${DEFAULT_WINDOW_DAYS}, widened up to ${cap} when fewer than 20 match`
    : `omitted = ${cap}`;
}

// Closing note for the non-member tiers: the cap, and the next step up.
// Members get none. A degraded request gets the degrade notice instead —
// the caller is already signed in, so "sign in free" would be wrong.
function tierNote(data) {
  if (data.downgraded) return null;
  if (data.tier === "anonymous") {
    const cap = capDays(data, 30);
    return (
      `Anonymous tier: up to 20 results sorted newest-first, --days capped at ${cap} (${omittedDays(cap)}). ` +
      "Sign in free with Google or GitHub at https://podlens.net and set ASKAIPODS_API_KEY to the account's " +
      "API key for 50 searches/day and --days up to 90 once the account is 48 hours old."
    );
  }
  if (data.tier === "free") {
    const cap = capDays(data, 90);
    const waitlist = waitlistLink(data.meta.cta?.waitlist);
    return (
      `Free tier: up to 20 results sorted newest-first, --days capped at ${cap} (${omittedDays(cap)}). ` +
      "Relevance ordering, --days up to 365 and 100 searches/day are member features; membership is granted " +
      "by PodLens and paid membership is not open yet — " +
      `waitlist: ${waitlist} (joining records interest; it does not grant membership).`
    );
  }
  return null;
}

// Degrade notice, by `downgraded.reason`: today's free-tier capacity is
// used up, the account is inside its first 48 hours, or (a reason this
// version does not know) a neutral statement of the level served.
// toStructured has already reduced `from` / `reason` to code tokens and
// `waitlist` to a podlens.net link.
function downgradeNote(data) {
  const d = data.downgraded;
  if (!d) return null;
  const level = `the anonymous level (--days cap ${capDays(data, 30)}, 20 searches/day per IP)`;
  if (d.reason === "free_pool_exhausted") {
    return (
      `*Note: Today's ${d.from}-tier capacity is used up, so this search ran at ${level}. ` +
      `Paid-membership waitlist: ${d.waitlist} (joining records interest; it does not grant membership).*`
    );
  }
  if (d.reason === "new_account") {
    return (
      `*Note: New free accounts search at the anonymous level for their first 48 hours, so this search ran at ${level}. ` +
      "The free tier (50 searches/day, --days up to 90) applies once the account is 48 hours old.*"
    );
  }
  return `*Note: This search ran at ${level} instead of the ${d.from} tier (reason: ${d.reason}).*`;
}

// Seconds → "m:ss" / "h:mm:ss" for the approximate-timestamp label.
export function clock(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// Sort results newest-first by parsing each `published_at` to a UTC
// millisecond timestamp and comparing numerically. Pure lexical compare
// is broken for ISO timestamps with timezone offsets:
// "2025-01-01T00:30:00+14:00" (UTC 2024-12-31T10:30Z) lex-sorts ahead
// of "2024-12-31T23:30:00-12:00" (UTC 2025-01-01T11:30Z), reversing the
// newest-first contract for any member-tier response that carries
// offset timestamps. Numeric UTC compare fixes that.
//
// client.mjs accepts only full dates (YYYY-MM-DD) and full ISO 8601
// timestamps with an offset, both of which Date.parse reads as UTC-exact.
//
// Nulls and any unparseable value sort to the end so absent-date
// results don't crowd out the dated ones.
function toUtcMs(dateStr) {
  if (!dateStr) return null;
  const ms = Date.parse(dateStr);
  return Number.isNaN(ms) ? null : ms;
}
// Recency serves the newest of the most similar matches in the window, so
// over a wide window the newest result can trail the newest indexed
// episode by weeks. Reported when a full page from one window wider than
// the default trails it by LAG_NOTE_MIN_DAYS or more: --days 30 can then
// surface newer matches. Null otherwise — relevance does not select by
// date, a short page already holds every match in the window, a widened
// search kept every match of its narrower windows, and a corpus whose
// newest episode is older than 30 days has nothing in a 30-day window.
// `sorted` is newest first with undated results last.
function resultLag(sortServed, sorted, win, newestDate, nowMs) {
  if (sortServed !== "recency" || sorted.length < PAGE_SIZE) return null;
  if (!win || win.expanded || !(win.served_days > DEFAULT_WINDOW_DAYS)) return null;
  if (typeof newestDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(newestDate)) return null;
  const corpusMs = Date.parse(newestDate);
  const resultMs = toUtcMs(sorted[0].published_at);
  if (Number.isNaN(corpusMs) || resultMs === null) return null;
  const DAY_MS = 86400000;
  const corpusDay = Math.floor(corpusMs / DAY_MS);
  if (Math.floor(nowMs / DAY_MS) - corpusDay > DEFAULT_WINDOW_DAYS) return null;
  const days = corpusDay - Math.floor(resultMs / DAY_MS);
  if (days < LAG_NOTE_MIN_DAYS) return null;
  return {
    newest_result_date: new Date(resultMs).toISOString().slice(0, 10),
    corpus_newest_date: newestDate,
    days,
  };
}

export function sortByDateDesc(items) {
  return [...items].sort((a, b) => {
    const am = toUtcMs(a?.published_at);
    const bm = toUtcMs(b?.published_at);
    if (am === bm) return 0;
    if (am === null) return 1;
    if (bm === null) return -1;
    return bm - am;
  });
}

// Build the structured payload an agent will parse. Each result keeps
// its `api_rank` (its position in API order) so the SKILL.md can tell
// the agent to derive a "Top Relevant" sub-view without re-querying when
// the server selected by relevance. When it selected by recency,
// api_rank reflects temporal order (newest-first from the API), not
// semantic relevance — `render_hint` flags that distinction: dual_view
// iff `meta.sort.served === "relevance"`.
//
// Preconditions: `response` must be a validated success envelope from
// `client.search()`. `client.mjs` validates `meta.access_tier` and
// `meta.sort` against their closed enums and `meta.quota` as an object
// before returning, so we read those fields directly here without a
// fallback. A programmatic caller
// that bypasses client.search() and hands toStructured a malformed
// response will get a TypeError — that's louder than a silent fallback
// and matches the "protocol break → exit 3" philosophy of client.mjs.
//
// Both renderers read this payload, so the rules for server strings are
// applied here once: a waitlist link is a podlens.net link or the built-in
// one, a code field is a short identifier or "unknown", and no string
// value carries control or format characters (cleanStrings, on the way
// out).
//
// `now` is the time the response was received (fetched_at, and the
// "today" resultLag measures the corpus age against).
export function toStructured(query, response, now = new Date()) {
  // These fields are guaranteed by client.mjs's success-envelope validator:
  //   response.results (array, each with a non-empty `text`),
  //   response.meta (object), response.meta.access_tier (closed enum),
  //   response.meta.sort ({requested, served}), response.meta.quota
  //   (object). Read them directly. The remaining fields below
  //   (meta.query_hash, meta.restrictions, ...) are optional per the
  //   server contract and keep their `?? null` defaults.
  const { access_tier: tier, sort, downgraded, warning, cta, window: win } = response.meta;
  const apiResults = response.results;

  const withRank = apiResults.map((r, idx) => ({ ...r, api_rank: idx + 1 }));
  const sorted = sortByDateDesc(withRank);

  return cleanStrings({
    tier,
    query,
    fetched_at: now.toISOString(),
    render_hint: sort.served === "relevance" ? "dual_view" : "single_view",
    // { requested, served } — the ordering asked for and the one the
    // server ran (relevance is member-only).
    sort,
    // { from, reason, waitlist } when a free request ran at the anonymous
    // level (reason "free_pool_exhausted": today's free-tier capacity is
    // used up; "new_account": the account is younger than 48 hours); else
    // null.
    downgraded: downgraded
      ? {
          ...downgraded,
          from: codeToken(downgraded.from),
          reason: codeToken(downgraded.reason),
          waitlist: waitlistLink(downgraded.waitlist),
        }
      : null,
    results: sorted.map((r) => ({
      podcast: r.podcast_name ?? null,
      episode: r.episode_title ?? null,
      date: r.published_at ?? null,
      // YouTube watch URL for the episode (start of the video); null when
      // the server has none. client.mjs already nulled anything outside the
      // watch-URL shape.
      url: r.url ?? null,
      // Approximate start of the passage the quote comes from (seconds)
      // and the url opened there; null when the server has no confident
      // timestamp. client.mjs keeps them only as a consistent pair.
      anchor_s: r.anchor_s ?? null,
      anchor_url: r.anchor_url ?? null,
      text: r.text,
      api_rank: r.api_rank,
    })),
    meta: {
      total_returned: response.total,
      quota: response.meta.quota,
      restrictions: response.meta.restrictions ?? null,
      query_hash: response.meta.query_hash ?? null,
      // reason_code is a diagnostic code; kept as a code token.
      window: win && typeof win.reason_code === "string" ? { ...win, reason_code: codeToken(win.reason_code) } : win ?? null,
      // Honesty signals:
      //   warning.code       — "corpus_stale_for_requested_window" or
      //                        "index_metadata_stale"; tells the agent
      //                        the empty/partial result is a freshness
      //                        issue rather than a semantic mismatch.
      //                        Kept as a code token.
      //   corpus_freshness   — { newest_date: "YYYY-MM-DD" | null };
      //                        lets the agent render "data as of X".
      //   cta                — non-member call-to-action (anonymous:
      //                        follow URL; free: paid-membership
      //                        waitlist URL, kept as a podlens.net link).
      // All three are optional — defaulted to null so the structured
      // output shape is stable across server versions.
      warning: warning ? { ...warning, code: codeToken(warning.code) } : null,
      corpus_freshness: response.meta.corpus_freshness ?? null,
      // { newest_result_date, corpus_newest_date, days } when a recency
      // search over a wide window returned results that trail the newest
      // indexed episode (see resultLag); else null.
      result_lag: resultLag(sort.served, sorted, win, response.meta.corpus_freshness?.newest_date, now.getTime()),
      cta: cta && "waitlist" in cta ? { ...cta, waitlist: waitlistLink(cta.waitlist) } : cta ?? null,
    },
  });
}

// Every string value in the payload without control or format characters
// (stripInvisible in shared.mjs). A key that carries such characters is
// dropped, not renamed: renamed, it would take the place of the checked
// field of the same name.
function cleanStrings(value) {
  if (typeof value === "string") return stripInvisible(value);
  if (Array.isArray(value)) return value.map(cleanStrings);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => stripInvisible(k) === k)
        .map(([k, v]) => [k, cleanStrings(v)]),
    );
  }
  return value;
}

export function renderJson(query, response, now) {
  return JSON.stringify(toStructured(query, response, now), null, 2);
}

export function renderMarkdown(query, response, now) {
  const data = toStructured(query, response, now);
  const lines = [];

  lines.push(`# askaipods · "${oneLine(query)}"`);
  lines.push("");

  const quota = data.meta.quota;
  const quotaLabel = `${quota.used}/${quota.limit} ${lineOr(quota.period, "daily")}`;
  // Server's P1-b narrow refund: when corpus is stale AND delivered
  // results are empty, the quota slot is refunded (see server CLAUDE.md
  // §Three-Tier Search Access). Surface as a trailing tag so the user
  // knows the search was free — `quota.used` is already decremented
  // upstream, so we only need the marker, not a separate count.
  const refundedTag = quota.refunded ? " · refunded" : "";
  // Served ordering. A mismatch means the requested ordering is not
  // available on this tier (relevance is member-only).
  const { requested, served } = data.sort;
  const sortLabel = requested === served ? served : `${served} (${requested} requested — member-only)`;
  lines.push(`*Tier: ${data.tier} · Sort: ${sortLabel} · Results: ${data.results.length} · Quota: ${quotaLabel}${refundedTag}*`);
  lines.push("");

  // Degrade notice: a free request ran at the anonymous level. Shown
  // before every other note — it explains the tier, cap and quota in the
  // header.
  const degradeNote = downgradeNote(data);
  if (degradeNote) {
    lines.push(degradeNote);
    lines.push("");
  }

  if (data.results.length === 0) {
    const win = data.meta.window;
    const warningCode = data.meta.warning?.code;
    const newest = data.meta.corpus_freshness?.newest_date;
    // Priority: freshness warnings take precedence over window/expansion
    // messaging because they tell the user something stronger — the
    // corpus (not just their query phrasing) is the reason for the
    // empty response.
    // Priority ladder (must match references/notices.md §Empty results
    // — priority ladder):
    //   1. warning.code = corpus_stale_for_requested_window
    //   2. warning.code = index_metadata_stale
    //   3. warning.code = any other value (forward-compat)
    //   4. window.truncated (widening cut short — retry)
    //   5. window.expanded (API widened the window, still empty)
    //   6. generic (no signal — likely semantic mismatch)
    // truncated means the widening stopped early: a wider window's query
    // errored, or the server's response-time limit passed before one could start
    // (then expanded can be false). It MUST be checked before expanded:
    // when a wider query errors mid-expansion both flags are true, and
    // the truncated copy ("retry in a moment") is strictly more
    // actionable than the expanded copy ("rephrase").
    if (warningCode === "corpus_stale_for_requested_window") {
      const asOf = newest ? ` (newest indexed episode: ${newest})` : "";
      const cap = capDays(data, null);
      const capText = cap ? ` (${cap} days)` : "";
      lines.push(
        `No results in the requested window${asOf}. The indexed corpus has no episodes matching that window — a longer \`--days\` helps only up to your tier cap${capText}; omitting \`--days\` already searches up to the cap.`,
      );
    } else if (warningCode === "index_metadata_stale") {
      lines.push(
        "No results. Recently indexed episodes are still propagating to the search index — retry in a few minutes.",
      );
    } else if (warningCode) {
      // Forward-compat: server may introduce new warning codes.
      // Preserve the signal rather than silently falling
      // through to generic "rephrase" copy, which would mislead the
      // user into thinking the empty result is their fault.
      lines.push(
        `No results. The server flagged a freshness issue with this search (code: ${warningCode}) — results may be incomplete or the requested window may be stale. Try a longer \`--days\` (up to your tier cap) or retry in a few minutes.`,
      );
    } else if (win && win.truncated) {
      lines.push(
        "No results found (search window expansion was cut short by a transient error or the server's response-time limit). Try again in a moment.",
      );
    } else if (win && win.expanded) {
      // Step 5 of the references/notices.md ladder appends the
      // corpus-indexed-through suffix when newest_date is present —
      // an honest freshness signal distinct from the freshness warning
      // (which would have landed on the warning branches above). Keeps
      // CLI markdown and the agent render instructions aligned.
      const indexedThrough = newest ? ` (corpus indexed through ${newest})` : "";
      lines.push(
        `No results found. The API expanded the search window from ${win.requested_days} to ${win.served_days} days but still found no matches${indexedThrough}. Try a different phrasing or broader topic.`,
      );
    } else {
      lines.push("No results found. Try a different phrasing or broader topic.");
    }
    const note = tierNote(data);
    if (note) {
      lines.push("");
      lines.push(`> ${note}`);
    }
    return lines.join("\n");
  }

  // Freshness warning (partial-results case): the meta.warning contract
  // in references/notices.md covers both empty AND partial responses.
  // When results are present but the server still flags a freshness
  // issue (e.g., index_metadata_stale: fresh episodes exist but some
  // haven't propagated to Vectorize yet), emit a banner above the results so
  // the user knows the set is incomplete rather than authoritative.
  // Placed before the expansion note so freshness signals dominate —
  // same priority intent as the empty-branch ladder.
  const warningCode = data.meta.warning?.code;
  const newest = data.meta.corpus_freshness?.newest_date;
  if (warningCode === "corpus_stale_for_requested_window") {
    const asOf = newest ? ` (newest indexed episode: ${newest})` : "";
    lines.push(
      `*Note: The indexed corpus has no episodes in the requested window${asOf} — results below may come from an expanded window. A longer \`--days\` (up to your tier cap) widens coverage.*`,
    );
    lines.push("");
  } else if (warningCode === "index_metadata_stale") {
    lines.push(
      "*Note: Recently indexed episodes are still propagating to the search index — some relevant matches may be missing. Retry in a few minutes for complete coverage.*",
    );
    lines.push("");
  } else if (warningCode) {
    // Unknown server warning code (forward-compat).
    // Surface the raw code so the signal reaches the user rather
    // than being silently dropped.
    lines.push(
      `*Note: Server flagged a freshness concern with this search (code: ${warningCode}) — results may be incomplete.*`,
    );
    lines.push("");
  }

  // Surface window expansion so the user knows the actual time range
  const win = data.meta.window;
  // The server widens when FEWER THAN 20 matched (results inside the
  // requested window are kept), so never claim the window was empty.
  // truncated without expanded is the server's response-time limit passing before
  // the first wider window could start: nothing widened, and the result
  // set is still short.
  if (win && (win.expanded || win.truncated)) {
    lines.push(
      win.truncated
        ? win.served_days > win.requested_days
          ? `*Note: The search widened to the last ${win.served_days} days before a transient error or the server's response-time limit cut it short — results may be incomplete and may include episodes older than ${win.requested_days} days. Retry in a moment.*`
          : `*Note: Widening the search beyond the initial ${win.requested_days}-day window was cut short by a transient error or the server's response-time limit — results may be incomplete. Retry in a moment.*`
        : `*Note: Fewer than 20 matches in the initial ${win.requested_days}-day window, so the search widened to the last ${win.served_days} days — results may include episodes older than ${win.requested_days} days.*`,
    );
    lines.push("");
  }

  const lag = data.meta.result_lag;
  if (lag) {
    lines.push(
      `*Note: The newest result is from ${lag.newest_result_date} while the corpus is indexed through ${lag.corpus_newest_date}. Recency returns the newest of the most similar matches in the window searched, so a shorter window (\`--days ${DEFAULT_WINDOW_DAYS}\`) can surface newer ones.*`,
    );
    lines.push("");
  }

  lines.push("## Results — newest first");
  lines.push("");

  for (let i = 0; i < data.results.length; i++) {
    const r = data.results[i];
    const title = lineOr(r.episode, "Untitled episode");
    const podcast = lineOr(r.podcast, "Unknown podcast");
    const date = r.date ?? "date unknown";
    lines.push(`### ${i + 1}. ${podcast} — ${title}`);
    // Bare URL rather than a [label](url) link: terminals and GFM
    // both auto-link it, while link syntax prints raw in a terminal.
    let line = r.url ? `*${date}* · ${r.url}` : `*${date}*`;
    if (r.anchor_url) line += ` · around ${clock(r.anchor_s)}: ${r.anchor_url}`;
    lines.push(line);
    lines.push("");
    // Quote-block the text on one line so the markdown stays compact.
    const text = oneLine(r.text);
    lines.push(`> ${text}`);
    lines.push("");
  }

  const note = tierNote(data);
  if (note) {
    lines.push("---");
    lines.push(`*${note}*`);
  }

  return lines.join("\n");
}
