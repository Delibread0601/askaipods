// Tests for client.mjs status → exit-code mapping, the tier-aware 429
// message, terminal-safe server text, and the timeout / body-read
// distinction.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { search, AskaipodsError } from "../skill/askaipods/scripts/client.mjs";
import {
  mockResponse,
  mockTimeoutFetch,
  mockBodyReadTimeoutFetch,
  mockNonJsonFetch,
  mockNetworkErrorFetch,
  restoreFetch,
  validEnvelope,
} from "./helpers.mjs";

const PKG_VERSION = JSON.parse(
  readFileSync(
    join(dirname(dirname(fileURLToPath(import.meta.url))), "package.json"),
    "utf8",
  ),
).version;

async function runAndCatch(opts = {}) {
  try {
    await search({ query: "test query", endpoint: "https://mock/", ...opts });
    return null;
  } catch (err) {
    return err;
  }
}

describe("search — happy path", () => {
  afterEach(restoreFetch);

  test("valid envelope returns data unchanged", async () => {
    mockResponse({ body: validEnvelope() });
    const data = await search({ query: "hi", endpoint: "https://mock/" });
    assert.equal(data.meta.access_tier, "anonymous");
  });

  test("sends q + days in body; Content-Type, User-Agent, X-PodLens-API-Key headers set when key provided", async () => {
    const calls = mockResponse({ body: validEnvelope() });
    await search({ query: "hi", days: 30, apiKey: "k1", endpoint: "https://mock/" });
    assert.equal(calls.length, 1);
    const { init } = calls[0];
    assert.equal(init.method, "POST");
    const body = JSON.parse(init.body);
    assert.equal(body.q, "hi");
    assert.equal(body.days, 30);
    assert.equal(init.headers["X-PodLens-API-Key"], "k1");
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.match(init.headers["User-Agent"], /^askaipods\//);
  });

  test("sends sort in body; defaults to 'recency' when unset", async () => {
    const calls = mockResponse({ body: validEnvelope() });
    await search({ query: "hi", sort: "relevance", endpoint: "https://mock/" });
    assert.equal(JSON.parse(calls[0].init.body).sort, "relevance");
    const calls2 = mockResponse({ body: validEnvelope() });
    await search({ query: "hi", endpoint: "https://mock/" });
    assert.equal(JSON.parse(calls2[0].init.body).sort, "recency");
  });

  test("omits days from body when not > 0", async () => {
    const calls = mockResponse({ body: validEnvelope() });
    await search({ query: "hi", endpoint: "https://mock/" });
    const body = JSON.parse(calls[0].init.body);
    assert.ok(!("days" in body), "days must not be forwarded when unset");
  });

  test("omits X-PodLens-API-Key when no apiKey provided", async () => {
    const calls = mockResponse({ body: validEnvelope() });
    await search({ query: "hi", endpoint: "https://mock/" });
    assert.ok(
      !("X-PodLens-API-Key" in calls[0].init.headers),
      "no apiKey → no header (anonymous tier)",
    );
  });

  test("User-Agent advertises the EXACT current version from package.json (version-bump parity)", async () => {
    // Semver-shape regex would pass for any version. Pin the exact string
    // read from package.json so a forgotten bump in client.mjs fails here.
    const calls = mockResponse({ body: validEnvelope() });
    await search({ query: "hi", endpoint: "https://mock/" });
    assert.equal(
      calls[0].init.headers["User-Agent"],
      `askaipods/${PKG_VERSION} (+https://github.com/Delibread0601/askaipods)`,
    );
  });

  test("calls AbortSignal.timeout(30000) and passes that signal to fetch (full timeout-budget guard)", async () => {
    // Defense-in-depth: the timeout-classification tests
    // fabricate TimeoutError from the mock, so they don't exercise the
    // real timeout wiring. Just asserting `signal instanceof AbortSignal`
    // is also insufficient — a regression to `new AbortController().signal`
    // (never aborts) would pass. Spy on AbortSignal.timeout to pin both:
    //   1. the 30000ms budget, and
    //   2. that the exact signal produced flows through to fetch unchanged.
    const originalTimeout = AbortSignal.timeout;
    const timeoutArgs = [];
    const sentinel = originalTimeout.call(AbortSignal, 30_000);
    AbortSignal.timeout = (ms) => {
      timeoutArgs.push(ms);
      return sentinel;
    };
    try {
      const calls = mockResponse({ body: validEnvelope() });
      await search({ query: "hi", endpoint: "https://mock/" });
      assert.deepEqual(timeoutArgs, [30_000], "client.mjs must call AbortSignal.timeout(30_000)");
      assert.equal(
        calls[0].init.signal,
        sentinel,
        "the exact signal from AbortSignal.timeout must flow to fetch",
      );
    } finally {
      AbortSignal.timeout = originalTimeout;
    }
  });
});

describe("search — input validation", () => {
  afterEach(restoreFetch);

  test("rejects empty query", async () => {
    const err = await runAndCatch({ query: "" });
    assert.ok(err instanceof AskaipodsError);
    assert.equal(err.exitCode, 1);
    assert.match(err.message, /query is required/i);
  });

  test("rejects whitespace-only query", async () => {
    const err = await runAndCatch({ query: "   " });
    assert.equal(err.exitCode, 1);
  });

  test("rejects query > 300 chars", async () => {
    const err = await runAndCatch({ query: "a".repeat(301) });
    assert.equal(err.exitCode, 1);
    assert.match(err.message, /too long/i);
  });

  test("accepts query at exactly 300 chars", async () => {
    mockResponse({ body: validEnvelope() });
    await search({ query: "a".repeat(300), endpoint: "https://mock/" });
  });
});

describe("search — HTTP error → exit-code mapping", () => {
  afterEach(restoreFetch);

  test("400 → exit 1, 'invalid request'", async () => {
    mockResponse({ status: 400, body: { error: "bad query" } });
    const err = await runAndCatch();
    assert.equal(err.exitCode, 1);
    assert.match(err.message, /invalid request/i);
    assert.match(err.message, /bad query/);
  });

  test("401 → exit 1, 'API key rejected'", async () => {
    mockResponse({ status: 401, body: { error: "invalid key" } });
    const err = await runAndCatch({ apiKey: "bogus" });
    assert.equal(err.exitCode, 1);
    assert.match(err.message, /API key rejected/i);
  });

  test("403 → exit 1", async () => {
    mockResponse({ status: 403, body: { error: "forbidden" } });
    const err = await runAndCatch({ apiKey: "bogus" });
    assert.equal(err.exitCode, 1);
  });

  test("413 → exit 1, 'too large'", async () => {
    mockResponse({ status: 413, body: {} });
    const err = await runAndCatch();
    assert.equal(err.exitCode, 1);
    assert.match(err.message, /too large/i);
  });

  test("503 → exit 3, 'temporarily unavailable'", async () => {
    mockResponse({ status: 503, body: { error: "service unavailable" } });
    const err = await runAndCatch();
    assert.equal(err.exitCode, 3);
    assert.match(err.message, /temporarily unavailable/i);
  });

  test("503 'Daily capacity reached' (no Retry-After) → exit 2, do-not-retry-until-reset copy", async () => {
    mockResponse({ status: 503, body: { error: "Daily capacity reached. Please try again tomorrow." } });
    const err = await runAndCatch();
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /daily capacity for anonymous-level searches is used up/);
    assert.match(err.message, /resets at 00:00 UTC — retrying at the anonymous level before then will fail/);
    assert.match(err.message, /shared by every caller served at the anonymous level, including free accounts in their first 48 hours/);
    assert.doesNotMatch(err.message, /temporarily unavailable/i);
  });

  test("503 with code daily_capacity_reached → exit 2 whatever the error text says", async () => {
    mockResponse({ status: 503, body: { error: "Come back tomorrow.", code: "daily_capacity_reached" } });
    const err = await runAndCatch();
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /daily capacity for anonymous-level searches is used up/);
  });

  test("503 with another code and other text stays exit 3", async () => {
    mockResponse({ status: 503, body: { error: "Vector search unavailable", code: "vectorize" } });
    assert.equal((await runAndCatch()).exitCode, 3);
  });

  test("transient 503 (any other error text) stays exit 3", async () => {
    mockResponse({
      status: 503,
      body: { error: "Service temporarily unavailable" },
    });
    const err = await runAndCatch();
    assert.equal(err.exitCode, 3);
    assert.match(err.message, /temporarily unavailable/i);
  });

  test("500 → exit 3 generic", async () => {
    mockResponse({ status: 500, body: { error: "boom" } });
    const err = await runAndCatch();
    assert.equal(err.exitCode, 3);
    assert.match(err.message, /HTTP 500/);
  });

  test("502 → exit 3", async () => {
    mockResponse({ status: 502, body: { error: "bad gateway" } });
    const err = await runAndCatch();
    assert.equal(err.exitCode, 3);
  });
});

