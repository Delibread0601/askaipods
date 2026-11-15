#!/usr/bin/env node
// Live smoke test: runs the published CLI against podlens.net and checks
// what the unit tests cannot — that the package on npm installs and runs,
// and that the CLI and the live server still agree on the contract.
//
//   node scripts/live-smoke.mjs               # the version in package.json, from npm
//   node scripts/live-smoke.mjs --local       # this working tree's CLI instead
//   node scripts/live-smoke.mjs --replay DIR  # re-check outputs saved with --out, no network
//
// EVERY RUN SPENDS REAL QUOTA: three anonymous searches (20/day per IP)
// and, when ASKAIPODS_API_KEY is set, three more on that key; a search that
// fails with the CLI's transient exit code is retried once. Run it after
// a release (CLAUDE.md §Release workflow, step 7) and after a podlens-site
// deploy that touches /api/search/semantic — not in CI, not in a loop.
//
// Findings come in two classes. A FAIL is a contract fact: it holds
// whatever the corpus contains today (tier caps, the default window, sort
// selection, field shapes). A WARN depends on the corpus or the query
// (how many results matched, how fresh they are, an ingest lag) and never
// changes the exit code — read it, but a quiet ingest day is not a
// broken release.
//
// Exit codes: 0 no FAIL (warnings allowed), or --help; 1 a FAIL, a scenario
// that could not run, or nothing checked; 64 bad arguments.
//
// Not shipped: package.json `files` leaves scripts/ out of the npm package.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { stripInvisible } from "../skill/askaipods/scripts/shared.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The README sample's query: broad enough to fill a page in any window.
const DEFAULT_QUERY = "when will AGI arrive";

// Server contract: TIER_MAX_DAYS and DEFAULT_RECENCY_DAYS in podlens-site
// functions/lib/pure.ts; the page size is topK in
// functions/api/search/semantic.ts.
const TIER_CAP = { anonymous: 30, free: 90, member: 365 };
const DEFAULT_WINDOW_DAYS = 30;
const PAGE_SIZE = 20;
// CLI contract: the smallest gap meta.result_lag reports
// (skill/askaipods/scripts/format.mjs).
const LAG_NOTE_MIN_DAYS = 14;

// Corpus-dependent thresholds (WARN only).
// Newest result of a default recency search vs the newest indexed episode.
const FRESHNESS_GAP_WARN_DAYS = 7;
// Newest indexed episode vs today.
const CORPUS_AGE_WARN_DAYS = 3;

const DAY_MS = 86400000;
const WATCH_URL = /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/;

// `keyed` scenarios run with ASKAIPODS_API_KEY as it is in the environment
// (a free or a member key); the others run with it removed.
export const SCENARIOS = [
  { name: "anonymous-default", keyed: false, args: [] },
  { name: "anonymous-days1", keyed: false, args: ["--days", "1"] },
  { name: "anonymous-relevance", keyed: false, args: ["--sort", "relevance"] },
  { name: "keyed-default", keyed: true, args: [] },
  { name: "keyed-days1", keyed: true, args: ["--days", "1"] },
  { name: "keyed-relevance", keyed: true, args: ["--sort", "relevance"] },
];

function dayOf(dateStr) {
  const ms = typeof dateStr === "string" ? Date.parse(dateStr) : NaN;
  return Number.isNaN(ms) ? null : Math.floor(ms / DAY_MS);
}

