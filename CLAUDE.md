# askaipods — project instructions

A zero-dependency npm CLI (`askaipods`) and companion [agentskills.io](https://agentskills.io) skill that wraps the [podlens.net](https://podlens.net) semantic search API, returning recent quote excerpts from 70+ AI-centred podcasts. Distributed as a global CLI via `npx` / `npm install` and as a skill drop-in under each runtime's `skills/` directory (`~/.claude/skills/`, `~/.agents/skills/` for Codex and OpenClaw, `~/.openclaw/skills/`, `~/.hermes/skills/`). README holds the authoritative per-runtime path table.

## Release notes style

GitHub release notes describe **what changed**, not **how the change was arrived at**. Do not mention Codex quality review rounds (R1, R2, ...), `plugin-dev:skill-reviewer` passes, `/verify` scans, `/code-audit` iterations, model identifiers, rejected-finding references, round counts, or "quality gates passed" sections. Include: features, fixes, contract changes, user-facing string changes, breaking changes, honest limitations, migration notes, and deferred scope for the next release (named in plain English, without review artifacts).

Release notes are written for npm / GitHub consumers, not for internal project history. The `v0.2.3` and `v0.2.4` release notes are the cleanest style templates.

This rule applies to the GitHub release body only — not to git commit messages (where referencing the review process for internal repo history is fine) and not to internal review transcripts.

## Release workflow

1. **Bump the version in three locations** (all three must match, every time):
   - `package.json` `"version"`
   - `src/cli.js` `const VERSION = "..."`
   - `src/client.js` `User-Agent` header string
2. **Recapture the README hero** (the sample output at the top of README.md) in the same commit, so episode titles and results do not drift. Re-run its command and replace the block with the new real output — never hand-edit titles, dates or quotes; soft-wrapping quote lines is the only allowed change. Prefer an anonymous capture (no key, no `--days`) so the header reads `Tier: anonymous`; when the IP's anonymous quota is used up, capture with a key plus `--days 30` and keep the command line and the italic note under the block saying so. Update the capture date in that note. If the top results have gone off-topic, pick a new query rather than trimming the list.
3. **Commit and push to `main`.** The `.github/workflows/auto-tag.yml` workflow watches `package.json` changes on `main`; when the version field changes and the tag does not already exist, it creates and pushes the `vX.Y.Z` tag. Whenever the version changes and no release exists for that tag yet, it also publishes a placeholder GitHub release (title = tag, auto-generated notes) so the "Latest" release never lags the newest tag.
4. **Replace the placeholder release notes** with `gh release edit vX.Y.Z --title "vX.Y.Z — <short descriptor>" --notes "$(cat <<'EOF' ... EOF)"`, following the §Release notes style rule above. If the workflow failed to create the release, use `gh release create` with the same arguments instead. Do not delete-and-recreate (URLs break, subscribers re-notified).
5. **Publish to npm** (`npm publish`) if the release is a source change — skip npm publish for release-note-only corrections. Authenticate interactively (`npm login --auth-type=web`) and complete the 2FA prompt on publish; do not store a long-lived publish token in `~/.npmrc` — npm is removing direct-publish rights from 2FA-bypass granular tokens (January 2027). The 2FA step needs the user, so Claude hands this command to the user rather than running it.

## Zero-dependency constraint

`package.json` declares no `dependencies` or `devDependencies`, and should stay that way. This is a load-bearing design choice — no dependency means no supply-chain surface for a CLI that agents run via `npx -y`.

- Tests must use `node:test` + `node:assert/strict` from the Node standard library. Do not add `jest`, `mocha`, `vitest`, or any other test framework.
- Runtime must stay on Node 18.3.0+ built-ins: `fetch`, `AbortSignal.timeout`, `parseArgs` from `node:util`, `Headers`, `URL`, etc. Do not add `node-fetch`, `commander`, `yargs`, or similar.
- If a truly unavoidable dependency comes up, it's a design discussion, not a mechanical addition.

## Instruction-content language

All instructional content in this file (rules, explanations, workflow steps) is written in English per the user's global `~/.claude/CLAUDE.md` convention. User-facing CLI output, release notes, and README content may use whatever language the audience expects.
