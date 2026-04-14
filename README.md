# askaipods

> Search AI podcast quotes about a topic — recent episode excerpts from Lex Fridman, Dwarkesh Patel, No Priors, Latent Space, and dozens of other AI podcasts, surfaced as short indexed quotes (no per-speaker attribution). A universal [agentskills.io](https://agentskills.io) skill compatible with Claude Code, OpenAI Codex, Hermes Agent, OpenClaw, and any other agent that supports the open skill standard. Powered by [podlens.net](https://podlens.net).

```
$ askaipods "what are people saying about test-time compute"

# askaipods · "what are people saying about test-time compute"

*Tier: anonymous · Results: 20 · Quota: 1/20 daily*

## Results — newest first

### 1. Lenny's Podcast — AI Engineering 101 with Chip Huyen
*2025-10*

> Test-time compute — spending more compute during inference by generating
> multiple answers and selecting the best, or allowing more reasoning/thinking ...

### 2. Latent Space — Better Data is All You Need (Ari Morcos, Datology)
*2025-08*

> Test-time compute as a paradigm pushes toward smaller base models because
> the cost of solving a prob...

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

That's the entire install. `npx` fetches and runs the latest version each time. No global install needed.

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
| OpenAI Codex CLI | `~/.agents/skills/askaipods/` ✨ | [examples/codex-install.md](examples/codex-install.md) |
| OpenClaw | `~/.agents/skills/askaipods/` ✨ or `~/.openclaw/skills/askaipods/` | [examples/openclaw-install.md](examples/openclaw-install.md) |
| Hermes Agent | `~/.hermes/skills/askaipods/` | [examples/hermes-install.md](examples/hermes-install.md) |
| Any other agentskills.io-compatible runtime | per runtime docs | follow the agentskills.io standard — copy `skill/askaipods/` into your agent's skills directory |

✨ **Two-for-one tip**: Codex CLI and OpenClaw both read from `~/.agents/skills/`, so a single install at `~/.agents/skills/askaipods/` covers both runtimes simultaneously.

The skill folder is self-contained: it tells the host agent how to invoke `askaipods` (via `npx`), how to parse the JSON, and how to render the response with an **Insights** section. The section layout is tier-dependent — member tier renders **Latest 5** + **Top 5 Most Relevant** + **Insights**; anonymous tier renders **Recent Quotes** + **Insights** (the "Top Relevant" section is suppressed for anonymous because the API returns results sorted by date, not by semantic relevance).

## Usage

### As a CLI

```bash
# Default: human-readable markdown to terminal
askaipods "what are VCs saying about reasoning models"

# JSON output (for scripts and agents)
askaipods "Anthropic safety research" --format json

# Restrict to recent episodes only (anonymous tier caps --days at 90; member tier accepts any value)
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
| **Results returned** | 20 (deterministic top 20, sorted newest-first) | 20 (deterministic top 20, sorted by relevance) |
| **Text length** | Full text | Full text |
| **Date precision** | Month only (`2025-10`) | Full date (`2025-10-15`) |
| **`--days` cap (when specified)** | 90 days | Unlimited |
| **Setup** | Nothing | `ASKAIPODS_API_KEY` env var |
| **Sign up** | n/a | https://podlens.net |

The anonymous tier exists so you can try the skill end-to-end with zero setup. Sign up for member access only when you outgrow the 20/day quota or need full dates and unlimited lookback.

## Honest limitations

- **No speaker attribution.** The corpus indexes quotes at the episode level but does not attempt to identify *which guest* said each quote. The upstream pipeline avoids speaker labeling because automatic diarization is unreliable, and a wrong attribution is worse than no attribution.
- **No episode URLs.** The public API does not expose direct podcast or episode links. You will need to search the podcast and episode title in your podcast app of choice.
- **AI-focused corpus.** Coverage is dense for AI research, ML engineering, AI investing, and AI policy. Off-topic queries return sparse, noisy results.
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
(5 results with api_rank 1-5, regardless of date)

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
