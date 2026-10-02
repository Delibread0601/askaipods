// Tests for format.js renderMarkdown:
//   R2-01 — empty-result 6-step priority ladder
//   R2-03 — non-empty freshness banner
//   R3-02 — expanded-empty branch appends "(corpus indexed through X)"
//   R5-01 — corpus_freshness missing newest_date rejected at envelope level
//           (validator test; here we check the downstream render only
//           receives validated shapes)
//   R6-01 — unknown warning code falls back with forward-compat copy
//   Plus: refunded tag, per-tier closing note, header (tier / sort /
//   results / quota), degrade notice.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../src/format.js";
import { validEnvelope, validResult } from "./helpers.mjs";

// Builders — concise mutations of the base valid envelope.
function empty(metaOverrides = {}) {
  return validEnvelope({
    meta: {
      tier: "anonymous",
      quota: { used: 1, limit: 20 },
      ...metaOverrides,
    },
  });
}
function nonEmpty(metaOverrides = {}) {
  return validEnvelope({
    total: 1,
    results: [
      validResult({
        text: "inference-time compute is the new scaling axis",
        episode_title: "Ep 42",
        podcast_name: "No Priors",
        published_at: "2026-04-10",
      }),
    ],
    meta: {
      tier: "anonymous",
      quota: { used: 1, limit: 20 },
      ...metaOverrides,
    },
  });
}

