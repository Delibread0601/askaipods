# Install askaipods in OpenClaw

[OpenClaw](https://github.com/openclaw/openclaw) is [agentskills.io](https://agentskills.io)-compatible. Per the [official docs](https://docs.openclaw.ai/tools/skills), it loads skills from several locations; the four that matter for installing askaipods, in precedence order (highest first), are:

1. `<workspace>/skills/` — workspace skills (highest)
2. `<workspace>/.agents/skills/` — project agent skills
3. `~/.agents/skills/` — personal agent skills
4. `~/.openclaw/skills/` — managed/local skills (shared across all agents on the machine)

> **Note**: `~/.agents/skills/` (location 3) is also the user-level location OpenAI Codex CLI documents ([official Codex skills docs](https://learn.chatgpt.com/docs/build-skills)), so an install there serves both runtimes (see [examples/codex-install.md](codex-install.md)).

## Recommended install

Install into the OpenClaw-native location (option 4 — lowest precedence of the four, but stable across agent versions):

```bash
git clone https://github.com/Delibread0601/askaipods.git ~/Code/askaipods
mkdir -p ~/.openclaw/skills
ln -s ~/Code/askaipods/skill/askaipods ~/.openclaw/skills/askaipods
```

Or use the shared personal-skills location (option 3) if you want the skill visible to every agentskills.io-compatible runtime that respects the `~/.agents/skills/` convention:

```bash
mkdir -p ~/.agents/skills
ln -s ~/Code/askaipods/skill/askaipods ~/.agents/skills/askaipods
```

## Workspace-only install

To make askaipods available only inside a specific OpenClaw workspace:

```bash
mkdir -p <workspace>/skills
cp -r ~/Code/askaipods/skill/askaipods <workspace>/skills/askaipods
```

This wins over all user-level installs for that workspace.

## Verify

In OpenClaw, ask:

> What are AI podcasts saying about reasoning models?

OpenClaw should recognize the trigger phrase, shell out to `npx -y askaipods search --format json -- "..."` (argv-style per SKILL.md's invocation rule), and render the structured response per the SKILL.md template.

## Troubleshooting

- **Skill not detected**: OpenClaw watches skill folders and refreshes when `SKILL.md` changes; if the skill still does not appear, start a new session or restart the OpenClaw Gateway (`openclaw skills update` tracks ClawHub installs only, not this Git/copied install). Check that the directory name `askaipods` matches the `name` field in `SKILL.md`.
- **`npx askaipods` fails**: Make sure Node.js 18.3.0+ is on PATH: `node --version`.
- **Conflicting copies across precedence levels**: Only the highest-precedence one wins. If you have askaipods in both `~/.agents/skills/` and `<workspace>/skills/`, the workspace one takes effect.

## Reference

- [OpenClaw skills documentation](https://docs.openclaw.ai/tools/skills)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [agentskills.io specification](https://agentskills.io/specification)
