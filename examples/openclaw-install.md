# Install askaipods in OpenClaw

[OpenClaw](https://github.com/openclaw/openclaw) is [agentskills.io](https://agentskills.io)-compatible. Per the [official docs](https://docs.openclaw.ai/tools/skills), it loads skills from four locations with this precedence (highest first):

1. `<workspace>/skills/` — workspace skills (highest)
2. `<workspace>/.agents/skills/` — project agent skills
3. `~/.agents/skills/` — personal agent skills (shared with OpenAI Codex CLI)
4. `~/.openclaw/skills/` — managed/local skills (shared across all agents on the machine)

For most users, **option 3 is the best choice** because the same `~/.agents/skills/askaipods/` install also makes the skill available in OpenAI Codex CLI — one install, two runtimes.

## Recommended install (shared with Codex)

```bash
git clone https://github.com/Delibread0601/askaipods.git ~/Code/askaipods
mkdir -p ~/.agents/skills
ln -s ~/Code/askaipods/skill/askaipods ~/.agents/skills/askaipods
```

If you don't already use Codex and prefer to keep OpenClaw skills separate, install into the OpenClaw-native location instead:

```bash
mkdir -p ~/.openclaw/skills
ln -s ~/Code/askaipods/skill/askaipods ~/.openclaw/skills/askaipods
```

Or use the OpenClaw CLI once askaipods is published to the ClawHub registry (not yet — check back, or open an issue to track):

```bash
openclaw skills install askaipods   # not yet available
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

OpenClaw should recognize the trigger phrase, shell out to `npx askaipods search "..." --format json`, and render the structured response per the SKILL.md template.

## Troubleshooting

- **Skill not detected**: Run `openclaw skills update --all` to refresh, or restart the OpenClaw session. Check that the directory name `askaipods` matches the `name` field in `SKILL.md`.
- **`npx askaipods` fails**: Make sure Node.js 18+ is on PATH: `node --version`.
- **Conflicting copies across precedence levels**: Only the highest-precedence one wins. If you have askaipods in both `~/.agents/skills/` and `<workspace>/skills/`, the workspace one takes effect.

## Reference

- [OpenClaw skills documentation](https://docs.openclaw.ai/tools/skills)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [agentskills.io specification](https://agentskills.io/specification)
