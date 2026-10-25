# Install askaipods in OpenAI Codex CLI

Codex CLI loads user-level skills from `~/.agents/skills/` and project-scoped skills from `.agents/skills/` within the repository workspace (earlier Codex releases read user-level skills from `~/.codex/skills/`). `~/.agents/skills/` is also OpenClaw's personal skills location, so one install serves both. For the authoritative scope list and any system-level paths your installed version supports, consult the [official Codex skills documentation](https://learn.chatgpt.com/docs/build-skills).

For most users, the **user-level** install is what you want — it makes `askaipods` available across every project.

## User-level install

```bash
git clone https://github.com/Delibread0601/askaipods.git ~/Code/askaipods
mkdir -p ~/.agents/skills
ln -s ~/Code/askaipods/skill/askaipods ~/.agents/skills/askaipods
```

Symlink (above) is recommended so `git pull` updates flow through automatically. Or copy:

```bash
cp -r ~/Code/askaipods/skill/askaipods ~/.agents/skills/askaipods
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

Codex should detect the trigger, run the bundled `node <skill-dir>/scripts/askaipods.mjs search --format json -- '...'` (falling back to the pinned `npx -y askaipods@<version>` named in SKILL.md only when the scripts folder is missing), and render the structured response per `SKILL.md`.

## Troubleshooting

- **Skill not detected**: Restart Codex (per the official docs, "If an update doesn't appear, restart Codex").
- **Multiple skills with the same name across scopes**: Codex shows both in the selector — pick the intended copy, or remove the duplicate.
- **The search command fails**: Check Node.js 18.3.0+: `node --version`.
- **Network blocked by the sandbox**: Codex's default `workspace-write` sandbox has network access off, so the search fails with `fetch failed (ENOTFOUND)` or similar. Approve the command when Codex asks for network access, or enable network access in your Codex sandbox settings (see the [Codex sandbox documentation](https://learn.chatgpt.com/docs/agent-approvals-security)); a search only needs `podlens.net`.

## Reference

- [OpenAI Codex skills documentation](https://learn.chatgpt.com/docs/build-skills)
- [agentskills.io specification](https://agentskills.io/specification)
