// Tests for format.js: toStructured passthrough, sortByDateDesc UTC
// comparison, and the tier → render_hint contract.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { toStructured, sortByDateDesc, renderJson } from "../src/format.js";
import { validEnvelope, validResult } from "./helpers.mjs";

describe("sortByDateDesc — pure function", () => {
  test("sorts newest first by YYYY-MM-DD", () => {
    const sorted = sortByDateDesc([
      { published_at: "2025-01-01" },
      { published_at: "2025-12-31" },
      { published_at: "2025-06-15" },
    ]);
    assert.deepEqual(
      sorted.map((r) => r.published_at),
      ["2025-12-31", "2025-06-15", "2025-01-01"],
    );
  });

  test("nulls sort to the end", () => {
    const sorted = sortByDateDesc([
      { published_at: null },
      { published_at: "2025-06-15" },
      { published_at: "2025-12-31" },
      { published_at: null },
    ]);
    const dates = sorted.map((r) => r.published_at);
    assert.deepEqual(dates.slice(0, 2), ["2025-12-31", "2025-06-15"]);
    assert.equal(dates[2], null);
    assert.equal(dates[3], null);
  });

  test("anonymous tier YYYY-MM normalizes to YYYY-MM-01 before compare", () => {
    const sorted = sortByDateDesc([
      { published_at: "2025-01" },
      { published_at: "2025-12" },
      { published_at: "2025-06" },
    ]);
    assert.deepEqual(
      sorted.map((r) => r.published_at),
      ["2025-12", "2025-06", "2025-01"],
    );
  });

  test("UTC-ms compare (NOT lex) fixes TZ-offset edge: +14 vs -12 crossing midnight", () => {
    // 2025-01-01T00:30:00+14:00 → UTC 2024-12-31T10:30Z
    // 2024-12-31T23:30:00-12:00 → UTC 2025-01-01T11:30Z
    // Lex compare would put the "+14" entry first (string "2025…" > "2024…"),
    // reversing the newest-first contract. UTC compare correctly puts the
    // "-12" entry first.
    const sorted = sortByDateDesc([
      { id: "a", published_at: "2025-01-01T00:30:00+14:00" },
      { id: "b", published_at: "2024-12-31T23:30:00-12:00" },
    ]);
    assert.equal(sorted[0].id, "b", "UTC compare must place the later UTC ts first");
    assert.equal(sorted[1].id, "a");
  });

  test("does not mutate input array", () => {
    const input = [
      { published_at: "2025-01-01" },
      { published_at: "2025-12-31" },
    ];
    const snapshot = input.map((r) => r.published_at);
    sortByDateDesc(input);
    assert.deepEqual(
      input.map((r) => r.published_at),
      snapshot,
    );
  });

  test("handles empty array", () => {
    assert.deepEqual(sortByDateDesc([]), []);
  });

  test("unparseable date strings sort to the end like null", () => {
    const sorted = sortByDateDesc([
      { id: "bad", published_at: "not a date" },
      { id: "good", published_at: "2025-06-15" },
    ]);
    assert.equal(sorted[0].id, "good");
    assert.equal(sorted[1].id, "bad");
  });
});

describe("toStructured — render_hint + tier", () => {
  test("member tier → render_hint 'dual_view'", () => {
    const env = validEnvelope({
      meta: { tier: "member", quota: { used: 5, limit: 100 } },
    });
    const s = toStructured("q", env);
    assert.equal(s.tier, "member");
    assert.equal(s.render_hint, "dual_view");
  });

  test("anonymous tier → render_hint 'single_view'", () => {
    const s = toStructured("q", validEnvelope());
    assert.equal(s.tier, "anonymous");
    assert.equal(s.render_hint, "single_view");
  });
});

describe("toStructured — api_rank preservation", () => {
  test("api_rank starts at 1 and reflects API order (not sort order)", () => {
    // Deliberately give API order different from date order: the API
    // returned [old, new, middle], but date-desc sort will produce
    // [new, middle, old]. api_rank must still reflect the API's semantic
    // ranking of the pre-sort order (1, 2, 3).
    const env = validEnvelope({
      total: 3,
      results: [
        validResult({ text: "oldest (API rank 1)", published_at: "2025-01-01" }),
        validResult({ text: "newest (API rank 2)", published_at: "2025-12-31" }),
        validResult({ text: "middle (API rank 3)", published_at: "2025-06-15" }),
      ],
    });
    const s = toStructured("q", env);
    // After sort: newest, middle, oldest
    assert.equal(s.results[0].text, "newest (API rank 2)");
    assert.equal(s.results[0].api_rank, 2);
    assert.equal(s.results[1].text, "middle (API rank 3)");
    assert.equal(s.results[1].api_rank, 3);
    assert.equal(s.results[2].text, "oldest (API rank 1)");
    assert.equal(s.results[2].api_rank, 1);
  });
});

