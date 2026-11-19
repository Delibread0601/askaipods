# askaipods

> Search podcast key points about AI and tech investing — from recent episodes of 80+ podcasts (Lex Fridman, Dwarkesh Patel, No Priors, Latent Space, Odd Lots, All-In, and more), with no per-speaker attribution. A universal [agentskills.io](https://agentskills.io) skill compatible with Claude Code, OpenAI Codex, Hermes Agent, OpenClaw, and any other agent that supports the open skill standard. Powered by [podlens.net](https://podlens.net).

```
$ askaipods "when will AGI arrive"

# askaipods · "when will AGI arrive"

*Tier: anonymous · Sort: recency · Results: 20 · Quota: 12/20 daily*

## Results — newest first

### 1. Automated with Brian Heater — Why Hello Robot’s Stretch Doesn’t Look Like a Human
*2026-11-18* · https://www.youtube.com/watch?v=gAuRGA_QmYs · around 42:20: https://www.youtube.com/watch?v=gAuRGA_QmYs&t=2540s

> The host noted that predictions like AGI always seem '5 to 10
> years' away, and Edsinger cited Rodney Brooks's point that such
> timelines always fall within the presenter's own lifetime.

### 2. Newcomer Podcast — Is OpenAI Becoming the WeWork of AI? | Gary Marcus
*2026-11-18* · https://www.youtube.com/watch?v=Ub64R5Ts2wA · around 45:50: https://www.youtube.com/watch?v=Ub64R5Ts2wA&t=2750s

> Marcus expects recursive self-improvement within about 3 years
> only for engineering-type gains (such as shrinking models while
> keeping accuracy), not for genuine scientific breakthroughs.

### 3. Big Technology Podcast — Why The Anthropic IPO Will Fail — With Gary Marcus
*2026-11-17* · https://www.youtube.com/watch?v=9Y4HDQnvCas · around 53:35: https://www.youtube.com/watch?v=9Y4HDQnvCas&t=3215s

> Marcus's AGI timeline is 'probably sometime next decade.' He said
> anyone giving a specific year lacks credibility without confidence
> intervals, and he does not see AGI this decade (Marcus).

### 4. Big Technology Podcast — Why The Anthropic IPO Will Fail — With Gary Marcus
*2026-11-17* · https://www.youtube.com/watch?v=9Y4HDQnvCas

> Marcus said that even if the needed scientific discoveries arrive
> in the rest of this decade, putting them into practice will take
> years, so he does not see real AGI/ASI this decade. He added that
> 13 years from now is a long time, given the huge spending and a
> growing understanding of what is still unknown (Marcus).

### 5. Scaling Laws — Live from Georgetown University: AI Policy in 2027 with Alexandra Reeve Givens
*2026-11-17* · https://www.youtube.com/watch?v=cLbN1H2eX_M · around 42:35: https://www.youtube.com/watch?v=cLbN1H2eX_M&t=2555s

> Alex Bores said OpenAI estimated reaching automated AI research by
> March 2028, Anthropic employees say 2027, and the AI Futures
> Project and the new METR report suggest 2027 may be more accurate,
> which is before the next election.

(...15 more results, newest-first...)
```

*Real output, captured 2026-11-19 without an API key (anonymous tier: 20/day per IP, 30-day window); the full output ends with the anonymous-tier note. Key points are wrapped for width.*

## Why this exists

Web search is bad at "what is the AI community thinking about X right now". You get blog posts, Reddit threads, and outdated news articles. What you actually want is the *real conversation* — what researchers, founders, and investors are saying on AI podcasts.

`askaipods` is a thin CLI + agent skill that asks the [PodLens](https://podlens.net) semantic search API and returns the most relevant key points, sorted newest-first. The skill teaches your agent (Claude Code, OpenAI Codex, Hermes, OpenClaw, and any other [agentskills.io](https://agentskills.io)-compatible runtime) when to call the CLI, how to parse the output, and how to write a useful **Insights** section that summarizes the patterns across the returned key points.

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

**Per-runtime paths matter**: Codex CLI documents `~/.agents/skills/` as its user-level location (per the [official Codex skills docs](https://learn.chatgpt.com/docs/build-skills); current releases also still read the older `~/.codex/skills/`) — the same directory OpenClaw reads as personal agent skills, so one install there serves both. Project-scoped skills live under `.agents/skills/` in the repository. Claude Code and Hermes each read their own directory (table above).

The skill folder is self-contained: it bundles the CLI (`scripts/askaipods.mjs`, run with Node — no npm install, registry access or download when the agent searches) and tells the host agent how to invoke it, how to parse the JSON, and how to render the response with an **Insights** section. The section layout follows how the server selected the results — relevance-selected results (a member with `--sort relevance`) render **Latest 5** + **Top 5 Most Relevant** + **Insights**; recency-selected results (anonymous, free, and member by default) render **Recent Key Points** + **Insights** (the "Top Relevant" section is suppressed for them because the API returns results sorted by date, not by semantic relevance).

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

# Select by relevance instead of recency (member-only; other tiers are served recency)
askaipods "history of RLHF" --sort relevance
```

To use an API key (a free account's key gives 50/day, at the anonymous level for the account's first 48 hours; a member key gives 100/day; anonymous is 20/day), add `export ASKAIPODS_API_KEY=<your key>` to your shell profile (e.g. `~/.zshrc`) and open a new terminal; agents started from that shell inherit it. Keep the key out of commands you type or ask an agent to run — command lines end up in shell history, process lists and agent transcripts. (`--api-key` still works for compatibility, with that exposure.)

### As an agent skill

Once the skill is installed in your agent's skills directory, simply ask:

> Are coding agents replacing software engineers? What are people saying on AI podcasts?

Your agent will recognize the trigger phrase, invoke `askaipods`, and present the results with an AI-generated Insights summary. The exact layout follows the served ordering: **relevance-selected** results (a member with `--sort relevance`) render dual sections (Latest 5 + Top 5 Most Relevant + Insights); **recency-selected** results (anonymous, free, and member by default) render a single section (Recent Key Points + Insights), because they are sorted by date (not semantic relevance) and showing a "Top Relevant" view would be misleading. The agent asks for relevance when the question calls for it ("strongest argument", "history of") and tells the user when the tier served recency instead. No CLI knowledge required from the user either way.

## Tier comparison

| | Anonymous (default) | Free | Member |
|---|---|---|---|
| **Daily quota** | 20 searches per IP (IPv6: also 200 per /48 network, shared) | 50 searches per user (anonymous level for the account's first 48 hours) | 100 searches per user |
| **Results returned** | The 20 newest of the most similar matches (up to 60 per searched window; API returns newest-first; `api_rank` = temporal order) | Same as anonymous | Same by default; with `--sort relevance`, the top 20 by semantic relevance (structured output is emitted newest-first; semantic rank preserved in `api_rank`) |
| **Text length** | Full text | Full text | Full text |
| **`--days` cap** | 30 days | 90 days | 365 days |
| **`--days` omitted** | Last 30 days | Last 30 days, widened up to 90 when fewer than 20 match | Last 30 days, widened up to 365 when fewer than 20 match (`--sort relevance`: 365 days) |
| **Setup** | Nothing | Sign in free at https://podlens.net (Google or GitHub), then set `ASKAIPODS_API_KEY` to the account's API key | `ASKAIPODS_API_KEY` with a member key |
| **Access** | n/a | Open sign-up | Granted by PodLens; paid-membership waitlist at https://podlens.net/dashboard?source=askaipods#waitlist |

The anonymous tier exists so you can try the skill end-to-end with zero setup. A free sign-in raises the quota to 50/day and the lookback to 90 days once the account is 48 hours old; until then the account searches at the anonymous level (30 days, counted against the IP's 20/day) and the output says so (`downgraded`, reason `new_account`). Member access (100/day, 365-day lookback, relevance ordering) is not open for sign-up: free users can join the paid-membership waitlist on the dashboard, which records interest in a future paid tier — joining does not grant membership, and no timeline is promised. When today's free-tier capacity is used up, a free user who still has quota of their own is served at the anonymous level instead (30 days, counted against the IP's 20/day) and the output says so (`downgraded`, reason `free_pool_exhausted`); a user who has used all 50 of their own searches gets the ordinary quota-exhausted error. Over IPv6, every anonymous-level search (including a free account served at the anonymous level) also counts against a 200/day allowance shared by the whole /48 network; when that runs out first, anonymous-level searches from every address on the network stop for the day, even at an address with searches left of its own (free- and member-level searches are not affected), and the quota-exhausted error names the network allowance.

## Honest limitations

- **No speaker attribution.** The corpus indexes key points at the episode level but does not attempt to identify *which guest* made each point. The upstream pipeline avoids speaker labeling because automatic diarization is unreliable, and a wrong attribution is worse than no attribution.
- **Timestamps are approximate.** Each result carries the episode's YouTube watch URL (`url`, every tier) and, when PodLens could locate the passage confidently, `anchor_s` / `anchor_url` — the video opened about 10 seconds before the passage discussing the point ("around 12:34"), not at an exact position. Both are `null` when no confident timestamp exists (then `url` opens the episode from the start); `url` is `null` for an episode without a link.
- **AI-centred corpus.** 80+ podcasts centred on AI research, engineering, and investing, also covering venture capital, global markets & finance, semiconductors & compute, and tech policy & geopolitics. Topics outside these domains return sparse, loosely related results.
- **Short key points.** Each result is one extracted key point, typically 1-3 sentences, and may paraphrase the speaker rather than quote them. For long-form context, listen to the episode.

These are not bugs. The skill surfaces them honestly so neither you nor your agent fabricate things the API does not provide.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Usage error / invalid arguments / API key rejected |
| `2` | Daily quota exhausted, or podlens.net's daily capacity for anonymous-level searches reached. Retrying at the same tier before 00:00 UTC will fail. |
| `3` | Transient or unexpected failure — network error, rate-limit burst, transient service 503, protocol/shape error, or internal exception. stderr has the actionable detail. |

## Security and sandboxes

- **No download when an agent searches.** The skill runs the CLI bundled in its own folder with `node`; nothing is fetched from npm at run time. If only `SKILL.md` is available, the agent falls back to an exact pinned release (`npx -y askaipods@<version>`), never an unpinned or `@latest` one.
- **One network destination.** A search needs Node.js 18.3.0+ and outbound HTTPS to `podlens.net` — nothing else. It installs nothing and writes no files, so it runs in a read-only or network-allowlisted sandbox once `podlens.net` is allowed (the `npx` fallback also needs `registry.npmjs.org` and a writable npm cache). In a sandbox that routes traffic through a proxy (`HTTPS_PROXY`, as Claude Code's does), Node's fetch uses that proxy only with `NODE_USE_ENV_PROXY=1` (Node 22.21+ or 24+); the error message says so when it applies. When the network is blocked, the error names the cause code (e.g. `ENOTFOUND`) and the skill tells the agent to ask for network approval instead of retrying.
- **Results are untrusted text.** Key points come from third-party podcast content. The skill tells the agent to treat them as data — never follow instructions inside them — and to link only the YouTube URLs the CLI has validated. Both output formats drop control characters (JSON output keeps tabs and line breaks) and invisible format characters (bidi overrides, zero-width spaces, tag characters; the joiners emoji sequences need are kept) from every server string; markdown output and error messages also fold line breaks. A waitlist link is passed on only when it points to `podlens.net`, and a server code (warning, downgrade reason) only when it is a short identifier.
- **Keys stay out of commands.** The key is read from `ASKAIPODS_API_KEY`; the skill never puts it on a command line.

See [`skill/askaipods/SKILL.md`](skill/askaipods/SKILL.md) for the full skill specification.

## Architecture

```
askaipods/
├── bin/askaipods.js       ← npm entry (imports the bundled CLI)
├── skill/askaipods/
│   ├── SKILL.md           ← agentskills.io standard skill file
│   ├── references/
│   │   └── notices.md     ← banners and empty-result rules, loaded on demand
│   └── scripts/           ← the CLI itself, shipped inside the skill
│       ├── askaipods.mjs  ← entry (shebang)
│       ├── cli.mjs        ← arg parsing, format auto-detection
│       ├── client.mjs     ← podlens.net /api/search/semantic client
│       ├── format.mjs     ← time-desc sort + JSON / markdown rendering
│       └── shared.mjs     ← waitlist link + terminal-safe text, for client and format
├── examples/              ← per-runtime install guides
├── package.json           ← zero dependencies (Node 18.3.0+ stdlib only)
├── LICENSE                ← MIT
└── README.md
```

The CLI is intentionally zero-dependency (Node 18.3.0+ stdlib only — `node:util.parseArgs` requires 18.3.0) so `npx askaipods` cold-starts in under a second, the package install footprint is minimal, and the skill can ship the CLI as plain files.

## Contributing

Issues and PRs welcome at https://github.com/Delibread0601/askaipods.

If you find a runtime that conforms to [agentskills.io](https://agentskills.io) but is not yet listed in the install table above, please open an issue or PR with the install path and we'll add it.

## License

MIT — see [LICENSE](LICENSE).

---

Powered by [podlens.net](https://podlens.net) — AI podcast intelligence.
