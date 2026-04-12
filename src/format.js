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
  "--days capped at 90 when specified. Set ASKAIPODS_API_KEY for 50 searches/day with full dates and unlimited lookback.";

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
  lines.push(`*Tier: ${tierLabel} · Results: ${data.results.length} · Quota: ${quotaLabel}*`);
  lines.push("");

  if (data.results.length === 0) {
    lines.push("No results found. Try a different phrasing or broader topic.");
    if (data.tier === "anonymous") {
      lines.push("");
      lines.push(`> ${ANONYMOUS_NOTE}`);
    }
    return lines.join("\n");
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
