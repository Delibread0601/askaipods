# Install askaipods in Hermes Agent

[Hermes Agent](https://github.com/nousresearch/hermes-agent) is built by Nous Research and is compatible with the [agentskills.io](https://agentskills.io) open standard. Skills live in `~/.hermes/skills/`.

## Install

```bash
git clone https://github.com/Delibread0601/askaipods.git ~/Code/askaipods
mkdir -p ~/.hermes/skills
ln -s ~/Code/askaipods/skill/askaipods ~/.hermes/skills/askaipods
```

Or copy:

```bash
cp -r ~/Code/askaipods/skill/askaipods ~/.hermes/skills/askaipods
```

## Verify

In a Hermes session, ask:

> Find what AI podcasts are saying about test-time compute

Hermes should pick up the skill from `~/.hermes/skills/askaipods/`, shell out to `npx askaipods`, and present the structured results.

## Troubleshooting

- **`npx askaipods` fails**: Hermes is Python-based but the askaipods CLI is Node. Make sure Node.js 18+ is on PATH alongside Python: `node --version`.
- **Skill not picked up**: Hermes documentation indicates skills are loaded from `~/.hermes/skills/`. Restart the agent after install if needed.
- **Quota exhausted**: Set `ASKAIPODS_API_KEY` in your shell environment before launching Hermes so the variable propagates to subprocess calls.

## Reference

- [Hermes Agent README](https://github.com/nousresearch/hermes-agent)
- [agentskills.io specification](https://agentskills.io/specification)