function argAfter(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

// One scenario's `--format json` output against the contract.
// Returns { failures: string[], warnings: string[] }.
export function checkScenario(scenario, out, query = DEFAULT_QUERY) {
  const failures = [];
  const warnings = [];
  const fail = (ok, message) => {
    if (!ok) failures.push(message);
  };

  if (out === null || typeof out !== "object" || !Array.isArray(out.results) || typeof out.meta !== "object" || out.meta === null) {
    return { failures: ["output is not the structured JSON payload (results[] + meta)"], warnings };
  }
  const { results, meta } = out;
  const requestedSort = argAfter(scenario.args, "--sort") ?? "recency";
  const daysArg = argAfter(scenario.args, "--days");

  // ── Tier ──
  const tier = out.tier;
  if (!scenario.keyed) {
    fail(tier === "anonymous", `tier is '${tier}', expected 'anonymous' for a request without a key`);
  } else if (tier === "anonymous") {
    if (out.downgraded) {
      warnings.push(`the key was served at the anonymous level (downgraded: ${out.downgraded.reason})`);
    } else {
      failures.push("tier is 'anonymous' for a request with a key and no downgrade notice — the key was not accepted");
    }
  } else {
    fail(tier === "free" || tier === "member", `tier is '${tier}', expected 'free' or 'member'`);
  }
  const cap = TIER_CAP[tier];
  if (cap === undefined) return { failures, warnings };

  // ── Envelope ──
  fail(out.query === query, "query is not echoed back unchanged");
  const servedSort = tier === "member" && requestedSort === "relevance" ? "relevance" : "recency";
  fail(
    out.sort?.requested === requestedSort && out.sort?.served === servedSort,
    `sort is ${JSON.stringify(out.sort)}, expected requested '${requestedSort}' / served '${servedSort}'`,
  );
  fail(
    out.render_hint === (servedSort === "relevance" ? "dual_view" : "single_view"),
    `render_hint '${out.render_hint}' does not match served sort '${servedSort}'`,
  );
  fail(meta.restrictions?.max_days === cap, `meta.restrictions.max_days is ${meta.restrictions?.max_days}, expected ${cap} for ${tier}`);
  const quota = meta.quota;
  fail(
    Number.isInteger(quota?.used) && Number.isInteger(quota?.limit) && quota.used >= 0 && quota.used <= quota.limit,
    `meta.quota ${JSON.stringify(quota)} is not 0 <= used <= limit`,
  );

  // ── Results ──
  fail(results.length === meta.total_returned, `results.length ${results.length} != meta.total_returned ${meta.total_returned}`);
  fail(results.length <= PAGE_SIZE, `${results.length} results, more than the page size ${PAGE_SIZE}`);
  const days = results.map((r) => dayOf(r.date));
  let ordered = true;
  for (let i = 1; i < days.length; i++) {
    // newest first, undated last
    if (days[i] !== null && (days[i - 1] === null || days[i] > days[i - 1])) ordered = false;
  }
  fail(ordered, "results are not sorted newest first with undated results last");
  const ranks = results.map((r) => r.api_rank).sort((a, b) => a - b);
  fail(ranks.every((rank, i) => rank === i + 1), "api_rank values are not a permutation of 1..n");
  const badLinks = results.filter((r) => {
    if (r.url !== null && !WATCH_URL.test(r.url)) return true;
    if (r.anchor_url === null && r.anchor_s === null) return false;
    return !(r.url !== null && Number.isInteger(r.anchor_s) && r.anchor_s >= 0 && r.anchor_url === `${r.url}&t=${r.anchor_s}s`);
  });
  fail(badLinks.length === 0, `${badLinks.length} result(s) with a url / anchor that is not a YouTube watch URL pair`);

  // ── Window ──
  const win = meta.window;
  const fetchedDay = dayOf(out.fetched_at);
  if (!win || typeof win.requested_days !== "number" || typeof win.served_days !== "number") {
    failures.push("meta.window is missing requested_days / served_days");
  } else {
    // A supplied --days is capped at the tier cap. An omitted one is the
    // whole cap when relevance is served, else the 30-day default.
    const expectedFirst =
      daysArg !== undefined
        ? Math.min(Number(daysArg), cap)
        : servedSort === "relevance"
          ? cap
          : Math.min(DEFAULT_WINDOW_DAYS, cap);
    fail(
      win.requested_days === expectedFirst,
      `meta.window.requested_days is ${win.requested_days}, expected ${expectedFirst} (${daysArg !== undefined ? `--days ${daysArg}` : `no --days, ${servedSort} served`}, ${tier} cap ${cap})`,
    );
    fail(
      win.served_days >= win.requested_days && win.served_days <= cap,
      `meta.window.served_days ${win.served_days} is outside requested ${win.requested_days} .. cap ${cap}`,
    );
    fail(win.served_days === win.requested_days || win.expanded === true, "served_days exceeds requested_days without meta.window.expanded");
    if (fetchedDay === null) {
      failures.push("fetched_at is not a timestamp");
    } else {
      // One day of grace on each side: the server accepts dates up to
      // tomorrow UTC, and it takes its cutoff when the request arrives,
      // which can be the UTC day before fetched_at.
      const outside = days.filter((d) => d !== null && (d < fetchedDay - win.served_days - 1 || d > fetchedDay + 1));
      fail(outside.length === 0, `${outside.length} result(s) dated outside the served ${win.served_days}-day window`);
    }

    // ── meta.result_lag (0.3.8+) ──
    if (!("result_lag" in meta)) {
      failures.push("meta.result_lag is absent — this CLI predates 0.3.8");
    } else if (meta.result_lag !== null) {
      const lag = meta.result_lag;
      const allowed = servedSort === "recency" && results.length >= PAGE_SIZE && !win.expanded && win.served_days > DEFAULT_WINDOW_DAYS;
      fail(allowed, "meta.result_lag is set for a search that is not a full recency page from one unwidened window wider than 30 days");
      fail(
        Number.isInteger(lag.days) && lag.days >= LAG_NOTE_MIN_DAYS && typeof lag.newest_result_date === "string" && typeof lag.corpus_newest_date === "string",
        `meta.result_lag ${JSON.stringify(lag)} is not { newest_result_date, corpus_newest_date, days >= ${LAG_NOTE_MIN_DAYS} }`,
      );
    }

    if (win.expanded || win.truncated) {
      warnings.push(
        `the window ${win.truncated ? "widening was cut short" : "widened"}: requested ${win.requested_days} days, served ${win.served_days} (fewer than ${PAGE_SIZE} matches in the first window)`,
      );
    }
  }

  // ── Corpus-dependent observations ──
  if (meta.warning) warnings.push(`server warning: ${meta.warning.code}`);
  if (results.length < PAGE_SIZE) warnings.push(`${results.length} results, fewer than a full page of ${PAGE_SIZE}`);
  const corpusDay = dayOf(meta.corpus_freshness?.newest_date);
  if (corpusDay === null) {
    warnings.push("meta.corpus_freshness.newest_date is missing");
  } else {
    if (fetchedDay !== null && fetchedDay - corpusDay > CORPUS_AGE_WARN_DAYS) {
      warnings.push(`the newest indexed episode (${meta.corpus_freshness.newest_date}) is ${fetchedDay - corpusDay} days old — ingest lag?`);
    }
    // The check this script exists for: a default recency search whose
    // newest result trails the newest indexed episode by more than a week.
    const newestDay = days.find((d) => d !== null);
    if (daysArg === undefined && servedSort === "recency" && newestDay !== undefined && corpusDay - newestDay > FRESHNESS_GAP_WARN_DAYS) {
      warnings.push(
        `the newest result is ${corpusDay - newestDay} days older than the newest indexed episode (${meta.corpus_freshness.newest_date}) on a default recency search`,
      );
    }
  }

  return { failures, warnings };
}

const rowKey = (r) => `${r.date}|${r.podcast}|${r.episode}|${r.text}`;
const sameRows = (a, b) => a.results.length === b.results.length && a.results.every((r, i) => rowKey(r) === rowKey(b.results[i]));

// Observations across scenarios (WARN only: the searches run seconds apart,
// and an episode ingested in between changes one of them). `outputs` maps
// scenario name → output; scenarios that did not run are absent.
export function checkAcross(outputs) {
  const warnings = [];
  const anonDefault = outputs["anonymous-default"];
  const anonRelevance = outputs["anonymous-relevance"];
  const keyedDefault = outputs["keyed-default"];
  if (anonDefault && anonRelevance && !sameRows(anonDefault, anonRelevance)) {
    warnings.push("anonymous --sort relevance (served recency) returned different rows than the anonymous default");
  }
  if (anonDefault && keyedDefault) {
    const newest = (o) => o.results.map((r) => dayOf(r.date)).find((d) => d !== null);
    const a = newest(anonDefault);
    const k = newest(keyedDefault);
    if (a !== undefined && k !== undefined && k < a) {
      warnings.push(`the keyed default's newest result is ${a - k} day(s) older than the anonymous default's — both start at the last ${DEFAULT_WINDOW_DAYS} days`);
    }
  }
  return warnings;
}

const USAGE =
  "usage: node scripts/live-smoke.mjs [--local | --version <x.y.z>] [--query <text>] [--out <new dir>]\n" +
  "       node scripts/live-smoke.mjs --replay <dir> [--query <text>]";

function usage(message) {
  console.error(`live-smoke: ${message}\n${USAGE}`);
  process.exit(64);
}

function summarize(out) {
  if (!Array.isArray(out?.results) || !out.meta) return "";
  const dated = out.results.map((r) => r.date).filter(Boolean);
  const range = dated.length ? `${dated[dated.length - 1].slice(0, 10)}..${dated[0].slice(0, 10)}` : "no dates";
  const win = out.meta.window ? `window ${out.meta.window.requested_days}→${out.meta.window.served_days}` : "no window";
  const quota = out.meta.quota ? `quota ${out.meta.quota.used}/${out.meta.quota.limit}` : "";
  return `${out.tier} · ${out.results.length} results · ${range} · ${win} · ${quota}`;
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        local: { type: "boolean" },
        version: { type: "string" },
        query: { type: "string" },
        out: { type: "string" },
        replay: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (err) {
    usage(err.message);
  }
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  // An empty value (an unset shell variable in `--replay "$DIR"`) must not
  // read as "option not given": that would turn a replay into a live run.
  for (const name of ["version", "out", "replay"]) {
    if (values[name] !== undefined && values[name].trim() === "") usage(`--${name} needs a value`);
  }
  if (values.replay && (values.local || values.version || values.out)) usage("--replay takes no --local / --version / --out");
  if (values.local && values.version) usage("--local and --version are exclusive");
  // A scenario that fails writes no file, so in a directory that already
  // holds saved outputs the earlier run's file would stay, and --replay
  // would then check a mix of two runs. Refused before any search is spent.
  if (values.out) {
    const kept = SCENARIOS.map((s) => `${s.name}.json`).filter((file) => existsSync(join(values.out, file)));
    if (kept.length) usage(`--out ${values.out} already holds saved outputs (${kept.join(", ")}); use a new directory`);
  }

  // The CLI trims the query and drops invisible characters from the one it
  // echoes. Doing both here first leaves a string the CLI returns as it
  // is, so the query sent, the one compared and the one replayed agree.
  const query = stripInvisible(values.query ?? DEFAULT_QUERY).trim();
  if (query === "") usage("--query needs a value");
  const packageVersion = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version;
  const version = values.version ?? packageVersion;
  const key = (process.env.ASKAIPODS_API_KEY ?? "").trim();
  // The key never reaches the output: CLI stderr is passed through this.
  const redact = (text) => (key ? text.split(key).join("[key]") : text);
  // Why a run failed: the spawn error, else the last line of its stderr.
  const causeOf = (child) => (child.error ? child.error.message : redact((child.stderr ?? "").trim().split("\n").pop() ?? ""));

  let problems = 0;
  let warned = 0;
  let skipped = 0;
  const skip = (name, why) => {
    console.log(`skip ${name.padEnd(20)} ${why}`);
    skipped += 1;
  };
  const outputs = {};
  const report = (name, { failures, warnings }, line) => {
    console.log(`${failures.length ? "FAIL" : "ok  "} ${name.padEnd(20)} ${line}`);
    for (const f of failures) console.log(`       FAIL ${f}`);
    for (const w of warnings) console.log(`       WARN ${w}`);
    problems += failures.length;
    warned += warnings.length;
  };

  if (values.replay) {
    console.log(`live-smoke: replaying saved outputs from ${values.replay} (no network)`);
    for (const scenario of SCENARIOS) {
      let out;
      try {
        out = JSON.parse(readFileSync(join(values.replay, `${scenario.name}.json`), "utf8"));
      } catch (err) {
        if (err.code === "ENOENT") skip(scenario.name, "no saved output");
        else report(scenario.name, { failures: [`the saved output cannot be read: ${err.message}`], warnings: [] }, "");
        continue;
      }
      outputs[scenario.name] = out;
      const result = checkScenario(scenario, out, query);
      report(scenario.name, result, summarize(out));
    }
  } else {
    // npx resolves a package of the same name in the current project
    // first, so the published package is run from an empty directory.
    const cwd = values.local ? REPO : mkdtempSync(join(tmpdir(), "askaipods-smoke-"));
    const command = values.local ? [process.execPath, join(REPO, "bin", "askaipods.js")] : ["npx", "-y", `askaipods@${version}`];
    const run = (args, env) => spawnSync(command[0], [...command.slice(1), ...args], { cwd, env, encoding: "utf8", timeout: 120000 });
    try {
      console.log(`live-smoke: ${values.local ? `working tree (${packageVersion})` : `askaipods@${version} from npm`} · query "${query}"`);
      const expected = `askaipods ${values.local ? packageVersion : version}`;
      const versionRun = run(["--version"], process.env);
      const reported = (versionRun.stdout ?? "").trim();
      const versionOk = reported === expected;
      const versionCause = versionOk ? "" : causeOf(versionRun);
      report(
        "version",
        { failures: versionOk ? [] : [`--version printed '${reported}', expected '${expected}'${versionCause ? ` — ${versionCause}` : ""}`], warnings: [] },
        reported,
      );

      if (versionOk && values.out) mkdirSync(values.out, { recursive: true });
      const stopped = new Set();
      for (const scenario of SCENARIOS) {
        if (!versionOk) {
          // No search is spent on a package that is not the one under test.
          skip(scenario.name, "not run: the version check failed");
          continue;
        }
        if (scenario.keyed && !key) {
          skip(scenario.name, "ASKAIPODS_API_KEY is not set");
          continue;
        }
        if (stopped.has(scenario.keyed)) {
          report(scenario.name, { failures: ["not run: the daily quota for this tier is used up"], warnings: [] }, "");
          continue;
        }
        const env = { ...process.env };
        if (!scenario.keyed) delete env.ASKAIPODS_API_KEY;
        const args = ["search", "--format", "json", ...scenario.args, "--", query];
        let child = run(args, env);
        if (child.status === 3) {
          // transient (network, burst limit, 503): one retry
          await new Promise((done) => setTimeout(done, 3000));
          child = run(args, env);
        }
        if (child.status !== 0) {
          if (child.status === 2) stopped.add(scenario.keyed);
          report(scenario.name, { failures: [`the CLI exited ${child.status ?? "without a status"}: ${causeOf(child)}`], warnings: [] }, "");
          continue;
        }
        let out;
        try {
          out = JSON.parse(child.stdout);
        } catch {
          report(scenario.name, { failures: ["stdout is not JSON"], warnings: [] }, "");
          continue;
        }
        if (values.out) writeFileSync(join(values.out, `${scenario.name}.json`), `${JSON.stringify(out, null, 2)}\n`);
        outputs[scenario.name] = out;
        const result = checkScenario(scenario, out, query);
        report(scenario.name, result, summarize(out));
      }
    } finally {
      if (!values.local) rmSync(cwd, { recursive: true, force: true });
    }
  }

  const across = checkAcross(outputs);
  for (const w of across) console.log(`WARN ${w}`);
  warned += across.length;

  const ran = Object.keys(outputs).length;
  console.log(
    `live-smoke: ${problems === 0 && ran > 0 ? "PASS" : "FAIL"} — ${ran} of ${SCENARIOS.length} scenario(s) checked, ${skipped} skipped, ${problems} failure(s), ${warned} warning(s)`,
  );
  process.exit(problems === 0 && ran > 0 ? 0 : 1);
}

// Run only when executed directly — importing the checks (the tests do)
// starts nothing. Both sides are real paths, so a symlinked path still runs.
function isMain() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) await main();
