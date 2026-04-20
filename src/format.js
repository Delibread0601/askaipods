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

const ANONYMOUS_NOTE =
  "Anonymous tier: 20 results sorted newest-first, dates fuzzed to month, " +
  "--days capped at 90 when specified. Set ASKAIPODS_API_KEY for 100 searches/day with full dates and unlimited lookback " +
  "(member tier is invite-only — request access at https://podlens.net).";

// Sort results newest-first by parsing each `published_at` to a UTC
// millisecond timestamp and comparing numerically. Pure lexical compare
// is broken for ISO timestamps with timezone offsets:
// "2025-01-01T00:30:00+14:00" (UTC 2024-12-31T10:30Z) lex-sorts ahead
// of "2024-12-31T23:30:00-12:00" (UTC 2025-01-01T11:30Z), reversing the
// newest-first contract for any member-tier response that carries
// offset timestamps. Numeric UTC compare fixes that.
//
// Anonymous tier dates are YYYY-MM (month only); Date.parse is
// inconsistent across engines for that shape, so normalize to
// YYYY-MM-01 first. Member tier dates are always Date.parse-able
// (either YYYY-MM-DD or a full ISO 8601 timestamp with offset).
//
// Nulls and any unparseable value sort to the end so absent-date
// results don't crowd out the dated ones.
function toUtcMs(dateStr) {
  if (!dateStr) return null;
  const normalized = /^\d{4}-\d{2}$/.test(dateStr) ? `${dateStr}-01` : dateStr;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : ms;
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
// its `api_rank` (1 = most semantically relevant in API order) so the
// SKILL.md can tell the agent to derive a "Top Relevant" sub-view for
// member tier without re-querying. For anonymous tier api_rank reflects
// temporal order (newest-first from the API), not semantic relevance —
// `render_hint` flags that distinction.
//
// Preconditions: `response` must be a validated success envelope from
// `client.search()`. `client.js` validates `meta.tier` is a non-empty
// string and `meta.quota` is an object before returning, so we read
// those fields directly here without a fallback. A programmatic caller
// that bypasses client.search() and hands toStructured a malformed
// response will get a TypeError — that's louder than a silent fallback
// and matches the "protocol break → exit 3" philosophy of client.js.
export function toStructured(query, response) {
  // These fields are guaranteed by client.js's success-envelope validator:
  //   response.results (array), response.meta (object),
  //   response.meta.tier (non-empty string), response.meta.quota (object).
  // Read them directly. The remaining fields below (total,
  // meta.query_hash, meta.restrictions) are optional per the server
  // contract and keep their `?? null` / fallback defenses.
  const tier = response.meta.tier;
  const apiResults = response.results;

  const withRank = apiResults.map((r, idx) => ({ ...r, api_rank: idx + 1 }));
  const sorted = sortByDateDesc(withRank);

  return {
    tier,
    query,
    fetched_at: new Date().toISOString(),
    render_hint: tier === "member" ? "dual_view" : "single_view",
    results: sorted.map((r) => ({
      podcast: r.podcast_name ?? null,
      episode: r.episode_title ?? null,
      date: r.published_at ?? null,
      text: r.text ?? "",
      api_rank: r.api_rank,
    })),
    meta: {
      total_returned: response.total,
      quota: response.meta.quota,
      restrictions: response.meta.restrictions ?? null,
      query_hash: response.meta.query_hash ?? null,
      window: response.meta.window ?? null,
      // New honesty signals (server audit 2026-04-17 → 2026-04-19):
      //   warning.code       — "corpus_stale_for_requested_window" or
      //                        "index_metadata_stale"; tells the agent
      //                        the empty/partial result is a freshness
      //                        issue rather than a semantic mismatch.
      //   corpus_freshness   — { newest_date: "YYYY-MM-DD" | null };
      //                        lets the agent render "data as of X".
      //   cta                — anonymous-tier call-to-action (e.g.
      //                        follow URL) passed through unchanged.
      // All three are optional — defaulted to null so the structured
      // output shape is stable across server versions.
      warning: response.meta.warning ?? null,
      corpus_freshness: response.meta.corpus_freshness ?? null,
      cta: response.meta.cta ?? null,
    },
  };
}

export function renderJson(query, response) {
  return JSON.stringify(toStructured(query, response), null, 2);
}

export function renderMarkdown(query, response) {
  const data = toStructured(query, response);
  const lines = [];

  lines.push(`# askaipods · "${query}"`);
  lines.push("");

  const quota = data.meta.quota;
  const tierLabel = data.tier;
  const quotaLabel = quota
    ? `${quota.used}/${quota.limit} ${quota.period ?? "daily"}`
    : "unknown";
  // Server's P1-b narrow refund: when corpus is stale AND delivered
  // results are empty, the quota slot is refunded (see server CLAUDE.md
  // §Two-Tier Search Access). Surface as a trailing tag so the user
  // knows the search was free — `quota.used` is already decremented
  // upstream, so we only need the marker, not a separate count.
  const refundedTag = data.meta.quota?.refunded ? " · refunded" : "";
  lines.push(`*Tier: ${tierLabel} · Results: ${data.results.length} · Quota: ${quotaLabel}${refundedTag}*`);
  lines.push("");

  if (data.results.length === 0) {
    const win = data.meta.window;
    const warningCode = data.meta.warning?.code;
    const newest = data.meta.corpus_freshness?.newest_date;
    // Priority: freshness warnings take precedence over window/expansion
    // messaging because they tell the user something stronger — the
    // corpus (not just their query phrasing) is the reason for the
    // empty response.
    // Priority ladder (must match SKILL.md §Error handling):
    //   1. warning.code = corpus_stale_for_requested_window
    //   2. warning.code = index_metadata_stale
    //   3. warning.code = any other value (forward-compat, R6-01)
    //   4. window.truncated (transient fallback error — retry)
    //   5. window.expanded (API widened the window, still empty)
    //   6. generic (no signal — likely semantic mismatch)
    // truncated MUST be checked before expanded: when a fallback
    // Vectorize query errors mid-expansion, both flags are true, and
    // the truncated copy ("retry in a moment") is strictly more
    // actionable than the expanded copy ("rephrase").
    if (warningCode === "corpus_stale_for_requested_window") {
      const asOf = newest ? ` (newest indexed episode: ${newest})` : "";
      lines.push(
        `No results in the requested window${asOf}. The indexed corpus has no episodes matching that window — try a longer \`--days\` value or omit it.`,
      );
    } else if (warningCode === "index_metadata_stale") {
      lines.push(
        "No results. Recently indexed episodes are still propagating to the search index — retry in a few minutes.",
      );
    } else if (warningCode) {
      // Forward-compat: server may introduce new warning codes (audit
      // R6-01). Preserve the signal rather than silently falling
      // through to generic "rephrase" copy, which would mislead the
      // user into thinking the empty result is their fault.
      lines.push(
        `No results. The server flagged a freshness issue with this search (code: ${warningCode}) — results may be incomplete or the requested window may be stale. Try omitting \`--days\` or retry in a few minutes.`,
      );
    } else if (win && win.truncated) {
      lines.push(
        "No results found (search window expansion was interrupted by a transient error). Try again in a moment, or try a different phrasing.",
      );
    } else if (win && win.expanded) {
      // SKILL.md §Error handling step 4 mandates appending the
      // corpus-indexed-through suffix when newest_date is present —
      // an honest freshness signal distinct from the freshness warning
      // (which would have landed on the warning branches above). Keeps
      // CLI markdown and SKILL.md's agent render instructions aligned.
      const indexedThrough = newest ? ` (corpus indexed through ${newest})` : "";
      lines.push(
        `No results found. The API expanded the search window from ${win.requested_days} to ${win.served_days} days but still found no matches${indexedThrough}. Try a different phrasing or broader topic.`,
      );
    } else {
      lines.push("No results found. Try a different phrasing or broader topic.");
    }
    if (data.tier === "anonymous") {
      lines.push("");
      lines.push(`> ${ANONYMOUS_NOTE}`);
    }
    return lines.join("\n");
  }

  // Freshness warning (partial-results case): SKILL.md's meta.warning
  // contract covers both empty AND partial responses. When results are
  // present but the server still flags a freshness issue (e.g.,
  // index_metadata_stale: fresh episodes exist but some haven't
  // propagated to Vectorize yet), emit a banner above the results so
  // the user knows the set is incomplete rather than authoritative.
  // Placed before the expansion note so freshness signals dominate —
  // same priority intent as the empty-branch ladder.
  const warningCode = data.meta.warning?.code;
  const newest = data.meta.corpus_freshness?.newest_date;
  if (warningCode === "corpus_stale_for_requested_window") {
    const asOf = newest ? ` (newest indexed episode: ${newest})` : "";
    lines.push(
      `*Note: The indexed corpus has no episodes in the requested window${asOf} — results below may come from an expanded window. Try omitting \`--days\` for broader coverage.*`,
    );
    lines.push("");
  } else if (warningCode === "index_metadata_stale") {
    lines.push(
      "*Note: Recently indexed episodes are still propagating to the search index — some relevant matches may be missing. Retry in a few minutes for complete coverage.*",
    );
    lines.push("");
  } else if (warningCode) {
    // Unknown server warning code (forward-compat, audit R6-01).
    // Surface the raw code so the signal reaches the user rather
    // than being silently dropped.
    lines.push(
      `*Note: Server flagged a freshness concern with this search (code: ${warningCode}) — results may be incomplete.*`,
    );
    lines.push("");
  }

  // Surface window expansion so the user knows the actual time range
  const win = data.meta.window;
  if (win && win.expanded) {
    lines.push(
      `*Note: No results in the requested ${win.requested_days}-day window; showing results from the last ${win.served_days} days.*`,
    );
    lines.push("");
  }

  lines.push("## Results — newest first");
  lines.push("");

  for (let i = 0; i < data.results.length; i++) {
    const r = data.results[i];
    const title = r.episode ?? "Untitled episode";
    const podcast = r.podcast ?? "Unknown podcast";
    const date = r.date ?? "date unknown";
    lines.push(`### ${i + 1}. ${podcast} — ${title}`);
    lines.push(`*${date}*`);
    lines.push("");
    // Quote-block the text and collapse newlines so the markdown stays compact.
    const text = (r.text ?? "").replace(/\s+/g, " ").trim();
    lines.push(`> ${text}`);
    lines.push("");
  }

  if (data.tier === "anonymous") {
    lines.push("---");
    lines.push(`*${ANONYMOUS_NOTE}*`);
  }

  return lines.join("\n");
}
