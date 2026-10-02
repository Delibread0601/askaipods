// Tests for client.js status → exit-code mapping, 429 tier-aware message
// (old and new server shapes),
// and the R7-02 / R8-01 timeout / body-read distinction.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { search, AskaipodsError } from "../src/client.js";
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
    assert.equal(data.meta.tier, "anonymous");
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

  test("User-Agent advertises the EXACT current version from package.json (R13-03 version-bump parity)", async () => {
    // Semver-shape regex would pass for any version. Pin the exact string
    // read from package.json so a forgotten bump in client.js fails here.
    const calls = mockResponse({ body: validEnvelope() });
    await search({ query: "hi", endpoint: "https://mock/" });
    assert.equal(
      calls[0].init.headers["User-Agent"],
      `askaipods/${PKG_VERSION} (+https://github.com/Delibread0601/askaipods)`,
    );
  });

  test("calls AbortSignal.timeout(30000) and passes that signal to fetch (R7-02 full timeout-budget guard, R16-01)", async () => {
    // Defense-in-depth (R13-02 + R16-01): the timeout-classification tests
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
      assert.deepEqual(timeoutArgs, [30_000], "client.js must call AbortSignal.timeout(30_000)");
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

  // Older server shape: no meta.access_tier / meta.downgraded on the 429
  // envelope, so the X-RateLimit-Limit header (or, without it, whether a
  // key was sent) decides the copy.
  test("old server: 429 quota, no apiKey → exit 2, anonymous message with the free sign-in path", async () => {
    mockResponse({
      status: 429,
      body: { error: "daily quota exhausted for anonymous tier" },
    });
    const err = await runAndCatch();
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /anonymous tier: 20\/day per IP/);
    assert.match(err.message, /sign in free with Google or GitHub at https:\/\/podlens\.net/);
    assert.match(err.message, /50 searches\/day/);
    assert.match(err.message, /ASKAIPODS_API_KEY/);
    assert.doesNotMatch(err.message, /invite/i);
  });

  test("old server: 429 quota WITH apiKey and no header → member message, no sign-in path", async () => {
    mockResponse({
      status: 429,
      body: { error: "daily quota exhausted for member tier" },
    });
    const err = await runAndCatch({ apiKey: "k1" });
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /member tier: 100\/day/i);
    // Member tier must NOT be told to sign in or set a key — they already have one.
    assert.doesNotMatch(err.message, /ASKAIPODS_API_KEY|sign in|waitlist/i);
    assert.doesNotMatch(err.message, /invite/i);
  });

  test("old server: 429 quota with a key served as anonymous (X-RateLimit-Limit 20) → anonymous message naming the key", async () => {
    mockResponse({
      status: 429,
      body: { error: "Daily search quota exhausted" },
      headers: { "x-ratelimit-limit": "20" },
    });
    const err = await runAndCatch({ apiKey: "k1" });
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /anonymous tier: 20\/day per IP — this API key was served as anonymous/);
    assert.doesNotMatch(err.message, /member tier: 100\/day/);
    assert.doesNotMatch(err.message, /invite/i);
  });

  test("old server: 429 quota with X-RateLimit-Limit 100 → member message", async () => {
    mockResponse({
      status: 429,
      body: { error: "Daily search quota exhausted" },
      headers: { "x-ratelimit-limit": "100" },
    });
    const err = await runAndCatch({ apiKey: "k1" });
    assert.match(err.message, /member tier: 100\/day/);
  });

  test("429 quota with X-RateLimit-Limit 50 and no access_tier → free message", async () => {
    mockResponse({
      status: 429,
      body: { error: "Daily search quota exhausted" },
      headers: { "x-ratelimit-limit": "50" },
    });
    const err = await runAndCatch({ apiKey: "k1" });
    assert.match(err.message, /free tier: 50\/day/);
  });

  // New server shape: the 429 envelope's meta carries access_tier (and
  // downgraded for a degraded free request), which wins over the header.
  function newServer429(meta, limit) {
    return {
      status: 429,
      body: { error: "Daily search quota exhausted", meta },
      headers: { "x-ratelimit-limit": String(limit) },
    };
  }

  test("new server: access_tier anonymous, no key → anonymous message with the free sign-in path", async () => {
    mockResponse(newServer429({ tier: "anonymous", access_tier: "anonymous", quota: { used: 20, limit: 20 } }, 20));
    const err = await runAndCatch();
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /anonymous tier: 20\/day per IP\)/);
    assert.match(err.message, /sign in free with Google or GitHub at https:\/\/podlens\.net/);
    assert.match(err.message, /50 searches\/day/);
  });

  test("new server: access_tier free → 50/day + waitlist link, no approval promise, frozen tier ignored", async () => {
    mockResponse(newServer429({ tier: "anonymous", access_tier: "free", quota: { used: 50, limit: 50 } }, 50));
    const err = await runAndCatch({ apiKey: "k1" });
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /free tier: 50\/day/);
    assert.match(err.message, /https:\/\/podlens\.net\/dashboard\?source=askaipods#waitlist/);
    assert.match(err.message, /does not grant membership/);
    assert.doesNotMatch(err.message, /anonymous tier|invite|approv/i);
  });

  test("new server: access_tier member → member message", async () => {
    mockResponse(newServer429({ tier: "member", access_tier: "member", quota: { used: 100, limit: 100 } }, 100));
    const err = await runAndCatch({ apiKey: "k1" });
    assert.match(err.message, /member tier: 100\/day/);
    assert.doesNotMatch(err.message, /waitlist|sign in/i);
  });

  test("new server: access_tier wins over a contradicting X-RateLimit-Limit header", async () => {
    mockResponse(newServer429({ tier: "anonymous", access_tier: "free", quota: { used: 50, limit: 50 } }, 100));
    const err = await runAndCatch({ apiKey: "k1" });
    assert.match(err.message, /free tier: 50\/day/);
  });

  test("new server: unknown access_tier falls back to the header rule", async () => {
    mockResponse(newServer429({ tier: "anonymous", access_tier: "gold", quota: { used: 20, limit: 20 } }, 20));
    const err = await runAndCatch({ apiKey: "k1" });
    assert.match(err.message, /this API key was served as anonymous/);
  });

  test("new server: degraded free request (meta.downgraded) → degrade copy with the server's waitlist link", async () => {
    const waitlist = "https://podlens.net/dashboard?source=quota_exhausted#waitlist";
    mockResponse(
      newServer429(
        {
          tier: "anonymous",
          access_tier: "anonymous",
          quota: { used: 20, limit: 20 },
          downgraded: { from: "free", reason: "free_pool_exhausted", waitlist },
        },
        20,
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

  test("429 without 'quota' in message → exit 3 rate-limit (not daily quota)", async () => {
    mockResponse({
      status: 429,
      body: { error: "burst rate limit exceeded" },
    });
    const err = await runAndCatch();
    assert.equal(err.exitCode, 3);
    assert.match(err.message, /rate limited/i);
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

describe("search — network / timeout classes (R7-02, R8-01)", () => {
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

  test("body-read TimeoutError → exit 3 with body-read message (R8-01)", async () => {
    mockBodyReadTimeoutFetch("TimeoutError");
    const err = await runAndCatch();
    assert.equal(err.exitCode, 3);
    // R8-01: body-read timeout distinguished from parse failure.
    assert.match(err.message, /while reading response body/i);
    assert.match(err.message, /timed out after 30s/i);
  });

  test("body-read AbortError → exit 3 with body-read message", async () => {
    mockBodyReadTimeoutFetch("AbortError");
    const err = await runAndCatch();
    assert.equal(err.exitCode, 3);
    assert.match(err.message, /while reading response body/i);
  });

  test("non-JSON body (proxy HTML) → exit 3 upstream proxy message, NOT timeout message (R8-01)", async () => {
    mockNonJsonFetch(502);
    const err = await runAndCatch();
    assert.equal(err.exitCode, 3);
    assert.match(err.message, /upstream proxy/i);
    assert.match(err.message, /HTTP 502/);
    // R8-01: real parse failure must NOT be labeled as a timeout.
    assert.doesNotMatch(err.message, /timed out/i);
  });

  test("TypeError (DNS/connection refused) → exit 3 network error", async () => {
    mockNetworkErrorFetch("getaddrinfo ENOTFOUND");
    const err = await runAndCatch();
    assert.equal(err.exitCode, 3);
    assert.match(err.message, /network error/i);
    assert.match(err.message, /ENOTFOUND/);
  });
});
