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

describe("Codex CLI skill path — ~/.agents/skills/ (current Codex docs)", () => {
  // The Codex skills docs list $HOME/.agents/skills as the user-level
  // location (earlier releases read ~/.codex/skills/); OpenClaw reads the
  // same directory, so one install serves both.
  test("README and the Codex guide install into ~/.agents/skills/", () => {
    for (const p of ["README.md", "examples/codex-install.md"]) {
      assert.match(read(p), /~\/\.agents\/skills\/askaipods/, `${p} uses ~/.agents/skills/`);
    }
  });

  test("no guide tells users to install the Codex copy into ~/.codex/skills/", () => {
    for (const p of ["README.md", "examples/codex-install.md", "examples/openclaw-install.md"]) {
      assert.doesNotMatch(read(p), /~\/\.codex\/skills\/askaipods|mkdir -p ~\/\.codex\/skills/, p);
    }
  });

  test("examples/openclaw-install.md notes the shared ~/.agents/skills/ location", () => {
    assert.match(read("examples/openclaw-install.md"), /also the user-level location OpenAI Codex CLI documents/);
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

describe("v0.2.9 — approximate anchors documented in SKILL.md", () => {
  test("SKILL.md documents anchor_s / anchor_url as approximate and renders them", () => {
    const body = read("skill/askaipods/SKILL.md");
    assert.match(body, /\*\*`results\[\]\.anchor_s` \/ `results\[\]\.anchor_url`\*\*/);
    assert.match(body, /\[YouTube ~<m:ss>\]\(<anchor_url>\)/, "render rule for the timestamp link");
    assert.match(body, /around m:ss/);
    assert.match(body, /never as the exact moment/);
  });
});

describe("v0.2.8 — full dates + episode url documented in SKILL.md", () => {
  test("SKILL.md documents results[].url, renders it, and drops the month-fuzz claim", () => {
    const body = read("skill/askaipods/SKILL.md");
    assert.match(body, /\*\*`results\[\]\.url`\*\*/, "field note for results[].url");
    assert.match(body, /\[YouTube\]\(<url>\)/, "render templates carry the YouTube link");
    assert.doesNotMatch(body, /fuzzed|date_precision|month-precision/);
  });
});

describe("v0.2.9 — search is always bounded to the tier window", () => {
  // The server resolves an omitted --days to the tier maximum (30
  // anonymous / 90 free / 365 member); no surface may promise an all-time search
  // or advise omitting --days to widen one.
  const RETIRED = /all-time results|omit for all-time|\(all time|no time filter|omitting `?--days`? (for|or)\b|omit it\./i;
  for (const p of ["skill/askaipods/SKILL.md", "README.md", "src/format.js", "src/cli.js"]) {
    test(`${p} carries no all-time / omit-to-widen claim`, () => {
      assert.doesNotMatch(read(p), RETIRED);
    });
  }
  test("SKILL.md states that an omitted --days means the tier cap", () => {
    const body = read("skill/askaipods/SKILL.md");
    assert.match(body, /omitted = 30/);
    assert.match(body, /omitted = 90/);
    assert.match(body, /omitted = 365/);
  });
});

describe("v0.3.0 — three tiers, --sort, degrade notice", () => {
  // Shipped surfaces that carry tier wording (package.json `files`).
  const SHIPPED = [
    "skill/askaipods/SKILL.md",
    "README.md",
    "examples/claude-code-install.md",
    "examples/hermes-install.md",
    "examples/codex-install.md",
    "examples/openclaw-install.md",
    "src/cli.js",
    "src/client.js",
    "src/format.js",
  ];
  for (const p of SHIPPED) {
    test(`${p} carries no invite-only / request-access wording`, () => {
      assert.doesNotMatch(read(p), /invite|request access/i);
    });
  }

  test("SKILL.md states the 30 / 90 / 365 caps per tier and no two-tier cap pair", () => {
    const body = read("skill/askaipods/SKILL.md");
    assert.match(body, /30 anonymous \/ 90 free \/ 365 member/);
    assert.doesNotMatch(body, /90 anonymous \/ 365 member/);
  });

  test("SKILL.md documents --sort intent mapping, sort / downgraded fields and the disclosures", () => {
    const body = read("skill/askaipods/SKILL.md");
    assert.match(body, /### Ordering-intent mapping \(`--sort`\)/);
    assert.match(body, /"strongest argument", "best explanation", "history of"/);
    assert.match(body, /sort\.served !== sort\.requested/);
    assert.match(body, /\*\*`sort`\*\*/);
    assert.match(body, /\*\*`downgraded`\*\*/);
    assert.match(body, /"sort": \{ "requested": "relevance", "served": "relevance" \}/);
    assert.match(body, /<downgraded\.waitlist>/);
  });

  test("render_hint is documented by served ordering, not by tier", () => {
    const body = read("skill/askaipods/SKILL.md");
    assert.match(body, /`dual_view` when the server selected by relevance \(`sort\.served === "relevance"`\)/);
    assert.match(body, /### For `render_hint: "dual_view"` \(results selected by relevance/);
  });

  test("waitlist copy never promises approval or a timeline", () => {
    for (const p of ["skill/askaipods/SKILL.md", "README.md", "examples/claude-code-install.md", "examples/hermes-install.md"]) {
      const body = read(p);
      assert.match(body, /https:\/\/podlens\.net\/dashboard\?source=askaipods#waitlist/, `${p} links the waitlist`);
      assert.match(body, /does not grant membership/, `${p} says joining does not grant membership`);
      assert.doesNotMatch(body, /added to the waitlist for review|once (approved|invited)/i, p);
    }
  });

  test("README tier table has a Free column with the 50/day quota and 90-day cap", () => {
    const body = read("README.md");
    assert.match(body, /\| \| Anonymous \(default\) \| Free \| Member \|/);
    assert.match(body, /\| 30 days \| 90 days \| 365 days \|/);
    assert.match(body, /50 searches per user/);
  });
});

describe("v0.2.9 — corpus scope matches PodLens (AI-centred, five domains)", () => {
  // The corpus is centred on AI but also covers venture capital, global
  // markets & finance, semiconductors & compute, and tech policy &
  // geopolitics (podlens.net llms.txt) — no surface may call it AI-only.
  const RETIRED = /AI-focused|non-AI topics|sparse and noisy|dozens (of other AI podcasts|more)/i;
  for (const p of ["skill/askaipods/SKILL.md", "README.md", "package.json", "src/cli.js"]) {
    test(`${p} does not describe the corpus as AI-only`, () => {
      assert.doesNotMatch(read(p), RETIRED);
    });
  }
  test("SKILL.md and README.md name the non-AI domains", () => {
    for (const p of ["skill/askaipods/SKILL.md", "README.md"]) {
      const body = read(p);
      for (const domain of [/venture capital/, /global markets & finance/, /semiconductors & compute/, /tech policy & geopolitics/]) {
        assert.match(body, domain, `${p} names ${domain}`);
      }
    }
  });
});
