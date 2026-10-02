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

A personal skill (`~/.claude/skills/`) takes precedence over a project skill with the same name — remove or update the personal copy if you want the project copy to run.

## Verify

In Claude Code, ask:

> What skills are available?

You should see `askaipods` in the list. Or invoke it directly:

> /askaipods test-time compute

Or trigger it organically:

> What are people saying about test-time compute on AI podcasts?

Claude Code should recognize the trigger phrase, run `npx -y askaipods search --format json -- "..."` (argv-style per SKILL.md's invocation rule), parse the response, and render the structured results per the SKILL.md template (the layout follows `render_hint`, i.e. the served ordering — relevance-selected results (a member with `--sort relevance`) show Latest + Top Relevant + Insights; recency-selected results (anonymous, free, and member by default) show Recent Quotes + Insights).

## Troubleshooting

- **Skill not appearing**: Make sure the parent directory name matches the `name` field in `SKILL.md` (both must be `askaipods`).
- **`npx askaipods` fails**: Check that Node.js 18.3.0+ is installed: `node --version`. The CLI uses zero dependencies so there are no other prereqs.
- **Anonymous quota exhausted (20/day)**: sign in free with Google or GitHub at https://podlens.net, then `export ASKAIPODS_API_KEY=pk_xxx` with the account's API key for 50/day.
- **Free quota exhausted (50/day)**: member access (100/day) is not open for sign-up; the paid-membership waitlist is at https://podlens.net/dashboard?source=askaipods#waitlist — joining records interest and does not grant membership.
- **Skill triggers too rarely**: Front-load your prompt with the trigger phrases in `SKILL.md` description, or invoke directly with `/askaipods <query>`.

## Reference

- [Claude Code skills documentation](https://code.claude.com/docs/en/skills)
- [agentskills.io specification](https://agentskills.io/specification)
