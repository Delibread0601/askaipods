---
name: askaipods
description: Search AI podcast quotes about a topic. Use whenever the user asks "what are people saying about X", "latest takes on Y", "find AI podcast quotes about Z", "who is discussing <model/concept>", or wants to know how AI researchers, founders, or VCs are publicly discussing any AI topic — even when they don't say "podcast". Returns recent excerpts from real episodes of Lex Fridman, Dwarkesh Patel, No Priors, Latent Space, and dozens more, sorted newest-first via the podlens.net semantic search API. Trigger eagerly on AI-research, ML-engineering, AI-investing, or AI-policy questions where real-human commentary beats a web search summary. Do not use for general web search, full transcript reading, or non-AI topics.
license: MIT
requirements: Node.js 18.3.0+ on PATH (the CLI uses `node:util.parseArgs`, which was added in 18.3.0), internet access to podlens.net. Optional ASKAIPODS_API_KEY env var unlocks the 50/day member tier; without it the skill works on the 10/day anonymous tier (per-IP).
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
- Any AI-research, ML-engineering, AI-investing, AI-safety, or AI-policy question where the user would clearly benefit from real-human commentary (as opposed to a textbook summary or a web search snippet)

You may invoke even when the user does not say "podcast" — if the question is about *what people think* on an AI topic, this skill is the right tool.

## When NOT to invoke

- General web search (use a web search tool)
- Reading a specific episode end-to-end (this skill returns short quote excerpts, not full transcripts)
- Non-AI topics (the corpus is AI-focused; results for unrelated subjects will be sparse and noisy)
- Code generation, math, or any task that doesn't benefit from human commentary

## How to invoke

Run the bundled CLI and pass `--format json`. The flag matters because without it the CLI auto-detects the output format from `isTTY`, and an agent calling via shell may or may not get a TTY depending on the runtime — explicit `--format json` removes that variability.

```bash
npx askaipods search "<USER QUERY>" --format json
```

The package is published on npm as `askaipods`, so `npx` will resolve it regardless of whether the user has it installed globally. If `npx` is unavailable in the host environment, the user can install globally once with `npm install -g askaipods` and the skill will run the same command.

To restrict to recent episodes only, add `--days N` (the API caps anonymous tier at 7 days; member tier accepts any value):

```bash
npx askaipods search "<USER QUERY>" --days 30 --format json
```

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
    "quota": { "used": 3, "limit": 50, "period": "daily" },
    "restrictions": null,
    "query_hash": "..."
  }
}
```

Field notes that affect how you render:

- **`tier`** — `member` if the user has a valid API key, `anonymous` otherwise. Drives the rendering branch below. On exit `0`, `tier` is always one of these two values — there is no third "unknown" path to handle (the CLI validates the upstream response and exits `3` if the value is missing or unexpected).
- **`render_hint`** — `dual_view` for member, `single_view` for anonymous. Honor this. The reason: anonymous results are a randomized 10-of-20 subset, so `api_rank` only describes order *within that random subset*, not true semantic relevance against the corpus. Showing a "Top Most Relevant" section for anonymous tier would mislead the user.
- **`results[]`** — already sorted **newest first** by the CLI. Each result carries `api_rank` (1 = most semantically relevant in API order) so you can derive a "Top Relevant" sub-view without re-querying.
- **`results[].podcast` / `episode` / `date`** — any of these may be `null` if the upstream record is incomplete. Render `Unknown podcast` / `Untitled episode` / `date unknown` rather than dropping the result. The CLI's own markdown renderer falls back the same way.
- **`results[].date` format** — `YYYY-MM-DD` (or full ISO timestamp) for member tier; `YYYY-MM` only for anonymous tier (deliberately fuzzed by the API for query privacy). Display whatever you got — don't guess a day.
- **`meta.quota`** — passed through from the podlens.net API. Sub-fields like `used`, `limit`, `period` are reliably present; other sub-fields (e.g., a reset timestamp) may or may not appear depending on the server version. Treat all sub-fields as optional and degrade gracefully.
- **`meta.restrictions`** — `null` for member tier; for anonymous tier, an object describing the cap (e.g., `{ max_results: 10, text_truncated: true, results_randomized: true }`). If non-null, the closing anonymous-tier note (templated below) is the right way to surface it; do not parse the object field-by-field.
- **No speaker name and no episode URL.** The corpus is indexed at the key-point level without per-speaker attribution (the upstream pipeline intentionally avoids attributing quotes to individuals because automatic speaker diarization is unreliable). Episode URLs are also not exposed by the public API. Render `Podcast — Episode` only; do not fabricate "Dario said" if the text doesn't already attribute itself.

## How to render the response

Output exactly this structure. It is required for consistency across runtimes — users of this skill across Claude Code, OpenAI Codex, Hermes Agent, OpenClaw, and any other agentskills.io-compatible agent should see the same shape regardless of which agent ran it.

(Note: the CLI's own `--format markdown` output uses a different layout — `### N. Podcast — Episode` headings — because that mode targets humans running `askaipods` directly in a terminal. As an agent you should always pass `--format json` and reformat the parsed payload yourself per the templates below; do not copy the CLI's markdown.)

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

