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
  "Anonymous tier: 10 randomized results from top 20, text truncated by rank, " +
  "dates fuzzed to month. Set ASKAIPODS_API_KEY for 50 searches/day with full text and dates.";

// Lexical compare on YYYY-MM[-DD][THH:MM:SSZ] descending puts newest
// first regardless of whether the date is a full ISO timestamp (member
// tier) or a YYYY-MM month-prefix (anonymous tier). Nulls sort to the
// end so absent-date results don't crowd out the dated ones.
export function sortByDateDesc(items) {
  return [...items].sort((a, b) => {
    const ad = a?.published_at ?? "";
    const bd = b?.published_at ?? "";
    if (ad === bd) return 0;
    if (!ad) return 1;
    if (!bd) return -1;
    return bd < ad ? -1 : 1;
  });
}

// Build the structured payload an agent will parse. Each result keeps
// its `api_rank` (1 = most semantically relevant in API order) so the
// SKILL.md can tell the agent to derive a "Top Relevant" sub-view for
// member tier without re-querying. For anonymous tier api_rank reflects
// only the relative order within a randomized subset, not the corpus
// rank — `render_hint` flags that distinction.
//
// `tier` defaults to "anonymous" rather than "unknown" if the upstream
// response is missing the field, so the SKILL.md tier branch (which
// only documents `anonymous` and `member`) always lands on a documented
// path. Anonymous is the safer default because it disables the
// "Top Relevant" view — better to under-promise relevance ranking than
// to render a misleading section based on randomized data.
export function toStructured(query, response) {
  const tier = response?.meta?.tier ?? "anonymous";
  const apiResults = Array.isArray(response?.results) ? response.results : [];

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
      total_returned: typeof response?.total === "number" ? response.total : apiResults.length,
      quota: response?.meta?.quota ?? null,
      restrictions: response?.meta?.restrictions ?? null,
      query_hash: response?.meta?.query_hash ?? null,
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
