// Offline tests for scripts/live-smoke.mjs: the contract checks it applies
// to live output, run here on payloads built by toStructured. Nothing in
// this file touches the network: importing the script starts nothing, and
// the runner tests execute it with --replay, with an empty PATH so that no
// package runner can start, or with a PATH holding only a stand-in npx.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS, checkScenario, checkAcross } from "../scripts/live-smoke.mjs";
import { toStructured } from "../skill/askaipods/scripts/format.mjs";
import { validEnvelope, validResult } from "./helpers.mjs";

const QUERY = "when will AGI arrive";
const NOW = new Date("2026-11-15T12:00:00Z");
const CAP = { anonymous: 30, free: 90, member: 365 };
const WATCH = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const scenario = (name) => SCENARIOS.find((s) => s.name === name);

// The CLI's JSON output for a healthy search: a full page dated on the
// corpus's newest day, from one unwidened first window.
function output({ tier = "anonymous", sort = "recency", dates, rows, window, meta = {} } = {}) {
  const cap = CAP[tier];
  const first = Math.min(30, cap);
  const results =
    rows ??
    (dates ?? Array.from({ length: 20 }, () => "2026-11-14")).map((date, i) =>
      validResult({ published_at: date, text: `quote ${i}`, url: WATCH, anchor_s: 80, anchor_url: `${WATCH}&t=80s` }),
    );
  return toStructured(
    QUERY,
    validEnvelope({
      total: results.length,
      results,
      meta: {
        access_tier: tier,
        sort: { requested: sort, served: tier === "member" ? sort : "recency" },
        quota: { used: 1, limit: 20 },
        restrictions: { max_days: cap },
        window: window ?? { requested_days: first, served_days: first, expanded: false },
        corpus_freshness: { newest_date: "2026-11-14" },
        ...meta,
      },
    }),
    NOW,
  );
}

const check = (name, out) => checkScenario(scenario(name), out, QUERY);

describe("live-smoke — scenarios", () => {
  test("the script stays out of the npm package and the release workflow names it", () => {
    const root = new URL("../", import.meta.url);
    const { files } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
    assert.ok(!files.some((f) => f === "scripts" || f.startsWith("scripts/")), "package.json files must not ship scripts/");
    assert.match(readFileSync(new URL("CLAUDE.md", root), "utf8"), /7\. \*\*Run the live smoke test\*\*.*`node scripts\/live-smoke\.mjs`/);
  });

  test("six scenarios, three without a key and three with", () => {
    assert.equal(SCENARIOS.length, 6);
    assert.equal(new Set(SCENARIOS.map((s) => s.name)).size, 6);
    assert.equal(SCENARIOS.filter((s) => s.keyed).length, 3);
  });
});