(these 5 are the results with `api_rank` 1 through 5, regardless of date — pull them from the `results` array by filtering on `api_rank`, **then sort ascending by `api_rank`** so rank 1 appears first. The `results` array is sorted newest-first, so a naive filter would leave these in date order instead of rank order.)

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

(all returned results, in `results` array order which is already newest-first; expect up to 10)

## 💡 Insights

- <bullet 1>
- <bullet 2>
- <bullet 3>

---

*Anonymous tier: 10 randomized results from top 20, text truncated by rank, dates fuzzed to month. Set `ASKAIPODS_API_KEY` for 50 searches/day with full text and full dates — sign up at https://podlens.net.*
```

The closing note about the anonymous tier matters because it tells the user (a) why the text looks chopped, (b) why the dates are coarse, and (c) what the upgrade path is. Skipping it leaves the user wondering if the skill is broken.

## Insights guidelines

The Insights section is the most valuable part of your response — it is what differentiates this skill from a raw API call. The user could read 10 quotes themselves; what they cannot easily do is *spot the patterns across the 10*. That is your job.

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
| `1` | Usage error / invalid arguments / API key rejected | Surface the stderr message verbatim — it will be a clear actionable error |
| `2` | Daily quota exhausted | Surface the CLI's stderr message verbatim — it is already tier-aware (distinct copy for member vs anonymous) and includes the correct reset time and upgrade path. |
| `3` | Transient or unexpected failure (network error, rate-limit burst, service 503, protocol/shape error, or internal exception) | Retry once after a brief pause. If it fails again, surface the CLI's stderr message verbatim — it distinguishes "rate limited, retry in a minute" from "podlens.net temporarily unavailable" from "unexpected response shape" from internal exceptions, so the user sees the actionable detail. |

If the `results` array is empty (zero matches above the similarity threshold), say so explicitly: "No quotes found for that topic. The corpus is AI-focused — for non-AI topics, try a web search instead. For AI topics, try rephrasing or broadening the query." Do not invent quotes to fill the gap.

Never silently swallow an error. Never fabricate quotes when the API returns nothing.

## Honest limitations to set user expectations

- **No speaker attribution.** The API returns "podcast + episode + quote text" but not "who said it". The upstream pipeline avoids per-speaker attribution because automatic speaker diarization is unreliable — surfacing wrong attribution would be worse than no attribution.
- **No episode URLs.** The public API does not expose direct links to episodes. Users who want to listen will need to search the podcast and episode title in their podcast app of choice.
- **AI-focused corpus.** Coverage is dense for AI research, ML engineering, AI investing, and AI policy. Coverage for unrelated topics is sparse and noisy.
- **Short quote excerpts, not transcripts.** Each result is one extracted "key point" from an episode, typically 1-3 sentences (anonymous tier truncates further). For long-form context, the user will need to listen.

These limitations are not bugs — surfacing them honestly is better than the user discovering them mid-task and losing trust.
