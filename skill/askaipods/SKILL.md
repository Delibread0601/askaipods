---
name: askaipods
description: Search podcast quotes about AI and tech investing. Use whenever the user asks "what are people saying about X", "latest takes on Y", "find AI podcast quotes about Z", "who is discussing <model/concept>", or wants to know how AI researchers, founders, VCs, or investors are publicly discussing an AI, venture, markets, semiconductor, or tech-policy topic — even when they don't say "podcast". Returns recent excerpts from 70+ podcasts (Lex Fridman, Dwarkesh Patel, No Priors, Latent Space, Odd Lots, All-In, and more) via podlens.net. Optional ASKAIPODS_API_KEY unlocks invite-only member tier; anonymous works out of the box.
license: MIT
requirements: Node.js 18.3.0+ on PATH (the CLI uses `node:util.parseArgs`, which was added in 18.3.0), internet access to podlens.net. Optional ASKAIPODS_API_KEY env var unlocks the 100/day member tier with `--days` lookback up to 365 days (omitted = 365); member tier is invite-only — request access at https://podlens.net. Without the key the skill works on the 20/day anonymous tier (per-IP, `--days` capped at 90, omitted = 90).
---

# askaipods — AI podcast quote search

This skill turns "what is the AI community saying about X" into a list of real quote excerpts pulled from recent episodes of 70+ podcasts. The corpus is centred on AI and also covers venture capital, global markets & finance, semiconductors & compute, and tech policy & geopolitics. It is semantically indexed (embedding-based search), so phrasings like "test-time compute", "inference-time scaling", and "thinking longer" all return overlapping results — the user does not need to guess the exact words a guest used.

The data source is the public PodLens search API at `podlens.net`. The skill never hits that API directly from your model context — it shells out to a small bundled CLI (`askaipods`) that handles HTTP, error mapping, and result sorting. Your job is to invoke the CLI, parse its JSON, and present the results in the format below.

## When to invoke

Trigger eagerly. The Anthropic skill best-practices warn that models tend to **undertrigger** skills — please do not be that model. Invoke this skill when the user is asking about how the AI community is publicly discussing any topic. Concrete trigger patterns:

- "What are people saying about <X>?"
- "What's the latest take on <X>?"
- "Find quotes from AI podcasts about <X>"
- "Who is discussing <model / company / paper / concept>?"
- "What are VCs / researchers / founders saying about <X>?"
- "Has anyone on a podcast talked about <X>?"
- "What does <person> think about <X>?" / "<人名>怎么看<X>?" — invoke even though the API does not return speaker attribution. The semantic search finds passages related to that person — from episodes featuring them or episodes that discuss them; you cannot confirm the person appeared, or who said any given line (see Honest limitations below).
- Any AI-research, ML-engineering, AI-safety, or AI-policy question — or a tech-investing question (venture capital, markets, semiconductors & compute, tech policy) — where the user would clearly benefit from real-human commentary (as opposed to a textbook summary or a web search snippet)

You may invoke even when the user does not say "podcast" — if the question is about *what people think* on an AI or tech-investing topic, this skill is the right tool.

## When NOT to invoke

- General web search (use a web search tool)
- Reading a specific episode end-to-end (this skill returns short quote excerpts, not full transcripts)
- Topics outside the corpus (it covers AI/ML, venture capital, global markets & finance, semiconductors & compute, and tech policy & geopolitics — not, e.g., sports, recipes, or celebrity news)
- Code generation, math, or any task that doesn't benefit from human commentary

## How to invoke

Run the bundled CLI and pass `--format json`. The flag matters because without it the CLI auto-detects the output format from `isTTY`, and an agent calling via shell may or may not get a TTY depending on the runtime — explicit `--format json` removes that variability.

