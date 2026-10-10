# askaipods

> Search podcast quotes about AI and tech investing — recent episode excerpts from 70+ podcasts (Lex Fridman, Dwarkesh Patel, No Priors, Latent Space, Odd Lots, All-In, and more), surfaced as short indexed quotes (no per-speaker attribution). A universal [agentskills.io](https://agentskills.io) skill compatible with Claude Code, OpenAI Codex, Hermes Agent, OpenClaw, and any other agent that supports the open skill standard. Powered by [podlens.net](https://podlens.net).

```
$ askaipods "when will AGI arrive"

# askaipods · "when will AGI arrive"

*Tier: anonymous · Sort: recency · Results: 20 · Quota: 5/20 daily*

## Results — newest first

### 1. The Cognitive Revolution — AI:AM: A Level We Shouldn't Pass? Notes from The Curve + Tokens vs. Salaries & Is SaaS Cooked?
*2026-10-08* · https://www.youtube.com/watch?v=g_K9pqbQJwU · around 17:20: https://www.youtube.com/watch?v=g_K9pqbQJwU&t=1040s

> Prakash said Elon Musk is betting that infrastructure matters more than
> models and is planning for 2029-2031 (terawatt-scale efforts, SpaceX
> satellites in the 2030s), while Anthropic and OpenAI are planning for a
> two-to-three-year horizon, with AGI/RSI around 2028-2029 (Prakash).

### 2. ChinaTalk — Washington is AGI-Pilled | Kevin Roose
*2026-10-08* · https://www.youtube.com/watch?v=e8NQczdKrks · around 55:50: https://www.youtube.com/watch?v=e8NQczdKrks&t=3350s

> Roose said the story he cares most about now is recursive self-improvement
> and whether an intelligence explosion arrives in 2027, which serious
> people now tell him could happen, including full automation of AI R&D next
> year.

### 3. ChinaTalk — Washington is AGI-Pilled | Kevin Roose
*2026-10-08* · https://www.youtube.com/watch?v=e8NQczdKrks · around 58:35: https://www.youtube.com/watch?v=e8NQczdKrks&t=3515s

> Jordan predicted that if AI doubles in capability every month or so,
> developed societies will reject an industrial-revolution-scale shock over
> five years and a political 'just say no' response will gain momentum;
> Roose mentioned a 'Butlerian Jihad' as possible.

### 4. The Cognitive Revolution — AI:AM: A Level We Shouldn't Pass? Notes from The Curve + Tokens vs. Salaries & Is SaaS Cooked?
*2026-10-08* · https://www.youtube.com/watch?v=g_K9pqbQJwU · around 22:20: https://www.youtube.com/watch?v=g_K9pqbQJwU&t=1340s

> Insiders repeatedly said they expect to be bottlenecked on safety and
> alignment, but that enough low-hanging fruit (such as fixing RL
> environments) remains to release the next one or two generations
> comfortably; beyond that, 'all bets are off' (host).

### 5. Pioneers of AI — OpenAI’s Tibo Sottiaux doesn’t want humans to be an ‘afterthought’
*2026-10-07* · https://www.youtube.com/watch?v=rzh4uC2-SqU

> Sotio said there is no clear definition of AGI, but predicted that in a
> couple of years people will point to roughly this period as when it was
> achieved.

(...15 more results, newest-first...)
```

*Real output, captured 2026-10-10 without an API key (anonymous tier: 20/day per IP, 30-day window); the full output ends with the anonymous-tier note. Quotes are wrapped for width.*

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

# Use an API key: a free account's key for 50/day (anonymous level for the account's first 48 hours),
# a member key for 100/day (anonymous: 20/day)
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
| **Daily quota** | 20 searches per IP (IPv6: also 200 per /48 network, shared) | 50 searches per user (anonymous level for the account's first 48 hours) | 100 searches per user |
| **Results returned** | The 20 newest of the most similar matches (up to 60 per searched window; API returns newest-first; `api_rank` = temporal order) | Same as anonymous | Same by default; with `--sort relevance`, the top 20 by semantic relevance (structured output is emitted newest-first; semantic rank preserved in `api_rank`) |
| **Text length** | Full text | Full text | Full text |
| **`--days` cap (omitted = the cap)** | 30 days | 90 days | 365 days |
| **Setup** | Nothing | Sign in free at https://podlens.net (Google or GitHub), then set `ASKAIPODS_API_KEY` to the account's API key | `ASKAIPODS_API_KEY` with a member key |
| **Access** | n/a | Open sign-up | Granted by PodLens; paid-membership waitlist at https://podlens.net/dashboard?source=askaipods#waitlist |

The anonymous tier exists so you can try the skill end-to-end with zero setup. A free sign-in raises the quota to 50/day and the lookback to 90 days once the account is 48 hours old; until then the account searches at the anonymous level (30 days, counted against the IP's 20/day) and the output says so (`downgraded`, reason `new_account`). Member access (100/day, 365-day lookback, relevance ordering) is not open for sign-up: free users can join the paid-membership waitlist on the dashboard, which records interest in a future paid tier — joining does not grant membership, and no timeline is promised. When today's free-tier capacity is used up, a free user who still has quota of their own is served at the anonymous level instead (30 days, counted against the IP's 20/day) and the output says so (`downgraded`, reason `free_pool_exhausted`); a user who has used all 50 of their own searches gets the ordinary quota-exhausted error. Over IPv6, every anonymous-level search (including a free account served at the anonymous level) also counts against a 200/day allowance shared by the whole /48 network; when that runs out first, anonymous-level searches from every address on the network stop for the day, even at an address with searches left of its own (free- and member-level searches are not affected), and the quota-exhausted error names the network allowance.

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
| `2` | Daily quota exhausted, or podlens.net's daily capacity for anonymous-level searches reached. Retrying at the same tier before 00:00 UTC will fail. |
| `3` | Transient or unexpected failure — network error, rate-limit burst, transient service 503, protocol/shape error, or internal exception. stderr has the actionable detail. |

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