describe("live-smoke — checkScenario contract checks", () => {
  test("a healthy response passes on every tier with no warnings", () => {
    for (const [name, out] of [
      ["anonymous-default", output()],
      ["anonymous-relevance", output({ sort: "relevance" })],
      ["keyed-default", output({ tier: "free" })],
      ["keyed-default", output({ tier: "member" })],
      ["keyed-relevance", output({ tier: "free", sort: "relevance" })],
      ["keyed-relevance", output({ tier: "member", sort: "relevance", window: { requested_days: 365, served_days: 365, expanded: false } })],
      ["keyed-days1", output({ tier: "member", window: { requested_days: 1, served_days: 1, expanded: false } })],
    ]) {
      assert.deepEqual(check(name, out), { failures: [], warnings: [] }, name);
    }
  });

  test("an omitted --days that starts at the tier cap fails for recency", () => {
    const dates = Array.from({ length: 20 }, () => "2026-10-21");
    const { failures, warnings } = check("keyed-default", output({ tier: "member", dates, window: { requested_days: 365, served_days: 365, expanded: false } }));
    assert.equal(failures.length, 1);
    assert.match(failures[0], /requested_days is 365, expected 30 \(no --days, recency served, member cap 365\)/);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /newest result is 24 days older than the newest indexed episode/);
  });

  test("member relevance without --days must cover the whole cap; a free relevance request is served recency and starts at 30", () => {
    const narrow = check("keyed-relevance", output({ tier: "member", sort: "relevance" }));
    assert.match(narrow.failures.join("\n"), /requested_days is 30, expected 365/);
    const wide = check("keyed-relevance", output({ tier: "free", sort: "relevance", window: { requested_days: 90, served_days: 90, expanded: false } }));
    assert.match(wide.failures.join("\n"), /requested_days is 90, expected 30/);
  });

  test("--days 1: a widened search passes with a warning; served beyond requested without expanded fails", () => {
    const widened = check("anonymous-days1", output({ window: { requested_days: 1, served_days: 30, expanded: true } }));
    assert.deepEqual(widened.failures, []);
    assert.match(widened.warnings.join("\n"), /the window widened: requested 1 days, served 30/);
    const silent = check("anonymous-days1", output({ window: { requested_days: 1, served_days: 30, expanded: false } }));
    assert.match(silent.failures.join("\n"), /served_days exceeds requested_days without meta\.window\.expanded/);
    const pastCap = check("anonymous-days1", output({ window: { requested_days: 1, served_days: 60, expanded: true } }));
    assert.match(pastCap.failures.join("\n"), /served_days 60 is outside requested 1 \.\. cap 30/);
  });

  test("a keyed request served as anonymous fails unless the response carries a downgrade notice", () => {
    assert.match(check("keyed-default", output()).failures.join("\n"), /the key was not accepted/);
    const downgraded = check(
      "keyed-default",
      output({ meta: { downgraded: { from: "free", reason: "new_account", waitlist: "https://podlens.net/dashboard?source=askaipods#waitlist" } } }),
    );
    assert.deepEqual(downgraded.failures, []);
    assert.match(downgraded.warnings.join("\n"), /served at the anonymous level \(downgraded: new_account\)/);
    assert.match(check("anonymous-default", output({ tier: "member" })).failures.join("\n"), /expected 'anonymous' for a request without a key/);
  });

  test("meta.result_lag: absent fails; set on a default-window search fails; set on a wide window passes", () => {
    const old = output();
    delete old.meta.result_lag;
    assert.match(check("anonymous-default", old).failures.join("\n"), /meta\.result_lag is absent/);

    const misplaced = output();
    misplaced.meta.result_lag = { newest_result_date: "2026-10-21", corpus_newest_date: "2026-11-14", days: 24 };
    assert.match(check("anonymous-default", misplaced).failures.join("\n"), /result_lag is set for a search that is not a full recency page/);

    // --days 365 is not one of the six scenarios; the rule is the same.
    const wide = output({ tier: "member", dates: Array.from({ length: 20 }, () => "2026-10-21"), window: { requested_days: 365, served_days: 365, expanded: false } });
    assert.deepEqual(wide.meta.result_lag, { newest_result_date: "2026-10-21", corpus_newest_date: "2026-11-14", days: 24 });
    assert.deepEqual(checkScenario({ name: "keyed-days365", keyed: true, args: ["--days", "365"] }, wide, QUERY).failures, []);
  });

  test("result rows: a date outside the served window, a broken anchor pair and a foreign URL each fail", () => {
    const stale = check("anonymous-default", output({ dates: ["2026-11-14", "2026-09-01"] }));
    assert.match(stale.failures.join("\n"), /1 result\(s\) dated outside the served 30-day window/);
    // The window edge has one day of grace: 31 days back passes, 32 fails.
    assert.deepEqual(check("anonymous-default", output({ dates: [...Array.from({ length: 19 }, () => "2026-11-14"), "2026-10-15"] })).failures, []);
    assert.equal(check("anonymous-default", output({ dates: [...Array.from({ length: 19 }, () => "2026-11-14"), "2026-10-14"] })).failures.length, 1);
    const anchor = check("anonymous-default", output({ rows: [validResult({ published_at: "2026-11-14", url: WATCH, anchor_s: 80, anchor_url: `${WATCH}&t=99s` })] }));
    assert.match(anchor.failures.join("\n"), /1 result\(s\) with a url \/ anchor/);
    const foreign = output();
    foreign.results[0].url = "https://example.com/watch?v=dQw4w9WgXcQ";
    foreign.results[0].anchor_url = null;
    foreign.results[0].anchor_s = null;
    assert.match(check("anonymous-default", foreign).failures.join("\n"), /1 result\(s\) with a url \/ anchor/);
  });

  test("envelope: a wrong cap, an unechoed query and a non-payload each fail", () => {
    assert.match(check("anonymous-default", output({ meta: { restrictions: { max_days: 90 } } })).failures.join("\n"), /max_days is 90, expected 30 for anonymous/);
    assert.match(checkScenario(scenario("anonymous-default"), output(), "another query").failures.join("\n"), /query is not echoed back/);
    assert.deepEqual(check("anonymous-default", { error: "nope" }).failures, ["output is not the structured JSON payload (results[] + meta)"]);
  });

  test("corpus-dependent facts only warn: a short page, a server warning, an old corpus", () => {
    const short = check("anonymous-default", output({ dates: ["2026-11-14", "2026-11-13"] }));
    assert.deepEqual(short.failures, []);
    assert.match(short.warnings.join("\n"), /2 results, fewer than a full page of 20/);
    const flagged = check("anonymous-default", output({ meta: { warning: { code: "index_metadata_stale" } } }));
    assert.deepEqual(flagged.failures, []);
    assert.match(flagged.warnings.join("\n"), /server warning: index_metadata_stale/);
    const lagging = check("anonymous-default", output({ dates: Array.from({ length: 20 }, () => "2026-11-10"), meta: { corpus_freshness: { newest_date: "2026-11-10" } } }));
    assert.deepEqual(lagging.failures, []);
    assert.match(lagging.warnings.join("\n"), /newest indexed episode \(2026-11-10\) is 5 days old/);
  });
});