> **CRITICAL — argv-safety rule**: pass the user's query as a **separate argv argument**, never splice it directly into a shell command string. A query like `"; rm -rf ~` spliced into `bash -c "npx askaipods \"$QUERY\""` is a command-injection path. Runtimes that support argv-array execution (Claude Code's `Bash` tool, Codex CLI shell invocations, most SDK-based agents) must use that form. Runtimes that only support shell strings must apply proper shell-quoting (e.g., Node's `shell-quote` or `printf %q`) before interpolation. The `--` separator also guarantees the query is treated as a positional argument regardless of leading characters.

Argv-array form (preferred for agent use):

```
["npx", "-y", "askaipods", "search", "--format", "json", "--", "<USER QUERY>"]
```

Shell-string form (only when argv is unavailable; the host runtime must shell-quote the query first via `printf %q`, Node's `shell-quote`, or equivalent — wrapping the raw query in double quotes is **not** sufficient, since `$VAR` and backticks still expand inside double quotes):

```bash
# <SHELL_QUOTED_QUERY> represents the user's query AFTER passing it through
# `printf %q` (or equivalent). For example, the query  what's new?  becomes
# the literal token  what\'s\ new\?  before reaching this command line.
npx -y askaipods search --format json -- <SHELL_QUOTED_QUERY>
```

The `-y` flag bypasses npm's first-run confirmation prompt; without it, a non-interactive runtime may hang on first use waiting for a TTY response that never comes (audit R7-03). The package is published on npm as `askaipods`, so `npx -y` resolves it regardless of whether the user has it installed globally. If `npx` is unavailable in the host environment, the user can install once with `npm install -g askaipods` and run `askaipods` directly.

The `search` subcommand is optional — `npx -y askaipods --format json -- <SHELL_QUOTED_QUERY>` works identically. Both subcommand spellings are supported; this does NOT relax the argv-array requirement above when argv execution is available — the choice is just which form reads better in context.

To focus on recent episodes, add `--days N` (it sets the first window searched — when fewer than 20 matches fall inside it, the server widens the window; see `meta.window`). When `--days` is passed, the server caps the value at 90 for anonymous tier and at 365 for member tier (larger values are silently clamped — do NOT pass `--days 730` expecting a two-year window). When `--days` is omitted, the server searches the tier maximum — the last 90 days (anonymous) or 365 days (member); there is no all-time search.

```bash
npx -y askaipods search --days 90 --format json -- <SHELL_QUOTED_QUERY>
```

To authenticate with a PodLens API key (member tier), pass `--api-key <key>` or set the `ASKAIPODS_API_KEY` environment variable. The flag takes priority over the env var when both are present.

```bash
npx -y askaipods search --api-key pk_abc123... --format json -- <SHELL_QUOTED_QUERY>
```

The query must be 1–300 characters after trimming. Longer queries are rejected locally (exit code 1) before reaching the API.

### Time-intent mapping (important)

When the user's query implies a time window, you MUST pass the appropriate `--days` value. Without it, the API searches the tier's maximum window (90 days anonymous / 365 member) regardless of recency words in the query.

| User intent | `--days` value |
|---|---|
| "recent", "latest", "最近", "current" | `90` |
| "last few days" | `3` |
| "last N days/weeks/months" | Convert N to days |
| A calendar period — "today", "yesterday", "this week"/"这周", "last week", "this month"/"这个月", "this quarter"/"这个季度", "this year"/"今年", "in March", "since January" | Days from the period's first day to today (minimum 1), then present only results whose `date` falls inside the period |
| No time intent (broad research) | Omit `--days` (the tier maximum: 90 days anonymous / 365 member) |

The API bounds only the start date, so a period that already ended needs that date filter. The server picks its results across the whole window up to today (newest for anonymous, most similar for member), so newer matches can crowd out an earlier period: when few or no results survive the filter, say so — never conclude the period had no discussion.

Do NOT silently default every query to `--days 90` — omitting `--days` on broad research queries keeps the widest window the tier allows (365 days for a member).

When the converted day count exceeds the tier cap (90 anonymous / 365 member), pass the cap value rather than the larger number — the server silently clamps anything above. Disclose the clamp in your response (e.g., "searched within member's 365-day cap; the user's 'last 2 years' would have meant ~730 days"). When the whole period ends before the cap's window begins (e.g. "in March" asked in October on anonymous), do not search — tell the user the period is outside the tier's lookback.

## JSON shape returned by the CLI

The example below is a **member-tier** response. Anonymous-tier responses differ in: top-level `tier: "anonymous"`, `render_hint: "single_view"`, lower `meta.quota.limit` (20), and a fuller `meta.restrictions` object describing anonymous caps (see field notes below).

```json
{
  "tier": "member",
  "query": "the user's query string",
  "fetched_at": "<ISO-8601 timestamp set by the CLI at request time>",
  "render_hint": "dual_view",
  "results": [
    {
      "podcast": "Dwarkesh Patel",
      "episode": "Dario Amodei on the future of AI",
      "date": "2026-03-15",
      "url": "https://www.youtube.com/watch?v=AbCdEfGhIjK",
      "anchor_s": 754,
      "anchor_url": "https://www.youtube.com/watch?v=AbCdEfGhIjK&t=754s",
      "text": "the actual quote excerpt ...",
      "api_rank": 1
    }
  ],
  "meta": {
    "total_returned": 20,
    "quota": { "used": 3, "limit": 100, "period": "daily", "next_reset": "2026-04-21T00:00:00Z" },
    "restrictions": { "max_days": 365 },
    "query_hash": "...",
    "window": {
      "requested_days": 7,
      "served_days": 30,
      "expanded": true,
      "attempted_days": [7, 30],
      "reason_code": "expanded_topk_filled"
    },
    "corpus_freshness": { "newest_date": "2026-04-18" },
    "warning": null,
    "cta": null
  }
}
```

Field notes that affect how you render:

- **`tier`** — `member` when the request carried an active member-tier API key, `anonymous` otherwise (a key that is not member-tier gets the anonymous tier and quota) — use the returned value, not whether a key was set. Drives the rendering branch below. On exit `0`, `tier` is always one of these two values — there is no third "unknown" path to handle (the CLI validates the upstream response and exits `3` if the value is missing or unexpected).
- **`fetched_at`** — ISO-8601 timestamp set by the CLI at request time (not by the server). Use it for staleness: if the user asks about the same topic again later in the session, compare `fetched_at` against the current time to decide whether to re-query or reuse the cached output. A reasonable freshness threshold is ~30 minutes for time-sensitive queries and ~2 hours for broad research.
- **`render_hint`** — `dual_view` for member, `single_view` for anonymous. Honor this. The reason: anonymous results are the 20 newest of the ~60 most similar matches, sorted by `published_at` desc (newest-first) by the API, so `api_rank` reflects temporal order, not semantic relevance. Showing a "Top Most Relevant" section for anonymous tier would mislead the user. Member results arrive in similarity order, so `api_rank` is meaningful for relevance-based views.
- **`results[]`** — already sorted **newest first** by the CLI. Each result carries `api_rank`, its position in the API's original ordering. **For member tier**, `api_rank` 1 = most semantically relevant — you can derive a "Top Relevant" sub-view without re-querying. **For anonymous tier**, the API sorts by date, so `api_rank` reflects temporal order (1 = newest), not relevance — see the `render_hint` note above for why a "Top Relevant" view should not be rendered for anonymous responses.
- **`results[].podcast` / `episode` / `date`** — any of these may be `null` if the upstream record is incomplete. Render `Unknown podcast` / `Untitled episode` / `date unknown` rather than dropping the result. The CLI's own markdown renderer falls back the same way.
- **`results[].date` format** — `YYYY-MM-DD` (or a full ISO timestamp) on both tiers. Display whatever you got — if a date ever arrives as month-only `YYYY-MM` (older server versions sent that for anonymous tier), show it as is and don't guess a day.
- **`results[].url`** — the episode's YouTube watch URL (`https://www.youtube.com/watch?v=<id>`), on both tiers. It opens the episode at the start, not at the quote. `null` when the source has no link (the CLI also nulls any value that isn't a YouTube watch URL); the key is missing entirely when an askaipods CLI older than 0.2.8 ran. Render it only as given — never build or guess a URL from the podcast or episode title.
- **`results[].anchor_s` / `results[].anchor_url`** — an APPROXIMATE start of the passage the quote comes from: `anchor_s` in seconds, `anchor_url` = `url` + `&t=<anchor_s>s` (the video opens about 10 seconds before the matched passage). Both `null` when PodLens has no confident timestamp (then fall back to `url`); the keys are missing entirely when an askaipods CLI older than 0.2.9 ran. Describe it as "around m:ss" — never as the exact moment the quote is said, and never compute a timestamp yourself.
- **`meta.quota`** — passed through from the podlens.net API. `used` and `limit` are guaranteed present (the CLI validates them as part of the success envelope); `period` is typically `"daily"`, `next_reset` is an ISO-8601 timestamp, and **`refunded`** (optional boolean) — when present and `true`, the server refunded this request's quota slot under its P1-b narrow-refund rule (triggered when a freshness warning — `corpus_stale_for_requested_window` or `index_metadata_stale` — fired AND zero results were delivered). The field is often absent; check with `quota.refunded === true` rather than `typeof quota.refunded === "boolean"`. When set, mention in the response that the search didn't count against the user's quota — it's a transparency signal worth surfacing.
- **`meta.restrictions`** — for member tier, an object describing the member cap (currently `{ max_days: 365 }`); for anonymous tier, a fuller object describing the anonymous restrictions (e.g., `{ max_results: 20, text_truncated: false, results_randomized: false, max_days: 90, order: "published_at_desc" }`). For anonymous tier, the closing anonymous-tier note (templated below) is the right way to surface the cap; for member tier, the field is informational only. Do not parse field-by-field, and do not branch tier on this field — use the top-level `tier` field.
- **`meta.window`** — present when the API includes window expansion metadata (may be `null` for older server versions). When the requested window returns fewer than 20 matches, the API automatically retries wider windows from `[30, 60, 90]` days — only windows longer than the requested one and within the tier cap, so an omitted `--days` (already the cap) never expands. The `window` object contains:
  - `requested_days` — the window applied: the `--days` value capped at the tier max, or the tier max when `--days` is omitted.
  - `served_days` — the last window whose query completed. When `expanded` is `true`, results may come from that wider window.
  - `expanded` — `true` when more than one window was attempted (regardless of whether any succeeded).
  - `attempted_days` — array of every window queried, in order (e.g. `[7, 30, 60]`); diagnostic, safe to ignore for rendering.
  - `reason_code` — one of three values, present only when `expanded` is `true` AND `truncated` is absent:
    - `"expanded_topk_filled"` — wider windows tried AND delivered the full topK (20).
    - `"expanded_partial_fill"` — wider windows tried AND delivered some but fewer than topK results.
    - `"exhausted_windows_empty"` — wider windows tried AND delivered nothing.
  - `truncated` — `true` when a fallback query errored mid-expansion, aborting further windows. When present, `reason_code` is suppressed.

  **When `expanded` is `true` AND results were delivered**, tell the user: "Fewer than 20 matches in the requested N-day window, so the search widened to the last M days — results may include episodes older than N days" (using `requested_days` and `served_days`); if `window.truncated === true`, say instead that widening was interrupted by a transient error (when `served_days` > `requested_days`, after reaching M days — so results may also include episodes older than N days), results may be incomplete, and a retry may help. When `expanded` is `true` AND results are empty AND `window.truncated` is not `true`, the API tried all available windows and genuinely found nothing — prefer checking `meta.warning` first for a freshness-aware message before falling back to generic "no results" copy. When `window.truncated === true`, expansion was aborted mid-way by a transient Vectorize error rather than running the full window plan; tell the user to retry rather than rephrase (see the §Error handling priority ladder below for the canonical ordering).
- **`meta.corpus_freshness`** — `{ "newest_date": "YYYY-MM-DD" | null }`. The latest `published_at` indexed in the corpus. Use it as an honest "data as of X" signal, especially when results are empty and `meta.warning` indicates a stale corpus. `null` when the corpus-freshness probe failed server-side — render "date unknown" rather than omitting.
- **`meta.warning`** — `null` in the common case. When present, an object `{ "code": "..." }` signalling an honest server-side explanation for an empty or partial response:
  - `"corpus_stale_for_requested_window"` — the newest indexed episode predates the search window's cutoff (the `--days` value, or the tier maximum when `--days` is omitted). Tell the user: "No episodes indexed in the requested window (newest indexed episode: `<corpus_freshness.newest_date>`). Try a longer `--days` value (up to your tier cap of 90 anonymous / 365 member; omitting `--days` already searches that cap)." **Do NOT** suggest rephrasing the query — the cause is freshness, not semantics.
  - `"index_metadata_stale"` — fresh episodes exist in the corpus but haven't propagated to the Vectorize index yet. Tell the user: "Recently indexed episodes are still propagating — retry in a few minutes."

  These warnings mean an empty or near-empty result is an infrastructure signal, not a semantic-relevance signal — they take precedence over `window.expanded`/`truncated` messaging when both apply.
- **`meta.cta`** — anonymous-tier call-to-action from the server (e.g., `{ follow: "https://x.com/..." }`) or `null`. Optional context for the closing anonymous-tier note; safe to ignore if you're already rendering the standard closing note.
- **No speaker name.** The corpus is indexed at the key-point level without per-speaker attribution (the upstream pipeline intentionally avoids attributing quotes to individuals because automatic speaker diarization is unreliable). Render `Podcast — Episode` only; do not fabricate "Dario said" if the text doesn't already attribute itself.

## How to render the response

Output exactly this structure. It is required for consistency across runtimes — users of this skill across Claude Code, OpenAI Codex, Hermes Agent, OpenClaw, and any other agentskills.io-compatible agent should see the same shape regardless of which agent ran it.

Note: parenthetical notes and `<placeholder>` tokens inside the fenced template blocks below are author guidance for the agent. Agents MUST replace placeholders with actual values from the JSON response, and MUST NOT include the parentheticals in the final user-facing output. When a result's `url` is `null` or missing, drop the ` · [YouTube](<url>)` segment from its line instead of printing an empty or made-up link. When `anchor_url` is non-null, link it instead as ` · [YouTube ~<m:ss>](<anchor_url>)` — `<m:ss>` is `anchor_s` as minutes:seconds (h:mm:ss past an hour), and the `~` marks it as approximate.

(Note: the CLI's own `--format markdown` output uses a different layout — `### N. Podcast — Episode` headings — because that mode targets humans running `askaipods` directly in a terminal. As an agent you should always pass `--format json` and reformat the parsed payload yourself per the templates below; do not copy the CLI's markdown.)

**Freshness banner rule (applies to every render path below, regardless of result count)**: before the first section heading, if `meta.warning` is non-null, emit a one-line italicized note:

- `meta.warning?.code === "corpus_stale_for_requested_window"` AND results are present → `*Note: The indexed corpus has no episodes in the requested window (newest indexed episode: <meta.corpus_freshness.newest_date>) — results below may come from an expanded window. A longer --days (up to your tier cap) widens coverage.*`
- `meta.warning?.code === "index_metadata_stale"` AND results are present → `*Note: Recently indexed episodes are still propagating to the search index — some relevant matches may be missing. Retry in a few minutes for complete coverage.*`
- `meta.warning?.code` is set to any other value AND results are present (forward-compat for future server codes) → `*Note: Server flagged a freshness concern with this search (code: <meta.warning.code>) — results may be incomplete.*`

The banner is mandatory whenever `meta.warning` is non-null and the response is rendered — an unannotated partial result misrepresents the corpus state as authoritative. For empty-result renders, the equivalent freshness copy replaces the "no results" message per the §Error handling priority ladder (do not stack both).

### For `render_hint: "dual_view"` (member tier)

```markdown
## 🆕 Latest 5

1. **<podcast>** — *<episode>* · <date> · [YouTube](<url>)
   > "<quote text>"

2. ...

(continue through up to 5 of the most recent returned results — when the response carries fewer than 5 results (partial fills are possible when `window.reason_code` is `"expanded_partial_fill"`, when a freshness warning fires, or simply when the corpus is sparse for the query), render whichever exist and drop the "5" from the heading; do NOT pad or fabricate. Take the first 5 results you are presenting (after any calendar-period filter) in array order, since the CLI already sorted by date desc.)

## 🎯 Top 5 Most Relevant

1. **<podcast>** — *<episode>* · <date> · [YouTube](<url>)
   > "<quote text>"

2. ...

(the 5 results you are presenting with the lowest `api_rank`, regardless of date — sort them ascending by `api_rank` and take up to 5, so rank order replaces the array's newest-first order. When fewer than 5 exist, render whichever do and drop the "5" from the heading.)

## 💡 Insights

- <bullet 1>
- <bullet 2>
- <bullet 3>
- (3-5 bullets total — see Insights guidelines below)
```

If the same result appears in both Latest and Top Relevant sections, that's fine and informative (it means a recent quote is also semantically central) — show it in both. Do not deduplicate.

### For `render_hint: "single_view"` (anonymous tier)

```markdown
## 🆕 Recent Quotes

1. **<podcast>** — *<episode>* · <date> · [YouTube](<url>)
   > "<quote text>"

2. ...

(every result you are presenting — all returned results, or only the in-period ones for a calendar-period query — in `results` array order, which is already newest-first; up to 20)

## 💡 Insights

- <bullet 1>
- <bullet 2>
- <bullet 3>

---

*Anonymous tier: up to 20 results sorted newest-first, `--days` capped at 90 (omitted = 90). Set `ASKAIPODS_API_KEY` for 100 searches/day and `--days` up to 365 (omitted = 365) — member tier is invite-only, request access at https://podlens.net.*
```

The closing note about the anonymous tier matters because it tells the user (a) why there is no "Top Relevant" view and results stop at 20, (b) what the lookback cap is, and (c) what the upgrade path is. Skipping it leaves the user wondering why the view differs from a member's.

## Insights guidelines

The Insights section is the most valuable part of your response — it is what differentiates this skill from a raw API call. The user could read 20 quotes themselves; what they cannot easily do is *spot the patterns across the 20*. That is your job.

Write 3-5 bullets, each one concrete and one sentence long. Cover at least three of these dimensions:

1. **Common themes** — what idea, framing, or concept is repeating across multiple quotes? Be specific: "three returned excerpts describe X as a 'phase transition'" beats "people are excited about X".
2. **Temporal contrast** — do the more recent quotes in this set say something different from the older ones? (This is a capped, similarity-selected sample — anonymous results also lean recent — so describe what the set shows, never corpus-wide volume or an accelerating/fading trend.)
3. **Notable podcasts or episodes** — which shows do the returned quotes cluster in? (Several quotes can come from one episode; you cannot identify individual speakers.)
4. **Disagreements** — do quotes contradict each other? Where are the live debates?
5. **What's missing** — what obvious angle, counter-argument, or stakeholder voice is conspicuously absent from the returned results? Gaps are signals too.

What to avoid:

- Generic observations like "people are excited about AI" — the user could write that themselves.
- Restating individual quotes — the user already sees the quotes above.
- Confident claims about who said what — the API does not return speaker names; do not invent attribution.
- Bullet points that exceed one sentence — the goal is dense pattern-recognition, not paragraphs.

## Error handling

The CLI uses stable exit codes so you can branch on the failure mode:

| Exit code | Meaning | What to tell the user |
|---|---|---|
| `0` | Success | Render the results normally |
| `1` | Usage error / invalid arguments / API key rejected | Surface the stderr message verbatim — it will be a clear actionable error. Common causes: query exceeds 300 characters (shorten it), empty query, or API key rejected by the server. |
| `2` | Daily quota exhausted | Surface the CLI's stderr message verbatim — it is already tier-aware (distinct copy for member vs anonymous) and includes the correct reset time and upgrade path. |
| `3` | Transient or unexpected failure (network error, rate-limit burst, service 503, protocol/shape error, or internal exception) | Read stderr first: "rate limited … Retry in a minute" → wait about a minute, then retry once; "Daily capacity reached" → do not retry today, tell the user; anything else → retry once after a brief pause. If it fails again, surface the CLI's stderr message verbatim — it distinguishes "rate limited, retry in a minute" from "podlens.net temporarily unavailable" from "unexpected response shape" from internal exceptions, so the user sees the actionable detail. |

If the `results` array is empty (zero matches above the similarity threshold), check the honesty signals in this priority order — freshness warnings dominate because they tell the user something stronger than "rephrase your query". `meta.warning` and `meta.window` are both nullable (the server omits either when not applicable), so use optional chaining (`?.`) when implementing these checks — absent fields must fall through to step 6 rather than throwing:

1. **`meta.warning?.code === "corpus_stale_for_requested_window"`** — corpus has no indexed episodes in the requested window. Tell the user: "No episodes indexed in the requested window (newest indexed episode: `<meta.corpus_freshness.newest_date>`). Try a longer `--days` value (up to your tier cap of 90 anonymous / 365 member; omitting `--days` already searches that cap)." Do NOT suggest rephrasing the query.
2. **`meta.warning?.code === "index_metadata_stale"`** — fresh episodes exist but haven't propagated to the vector index. Tell the user: "Recently indexed episodes are still propagating to the search index — retry in a few minutes."
3. **`meta.warning?.code` is set to any other value** (forward-compat for future server codes) — preserve the signal rather than falling through. Tell the user: "No results. The server flagged a freshness issue with this search (code: `<meta.warning.code>`) — results may be incomplete or the requested window may be stale. Try a longer `--days` (up to your tier cap) or retry in a few minutes."
4. **`meta.window?.truncated === true`** — the expansion was interrupted by a transient error. Tell the user to retry in a moment.
5. **`meta.window?.expanded === true`** — the API widened the window (e.g., 7→30 days) and still found nothing. Tell the user: "No quotes found. The API expanded the search from N to M days but found no matches. Try rephrasing or broadening the query." If `meta.corpus_freshness?.newest_date` is present, append "(corpus indexed through `<newest_date>`)" as an honest data-freshness signal.
6. **Otherwise** (no warning, no expansion): say "No quotes found for that topic. The corpus covers AI/ML, venture capital, global markets & finance, semiconductors & compute, and tech policy & geopolitics — for a topic outside these, a web search may serve better; otherwise try rephrasing or broadening the query."

If `meta.quota.refunded === true`, add a one-line note at the end: "_This search was refunded — it did not count against your daily quota._" (The server's P1-b narrow-refund rule fires when a freshness warning fired AND zero results are delivered.)

Do not invent quotes to fill the gap.

Never silently swallow an error. Never fabricate quotes when the API returns nothing.

## Honest limitations to set user expectations

- **No speaker attribution.** The API returns "podcast + episode + quote text" but not "who said it". The upstream pipeline avoids per-speaker attribution because automatic speaker diarization is unreliable — surfacing wrong attribution would be worse than no attribution.
- **Timestamps are approximate.** `anchor_url` opens the video around the passage (about 10 seconds early), not at the exact quote; when it is `null`, `url` opens the episode from the start. `url` can be `null` for an episode without a link.
- **AI-centred corpus.** 70+ podcasts centred on AI research, engineering, and investing, also covering venture capital, global markets & finance, semiconductors & compute, and tech policy & geopolitics. Topics outside these domains return sparse, loosely related results.
- **Short quote excerpts, not transcripts.** Each result is one extracted "key point" from an episode, typically 1-3 sentences. For long-form context, the user will need to listen.

These limitations are not bugs — surfacing them honestly is better than the user discovering them mid-task and losing trust.
