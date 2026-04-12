# Install askaipods in Claude Code

## Personal install (available across all your projects)

```bash
git clone https://github.com/Delibread0601/askaipods.git ~/Code/askaipods
mkdir -p ~/.claude/skills
ln -s ~/Code/askaipods/skill/askaipods ~/.claude/skills/askaipods
```

The symlink lets you `git pull` updates to the repo and have them picked up automatically without recopying.

If you prefer a copy over a symlink:

```bash
cp -r ~/Code/askaipods/skill/askaipods ~/.claude/skills/askaipods
```

## Project-only install (only for the current repo)

```bash
mkdir -p .claude/skills
cp -r /path/to/askaipods/skill/askaipods .claude/skills/askaipods
```

Project-level skills override personal-level skills with the same name.

## Verify

In Claude Code, ask:

> What skills are available?

You should see `askaipods` in the list. Or invoke it directly:

> /askaipods test-time compute

Or trigger it organically:

> What are people saying about test-time compute on AI podcasts?

Claude Code should recognize the trigger phrase, run `npx askaipods search "..." --format json`, parse the response, and render the Latest / Top Relevant / Insights sections.

## Troubleshooting

- **Skill not appearing**: Make sure the parent directory name matches the `name` field in `SKILL.md` (both must be `askaipods`).
- **`npx askaipods` fails**: Check that Node.js 18+ is installed: `node --version`. The CLI uses zero dependencies so there are no other prereqs.
- **Anonymous quota exhausted**: Sign up at https://podlens.net for 50/day, then `export ASKAIPODS_API_KEY=pk_xxx`.
- **Skill triggers too rarely**: Front-load your prompt with the trigger phrases in `SKILL.md` description, or invoke directly with `/askaipods <query>`.

## Reference

- [Claude Code skills documentation](https://code.claude.com/docs/en/skills)
- [agentskills.io specification](https://agentskills.io/specification)
