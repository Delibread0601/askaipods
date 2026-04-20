// Contract tests for isValidSuccessEnvelope.
//
// The validator is not exported, so we exercise it through `search()`
// with a mocked fetch — this also covers the "valid envelope → returned
// unchanged" and "invalid envelope → AskaipodsError exit 3" edges that
// the CLI ultimately depends on.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { search, AskaipodsError } from "../src/client.js";
import {
  mockResponse,
  restoreFetch,
  validEnvelope,
  validResult,
} from "./helpers.mjs";

async function callSearch(body, { status = 200 } = {}) {
  mockResponse({ status, body });
  return await search({ query: "anything", endpoint: "https://mock/" });
}

async function expectEnvelopeRejected(body) {
  await assert.rejects(
    async () => callSearch(body),
    (err) => {
      assert.ok(err instanceof AskaipodsError, `expected AskaipodsError, got ${err?.name}`);
      assert.equal(err.exitCode, 3, "malformed envelope must map to exit 3");
      assert.match(err.message, /unexpected response shape/i);
      return true;
    },
  );
}

describe("isValidSuccessEnvelope — minimal valid shapes", () => {
  afterEach(restoreFetch);

  test("accepts the minimal anonymous envelope", async () => {
    const data = await callSearch(validEnvelope());
    assert.equal(data.total, 0);
    assert.equal(data.meta.tier, "anonymous");
  });

  test("accepts envelope with populated results", async () => {
    const env = validEnvelope({
      total: 2,
      results: [validResult(), validResult({ published_at: "2025-09" })],
    });
    const data = await callSearch(env);
    assert.equal(data.results.length, 2);
  });

  test("accepts member tier", async () => {
    const env = validEnvelope({ meta: { tier: "member", quota: { used: 5, limit: 100 } } });
    const data = await callSearch(env);
    assert.equal(data.meta.tier, "member");
  });
});

describe("isValidSuccessEnvelope — envelope-level shape checks", () => {
  afterEach(restoreFetch);

  test("rejects non-object data", async () => {
    await expectEnvelopeRejected("not an object");
  });

  test("rejects array data", async () => {
    await expectEnvelopeRejected([]);
  });

  test("rejects missing total", async () => {
    const env = validEnvelope();
    delete env.total;
    await expectEnvelopeRejected(env);
  });

  test("rejects non-number total", async () => {
    await expectEnvelopeRejected(validEnvelope({ total: "5" }));
  });

  test("rejects NaN/Infinity total", async () => {
    await expectEnvelopeRejected(validEnvelope({ total: Number.POSITIVE_INFINITY }));
  });

  test("rejects non-array results", async () => {
    await expectEnvelopeRejected(validEnvelope({ results: {} }));
  });
});

describe("isValidSuccessEnvelope — result-row shape checks", () => {
  afterEach(restoreFetch);

  test("rejects non-object result row", async () => {
    await expectEnvelopeRejected(validEnvelope({ total: 1, results: ["just a string"] }));
  });

  test("rejects empty text", async () => {
    await expectEnvelopeRejected(
      validEnvelope({ total: 1, results: [validResult({ text: "" })] }),
    );
  });

  test("rejects whitespace-only text", async () => {
    await expectEnvelopeRejected(
      validEnvelope({ total: 1, results: [validResult({ text: "   \t\n" })] }),
    );
  });

  test("accepts null episode_title (allowed missing)", async () => {
    const env = validEnvelope({
      total: 1,
      results: [validResult({ episode_title: null })],
    });
    const data = await callSearch(env);
    assert.equal(data.results[0].episode_title, null);
  });

  test("rejects non-string episode_title", async () => {
    await expectEnvelopeRejected(
      validEnvelope({ total: 1, results: [validResult({ episode_title: 42 })] }),
    );
  });

  test("rejects non-string podcast_name", async () => {
    await expectEnvelopeRejected(
      validEnvelope({ total: 1, results: [validResult({ podcast_name: { obj: true } })] }),
    );
  });
});