describe("search — 429 tier-aware quota messaging", () => {
  afterEach(restoreFetch);

  // The 429 envelope carries the same tier fields as a success
  // (access_tier, quota, and downgraded for a degraded free request).
  const quota429 = (meta) => ({ status: 429, body: { error: "Daily search quota exhausted", meta } });

  test("429 quota without meta → exit 2, tier-neutral message (no guess from the key)", async () => {
    for (const opts of [{}, { apiKey: "k1" }]) {
      mockResponse({ status: 429, body: { error: "Daily search quota exhausted" } });
      const err = await runAndCatch(opts);
      assert.equal(err.exitCode, 2);
      assert.equal(err.message, "daily search quota exhausted. Quota resets at 00:00 UTC.");
    }
  });

  test("unknown access_tier → tier-neutral message", async () => {
    mockResponse(quota429({ access_tier: "gold", quota: { used: 20, limit: 20 } }));
    const err = await runAndCatch({ apiKey: "k1" });
    assert.equal(err.exitCode, 2);
    assert.equal(err.message, "daily search quota exhausted. Quota resets at 00:00 UTC.");
  });

  test("access_tier anonymous with a key → anonymous message naming the key", async () => {
    mockResponse(quota429({ access_tier: "anonymous", quota: { used: 20, limit: 20 } }));
    const err = await runAndCatch({ apiKey: "k1" });
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /anonymous tier: 20\/day per IP — this API key was served as anonymous/);
    assert.doesNotMatch(err.message, /member tier|free tier|invite/i);
  });

  test("access_tier anonymous, no key → anonymous message with the free sign-in path", async () => {
    mockResponse(quota429({ access_tier: "anonymous", quota: { used: 20, limit: 20 } }));
    const err = await runAndCatch();
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /anonymous tier: 20\/day per IP\)/);
    assert.match(err.message, /sign in free with Google or GitHub at https:\/\/podlens\.net/);
    assert.match(err.message, /50 searches\/day/);
    assert.match(err.message, /ASKAIPODS_API_KEY/);
    assert.doesNotMatch(err.message, /invite/i);
  });

  test("access_tier free → 50/day + waitlist link, no approval promise, frozen tier ignored", async () => {
    mockResponse(quota429({ tier: "anonymous", access_tier: "free", quota: { used: 50, limit: 50 } }));
    const err = await runAndCatch({ apiKey: "k1" });
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /free tier: 50\/day/);
    assert.match(err.message, /https:\/\/podlens\.net\/dashboard\?source=askaipods#waitlist/);
    assert.match(err.message, /does not grant membership/);
    assert.doesNotMatch(err.message, /anonymous tier|invite|approv/i);
  });

  test("access_tier member → member message", async () => {
    mockResponse(quota429({ access_tier: "member", quota: { used: 100, limit: 100 } }));
    const err = await runAndCatch({ apiKey: "k1" });
    assert.match(err.message, /member tier: 100\/day/);
    assert.doesNotMatch(err.message, /waitlist|sign in/i);
  });

  test("degraded free request (meta.downgraded) → degrade copy with the server's waitlist link", async () => {
    const waitlist = "https://podlens.net/dashboard?source=quota_exhausted#waitlist";
    mockResponse(
      quota429(
        {
          access_tier: "anonymous",
          quota: { used: 20, limit: 20 },
          downgraded: { from: "free", reason: "free_pool_exhausted", waitlist },
        },
      ),
    );
    const err = await runAndCatch({ apiKey: "k1" });
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /free-tier capacity is used up/);
    assert.match(err.message, /anonymous level — 20\/day per IP/);
    assert.ok(err.message.includes(waitlist), "uses meta.downgraded.waitlist verbatim");
    assert.match(err.message, /does not grant membership/);
    // A signed-in free user must not be told to sign in or that the key is wrong.
    assert.doesNotMatch(err.message, /sign in|served as anonymous|invite/i);
  });

  test("new-account probation (reason new_account) → 48-hour copy, not pool-exhaustion copy", async () => {
    mockResponse(
      quota429(
        {
          access_tier: "anonymous",
          quota: { used: 20, limit: 20 },
          downgraded: { from: "free", reason: "new_account", waitlist: "https://podlens.net/dashboard#waitlist" },
        },
      ),
    );
    const err = await runAndCatch({ apiKey: "k1" });
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /new free accounts search at the anonymous level — 20\/day per IP — for their first 48 hours/);
    assert.match(err.message, /50 searches\/day apply once the account is 48 hours old/);
    assert.match(err.message, /Quota resets at 00:00 UTC/);
    assert.doesNotMatch(err.message, /capacity|waitlist|sign in|served as anonymous/i);
  });

  test("unknown downgrade reason → neutral anonymous-level copy", async () => {
    mockResponse(
      quota429(
        {
          access_tier: "anonymous",
          quota: { used: 20, limit: 20 },
          downgraded: { from: "free", reason: "maintenance", waitlist: "https://podlens.net/dashboard#waitlist" },
        },
      ),
    );
    const err = await runAndCatch({ apiKey: "k1" });
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /this request ran at the anonymous level — 20\/day per IP — and that quota is used up/);
    assert.doesNotMatch(err.message, /capacity|48 hours|waitlist|sign in/i);
  });

  test("anonymous 429 qualifies the 50/day upsell with the 48-hour probation", async () => {
    mockResponse(quota429({ access_tier: "anonymous", quota: { used: 20, limit: 20 } }));
    const err = await runAndCatch();
    assert.match(err.message, /new accounts search at the anonymous level for their first 48 hours/);
    mockResponse(quota429({ access_tier: "anonymous", quota: { used: 20, limit: 20 } }));
    const keyed = await runAndCatch({ apiKey: "k1" });
    assert.match(keyed.message, /50 searches\/day once the account is 48 hours old/);
  });

  // IPv6 /48 aggregate: same 429 text and access_tier "anonymous", but the
  // binding limit is the network's 200/day, not the IP's 20/day.
  const NETWORK_COPY = /20\/day per IP, 200\/day per IPv6 \/48 network/;
  const NETWORK_USED = /the network's shared 200\/day is used up/;
  const PER_IP_ONLY = /20\/day per IP\)|20\/day per IP —|that quota is used/;

  test("/48 allowance, no key → network copy with the free sign-in path, no per-IP claim", async () => {
    mockResponse(quota429({ access_tier: "anonymous", quota: { used: 200, limit: 200 } }));
    const err = await runAndCatch();
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /anonymous tier: 20\/day per IP, 200\/day per IPv6 \/48 network; the network's shared 200\/day is used up\)/);
    assert.match(err.message, /sign in free with Google or GitHub at https:\/\/podlens\.net/);
    assert.doesNotMatch(err.message, PER_IP_ONLY);
  });

  test("/48 allowance, key served as anonymous → network copy naming the key", async () => {
    mockResponse(quota429({ access_tier: "anonymous", quota: { used: 200, limit: 200 } }));
    const err = await runAndCatch({ apiKey: "k1" });
    assert.equal(err.exitCode, 2);
    assert.match(err.message, NETWORK_COPY);
    assert.match(err.message, NETWORK_USED);
    assert.match(err.message, /this API key was served as anonymous/);
    assert.doesNotMatch(err.message, PER_IP_ONLY);
  });

  for (const [reason, expected] of [
    ["new_account", /for their first 48 hours, and the network's shared 200\/day is used up\)/],
    ["free_pool_exhausted", /free-tier capacity is used up.*the network's shared 200\/day is used up too\)/],
    ["maintenance", /this request ran at the anonymous level — 20\/day per IP, 200\/day per IPv6 \/48 network — and the network's shared 200\/day is used up\)/],
  ]) {
    test(`/48 allowance, downgraded (${reason}) → network copy in the downgrade branch`, async () => {
      mockResponse(
        quota429(
          {
            access_tier: "anonymous",
            quota: { used: 200, limit: 200 },
            downgraded: { from: "free", reason, waitlist: "https://podlens.net/dashboard#waitlist" },
          },
        ),
      );
      const err = await runAndCatch({ apiKey: "k1" });
      assert.equal(err.exitCode, 2);
      assert.match(err.message, NETWORK_COPY);
      assert.match(err.message, expected);
      assert.doesNotMatch(err.message, PER_IP_ONLY);
    });
  }

  test("429 without 'quota' in message → exit 3 rate-limit (not daily quota)", async () => {
    mockResponse({
      status: 429,
      body: { error: "burst rate limit exceeded" },
    });
    const err = await runAndCatch();
    assert.equal(err.exitCode, 3);
    assert.match(err.message, /rate limited/i);
  });

  test("429 carrying meta.quota → exit 2 whatever the error text says", async () => {
    mockResponse({
      status: 429,
      body: { error: "Daily search limit reached", meta: { access_tier: "member", quota: { used: 100, limit: 100 } } },
    });
    const err = await runAndCatch({ apiKey: "k1" });
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /member tier: 100\/day/);
  });

  test("429 with meta but no meta.quota and no 'quota' text → exit 3 rate-limit", async () => {
    mockResponse({ status: 429, body: { error: "Too many requests", meta: { access_tier: "member" } } });
    assert.equal((await runAndCatch()).exitCode, 3);
  });

  test("429 case-insensitive 'QUOTA' string still maps to exit 2", async () => {
    mockResponse({
      status: 429,
      body: { error: "Daily QUOTA Exhausted" },
    });
    const err = await runAndCatch();
    assert.equal(err.exitCode, 2);
  });
});

