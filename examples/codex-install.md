# Install askaipods in OpenAI Codex CLI

Codex CLI loads user-level skills from `~/.codex/skills/` (or `$CODEX_HOME/skills/` if the env var is set) and project-scoped skills from `.agents/skills/` within the repository workspace. When both scopes carry the same skill name, repository-scoped wins. For the authoritative scope list and any system-level paths your installed version supports, consult the [official Codex skills documentation](https://developers.openai.com/codex/skills).

For most users, the **user-level** install is what you want — it makes `askaipods` available across every project.

## User-level install

```bash
git clone https://github.com/Delibread0601/askaipods.git ~/Code/askaipods
mkdir -p ~/.codex/skills
ln -s ~/Code/askaipods/skill/askaipods ~/.codex/skills/askaipods
```

Symlink (above) is recommended so `git pull` updates flow through automatically. Or copy:

```bash
cp -r ~/Code/askaipods/skill/askaipods ~/.codex/skills/askaipods
```

## Project-only install

```bash
mkdir -p .agents/skills
cp -r /path/to/askaipods/skill/askaipods .agents/skills/askaipods
```

## Verify

Codex CLI detects skill changes automatically. If the skill does not appear after install, restart the Codex session.

In Codex, ask:

> What are people saying about reasoning models on AI podcasts?

Codex should detect the trigger, run `npx -y askaipods search --format json -- "..."`, and render the structured response per `SKILL.md`.

## Troubleshooting

- **Skill not detected**: Restart Codex (per the official docs, "If an update doesn't appear, restart Codex").
- **Multiple skills with the same name across scopes**: Codex shows both in the selector — repository-scoped wins by default.
- **`npx askaipods` fails**: Check Node.js 18.3.0+: `node --version`.

## Reference

- [OpenAI Codex skills documentation](https://developers.openai.com/codex/skills/)
- [agentskills.io specification](https://agentskills.io/specification)
