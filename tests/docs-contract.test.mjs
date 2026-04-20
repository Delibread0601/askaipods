// Contract tests for shipped documentation. Cheap static checks so the
// doc-only ledger items from v0.2.5 convergence (R7-03 `npx -y`, R7-04
// Codex CLI path) cannot silently regress in a future edit.
//
// Scope excludes R2-04 (README 'Results returned' row rewrite): the
// rewrite was a one-time copy change with no stable contract text to
// pin without over-coupling to English phrasing.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (relpath) => readFileSync(join(ROOT, relpath), "utf8");

// Return concatenated content of all ```-fenced code blocks. Used to
// distinguish actual invocation examples (inside code fences) from
// narrative or troubleshooting mentions (e.g., "`npx askaipods` fails"
// in a bullet list, or the argv-safety anti-pattern in SKILL.md).
function codeBlockText(md) {
  // Accept any non-newline content after the opening fence (info string,
  // trailing spaces, attribute-style extensions like `bash title="x"`).
  // Tilde fences and embedded triple-backticks are not used in any shipped
  // doc under this repo, so not handled here — narrower == simpler, and
  // a reviewer noticing a future style switch would be introducing a new
  // fixture style that warrants widening this helper deliberately.
  const matches = md.matchAll(/```[^\n]*\n([\s\S]*?)```/g);
  return Array.from(matches, (m) => m[1]).join("\n");
}

describe("R7-03 — `npx -y askaipods` in SKILL.md and install guides", () => {
  const INSTALL_GUIDES = [
    "skill/askaipods/SKILL.md",
    "examples/codex-install.md",
    "examples/claude-code-install.md",
    "examples/hermes-install.md",
    "examples/openclaw-install.md",
  ];

  for (const p of INSTALL_GUIDES) {
    test(`${p} uses \`npx -y askaipods\` AND no code-block invocation omits -y (R14-01 negative guard)`, () => {
      const body = read(p);
      assert.match(
        body,
        /npx -y askaipods/,
        "install docs must use `npx -y` to bypass npm's first-run confirmation prompt (R7-03)",
      );
      // Negative guard scoped to fenced code blocks only. Narrative
      // mentions like "`npx askaipods` fails" in troubleshooting bullets
      // and the argv-safety anti-pattern in SKILL.md are legitimate and
      // must not fail this test. Invocation examples, by convention in
      // these guides, live inside ```-fenced blocks.
      const fenced = codeBlockText(body);
      const strippedCorrect = fenced.replace(/npx -y askaipods/g, "");
      assert.doesNotMatch(
        strippedCorrect,
        /npx askaipods/,
        "no code-block invocation of `npx askaipods` may omit `-y` — non-TTY runtimes hang on first-run confirmation (R7-03)",
      );
    });
  }
});

describe("R7-04 — Codex CLI skill path corrected to ~/.codex/skills/", () => {
  test("README documents ~/.codex/skills/ as the Codex path", () => {
    const body = read("README.md");
    assert.match(
      body,
      /~\/\.codex\/skills\//,
      "README must use the corrected Codex skills path (R7-04)",
    );
  });

  test("examples/codex-install.md uses ~/.codex/skills/", () => {
    const body = read("examples/codex-install.md");
    assert.match(body, /~\/\.codex\/skills\//);
  });

  test("examples/openclaw-install.md documents the R7-04 correction (R14-01 negative guard)", () => {
    const body = read("examples/openclaw-install.md");
    // Correction landed in v0.2.5: the guide now explicitly distinguishes
    // OpenClaw's location from Codex's ~/.codex/skills/, AND disavows the
    // earlier incorrect "shared with Codex" claim so a future edit cannot
    // silently reintroduce it.
    assert.match(body, /~\/\.codex\/skills\//);
    assert.match(
      body,
      /earlier version of this guide claimed/i,
      "guide must preserve the disavowal of the earlier incorrect `~/.agents/skills/ shared with Codex` claim (R7-04)",
    );
  });
});

describe("R7-01 — SKILL.md argv-safety rule present", () => {
  test("SKILL.md documents the argv-array invocation form", () => {
    const body = read("skill/askaipods/SKILL.md");
    // Two contract anchors:
    //   (1) the explicit argv-safety warning
    //   (2) the argv-array form `[..., "--", "<USER QUERY>"]` with `--` separator
    assert.match(body, /argv-safety/i, "SKILL.md must document the argv-safety rule (R7-01)");
    assert.match(
      body,
      /\[\s*"npx"/,
      "SKILL.md must show the argv-array invocation form",
    );
    assert.match(body, /"--"/, "SKILL.md must document the `--` positional separator");
  });
});