describe("search — server text in error messages is terminal-safe", () => {
  afterEach(restoreFetch);

  // An OSC-8 hyperlink opener, a line break that would start a new stderr
  // line, and a bidi override.
  const HOSTILE = "bad\u001b]8;;https://evil.example\u0007 thing\n# heading\u202E";
  const UNSAFE = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;

  for (const [status, exitCode] of [[400, 1], [401, 1], [403, 1], [503, 3], [500, 3]]) {
    test(`HTTP ${status}: the server's error text is folded to one clean line`, async () => {
      mockResponse({ status, body: { error: HOSTILE } });
      const err = await runAndCatch({ apiKey: "k1" });
      assert.equal(err.exitCode, exitCode);
      assert.doesNotMatch(err.message, UNSAFE);
      assert.match(err.message, /bad \]8;;https:\/\/evil\.example thing # heading$/);
    });
  }

  test("error text with nothing visible in it falls back to the built-in detail", async () => {
    mockResponse({ status: 400, body: { error: "\u200D \u200C" } });
    assert.equal((await runAndCatch()).message, "invalid request: bad request");
    mockResponse({ status: 503, body: { error: "\u202E\u001b" } });
    assert.equal((await runAndCatch()).message, "podlens.net temporarily unavailable: service unavailable");
  });

  test("an error value that cannot be turned into a string does not break 429 / 503 classification", async () => {
    const hostile = { toString: null, valueOf: null };
    mockResponse({ status: 429, body: { error: hostile, meta: { access_tier: "member", quota: { used: 100, limit: 100 } } } });
    const quota = await runAndCatch({ apiKey: "k1" });
    assert.ok(quota instanceof AskaipodsError);
    assert.equal(quota.exitCode, 2);
    mockResponse({ status: 429, body: { error: hostile } });
    assert.equal((await runAndCatch()).exitCode, 3);
    mockResponse({ status: 503, body: { error: hostile, code: "daily_capacity_reached" } });
    assert.equal((await runAndCatch()).exitCode, 2);
    mockResponse({ status: 503, body: { error: hostile } });
    const transient = await runAndCatch();
    assert.equal(transient.exitCode, 3);
    assert.equal(transient.message, "podlens.net temporarily unavailable: service unavailable");
  });

  test("a non-string error falls back instead of printing [object Object]", async () => {
    mockResponse({ status: 400, body: { error: { nested: true } } });
    assert.equal((await runAndCatch()).message, "invalid request: bad request");
    mockResponse({ status: 503, body: { error: 42 } });
    assert.equal((await runAndCatch()).message, "podlens.net temporarily unavailable: service unavailable");
    mockResponse({ status: 500, body: { error: ["x"] }, statusText: "Server\u001b Error" });
    assert.equal((await runAndCatch()).message, "podlens.net error (HTTP 500): Server Error");
    mockResponse({ status: 500, body: {}, statusText: "" });
    assert.equal((await runAndCatch()).message, "podlens.net error (HTTP 500): no detail given");
  });

  test("429 degrade copy prints only a podlens.net waitlist link, else the built-in one", async () => {
    const degraded = (waitlist) => ({
      status: 429,
      body: {
        error: "Daily search quota exhausted",
        meta: {
          access_tier: "anonymous",
          quota: { used: 20, limit: 20 },
          downgraded: { from: "free", reason: "free_pool_exhausted", waitlist },
        },
      },
    });
    const BUILT_IN = /Paid-membership waitlist: https:\/\/podlens\.net\/dashboard\?source=askaipods#waitlist \(joining/;
    for (const bad of [
      "https://podlens.net/w\u001b[31m\n# x",
      "https://evil.example/login",
      "https://podlens.net.evil.example/",
      "http://podlens.net/dashboard",
      "https://podlens.net/w) [x](https://evil.example",
      "\u001b",
      42,
    ]) {
      mockResponse(degraded(bad));
      const err = await runAndCatch({ apiKey: "k1" });
      assert.equal(err.exitCode, 2);
      assert.doesNotMatch(err.message, UNSAFE);
      assert.doesNotMatch(err.message, /evil|\[31m/);
      assert.match(err.message, BUILT_IN, `${JSON.stringify(bad)} → built-in link`);
    }
  });
});

describe("search — network / timeout classes", () => {
  afterEach(restoreFetch);

  test("fetch-phase TimeoutError → exit 3 with 30s budget message", async () => {
    mockTimeoutFetch("TimeoutError");
    const err = await runAndCatch();
    assert.equal(err.exitCode, 3);
    assert.match(err.message, /timed out after 30s/i);
    // Must not mention body-read phase — this is the connection/header timeout.
    assert.doesNotMatch(err.message, /while reading response body/);
  });

  test("fetch-phase AbortError (older Node 18) treated same as TimeoutError", async () => {
    mockTimeoutFetch("AbortError");
    const err = await runAndCatch();
    assert.equal(err.exitCode, 3);
    assert.match(err.message, /timed out after 30s/i);
  });

  test("body-read TimeoutError → exit 3 with body-read message", async () => {
    mockBodyReadTimeoutFetch("TimeoutError");
    const err = await runAndCatch();
    assert.equal(err.exitCode, 3);
    // Body-read timeout distinguished from parse failure.
    assert.match(err.message, /while reading response body/i);
    assert.match(err.message, /timed out after 30s/i);
  });

  test("body-read AbortError → exit 3 with body-read message", async () => {
    mockBodyReadTimeoutFetch("AbortError");
    const err = await runAndCatch();
    assert.equal(err.exitCode, 3);
    assert.match(err.message, /while reading response body/i);
  });

  test("non-JSON body (proxy HTML) → exit 3 upstream proxy message, NOT timeout message", async () => {
    mockNonJsonFetch(502);
    const err = await runAndCatch();
    assert.equal(err.exitCode, 3);
    assert.match(err.message, /upstream proxy/i);
    assert.match(err.message, /HTTP 502/);
    // A real parse failure must NOT be labeled as a timeout.
    assert.doesNotMatch(err.message, /timed out/i);
  });

  test("TypeError (DNS/connection refused) → exit 3 network error", async () => {
    mockNetworkErrorFetch("getaddrinfo ENOTFOUND");
    const err = await runAndCatch();
    assert.equal(err.exitCode, 3);
    assert.match(err.message, /network error/i);
    assert.match(err.message, /ENOTFOUND/);
  });

  const PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];

  // Node's fetch throws TypeError("fetch failed") and keeps the reason
  // only in err.cause.code — the code a network-blocking sandbox yields.
  for (const code of ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EACCES", "EPERM", "ENETUNREACH", "EHOSTUNREACH"]) {
    test(`fetch failed with cause ${code} → exit 3, code surfaced, sandbox hint`, async () => {
      mockNetworkErrorFetch("fetch failed", { code });
      // A developer shell behind a proxy would switch the hint to the
      // NODE_USE_ENV_PROXY one (tested below); pin the no-proxy case.
      const saved = Object.fromEntries(PROXY_VARS.map((k) => [k, process.env[k]]));
      for (const k of PROXY_VARS) delete process.env[k];
      let err;
      try {
        err = await runAndCatch();
      } finally {
        for (const k of PROXY_VARS) if (saved[k] !== undefined) process.env[k] = saved[k];
      }
      assert.equal(err.exitCode, 3);
      assert.match(err.message, new RegExp(`fetch failed \\(${code}\\)`));
      assert.match(err.message, /if this runs inside a sandbox, outbound HTTPS to podlens\.net may be blocked/);
    });
  }

  test("blocked code with HTTPS_PROXY set (proxy-based sandbox) → NODE_USE_ENV_PROXY hint", async () => {
    const saved = { p: process.env.HTTPS_PROXY, u: process.env.NODE_USE_ENV_PROXY };
    process.env.HTTPS_PROXY = "http://localhost:8080";
    delete process.env.NODE_USE_ENV_PROXY;
    try {
      mockNetworkErrorFetch("fetch failed", { code: "ENOTFOUND" });
      const err = await runAndCatch();
      assert.equal(err.exitCode, 3);
      assert.match(err.message, /HTTPS_PROXY is set but Node's fetch ignores it unless NODE_USE_ENV_PROXY=1/);
    } finally {
      if (saved.p === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = saved.p;
      if (saved.u !== undefined) process.env.NODE_USE_ENV_PROXY = saved.u;
    }
  });

  test("blocked code with only HTTP_PROXY set → the hint names HTTP_PROXY, not HTTPS_PROXY", async () => {
    const keys = [...PROXY_VARS, "NODE_USE_ENV_PROXY"];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    process.env.HTTP_PROXY = "http://localhost:8080";
    try {
      mockNetworkErrorFetch("fetch failed", { code: "ECONNREFUSED" });
      const err = await runAndCatch();
      assert.equal(err.exitCode, 3);
      assert.match(err.message, / — HTTP_PROXY is set but Node's fetch ignores it unless NODE_USE_ENV_PROXY=1/);
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  test("fetch failed with a TLS cause → code surfaced, no sandbox hint", async () => {
    mockNetworkErrorFetch("fetch failed", { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
    const err = await runAndCatch();
    assert.equal(err.exitCode, 3);
    assert.match(err.message, /\(UNABLE_TO_VERIFY_LEAF_SIGNATURE\)/);
    assert.doesNotMatch(err.message, /sandbox/);
  });

  test("a cause code outside the safe shape is not echoed", async () => {
    mockNetworkErrorFetch("fetch failed", { code: "x\u001b]8;;evil\u0007" });
    const err = await runAndCatch();
    assert.equal(err.message, "network error contacting podlens.net: fetch failed");
  });
});
