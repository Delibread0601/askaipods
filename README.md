# askaipods

> Search podcast quotes about AI and tech investing — recent episode excerpts from 70+ podcasts (Lex Fridman, Dwarkesh Patel, No Priors, Latent Space, Odd Lots, All-In, and more), surfaced as short indexed quotes (no per-speaker attribution). A universal [agentskills.io](https://agentskills.io) skill compatible with Claude Code, OpenAI Codex, Hermes Agent, OpenClaw, and any other agent that supports the open skill standard. Powered by [podlens.net](https://podlens.net).

```
$ askaipods "when will AGI arrive" --days 30

# askaipods · "when will AGI arrive"

*Tier: member · Sort: recency · Results: 20 · Quota: 16/100 daily*

## Results — newest first

### 1. Sources with Alex Heath — Factory CEO on why AGI is already here
*2026-09-29* · https://www.youtube.com/watch?v=IMxtXy2SnH0 · around 33:05: https://www.youtube.com/watch?v=IMxtXy2SnH0&t=1985s

> Matan believes AGI is already here and that we are living in a 'post-AGI
> world.' So far nothing is 'crazy and scary,' though problems remain to be
> solved.

### 2. The Cognitive Revolution — Obsolete or Irreplaceable? Garrison Lovely on Stopping the Race to Replace Human Labor
*2026-09-29* · https://www.youtube.com/watch?v=PiBNrW7Q_Ws · around 31:20: https://www.youtube.com/watch?v=PiBNrW7Q_Ws&t=1880s

> Lovely's position is not that AGI should never be built, but that it should
> only happen with strong public buy-in and scientific consensus that it can
> be done safely (Lovely).

### 3. Sources with Alex Heath — Factory CEO on why AGI is already here
*2026-09-29* · https://www.youtube.com/watch?v=IMxtXy2SnH0 · around 33:35: https://www.youtube.com/watch?v=IMxtXy2SnH0&t=2015s

> Matan says he believes we are already 'past that event horizon' of AGI and
> that work remains on things that might become 'crazy and scary' so that
> nothing bad happens. He calls these 'the most fun problems to be working on.'

### 4. The a16z Show — How Jev Turns AI Into Software That Gets Things Done
*2026-09-28* · https://www.youtube.com/watch?v=Ut3LOjKNJaE · around 19:50: https://www.youtube.com/watch?v=Ut3LOjKNJaE&t=1190s

> Diego says, 'for nuanced reasons,' that we are not on a path to RSI
> (recursive self-improvement), and still believes that, but thinks OpenAI's
> AGI definition (automating most economically valuable work) is 'extremely
> doable.'

### 5. The Cognitive Revolution — AI:AM: What If It Works Too Well? Colluding Agents, $200M Safety Orgs, Virtual Cells Saturate at 2%
*2026-09-27* · https://www.youtube.com/watch?v=WPHfPiz6kkk · around 40:50: https://www.youtube.com/watch?v=WPHfPiz6kkk&t=2450s

> Geoffrey Irving has said superintelligence might arrive in two or three
> years and has proposed slowing down. Nadeau said CG manages timeline
> uncertainty with a portfolio of short- and long-payoff bets.

(...15 more results, newest-first...)
```

*Real output, captured 2026-10-02 with a member API key; `--days 30` matches the anonymous tier's 30-day window. Without a key the header reads `Tier: anonymous` with a 20/day quota, and the output ends with an anonymous-tier note. Quotes are wrapped for width.*

## Why this exists

Web search is bad at "what is the AI community thinking about X right now". You get blog posts, Reddit threads, and outdated news articles. What you actually want is the *real conversation* — what researchers, founders, and investors are saying on AI podcasts, in their own words.

`askaipods` is a thin CLI + agent skill that asks the [PodLens](https://podlens.net) semantic search API and returns the most relevant quote excerpts, sorted newest-first. The skill teaches your agent (Claude Code, OpenAI Codex, Hermes, OpenClaw, and any other [agentskills.io](https://agentskills.io)-compatible runtime) when to call the CLI, how to parse the output, and how to write a useful **Insights** section that summarizes the patterns across the returned quotes.

## Install

### Option 1: as a CLI (works in any terminal)

```bash
npx askaipods "your query here"
```

That's the entire install. `npx` checks the registry and runs the latest published version each time — unless askaipods is also installed in the current project or globally, in which case that copy runs (update a project install with `npm install askaipods@latest`, a global one with `npm install -g askaipods@latest`). No global install needed.

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

**Per-runtime paths matter**: Codex CLI documents `~/.agents/skills/` as its user-level location (per the [official Codex skills docs](https://learn.chatgpt.com/docs/build-skills); earlier releases read `~/.codex/skills/`) — the same directory OpenClaw reads as personal agent skills, so one install there serves both. Project-scoped skills live under `.agents/skills/` in the repository. Claude Code and Hermes each read their own directory (table above).

The skill folder is self-contained: it tells the host agent how to invoke `askaipods` (via `npx`), how to parse the JSON, and how to render the response with an **Insights** section. The section layout follows how the server selected the results — relevance-selected results (a member with `--sort relevance`) render **Latest 5** + **Top 5 Most Relevant** + **Insights**; recency-selected results (anonymous, free, and member by default) render **Recent Quotes** + **Insights** (the "Top Relevant" section is suppressed for them because the API returns results sorted by date, not by semantic relevance).

## Usage

### As a CLI

```bash
# Default: human-readable markdown to terminal
askaipods "what are VCs saying about reasoning models"

# JSON output (for scripts and agents)
askaipods "Anthropic safety research" --format json

# Focus on recent episodes (widened through 30/60/90 days within the tier cap when fewer than 20 match;
# --days caps: anonymous 30, free 90, member 365)
askaipods "GPU shortage" --days 30

# Use an API key: a free account's key for 50/day, a member key for 100/day (anonymous: 20/day)
ASKAIPODS_API_KEY=pk_xxx askaipods "your query"
askaipods "your query" --api-key pk_xxx

# Select by relevance instead of recency (member-only; other tiers are served recency)
askaipods "history of RLHF" --sort relevance
```

### As an agent skill

Once the skill is installed in your agent's skills directory, simply ask:

> Are coding agents replacing software engineers? What are people saying on AI podcasts?

Your agent will recognize the trigger phrase, invoke `askaipods`, and present the results with an AI-generated Insights summary. The exact layout follows the served ordering: **relevance-selected** results (a member with `--sort relevance`) render dual sections (Latest 5 + Top 5 Most Relevant + Insights); **recency-selected** results (anonymous, free, and member by default) render a single section (Recent Quotes + Insights), because they are sorted by date (not semantic relevance) and showing a "Top Relevant" view would be misleading. The agent asks for relevance when the question calls for it ("strongest argument", "history of") and tells the user when the tier served recency instead. No CLI knowledge required from the user either way.

## Tier comparison

| | Anonymous (default) | Free | Member |
|---|---|---|---|
| **Daily quota** | 20 searches per IP | 50 searches per user | 100 searches per user |
| **Results returned** | The 20 newest of the most similar matches (up to 60 per searched window; API returns newest-first; `api_rank` = temporal order) | Same as anonymous | Same by default; with `--sort relevance`, the top 20 by semantic relevance (structured output is emitted newest-first; semantic rank preserved in `api_rank`) |
| **Text length** | Full text | Full text | Full text |
| **`--days` cap (omitted = the cap)** | 30 days | 90 days | 365 days |
| **Setup** | Nothing | Sign in free at https://podlens.net (Google or GitHub), then set `ASKAIPODS_API_KEY` to the account's API key | `ASKAIPODS_API_KEY` with a member key |
| **Access** | n/a | Open sign-up | Granted by PodLens; paid-membership waitlist at https://podlens.net/dashboard?source=askaipods#waitlist |

The anonymous tier exists so you can try the skill end-to-end with zero setup. A free sign-in raises the quota to 50/day and the lookback to 90 days. Member access (100/day, 365-day lookback, relevance ordering) is not open for sign-up: free users can join the paid-membership waitlist on the dashboard, which records interest in a future paid tier — joining does not grant membership, and no timeline is promised. When today's free-tier capacity is used up, a free user who still has quota of their own is served at the anonymous level instead (30 days, counted against the IP's 20/day) and the output says so (`downgraded`); a user who has used all 50 of their own searches gets the ordinary quota-exhausted error.

## Honest limitations

- **No speaker attribution.** The corpus indexes quotes at the episode level but does not attempt to identify *which guest* said each quote. The upstream pipeline avoids speaker labeling because automatic diarization is unreliable, and a wrong attribution is worse than no attribution.
- **Timestamps are approximate.** Each result carries the episode's YouTube watch URL (`url`, every tier) and, when PodLens could locate the passage confidently, `anchor_s` / `anchor_url` — the video opened about 10 seconds before the passage discussing the point ("around 12:34"), not at an exact quote position. Both are `null` when no confident timestamp exists (then `url` opens the episode from the start); `url` is `null` for an episode without a link.
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

For relevance-selected results (`render_hint: dual_view` — a member with `--sort relevance`), the host agent renders two sections plus insights:

```markdown
## 🆕 Latest 5
(5 most recent of the up to 20 returned results)

## 🎯 Top 5 Most Relevant
(5 results with the lowest api_rank, regardless of date)

## 💡 Insights
(3-5 bullets synthesizing patterns across the quotes)
```

For recency-selected results (`render_hint: single_view` — anonymous, free, and member by default), only Recent Quotes and Insights — the Top Relevant section is intentionally suppressed because these results are sorted by date (newest-first), so api_rank reflects temporal order, not semantic relevance.

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
