---
name: askaipods
description: Search AI podcast quotes about a topic. Use whenever the user asks "what are people saying about X", "latest takes on Y", "find AI podcast quotes about Z", "who is discussing <model/concept>", or wants to know how AI researchers, founders, or VCs are publicly discussing any AI topic — even when they don't say "podcast". Returns recent excerpts from Lex Fridman, Dwarkesh Patel, No Priors, Latent Space, and dozens more via podlens.net. Optional ASKAIPODS_API_KEY unlocks invite-only member tier; anonymous works out of the box.
license: MIT
requirements: Node.js 18.3.0+ on PATH (the CLI uses `node:util.parseArgs`, which was added in 18.3.0), internet access to podlens.net. Optional ASKAIPODS_API_KEY env var unlocks the 100/day member tier with full dates and lookback up to 365 days (member tier is invite-only — request access at https://podlens.net); without the key the skill works on the 20/day anonymous tier (per-IP, month-precision dates, `--days` capped at 90 when specified).
---

# askaipods — AI podcast quote search

This skill turns "what is the AI community saying about X" into a list of real quote excerpts pulled from recent episodes of top AI podcasts. The corpus is semantically indexed (embedding-based search), so phrasings like "test-time compute", "inference-time scaling", and "thinking longer" all return overlapping results — the user does not need to guess the exact words a guest used.

The data source is the public PodLens search API at `podlens.net`. The skill never hits that API directly from your model context — it shells out to a small bundled CLI (`askaipods`) that handles HTTP, error mapping, and result sorting. Your job is to invoke the CLI, parse its JSON, and present the results in the format below.

## When to invoke

Trigger eagerly. The Anthropic skill best-practices warn that models tend to **undertrigger** skills — please do not be that model. Invoke this skill when the user is asking about how the AI community is publicly discussing any topic. Concrete trigger patterns:

- "What are people saying about <X>?"
- "What's the latest take on <X>?"
- "Find quotes from AI podcasts about <X>"
- "Who is discussing <model / company / paper / concept>?"
- "What are VCs / researchers / founders saying about <X>?"
- "Has anyone on a podcast talked about <X>?"
- "What does <person> think about <X>?" / "<人名>怎么看<X>?" — invoke even though the API does not return speaker attribution. The semantic search will still find quotes from episodes featuring that person; you just cannot confirm who in the episode said each line (see Honest limitations below).
- Any AI-research, ML-engineering, AI-investing, AI-safety, or AI-policy question where the user would clearly benefit from real-human commentary (as opposed to a textbook summary or a web search snippet)

You may invoke even when the user does not say "podcast" — if the question is about *what people think* on an AI topic, this skill is the right tool.

## When NOT to invoke

- General web search (use a web search tool)
- Reading a specific episode end-to-end (this skill returns short quote excerpts, not full transcripts)
- Non-AI topics (the corpus is AI-focused; results for unrelated subjects will be sparse and noisy)
- Code generation, math, or any task that doesn't benefit from human commentary

## How to invoke

Run the bundled CLI and pass `--format json`. The flag matters because without it the CLI auto-detects the output format from `isTTY`, and an agent calling via shell may or may not get a TTY depending on the runtime — explicit `--format json` removes that variability.

> **CRITICAL — argv-safety rule**: pass the user's query as a **separate argv argument**, never splice it directly into a shell command string. A query like `"; rm -rf ~` spliced into `bash -c "npx askaipods \"$QUERY\""` is a command-injection path. Runtimes that support argv-array execution (Claude Code's `Bash` tool, Codex CLI shell invocations, most SDK-based agents) must use that form. Runtimes that only support shell strings must apply proper shell-quoting (e.g., Node's `shell-quote` or `printf %q`) before interpolation. The `--` separator also guarantees the query is treated as a positional argument regardless of leading characters.

Argv-array form (preferred for agent use):

```
["npx", "-y", "askaipods", "search", "--format", "json", "--", "<USER QUERY>"]
```

Shell-string form (only when argv is unavailable AND the query has been properly shell-quoted — do NOT use raw string interpolation):

```bash
npx -y askaipods search --format json -- "<USER QUERY>"
```

The `-y` flag bypasses npm's first-run confirmation prompt; without it, a non-interactive runtime may hang on first use waiting for a TTY response that never comes (audit R7-03). The package is published on npm as `askaipods`, so `npx -y` resolves it regardless of whether the user has it installed globally. If `npx` is unavailable in the host environment, the user can install once with `npm install -g askaipods` and run `askaipods` directly.

The `search` subcommand is optional — `npx -y askaipods --format json -- "<USER QUERY>"` works identically. Both forms are supported; use whichever reads better in context.

To restrict to recent episodes only, add `--days N`. When `--days` is passed, the server caps the value at 90 for anonymous tier and at 365 for member tier (larger values are silently clamped — do NOT pass `--days 730` expecting a two-year window). When `--days` is omitted entirely, there is no time filter — the server returns all-time results.

```bash
npx -y askaipods search --days 90 --format json -- "<USER QUERY>"
```

To authenticate with a PodLens API key (member tier), pass `--api-key <key>` or set the `ASKAIPODS_API_KEY` environment variable. The flag takes priority over the env var when both are present.

```bash
npx -y askaipods search --api-key pk_abc123... --format json -- "<USER QUERY>"
```

The query must be 1–300 characters after trimming. Longer queries are rejected locally (exit code 1) before reaching the API.

### Time-intent mapping (important)

When the user's query implies a time window, you MUST pass the appropriate `--days` value. Without it, the API returns all-time results regardless of recency words in the query.

| User intent | `--days` value |
|---|---|
| "recent", "latest", "最近", "current" | `90` |
| "this month", "这个月" | `30` |
| "this week", "这周", "last week" | `7` |
| "today", "yesterday", "last few days" | `3` |
| "last N days/weeks/months" | Convert N to days |
| "this quarter", "这个季度" | `90` |
| "this year", "今年" | `365` (member only; anonymous capped to 90) |
| Explicit date range (e.g. "since January") | Convert to days from today |
| No time intent (broad research) | Omit `--days` (all time — no cap applied) |

Do NOT silently default every query to `--days 90` — omitting `--days` on broad research queries preserves valuable historical context that the user did not ask to exclude.

## JSON shape returned by the CLI

```json
{
  "tier": "anonymous" | "member",
  "query": "the user's query string",
  "fetched_at": "<ISO-8601 timestamp set by the CLI at request time>",
  "render_hint": "single_view" | "dual_view",
  "results": [
    {
      "podcast": "Dwarkesh Patel",
      "episode": "Dario Amodei on the future of AI",
      "date": "2026-03-15",
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

- **`tier`** — `member` if the user has a valid API key, `anonymous` otherwise. Drives the rendering branch below. On exit `0`, `tier` is always one of these two values — there is no third "unknown" path to handle (the CLI validates the upstream response and exits `3` if the value is missing or unexpected).
- **`fetched_at`** — ISO-8601 timestamp set by the CLI at request time (not by the server). Use it for staleness: if the user asks about the same topic again later in the session, compare `fetched_at` against the current time to decide whether to re-query or reuse the cached output. A reasonable freshness threshold is ~30 minutes for time-sensitive queries and ~2 hours for broad research.
- **`render_hint`** — `dual_view` for member, `single_view` for anonymous. Honor this. The reason: anonymous results are sorted by `published_at` desc (newest-first) by the API, so `api_rank` reflects temporal order, not semantic relevance. Showing a "Top Most Relevant" section for anonymous tier would mislead the user. Member results arrive in similarity order, so `api_rank` is meaningful for relevance-based views.
- **`results[]`** — already sorted **newest first** by the CLI. Each result carries `api_rank` (1 = most semantically relevant in API order) so you can derive a "Top Relevant" sub-view without re-querying.
- **`results[].podcast` / `episode` / `date`** — any of these may be `null` if the upstream record is incomplete. Render `Unknown podcast` / `Untitled episode` / `date unknown` rather than dropping the result. The CLI's own markdown renderer falls back the same way.
- **`results[].date` format** — `YYYY-MM-DD` (or full ISO timestamp) for member tier; `YYYY-MM` only for anonymous tier (deliberately fuzzed by the API). Display whatever you got — don't guess a day.
- **`meta.quota`** — passed through from the podlens.net API. `used` and `limit` are guaranteed present (the CLI validates them as part of the success envelope); `period` is typically `"daily"`, `next_reset` is an ISO-8601 timestamp, and **`refunded`** (optional boolean) — when present and `true`, the server refunded this request's quota slot under its P1-b narrow-refund rule (triggered when the corpus is stale for the requested window AND zero results were delivered). The field is often absent; check with `quota.refunded === true` rather than `typeof quota.refunded === "boolean"`. When set, mention in the response that the search didn't count against the user's quota — it's a transparency signal worth surfacing.
- **`meta.restrictions`** — for member tier, an object describing the member cap (currently `{ max_days: 365 }`); for anonymous tier, a fuller object describing the anonymous restrictions (e.g., `{ max_results: 20, text_truncated: false, results_randomized: false, date_precision: "month", max_days: 90, order: "published_at_desc" }`). For anonymous tier, the closing anonymous-tier note (templated below) is the right way to surface the cap; for member tier, the field is informational only. Do not parse field-by-field, and do not branch tier on this field — use `meta.tier`.
- **`meta.window`** — present when the API includes window expansion metadata (may be `null` for older server versions). When the user passes `--days` and the requested window has no results, the API automatically retries with wider windows (`[30, 60, 90]` days). The `window` object contains:
  - `requested_days` — what the client asked for.
  - `served_days` — the last window actually attempted. When `expanded` is `true`, results came from that wider window.
  - `expanded` — `true` when more than one window was attempted (regardless of whether any succeeded).
  - `attempted_days` — array of every window queried, in order (e.g. `[7, 30, 60]`); diagnostic, safe to ignore for rendering.
  - `reason_code` — one of three values, present only when `expanded` is `true` AND `truncated` is absent:
    - `"expanded_topk_filled"` — wider windows tried AND delivered the full topK (20).
    - `"expanded_partial_fill"` — wider windows tried AND delivered some but fewer than topK results.
    - `"exhausted_windows_empty"` — wider windows tried AND delivered nothing.
  - `truncated` — `true` when a fallback query errored mid-expansion, aborting further windows. When present, `reason_code` is suppressed.

  **When `expanded` is `true` AND results were delivered**, tell the user: "No results in the requested N-day window; showing results from the last M days" (using `requested_days` and `served_days`). When `expanded` is `true` AND results are empty, the API tried all available windows and genuinely found nothing — prefer checking `meta.warning` first for a freshness-aware message before falling back to generic "no results" copy.
- **`meta.corpus_freshness`** — `{ "newest_date": "YYYY-MM-DD" | null }`. The latest `published_at` indexed in the corpus. Use it as an honest "data as of X" signal, especially when results are empty and `meta.warning` indicates a stale corpus. `null` when the corpus-freshness probe failed server-side — render "date unknown" rather than omitting.
- **`meta.warning`** — `null` in the common case. When present, an object `{ "code": "..." }` signalling an honest server-side explanation for an empty or partial response:
  - `"corpus_stale_for_requested_window"` — the user bounded the search with `--days` but the newest indexed episode predates that window's cutoff. Tell the user: "No episodes indexed in the requested window (newest indexed episode: `<corpus_freshness.newest_date>`). Try a longer `--days` value or omit it." **Do NOT** suggest rephrasing the query — the cause is freshness, not semantics.
  - `"index_metadata_stale"` — fresh episodes exist in the corpus but haven't propagated to the Vectorize index yet. Tell the user: "Recently indexed episodes are still propagating — retry in a few minutes."

  These warnings mean an empty or near-empty result is an infrastructure signal, not a semantic-relevance signal — they take precedence over `window.expanded`/`truncated` messaging when both apply.
- **`meta.cta`** — anonymous-tier call-to-action from the server (e.g., `{ follow: "https://x.com/..." }`) or `null`. Optional context for the closing anonymous-tier note; safe to ignore if you're already rendering the standard closing note.
- **No speaker name and no episode URL.** The corpus is indexed at the key-point level without per-speaker attribution (the upstream pipeline intentionally avoids attributing quotes to individuals because automatic speaker diarization is unreliable). Episode URLs are also not exposed by the public API. Render `Podcast — Episode` only; do not fabricate "Dario said" if the text doesn't already attribute itself.

## How to render the response

Output exactly this structure. It is required for consistency across runtimes — users of this skill across Claude Code, OpenAI Codex, Hermes Agent, OpenClaw, and any other agentskills.io-compatible agent should see the same shape regardless of which agent ran it.

(Note: the CLI's own `--format markdown` output uses a different layout — `### N. Podcast — Episode` headings — because that mode targets humans running `askaipods` directly in a terminal. As an agent you should always pass `--format json` and reformat the parsed payload yourself per the templates below; do not copy the CLI's markdown.)

**Freshness banner rule (applies to every render path below, regardless of result count)**: before the first section heading, if `meta.warning` is non-null, emit a one-line italicized note:

- `meta.warning.code === "corpus_stale_for_requested_window"` AND results are present → `*Note: The indexed corpus has no episodes in the requested window (newest indexed episode: <meta.corpus_freshness.newest_date>) — results below may come from an expanded window. Consider omitting --days for broader coverage.*`
- `meta.warning.code === "index_metadata_stale"` AND results are present → `*Note: Recently indexed episodes are still propagating to the search index — some relevant matches may be missing. Retry in a few minutes for complete coverage.*`
- `meta.warning.code` is set to any other value AND results are present (forward-compat for future server codes) → `*Note: Server flagged a freshness concern with this search (code: <meta.warning.code>) — results may be incomplete.*`

The banner is mandatory whenever `meta.warning` is non-null and the response is rendered — an unannotated partial result misrepresents the corpus state as authoritative. For empty-result renders, the equivalent freshness copy replaces the "no results" message per the §Error handling priority ladder (do not stack both).

### For `render_hint: "dual_view"` (member tier)

```markdown
## 🆕 Latest 5

1. **<podcast>** — *<episode>* · <date>
   > "<quote text>"

2. ...

(continue through the 5 most recent of the returned results, which are the first 5 in the `results` array since the CLI already sorted by date desc)

## 🎯 Top 5 Most Relevant

1. **<podcast>** — *<episode>* · <date>
   > "<quote text>"

2. ...

(these 5 are the results with `api_rank` 1 through 5, regardless of date. Pull them from the `results` array by filtering on `api_rank`.

**Then sort ascending by `api_rank`** so rank 1 appears first — the `results` array is sorted newest-first, so a naive filter without re-sorting would leave these in date order instead of rank order.)

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

1. **<podcast>** — *<episode>* · <date>
   > "<quote text>"

2. ...

(all returned results, in `results` array order which is already newest-first; expect up to 20)

## 💡 Insights

- <bullet 1>
- <bullet 2>
- <bullet 3>

---

*Anonymous tier: 20 results sorted newest-first, dates fuzzed to month, `--days` capped at 90 when specified. Set `ASKAIPODS_API_KEY` for 100 searches/day with full dates and lookback up to 365 days — member tier is invite-only, request access at https://podlens.net.*
```

The closing note about the anonymous tier matters because it tells the user (a) why the dates are coarse, (b) what the lookback cap is, and (c) what the upgrade path is. Skipping it leaves the user wondering why dates lack day precision.

## Insights guidelines

The Insights section is the most valuable part of your response — it is what differentiates this skill from a raw API call. The user could read 20 quotes themselves; what they cannot easily do is *spot the patterns across the 20*. That is your job.

Write 3-5 bullets, each one concrete and one sentence long. Cover at least three of these dimensions:

1. **Common themes** — what idea, framing, or concept is repeating across multiple quotes? Be specific: "three guests describe X as a 'phase transition'" beats "people are excited about X".
2. **Temporal trend** — is the conversation accelerating, shifting, or fading? Are recent quotes saying something different from older ones in the same set?
3. **Notable podcasts or episodes** — which shows are over-represented? An over-representation often signals which community is most engaged with the topic. (You cannot identify individual speakers, but you can identify which podcasts the topic clusters in.)
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
| `3` | Transient or unexpected failure (network error, rate-limit burst, service 503, protocol/shape error, or internal exception) | Retry once after a brief pause. If it fails again, surface the CLI's stderr message verbatim — it distinguishes "rate limited, retry in a minute" from "podlens.net temporarily unavailable" from "unexpected response shape" from internal exceptions, so the user sees the actionable detail. |

If the `results` array is empty (zero matches above the similarity threshold), check the honesty signals in this priority order — freshness warnings dominate because they tell the user something stronger than "rephrase your query":

1. **`meta.warning.code === "corpus_stale_for_requested_window"`** — corpus has no indexed episodes in the requested window. Tell the user: "No episodes indexed in the requested window (newest indexed episode: `<meta.corpus_freshness.newest_date>`). Try a longer `--days` value or omit it." Do NOT suggest rephrasing the query.
2. **`meta.warning.code === "index_metadata_stale"`** — fresh episodes exist but haven't propagated to the vector index. Tell the user: "Recently indexed episodes are still propagating to the search index — retry in a few minutes."
3. **`meta.warning.code` is set to any other value** (forward-compat for future server codes) — preserve the signal rather than falling through. Tell the user: "No results. The server flagged a freshness issue with this search (code: `<meta.warning.code>`) — results may be incomplete or the requested window may be stale. Try omitting `--days` or retry in a few minutes."
4. **`meta.window.truncated === true`** — the expansion was interrupted by a transient error. Tell the user to retry in a moment.
5. **`meta.window.expanded === true`** — the API widened the window (e.g., 7→30 days) and still found nothing. Tell the user: "No quotes found. The API expanded the search from N to M days but found no matches. Try rephrasing or broadening the query." If `meta.corpus_freshness.newest_date` is present, append "(corpus indexed through `<newest_date>`)" as an honest data-freshness signal.
6. **Otherwise** (no warning, no expansion): say "No quotes found for that topic. The corpus is AI-focused — for non-AI topics, try a web search instead. For AI topics, try rephrasing or broadening the query."

If `meta.quota.refunded === true`, add a one-line note at the end: "_This search was refunded — it did not count against your daily quota._" (The server's P1-b narrow-refund rule fires when the corpus is stale for the requested window AND zero results are delivered.)

Do not invent quotes to fill the gap.

Never silently swallow an error. Never fabricate quotes when the API returns nothing.

## Honest limitations to set user expectations

- **No speaker attribution.** The API returns "podcast + episode + quote text" but not "who said it". The upstream pipeline avoids per-speaker attribution because automatic speaker diarization is unreliable — surfacing wrong attribution would be worse than no attribution.
- **No episode URLs.** The public API does not expose direct links to episodes. Users who want to listen will need to search the podcast and episode title in their podcast app of choice.
- **AI-focused corpus.** Coverage is dense for AI research, ML engineering, AI investing, and AI policy. Coverage for unrelated topics is sparse and noisy.
- **Short quote excerpts, not transcripts.** Each result is one extracted "key point" from an episode, typically 1-3 sentences. For long-form context, the user will need to listen.

These limitations are not bugs — surfacing them honestly is better than the user discovering them mid-task and losing trust.