describe("renderMarkdown — header", () => {
  test("header line includes tier, result count, and quota", () => {
    const out = renderMarkdown("test q", validEnvelope());
    assert.match(out, /# askaipods · "test q"/);
    assert.match(out, /Tier: anonymous/);
    assert.match(out, /Results: 0/);
    assert.match(out, /Quota: 1\/20 daily/);
  });

  test("quota.period passthrough (non-'daily' label)", () => {
    const env = validEnvelope({
      meta: { tier: "member", quota: { used: 3, limit: 100, period: "per-day" } },
    });
    const out = renderMarkdown("q", env);
    assert.match(out, /Quota: 3\/100 per-day/);
  });

  test("refunded=true renders ' · refunded' tag in header", () => {
    const env = empty({ quota: { used: 2, limit: 20, refunded: true } });
    const out = renderMarkdown("q", env);
    assert.match(out, /· refunded/);
  });

  test("refunded absent → no refunded tag", () => {
    const out = renderMarkdown("q", empty());
    assert.doesNotMatch(out, /refunded/);
  });

  test("refunded=false → no refunded tag", () => {
    const env = empty({ quota: { used: 2, limit: 20, refunded: false } });
    const out = renderMarkdown("q", env);
    assert.doesNotMatch(out, /refunded/);
  });
});

describe("renderMarkdown — empty result ladder priority (R2-01)", () => {
  test("step 1: warning 'corpus_stale_for_requested_window' — message + newest_date suffix", () => {
    const env = empty({
      warning: { code: "corpus_stale_for_requested_window" },
      corpus_freshness: { newest_date: "2026-04-01" },
      // Present but lower-priority signals:
      window: { requested_days: 30, served_days: 90, expanded: true, truncated: true },
    });
    const out = renderMarkdown("q", env);
    assert.match(out, /No results in the requested window/);
    assert.match(out, /\(newest indexed episode: 2026-04-01\)/);
    // Must NOT fall through to the expanded/truncated copy
    assert.doesNotMatch(out, /The API expanded the search window/);
    assert.doesNotMatch(out, /transient error/);
  });

  test("step 1: stale warning without newest_date → no trailing suffix", () => {
    const env = empty({
      warning: { code: "corpus_stale_for_requested_window" },
      corpus_freshness: { newest_date: null },
    });
    const out = renderMarkdown("q", env);
    assert.match(out, /No results in the requested window/);
    assert.doesNotMatch(out, /\(newest indexed episode/);
  });

  test("step 2: warning 'index_metadata_stale' — propagation message", () => {
    const env = empty({ warning: { code: "index_metadata_stale" } });
    const out = renderMarkdown("q", env);
    assert.match(out, /propagating to the search index/);
    assert.match(out, /retry in a few minutes/i);
  });

  test("step 3: unknown warning code (forward-compat, R6-01)", () => {
    // Novel code the client has never seen — validator stays open-enum,
    // renderer surfaces the raw code instead of falling through to generic copy.
    const env = empty({ warning: { code: "novel_future_warning_v9" } });
    const out = renderMarkdown("q", env);
    assert.match(out, /code: novel_future_warning_v9/);
    // Must NOT fall through to the step-6 generic "try a different phrasing" copy
    assert.doesNotMatch(out, /Try a different phrasing or broader topic\./);
  });

  test("step 4: window.truncated — transient error copy (NO warning)", () => {
    const env = empty({
      window: { requested_days: 30, served_days: 90, expanded: false, truncated: true },
    });
    const out = renderMarkdown("q", env);
    assert.match(out, /transient error/);
    assert.match(out, /Try again in a moment/i);
  });

  test("R2-01: truncated MUST be checked before expanded (both true → truncated wins)", () => {
    // When a fallback Vectorize query errors mid-expansion, both flags are
    // true. Truncated copy ("retry") is strictly more actionable than
    // expanded copy ("rephrase").
    const env = empty({
      window: { requested_days: 30, served_days: 90, expanded: true, truncated: true },
    });
    const out = renderMarkdown("q", env);
    assert.match(out, /transient error/);
    assert.doesNotMatch(out, /The API expanded the search window/);
  });

  test("step 5: window.expanded + newest_date → 'corpus indexed through' suffix (R3-02)", () => {
    const env = empty({
      window: { requested_days: 30, served_days: 180, expanded: true },
      corpus_freshness: { newest_date: "2026-04-05" },
    });
    const out = renderMarkdown("q", env);
    assert.match(out, /expanded the search window from 30 to 180 days/);
    assert.match(out, /\(corpus indexed through 2026-04-05\)/);
  });

  test("step 5: window.expanded without newest_date → no suffix, still expanded copy", () => {
    const env = empty({
      window: { requested_days: 30, served_days: 180, expanded: true },
    });
    const out = renderMarkdown("q", env);
    assert.match(out, /expanded the search window from 30 to 180 days/);
    assert.doesNotMatch(out, /corpus indexed through/);
  });

  test("step 6: no signal → generic 'try a different phrasing'", () => {
    const out = renderMarkdown("q", empty());
    assert.match(out, /Try a different phrasing or broader topic\./);
  });

  test("anonymous empty result appends the anonymous tier note (free sign-in path)", () => {
    const out = renderMarkdown("q", empty());
    assert.match(out, /Anonymous tier/);
    assert.match(out, /Sign in free with Google or GitHub at https:\/\/podlens\.net/);
    assert.match(out, /ASKAIPODS_API_KEY/);
    assert.match(out, /50 searches\/day/);
    assert.doesNotMatch(out, /invite/i);
  });

  test("anonymous note no longer claims month-fuzzed dates", () => {
    const out = renderMarkdown("q", empty());
    assert.doesNotMatch(out, /fuzzed|full dates/);
  });

  test("anonymous note states the bounded default (omitted --days = the cap), 30 without restrictions", () => {
    const out = renderMarkdown("q", empty());
    assert.match(out, /--days capped at 30 \(omitted = 30\)/);
    assert.match(out, /--days up to 90/);
    assert.doesNotMatch(out, /all-time/);
  });

  test("anonymous note follows the server's restrictions.max_days (old server: 90)", () => {
    const out = renderMarkdown("q", empty({ restrictions: { max_results: 20, max_days: 90 } }));
    assert.match(out, /--days capped at 90 \(omitted = 90\)/);
  });

  test("member empty result appends no tier note", () => {
    const env = validEnvelope({
      meta: { tier: "member", quota: { used: 5, limit: 100 } },
    });
    const out = renderMarkdown("q", env);
    assert.doesNotMatch(out, /Anonymous tier|Free tier|waitlist/);
  });

  test("step 1 copy names the tier cap from restrictions.max_days, no fixed tier list", () => {
    const out = renderMarkdown(
      "q",
      empty({ warning: { code: "corpus_stale_for_requested_window" }, restrictions: { max_days: 30 } }),
    );
    assert.match(out, /up to your tier cap \(30 days\)/);
    assert.doesNotMatch(out, /90 anonymous|365 member/);
  });
});

describe("renderMarkdown — three-tier server (0.3.0)", () => {
  const meta3 = (extra) => ({
    tier: "anonymous",
    quota: { used: 1, limit: 20 },
    sort: { requested: "recency", served: "recency" },
    ...extra,
  });

  test("header shows the effective tier (access_tier) and the served ordering", () => {
    const out = renderMarkdown("q", nonEmpty(meta3({ access_tier: "free", quota: { used: 2, limit: 50 } })));
    assert.match(out, /\*Tier: free · Sort: recency · Results: 1 · Quota: 2\/50 daily\*/);
  });

  test("header flags a relevance request served as recency", () => {
    const out = renderMarkdown(
      "q",
      nonEmpty(meta3({ access_tier: "free", sort: { requested: "relevance", served: "recency" } })),
    );
    assert.match(out, /Sort: recency \(relevance requested — member-only\)/);
  });

  test("member served relevance: header says relevance, no tier note", () => {
    const out = renderMarkdown(
      "q",
      nonEmpty(meta3({ tier: "member", access_tier: "member", quota: { used: 3, limit: 100 }, sort: { requested: "relevance", served: "relevance" } })),
    );
    assert.match(out, /Tier: member · Sort: relevance ·/);
    assert.doesNotMatch(out, /Anonymous tier|Free tier/);
  });

  test("old server (no sort) → header has no Sort label", () => {
    const out = renderMarkdown("q", nonEmpty());
    assert.doesNotMatch(out, /Sort:/);
  });

  test("free tier note: cap 90 + paid-membership waitlist from meta.cta.waitlist, no approval promise", () => {
    // Distinct from the built-in fallback URL, so the assertion proves the
    // server-provided link won.
    const waitlist = "https://podlens.net/dashboard?source=server_cta#waitlist";
    const out = renderMarkdown(
      "q",
      nonEmpty(meta3({ access_tier: "free", quota: { used: 2, limit: 50 }, restrictions: { max_days: 90 }, cta: { waitlist } })),
    );
    assert.match(out, /Free tier: up to 20 results sorted newest-first, --days capped at 90 \(omitted = 90\)/);
    assert.ok(out.includes(waitlist), "uses meta.cta.waitlist");
    assert.doesNotMatch(out, /source=askaipods/, "fallback not used");
    assert.match(out, /does not grant membership/);
    assert.doesNotMatch(out, /Anonymous tier|Sign in free|invite|approv/i);
  });

  test("free tier note falls back to the dashboard waitlist URL when cta has none", () => {
    const out = renderMarkdown("q", nonEmpty(meta3({ access_tier: "free" })));
    assert.match(out, /https:\/\/podlens\.net\/dashboard\?source=askaipods#waitlist/);
  });

  test("degraded request: degrade notice with the server's waitlist link, no sign-in tier note", () => {
    const waitlist = "https://podlens.net/dashboard?source=quota_exhausted#waitlist";
    const env = nonEmpty(
      meta3({
        access_tier: "anonymous",
        restrictions: { max_days: 30 },
        downgraded: { from: "free", reason: "free_pool_exhausted", waitlist },
      }),
    );
    for (const out of [renderMarkdown("q", env), renderMarkdown("q", empty(env.meta))]) {
      assert.match(out, /Today's free-tier capacity is used up, so this search ran at the anonymous level \(--days cap 30, 20 searches\/day per IP\)/);
      assert.ok(out.includes(waitlist));
      assert.match(out, /does not grant membership/);
      assert.doesNotMatch(out, /Anonymous tier|Sign in free/);
    }
  });
});

describe("renderMarkdown — non-empty freshness banner (R2-03, R6-01)", () => {
  test("corpus_stale_for_requested_window banner + newest_date suffix", () => {
    const env = nonEmpty({
      warning: { code: "corpus_stale_for_requested_window" },
      corpus_freshness: { newest_date: "2026-04-05" },
    });
    const out = renderMarkdown("q", env);
    // Banner text is non-empty and visually distinct (italic *Note: ...*)
    assert.match(out, /\*Note: The indexed corpus has no episodes in the requested window/);
    assert.match(out, /\(newest indexed episode: 2026-04-05\)/);
    // Banner appears before the results heading
    const bannerIdx = out.indexOf("*Note: The indexed corpus");
    const resultsIdx = out.indexOf("## Results");
    assert.ok(bannerIdx >= 0 && bannerIdx < resultsIdx, "banner must appear above results");
  });

  test("index_metadata_stale banner", () => {
    const env = nonEmpty({ warning: { code: "index_metadata_stale" } });
    const out = renderMarkdown("q", env);
    assert.match(out, /\*Note: Recently indexed episodes are still propagating/);
  });

  test("unknown warning code in non-empty render shows forward-compat banner (R6-01)", () => {
    const env = nonEmpty({ warning: { code: "some_new_code_xyz" } });
    const out = renderMarkdown("q", env);
    assert.match(out, /code: some_new_code_xyz/);
    // Banner is non-empty (R2-03 SKILL.md "Freshness" instruction rendered in all templates)
    assert.match(out, /\*Note:/);
  });

  test("window.expanded in non-empty render emits expansion note", () => {
    const env = nonEmpty({
      window: { requested_days: 30, served_days: 90, expanded: true },
    });
    const out = renderMarkdown("q", env);
    assert.match(out, /Fewer than 20 matches in the requested 30-day window, so the search widened to the last 90 days — results may include episodes older than 30 days\./);
    // Widening can add nothing older, so the note must not assert that it did.
    assert.doesNotMatch(out, /are included/);
    assert.doesNotMatch(out, /No results in the requested/);
  });

  test("truncated expansion with results says incomplete + retry, not 'widened'", () => {
    const env = nonEmpty({
      window: { requested_days: 7, served_days: 7, expanded: true, truncated: true },
    });
    const out = renderMarkdown("q", env);
    assert.match(out, /interrupted by a transient error — results may be incomplete\. Retry in a moment/);
    assert.doesNotMatch(out, /widened to the last/);
  });

  test("truncated after a partial widen names the reached window and the older-episode caveat", () => {
    const env = nonEmpty({
      window: { requested_days: 7, served_days: 30, expanded: true, truncated: true },
    });
    const out = renderMarkdown("q", env);
    assert.match(out, /widened to the last 30 days before a transient error interrupted it — results may be incomplete and may include episodes older than 7 days\. Retry in a moment/);
  });
});

describe("renderMarkdown — result rendering", () => {
  test("renders numbered result blocks with podcast — title, date, quote", () => {
    const out = renderMarkdown("q", nonEmpty());
    assert.match(out, /## Results — newest first/);
    assert.match(out, /### 1\. No Priors — Ep 42/);
    assert.match(out, /\*2026-04-10\*/);
    assert.match(out, /> inference-time compute is the new scaling axis/);
  });

  test("missing fields use fallback labels (episode → 'Untitled', podcast → 'Unknown', date → 'date unknown')", () => {
    const env = validEnvelope({
      total: 1,
      results: [
        {
          text: "some text",
          episode_title: null,
          podcast_name: null,
          published_at: null,
        },
      ],
    });
    const out = renderMarkdown("q", env);
    assert.match(out, /Unknown podcast — Untitled episode/);
    assert.match(out, /date unknown/);
  });

  test("url renders as a bare link after the date; null url → date only", () => {
    const url = "https://www.youtube.com/watch?v=72Im-Mm5JKs";
    const env = validEnvelope({
      total: 2,
      results: [
        validResult({ published_at: "2026-09-23", url, text: "WITH" }),
        validResult({ published_at: "2026-09-01", url: null, text: "WITHOUT" }),
      ],
    });
    const lines = renderMarkdown("q", env).split("\n");
    assert.ok(lines.includes(`*2026-09-23* · ${url}`));
    assert.ok(lines.includes("*2026-09-01*"));
  });

  test("anchor renders as 'around m:ss' after the url; h:mm:ss past an hour", () => {
    const url = "https://www.youtube.com/watch?v=72Im-Mm5JKs";
    const env = validEnvelope({
      total: 2,
      results: [
        validResult({ published_at: "2026-09-23", url, anchor_s: 754, anchor_url: `${url}&t=754s` }),
        validResult({ published_at: "2026-09-01", url, anchor_s: 3725, anchor_url: `${url}&t=3725s` }),
      ],
    });
    const lines = renderMarkdown("q", env).split("\n");
    assert.ok(lines.includes(`*2026-09-23* · ${url} · around 12:34: ${url}&t=754s`));
    assert.ok(lines.includes(`*2026-09-01* · ${url} · around 1:02:05: ${url}&t=3725s`));
  });

  test("result text with internal newlines is collapsed to single spaces", () => {
    const env = validEnvelope({
      total: 1,
      results: [validResult({ text: "line1\n\n  line2\t\tline3" })],
    });
    const out = renderMarkdown("q", env);
    assert.match(out, /> line1 line2 line3/);
  });

  test("results appear in date-desc order regardless of API order", () => {
    const env = validEnvelope({
      total: 3,
      results: [
        validResult({ published_at: "2025-01-01", text: "OLD" }),
        validResult({ published_at: "2026-04-01", text: "NEW" }),
        validResult({ published_at: "2025-06-01", text: "MID" }),
      ],
    });
    const out = renderMarkdown("q", env);
    const newIdx = out.indexOf("> NEW");
    const midIdx = out.indexOf("> MID");
    const oldIdx = out.indexOf("> OLD");
    assert.ok(newIdx > 0 && newIdx < midIdx && midIdx < oldIdx, "expected date-desc ordering in output");
  });
});