describe("live-smoke — shapes the server produces on a quiet or slow day", () => {
  test("a widening cut short only warns, with or without a failed wider window", () => {
    for (const window of [
      { requested_days: 30, served_days: 30, expanded: false, truncated: true },
      { requested_days: 1, served_days: 1, expanded: true, truncated: true },
    ]) {
      const name = window.requested_days === 1 ? "anonymous-days1" : "anonymous-default";
      const { failures, warnings } = check(name, output({ window }));
      assert.deepEqual(failures, [], name);
      assert.match(warnings.join("\n"), /the window widening was cut short/, name);
    }
  });

  test("an undated result sorts last and an empty page passes, each with warnings only", () => {
    const rows = [
      validResult({ published_at: "2026-11-14", url: WATCH, anchor_s: 80, anchor_url: `${WATCH}&t=80s` }),
      validResult({ published_at: null, url: WATCH, anchor_s: null, anchor_url: null }),
    ];
    const undated = check("anonymous-default", output({ rows }));
    assert.deepEqual(undated.failures, []);
    assert.match(undated.warnings.join("\n"), /2 results, fewer than a full page/);
    const empty = check("anonymous-default", output({ rows: [] }));
    assert.deepEqual(empty.failures, []);
    assert.match(empty.warnings.join("\n"), /0 results, fewer than a full page/);
  });
});