describe("isValidSuccessEnvelope — published_at calendar validation (R3-01)", () => {
  afterEach(restoreFetch);

  const cases = [
    ["2025-10-15", true, "YYYY-MM-DD"],
    ["2025-10", true, "YYYY-MM (anonymous tier)"],
    ["2025-10-15T12:00:00Z", true, "Z offset"],
    ["2025-10-15T12:00:00+14:00", true, "max +14 offset"],
    ["2025-10-15T12:00:00.123Z", true, "fractional seconds"],
    ["2025-10-15T12:00:00-12:00", true, "negative offset"],
    // calendar-invalid
    ["2025-02-30", false, "Feb 30 impossible"],
    ["2025-13-01", false, "month 13"],
    ["2025-00-15", false, "month 0"],
    ["2025-10-32", false, "day 32"],
    // shape-invalid
    ["2025-10-15T12:00:00", false, "missing offset (ambiguous TZ)"],
    ["2025/10/15", false, "slash separator"],
    ["not a date", false, "garbage"],
    ["2025-10-15T25:00:00Z", false, "hour 25"],
    ["2025-10-15T12:60:00Z", false, "minute 60"],
    ["2025-10-15T12:00:00+15:00", false, "offset >+14"],
    ["1969-12-31", false, "pre-1970 bound"],
    ["2025", false, "YYYY alone (regex requires ≥YYYY-MM)"],
  ];

  for (const [input, valid, description] of cases) {
    test(`${valid ? "accepts" : "rejects"}: ${input} — ${description}`, async () => {
      const env = validEnvelope({
        total: 1,
        results: [validResult({ published_at: input })],
      });
      if (valid) {
        const data = await callSearch(env);
        assert.equal(data.results[0].published_at, input);
      } else {
        await expectEnvelopeRejected(env);
      }
    });
  }

  test("accepts null published_at", async () => {
    const env = validEnvelope({
      total: 1,
      results: [validResult({ published_at: null })],
    });
    const data = await callSearch(env);
    assert.equal(data.results[0].published_at, null);
  });
});

describe("isValidSuccessEnvelope — meta.tier / meta.quota (R2-02)", () => {
  afterEach(restoreFetch);

  test("rejects unknown tier value (closed enum)", async () => {
    await expectEnvelopeRejected(
      validEnvelope({ meta: { tier: "premium", quota: { used: 0, limit: 10 } } }),
    );
  });

  test("rejects non-object quota", async () => {
    await expectEnvelopeRejected(
      validEnvelope({ meta: { tier: "anonymous", quota: "n/a" } }),
    );
  });

  test("rejects non-number quota.used", async () => {
    await expectEnvelopeRejected(
      validEnvelope({ meta: { tier: "anonymous", quota: { used: "1", limit: 20 } } }),
    );
  });

  test("rejects non-number quota.limit", async () => {
    await expectEnvelopeRejected(
      validEnvelope({ meta: { tier: "anonymous", quota: { used: 1, limit: null } } }),
    );
  });

  test("accepts quota.refunded true (boolean)", async () => {
    const data = await callSearch(
      validEnvelope({
        meta: { tier: "anonymous", quota: { used: 0, limit: 20, refunded: true } },
      }),
    );
    assert.equal(data.meta.quota.refunded, true);
  });

  test("rejects quota.refunded as string (R2-02)", async () => {
    await expectEnvelopeRejected(
      validEnvelope({
        meta: { tier: "anonymous", quota: { used: 0, limit: 20, refunded: "yes" } },
      }),
    );
  });

  test("accepts quota.period / quota.next_reset (optional passthrough)", async () => {
    const data = await callSearch(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20, period: "daily", next_reset: "2026-04-21T00:00:00Z" },
        },
      }),
    );
    assert.equal(data.meta.quota.period, "daily");
  });
});

describe("isValidSuccessEnvelope — meta.warning (R2-02, R6-01)", () => {
  afterEach(restoreFetch);

  test("accepts warning with string code", async () => {
    const data = await callSearch(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          warning: { code: "corpus_stale_for_requested_window" },
        },
      }),
    );
    assert.equal(data.meta.warning.code, "corpus_stale_for_requested_window");
  });

  test("accepts unknown warning code (validator stays open-enum, R6-01)", async () => {
    const data = await callSearch(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          warning: { code: "a_new_future_warning" },
        },
      }),
    );
    assert.equal(data.meta.warning.code, "a_new_future_warning");
  });

  test("rejects warning missing code (non-object .code)", async () => {
    await expectEnvelopeRejected(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          warning: { code: 42 },
        },
      }),
    );
  });

  test("rejects warning as non-object", async () => {
    await expectEnvelopeRejected(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          warning: "stale",
        },
      }),
    );
  });

  test("accepts warning null / absent", async () => {
    const data = await callSearch(
      validEnvelope({
        meta: { tier: "anonymous", quota: { used: 1, limit: 20 }, warning: null },
      }),
    );
    assert.equal(data.meta.warning, null);
  });
});

