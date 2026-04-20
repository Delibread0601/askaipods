# askaipods — project instructions

A zero-dependency npm CLI (`askaipods`) and companion [agentskills.io](https://agentskills.io) skill that wraps the [podlens.net](https://podlens.net) semantic search API, returning recent quote excerpts from AI podcasts. Distributed as a global CLI via `npx` / `npm install` and as a skill drop-in under each runtime's `skills/` directory (`~/.claude/skills/`, `~/.codex/skills/`, `~/.openclaw/skills/` or `~/.agents/skills/`, `~/.hermes/skills/`). README holds the authoritative per-runtime path table.

## Release notes style

GitHub release notes describe **what changed**, not **how the change was arrived at**. Do not mention Codex quality review rounds (R1, R2, ...), `plugin-dev:skill-reviewer` passes, `/verify` scans, `/code-audit` iterations, model identifiers, rejected-finding references, round counts, or "quality gates passed" sections. Include: features, fixes, contract changes, user-facing string changes, breaking changes, honest limitations, migration notes, and deferred scope for the next release (named in plain English, without review artifacts).

Release notes are written for npm / GitHub consumers, not for internal project history. The `v0.2.3` and `v0.2.4` release notes are the cleanest style templates.

This rule applies to the GitHub release body only — not to git commit messages (where referencing the review process for internal repo history is fine) and not to internal review transcripts.

## Release workflow

1. **Bump the version in three locations** (all three must match, every time):
   - `package.json` `"version"`
   - `src/cli.js` `const VERSION = "..."`
   - `src/client.js` `User-Agent` header string
2. **Commit and push to `main`.** The `.github/workflows/auto-tag.yml` workflow watches `package.json` changes on `main`; when the version field changes and the tag does not already exist, it creates and pushes the `vX.Y.Z` tag. It does **not** create a GitHub release.
3. **Create the GitHub release manually** with `gh release create vX.Y.Z --title "vX.Y.Z — <short descriptor>" --notes "$(cat <<'EOF' ... EOF)"`, following the §Release notes style rule above. Use `gh release edit` to amend; do not delete-and-recreate (URLs break, subscribers re-notified).
4. **Publish to npm** (`npm publish`) if the release is a source change — skip npm publish for release-note-only corrections.

## Zero-dependency constraint

`package.json` has empty `dependencies` and `devDependencies` objects, and should stay that way. This is a load-bearing design choice — no dependency means no supply-chain surface for a CLI that agents run via `npx -y`.

- Tests must use `node:test` + `node:assert/strict` from the Node standard library. Do not add `jest`, `mocha`, `vitest`, or any other test framework.
- Runtime must stay on Node 18.3.0+ built-ins: `fetch`, `AbortSignal.timeout`, `parseArgs` from `node:util`, `Headers`, `URL`, etc. Do not add `node-fetch`, `commander`, `yargs`, or similar.
- If a truly unavoidable dependency comes up, it's a design discussion, not a mechanical addition.

## Instruction-content language

All instructional content in this file (rules, explanations, workflow steps) is written in English per the user's global `~/.claude/CLAUDE.md` convention. User-facing CLI output, release notes, and README content may use whatever language the audience expects.