describe("live-smoke — runner", () => {
  const SCRIPT = fileURLToPath(new URL("../scripts/live-smoke.mjs", import.meta.url));
  // An empty PATH: were a run to leave replay mode, no npx could start.
  // TMPDIR is kept so the child's temporary directory is where this
  // process's is.
  const env = { PATH: "", ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) };
  const run = (args, script = SCRIPT) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env });
  const withDir = (fn) => {
    const dir = mkdtempSync(join(tmpdir(), "askaipods-smoke-test-"));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const healthy = {
    "anonymous-default": output(),
    "anonymous-days1": output({ window: { requested_days: 1, served_days: 1, expanded: false } }),
    "anonymous-relevance": output({ sort: "relevance" }),
    "keyed-default": output({ tier: "member" }),
    "keyed-days1": output({ tier: "member", window: { requested_days: 1, served_days: 1, expanded: false } }),
    "keyed-relevance": output({ tier: "member", sort: "relevance", window: { requested_days: 365, served_days: 365, expanded: false } }),
  };
  const save = (dir, outputs) => {
    for (const [name, out] of Object.entries(outputs)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(out));
  };

  test("--replay: six healthy outputs pass, also through a symlinked path", () => {
    withDir((dir) => {
      save(dir, healthy);
      const direct = run(["--replay", dir]);
      assert.match(direct.stdout, /live-smoke: PASS — 6 of 6 scenario\(s\) checked, 0 skipped, 0 failure\(s\), 0 warning\(s\)/);
      assert.equal(direct.status, 0);
      const link = join(dir, "link.mjs");
      symlinkSync(SCRIPT, link);
      const linked = run(["--replay", dir], link);
      assert.match(linked.stdout, /live-smoke: PASS — 6 of 6/);
      assert.equal(linked.status, 0);
    });
  });

  test("--replay: one failing output exits 1; missing outputs are counted as skipped; none at all exits 1", () => {
    withDir((dir) => {
      const { "keyed-default": _a, "keyed-days1": _b, "keyed-relevance": _c, ...anonymous } = healthy;
      save(dir, anonymous);
      const partial = run(["--replay", dir]);
      assert.match(partial.stdout, /live-smoke: PASS — 3 of 6 scenario\(s\) checked, 3 skipped/);
      assert.equal(partial.status, 0);
      save(dir, { "anonymous-default": output({ tier: "member" }) });
      const failing = run(["--replay", dir]);
      assert.match(failing.stdout, /FAIL anonymous-default/);
      assert.match(failing.stdout, /live-smoke: FAIL — 3 of 6/);
      assert.equal(failing.status, 1);
    });
    withDir((dir) => {
      const none = run(["--replay", dir]);
      assert.match(none.stdout, /live-smoke: FAIL — 0 of 6 scenario\(s\) checked, 6 skipped/);
      assert.equal(none.status, 1);
    });
  });

  test("--replay: a saved output that is not JSON fails instead of counting as skipped", () => {
    withDir((dir) => {
      save(dir, healthy);
      writeFileSync(join(dir, "keyed-days1.json"), "{");
      const child = run(["--replay", dir]);
      assert.match(child.stdout, /FAIL keyed-days1 +\n +FAIL the saved output cannot be read/);
      assert.match(child.stdout, /live-smoke: FAIL — 5 of 6 scenario\(s\) checked, 0 skipped, 1 failure\(s\)/);
      assert.equal(child.status, 1);
    });
  });

  test("an empty option value is a usage error, not an option left out", () => {
    for (const args of [["--replay", ""], ["--out", ""], ["--replay", " "], ["--query", ""]]) {
      const child = run(args);
      assert.equal(child.status, 64, args.join(" "));
      assert.match(child.stderr, /needs a value/);
      assert.equal(child.stdout, "");
    }
    assert.equal(run(["--help"]).status, 0);
    assert.equal(run(["--replay", "x", "--local"]).status, 64);
  });

  test("a failed version check stops the run before any search", () => {
    const child = run(["--version", "0.0.0"]);
    assert.match(child.stdout, /FAIL --version printed '', expected 'askaipods 0\.0\.0' — .*ENOENT/);
    assert.equal((child.stdout.match(/not run: the version check failed/g) ?? []).length, 6);
    assert.match(child.stdout, /live-smoke: FAIL — 0 of 6 scenario\(s\) checked, 6 skipped, 1 failure\(s\)/);
    assert.equal(child.status, 1);
  });

  // A stand-in npx, the only program on PATH: it answers --version with the
  // version it was asked for and prints a saved output per search — the
  // keyed one when the key is in its environment — so the live branch runs
  // end to end offline. It writes the key to stderr on every keyed call.
  const STUB = `import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const key = process.env.ASKAIPODS_API_KEY;
if (args.includes("--version")) {
  console.log(args.find((a) => a.startsWith("askaipods@")).replace("@", " "));
  process.exit(0);
}
if (key) console.error("error: the server rejected " + key);
if (key && process.env.STUB_EXIT) process.exit(Number(process.env.STUB_EXIT));
const name = (key ? "keyed-" : "anonymous-") + (args.includes("--days") ? "days1" : args.includes("--sort") ? "relevance" : "default");
process.stdout.write(readFileSync(process.env.STUB_DIR + "/" + name + ".json", "utf8"));
`;
  const KEY = "pk_test_0123456789abcdef";
  const withStubNpx = (fn) =>
    withDir((dir) => {
      save(dir, healthy);
      writeFileSync(join(dir, "stub.mjs"), STUB);
      mkdirSync(join(dir, "bin"));
      writeFileSync(join(dir, "bin", "npx"), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, "stub.mjs")}" "$@"\n`, { mode: 0o755 });
      const live = (args, extra = {}) =>
        spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { ...env, PATH: join(dir, "bin"), STUB_DIR: dir, ...extra } });
      return fn(dir, live);
    });
  const posix = { skip: process.platform === "win32" && "the stand-in npx is a shell script" };

  test("a live run checks all six, saves them with --out, and the key appears nowhere", posix, () => {
    withStubNpx((dir, live) => {
      const out = join(dir, "out");
      const child = live(["--out", out], { ASKAIPODS_API_KEY: KEY });
      assert.match(child.stdout, /live-smoke: PASS — 6 of 6 scenario\(s\) checked, 0 skipped, 0 failure\(s\), 0 warning\(s\)/);
      assert.equal(child.status, 0);
      assert.deepEqual(readdirSync(out).sort(), SCENARIOS.map((s) => `${s.name}.json`).sort());
      const saved = readdirSync(out).map((f) => readFileSync(join(out, f), "utf8"));
      for (const text of [child.stdout, child.stderr, ...saved]) assert.ok(!text.includes(KEY));
      const noKey = live([]);
      assert.match(noKey.stdout, /live-smoke: PASS — 3 of 6 scenario\(s\) checked, 3 skipped/);
    });
  });

  test("a CLI failure is reported with the key replaced, and exit 2 stops that tier's remaining searches", posix, () => {
    withStubNpx((dir, live) => {
      const child = live([], { ASKAIPODS_API_KEY: KEY, STUB_EXIT: "2" });
      assert.match(child.stdout, /FAIL the CLI exited 2: error: the server rejected \[key\]/);
      assert.equal((child.stdout.match(/not run: the daily quota for this tier is used up/g) ?? []).length, 2);
      assert.match(child.stdout, /live-smoke: FAIL — 3 of 6 scenario\(s\) checked, 0 skipped, 3 failure\(s\)/);
      assert.equal(child.status, 1);
      assert.ok(!child.stdout.includes(KEY) && !child.stderr.includes(KEY));
    });
  });
});

describe("live-smoke — checkAcross", () => {
  test("no warnings when the anonymous pair matches and the keyed default is as fresh", () => {
    assert.deepEqual(checkAcross({ "anonymous-default": output(), "anonymous-relevance": output({ sort: "relevance" }), "keyed-default": output({ tier: "member" }) }), []);
  });

  test("warns when anonymous relevance differs from the default, and when the keyed default is older", () => {
    const older = output({ tier: "member", dates: Array.from({ length: 20 }, () => "2026-10-21") });
    const warnings = checkAcross({
      "anonymous-default": output(),
      "anonymous-relevance": output({ sort: "relevance", dates: Array.from({ length: 20 }, () => "2026-11-13") }),
      "keyed-default": older,
    });
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /returned different rows than the anonymous default/);
    assert.match(warnings[1], /keyed default's newest result is 24 day\(s\) older/);
  });

  test("scenarios that did not run are skipped", () => {
    assert.deepEqual(checkAcross({ "anonymous-default": output() }), []);
  });
});