describe("toStructured — field mapping + defaults", () => {
  test("renames episode_title→episode, podcast_name→podcast, published_at→date", () => {
    const env = validEnvelope({
      total: 1,
      results: [
        validResult({
          text: "t",
          episode_title: "Ep 1",
          podcast_name: "Pod X",
          published_at: "2025-10-15",
        }),
      ],
    });
    const s = toStructured("q", env);
    assert.equal(s.results[0].episode, "Ep 1");
    assert.equal(s.results[0].podcast, "Pod X");
    assert.equal(s.results[0].date, "2025-10-15");
    assert.equal(s.results[0].text, "t");
  });

  test("missing episode_title / podcast_name / published_at → null", () => {
    const env = validEnvelope({
      total: 1,
      results: [
        {
          text: "t",
          episode_title: null,
          podcast_name: null,
          published_at: null,
        },
      ],
    });
    const s = toStructured("q", env);
    assert.equal(s.results[0].episode, null);
    assert.equal(s.results[0].podcast, null);
    assert.equal(s.results[0].date, null);
  });
});

describe("toStructured — meta passthrough", () => {
  test("quota passes through untouched", () => {
    const env = validEnvelope({
      meta: {
        tier: "anonymous",
        quota: {
          used: 3,
          limit: 20,
          period: "daily",
          next_reset: "2026-04-21T00:00:00Z",
          refunded: true,
        },
      },
    });
    const s = toStructured("q", env);
    assert.deepEqual(s.meta.quota, env.meta.quota);
  });

  test("total_returned reflects response.total", () => {
    const env = validEnvelope({ total: 42 });
    const s = toStructured("q", env);
    assert.equal(s.meta.total_returned, 42);
  });

  test("missing restrictions / query_hash / window → null defaults", () => {
    const s = toStructured("q", validEnvelope());
    assert.equal(s.meta.restrictions, null);
    assert.equal(s.meta.query_hash, null);
    assert.equal(s.meta.window, null);
  });

  test("warning / corpus_freshness / cta default to null when absent", () => {
    const s = toStructured("q", validEnvelope());
    assert.equal(s.meta.warning, null);
    assert.equal(s.meta.corpus_freshness, null);
    assert.equal(s.meta.cta, null);
  });

  test("warning / corpus_freshness / cta pass through when present", () => {
    const env = validEnvelope({
      meta: {
        tier: "anonymous",
        quota: { used: 1, limit: 20 },
        warning: { code: "index_metadata_stale" },
        corpus_freshness: { newest_date: "2026-04-15" },
        cta: { label: "Join", url: "https://podlens.net" },
      },
    });
    const s = toStructured("q", env);
    assert.equal(s.meta.warning.code, "index_metadata_stale");
    assert.equal(s.meta.corpus_freshness.newest_date, "2026-04-15");
    assert.equal(s.meta.cta.url, "https://podlens.net");
  });
});

describe("toStructured — envelope metadata", () => {
  test("query + fetched_at recorded", () => {
    const before = Date.now();
    const s = toStructured("my query", validEnvelope());
    const after = Date.now();
    assert.equal(s.query, "my query");
    const fetchedMs = Date.parse(s.fetched_at);
    assert.ok(fetchedMs >= before && fetchedMs <= after, "fetched_at must be recent ISO timestamp");
    // Must be ISO 8601 with Z (UTC)
    assert.match(s.fetched_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("renderJson", () => {
  test("returns stringified structured payload", () => {
    const env = validEnvelope({
      total: 1,
      results: [validResult()],
    });
    const json = renderJson("q", env);
    const parsed = JSON.parse(json);
    assert.equal(parsed.tier, "anonymous");
    assert.equal(parsed.results.length, 1);
    assert.equal(parsed.query, "q");
  });

  test("output is pretty-printed (contains newlines + indentation)", () => {
    const json = renderJson("q", validEnvelope());
    assert.match(json, /\n/);
    assert.match(json, /  /, "expected 2-space indentation");
  });
});