describe("isValidSuccessEnvelope — meta.corpus_freshness (R4-01, R5-01)", () => {
  afterEach(restoreFetch);

  test("rejects corpus_freshness missing newest_date property (R5-01)", async () => {
    await expectEnvelopeRejected(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          corpus_freshness: {},
        },
      }),
    );
  });

  test("rejects corpus_freshness as non-object", async () => {
    await expectEnvelopeRejected(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          corpus_freshness: "2025-10-15",
        },
      }),
    );
  });

  test("rejects corpus_freshness.newest_date as non-string", async () => {
    // Per client.js line 180, non-string is structural → envelope-fatal.
    await expectEnvelopeRejected(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          corpus_freshness: { newest_date: 42 },
        },
      }),
    );
  });

  test("accepts valid ISO newest_date", async () => {
    const data = await callSearch(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          corpus_freshness: { newest_date: "2026-04-15" },
        },
      }),
    );
    assert.equal(data.meta.corpus_freshness.newest_date, "2026-04-15");
  });

  test("accepts null newest_date (server probe failure passthrough)", async () => {
    const data = await callSearch(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          corpus_freshness: { newest_date: null },
        },
      }),
    );
    assert.equal(data.meta.corpus_freshness.newest_date, null);
  });

  test("R4-01: invalid-calendar newest_date (Feb 30) coerces to null without failing envelope", async () => {
    const data = await callSearch(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          corpus_freshness: { newest_date: "2026-02-30" },
        },
      }),
    );
    assert.equal(
      data.meta.corpus_freshness.newest_date,
      null,
      "malformed newest_date must be coerced to null, not throw",
    );
  });

  test("R4-01: non-ISO newest_date (e.g. 'yesterday') coerces to null", async () => {
    const data = await callSearch(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          corpus_freshness: { newest_date: "yesterday" },
        },
      }),
    );
    assert.equal(data.meta.corpus_freshness.newest_date, null);
  });

  test("R4-01: month-only newest_date coerces to null (YYYY-MM rejected, full date required)", async () => {
    const data = await callSearch(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          corpus_freshness: { newest_date: "2026-04" },
        },
      }),
    );
    assert.equal(data.meta.corpus_freshness.newest_date, null);
  });
});

describe("isValidSuccessEnvelope — meta.cta (R2-02)", () => {
  afterEach(restoreFetch);

  test("accepts cta as object", async () => {
    const data = await callSearch(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          cta: { label: "Sign up", url: "https://podlens.net" },
        },
      }),
    );
    assert.equal(data.meta.cta.url, "https://podlens.net");
  });

  test("rejects cta as non-object primitive", async () => {
    await expectEnvelopeRejected(
      validEnvelope({
        meta: { tier: "anonymous", quota: { used: 1, limit: 20 }, cta: "upgrade" },
      }),
    );
  });

  test("accepts cta null", async () => {
    const data = await callSearch(
      validEnvelope({
        meta: { tier: "anonymous", quota: { used: 1, limit: 20 }, cta: null },
      }),
    );
    assert.equal(data.meta.cta, null);
  });
});

describe("isValidSuccessEnvelope — meta.window (R3-01)", () => {
  afterEach(restoreFetch);

  test("accepts minimal valid window", async () => {
    const data = await callSearch(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          window: { requested_days: 30, served_days: 90, expanded: true },
        },
      }),
    );
    assert.equal(data.meta.window.served_days, 90);
  });

  test("accepts full window with truncated/reason_code/attempted_days", async () => {
    const data = await callSearch(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          window: {
            requested_days: 30,
            served_days: 180,
            expanded: true,
            truncated: false,
            reason_code: "fallback_ok",
            attempted_days: [30, 90, 180],
          },
        },
      }),
    );
    assert.equal(data.meta.window.attempted_days.length, 3);
  });

  test("rejects non-object window", async () => {
    await expectEnvelopeRejected(
      validEnvelope({
        meta: { tier: "anonymous", quota: { used: 1, limit: 20 }, window: "30d" },
      }),
    );
  });

  test("rejects non-number requested_days", async () => {
    await expectEnvelopeRejected(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          window: { requested_days: "30", served_days: 30, expanded: false },
        },
      }),
    );
  });

  test("rejects missing served_days", async () => {
    await expectEnvelopeRejected(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          window: { requested_days: 30, expanded: false },
        },
      }),
    );
  });

  test("rejects string expanded (truthy string would misroute render)", async () => {
    await expectEnvelopeRejected(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          window: { requested_days: 30, served_days: 30, expanded: "false" },
        },
      }),
    );
  });

  test("rejects string truncated when present", async () => {
    await expectEnvelopeRejected(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          window: {
            requested_days: 30,
            served_days: 30,
            expanded: false,
            truncated: "true",
          },
        },
      }),
    );
  });

  test("rejects attempted_days with non-number element", async () => {
    await expectEnvelopeRejected(
      validEnvelope({
        meta: {
          tier: "anonymous",
          quota: { used: 1, limit: 20 },
          window: {
            requested_days: 30,
            served_days: 30,
            expanded: false,
            attempted_days: [30, "90"],
          },
        },
      }),
    );
  });
});
