// Tests for format.js renderMarkdown:
//   R2-01 — empty-result 6-step priority ladder
//   R2-03 — non-empty freshness banner
//   R3-02 — expanded-empty branch appends "(corpus indexed through X)"
//   R5-01 — corpus_freshness missing newest_date rejected at envelope level
//           (validator test; here we check the downstream render only
//           receives validated shapes)
//   R6-01 — unknown warning code falls back with forward-compat copy
//   Plus: refunded tag, anonymous footer, 3-column result header.

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

  test("anonymous empty result appends ANONYMOUS_NOTE footer", () => {
    const out = renderMarkdown("q", empty());
    // Pre-existing invariant: anonymous note mentions invite-only AND
    // sign-up path.
    assert.match(out, /Anonymous tier/);
    assert.match(out, /invite-only/);
    assert.match(out, /ASKAIPODS_API_KEY/);
    assert.match(out, /podlens\.net/);
  });

  test("member empty result does NOT append ANONYMOUS_NOTE", () => {
    const env = validEnvelope({
      meta: { tier: "member", quota: { used: 5, limit: 100 } },
    });
    const out = renderMarkdown("q", env);
    assert.doesNotMatch(out, /Anonymous tier/);
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
    assert.match(out, /No results in the requested 30-day window/);
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
