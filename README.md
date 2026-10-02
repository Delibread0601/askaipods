# askaipods

> Search podcast quotes about AI and tech investing — recent episode excerpts from 70+ podcasts (Lex Fridman, Dwarkesh Patel, No Priors, Latent Space, Odd Lots, All-In, and more), surfaced as short indexed quotes (no per-speaker attribution). A universal [agentskills.io](https://agentskills.io) skill compatible with Claude Code, OpenAI Codex, Hermes Agent, OpenClaw, and any other agent that supports the open skill standard. Powered by [podlens.net](https://podlens.net).

```
$ askaipods "what are people saying about test-time compute"

# askaipods · "what are people saying about test-time compute"

*Tier: anonymous · Results: 20 · Quota: 1/20 daily*

## Results — newest first

### 1. The Data Exchange — This 150M Model Outperforms DeepSeek
*2026-09-24* · https://www.youtube.com/watch?v=zoFYO4LxPcY · around 23:05: https://www.youtube.com/watch?v=zoFYO4LxPcY&t=1385s

> Pathway currently runs on traditional GPUs; Susanna did not claim CPU
> inference, but said edge-computing companies 'started knocking on our
> doors' after the benchmark was published.

### 2. Machine Learning Street Talk — The AI That Replaces Hours of Model Tuning - Frank Hutter
*2026-09-23* · https://www.youtube.com/watch?v=72Im-Mm5JKs

> Harness modes such as 'scaling mode' and 'thinking mode' use test-time
> compute to handle larger and more complex data (Frank).

(...18 more results, newest-first...)
```

## Why this exists

Web search is bad at "what is the AI community thinking about X right now". You get blog posts, Reddit threads, and outdated news articles. What you actually want is the *real conversation* — what researchers, founders, and investors are saying on AI podcasts, in their own words.

`askaipods` is a thin CLI + agent skill that asks the [PodLens](https://podlens.net) semantic search API and returns the most relevant quote excerpts, sorted newest-first. The skill teaches your agent (Claude Code, OpenAI Codex, Hermes, OpenClaw, and any other [agentskills.io](https://agentskills.io)-compatible runtime) when to call the CLI, how to parse the output, and how to write a useful **Insights** section that summarizes the patterns across the returned quotes.

## Install

### Option 1: as a CLI (works in any terminal)

```bash
npx askaipods "your query here"
```

That's the entire install. `npx` fetches the package on first use and reuses its cache afterwards — run `npx askaipods@latest "…"` to force the newest release. No global install needed.

To install globally (faster startup):

```bash
npm install -g askaipods
askaipods "your query here"
```

### Option 2: as an agent skill (Claude Code, Codex, Hermes, OpenClaw, etc.)

```bash
git clone https://github.com/Delibread0601/askaipods.git
```

Then copy or symlink the `skill/askaipods/` directory into your agent's skills folder. Per-runtime instructions:

| Runtime | Skill folder | Install guide |
|---|---|---|
| Claude Code | `~/.claude/skills/askaipods/` | [examples/claude-code-install.md](examples/claude-code-install.md) |
| OpenAI Codex CLI | `~/.agents/skills/askaipods/` (project-scoped: `.agents/skills/askaipods/`) | [examples/codex-install.md](examples/codex-install.md) |
| OpenClaw | `~/.agents/skills/askaipods/` or `~/.openclaw/skills/askaipods/` | [examples/openclaw-install.md](examples/openclaw-install.md) |
| Hermes Agent | `~/.hermes/skills/askaipods/` | [examples/hermes-install.md](examples/hermes-install.md) |
| Any other agentskills.io-compatible runtime | per runtime docs | follow the agentskills.io standard — copy `skill/askaipods/` into your agent's skills directory |

**Per-runtime paths matter**: Codex CLI documents `~/.agents/skills/` as its user-level location (per the [official Codex skills docs](https://developers.openai.com/codex/skills); earlier releases read `~/.codex/skills/`) — the same directory OpenClaw reads as personal agent skills, so one install there serves both. Project-scoped skills live under `.agents/skills/` in the repository. Claude Code and Hermes each read their own directory (table above).

The skill folder is self-contained: it tells the host agent how to invoke `askaipods` (via `npx`), how to parse the JSON, and how to render the response with an **Insights** section. The section layout is tier-dependent — member tier renders **Latest 5** + **Top 5 Most Relevant** + **Insights**; anonymous tier renders **Recent Quotes** + **Insights** (the "Top Relevant" section is suppressed for anonymous because the API returns results sorted by date, not by semantic relevance).

## Usage

### As a CLI

```bash
# Default: human-readable markdown to terminal
askaipods "what are VCs saying about reasoning models"

# JSON output (for scripts and agents)
askaipods "Anthropic safety research" --format json

# Focus on recent episodes (widened through 30/60/90 days when fewer than 20 match; anonymous caps --days at 90, member at 365)
askaipods "GPU shortage" --days 90

# Use a member-tier API key for 100/day instead of 20/day
ASKAIPODS_API_KEY=pk_xxx askaipods "your query"
askaipods "your query" --api-key pk_xxx
```

### As an agent skill

Once the skill is installed in your agent's skills directory, simply ask:

> What are people saying about test-time compute on AI podcasts?

Your agent will recognize the trigger phrase, invoke `askaipods`, and present the results with an AI-generated Insights summary. The exact layout is tier-dependent: **member tier** renders dual sections (Latest 5 + Top 5 Most Relevant + Insights); **anonymous tier** renders a single section (Recent Quotes + Insights), because anonymous results are sorted by date (not semantic relevance) and showing a "Top Relevant" view would be misleading. No CLI knowledge required from the user either way.

## Tier comparison

| | Anonymous (default) | Member |
|---|---|---|
| **Daily quota** | 20 searches per IP | 100 searches per user |
| **Results returned** | The 20 newest of the ~60 most similar (API returns newest-first; `api_rank` = temporal order) | Top 20 by semantic relevance (structured output is emitted newest-first; semantic rank preserved in `api_rank`) |
| **Text length** | Full text | Full text |
| **`--days` cap (omitted = the cap)** | 90 days | 365 days |
| **Setup** | Nothing | `ASKAIPODS_API_KEY` env var |
| **Access** | n/a | invite-only · request at https://podlens.net |

The anonymous tier exists so you can try the skill end-to-end with zero setup. Member access is currently invite-only — request access at https://podlens.net (you'll be added to the waitlist for review) only if you outgrow the 20/day quota or need relevance-ranked results and the longer 365-day lookback window.

## Honest limitations

- **No speaker attribution.** The corpus indexes quotes at the episode level but does not attempt to identify *which guest* said each quote. The upstream pipeline avoids speaker labeling because automatic diarization is unreliable, and a wrong attribution is worse than no attribution.
- **Timestamps are approximate.** Each result carries the episode's YouTube watch URL (`url`, both tiers) and, when PodLens could locate the passage confidently, `anchor_s` / `anchor_url` — the video opened about 10 seconds before the passage discussing the point ("around 12:34"), not at an exact quote position. Both are `null` when no confident timestamp exists (then `url` opens the episode from the start); `url` is `null` for an episode without a link.
- **AI-centred corpus.** 70+ podcasts centred on AI research, engineering, and investing, also covering venture capital, global markets & finance, semiconductors & compute, and tech policy & geopolitics. Topics outside these domains return sparse, loosely related results.
- **Short quote excerpts.** Each result is typically 1-3 sentences. For long-form context, listen to the episode.

These are not bugs. The skill surfaces them honestly so neither you nor your agent fabricate things the API does not provide.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Usage error / invalid arguments / API key rejected |
| `2` | Daily quota exhausted |
| `3` | Transient or unexpected failure — network error, rate-limit burst, service 503, protocol/shape error, or internal exception. stderr has the actionable detail. |

## How the skill renders results

For member tier (`render_hint: dual_view`), the host agent renders two sections plus insights:

```markdown
## 🆕 Latest 5
(5 most recent of the 20 returned results)

## 🎯 Top 5 Most Relevant
(5 results with the lowest api_rank, regardless of date)

## 💡 Insights
(3-5 bullets synthesizing patterns across the quotes)
```

For anonymous tier (`render_hint: single_view`), only Recent Quotes and Insights — the Top Relevant section is intentionally suppressed because anonymous results are sorted by date (newest-first), so api_rank reflects temporal order, not semantic relevance.

See [`skill/askaipods/SKILL.md`](skill/askaipods/SKILL.md) for the full skill specification.

## Architecture

```
askaipods/
├── bin/askaipods.js       ← CLI entry (shebang)
├── src/
│   ├── cli.js             ← arg parsing, format auto-detection
│   ├── client.js          ← podlens.net /api/search/semantic client
│   └── format.js          ← time-desc sort + JSON / markdown rendering
├── skill/askaipods/
│   └── SKILL.md           ← agentskills.io standard skill file
├── examples/              ← per-runtime install guides
├── package.json           ← zero dependencies (Node 18.3.0+ stdlib only)
├── LICENSE                ← MIT
└── README.md
```

The CLI is intentionally zero-dependency (Node 18.3.0+ stdlib only — `node:util.parseArgs` requires 18.3.0) so `npx askaipods` cold-starts in under a second and the package install footprint is minimal.

## Contributing

Issues and PRs welcome at https://github.com/Delibread0601/askaipods.

If you find a runtime that conforms to [agentskills.io](https://agentskills.io) but is not yet listed in the install table above, please open an issue or PR with the install path and we'll add it.

## License

MIT — see [LICENSE](LICENSE).

---

Powered by [podlens.net](https://podlens.net) — AI podcast intelligence.
