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

> Find what AI podcasts are saying about coding agents replacing software engineers

Hermes should pick up the skill from `~/.hermes/skills/askaipods/`, shell out to `npx -y askaipods ...` (argv-style per SKILL.md's invocation rule), and present the structured results.

## Troubleshooting

- **`npx askaipods` fails**: Hermes is Python-based but the askaipods CLI is Node. Make sure Node.js 18.3.0+ is on PATH alongside Python: `node --version`.
- **Skill not picked up**: Hermes loads skills from `~/.hermes/skills/`. If `askaipods` is not listed, start a new Hermes session.
- **Quota exhausted**: Anonymous use allows 20 searches/day per IP. Sign in free with Google or GitHub at https://podlens.net for an API key with 50/day, and set `ASKAIPODS_API_KEY` in your shell environment before launching Hermes so the variable propagates to subprocess calls. Free users who need more can join the paid-membership waitlist at https://podlens.net/dashboard?source=askaipods#waitlist (joining records interest; it does not grant membership).

## Reference

- [Hermes Agent README](https://github.com/nousresearch/hermes-agent)
- [agentskills.io specification](https://agentskills.io/specification)
