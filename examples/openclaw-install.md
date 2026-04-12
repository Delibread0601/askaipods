# Install askaipods in OpenClaw

[OpenClaw](https://github.com/openclaw/openclaw) supports a "skills platform" with bundled, managed, and workspace skills. The skill format is compatible with the [agentskills.io](https://agentskills.io) open standard, but the exact filesystem path for user-installed workspace skills is documented at [docs.openclaw.ai/tools/skills](https://docs.openclaw.ai/tools/skills) — please consult the official documentation for your version.

## General install pattern

```bash
git clone https://github.com/Delibread0601/askaipods.git ~/Code/askaipods
```

Then place `~/Code/askaipods/skill/askaipods/` into the OpenClaw skills directory documented for your installation. Each agentskills.io skill is a folder containing `SKILL.md`, and OpenClaw should pick it up automatically once placed in the right location.

## Hermes Agent fallback

If you are running Hermes Agent alongside OpenClaw, Hermes provides an explicit import path for OpenClaw-format skills at `~/.hermes/skills/openclaw-imports/`:

```bash
mkdir -p ~/.hermes/skills/openclaw-imports
ln -s ~/Code/askaipods/skill/askaipods ~/.hermes/skills/openclaw-imports/askaipods
```

This works even if you have not configured OpenClaw itself, since Hermes will load the skill via its own runtime.

## Verify

In OpenClaw, ask:

> What are AI podcasts saying about <topic>?

OpenClaw should recognize the trigger and shell out to `npx askaipods search "..." --format json`.

## Troubleshooting

- **Path uncertainty**: The OpenClaw README excerpt available at the time of writing did not document the exact user-skill install path. Check `docs.openclaw.ai/tools/skills` and `openclaw skills --help` for the authoritative answer for your installed version.
- **`npx askaipods` fails**: Make sure Node.js 18+ is on PATH: `node --version`.
- **Skill not detected**: OpenClaw uses a "ClawHub" registry for managed skills; workspace skills may need to be registered separately. See the official docs.

## Reference

- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [agentskills.io specification](https://agentskills.io/specification)
- If you successfully install askaipods in OpenClaw and the path differs from what's described here, please [open an issue](https://github.com/Delibread0601/askaipods/issues) so this guide can be improved.
