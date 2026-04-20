// Thin client for podlens.net /api/search/semantic.
//
// Lives in its own file so the CLI layer never has to know about HTTP
// or status codes — it gets back either a parsed response object or a
// thrown error carrying a stable exitCode (1=usage, 2=quota, 3=network).
// That separation lets the test suite mock the network at this seam
// instead of patching `fetch` globally.

const PODLENS_ENDPOINT = "https://podlens.net/api/search/semantic";

// Hard caps mirror the server's own validation in
// functions/api/search/semantic.ts so the user gets a fast local error
// instead of a confusing 400 round-trip.
const MAX_QUERY_LEN = 300;
const MIN_QUERY_LEN = 1;

export class AskaipodsError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = "AskaipodsError";
    this.exitCode = exitCode;
  }
}

function exitErr(code, message) {
  return new AskaipodsError(message, code);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Strict calendar validation for published_at. Accepts only the three
// documented shapes, validates all numeric components against calendar
// and clock bounds, and round-trips via Date.UTC to catch impossible
// day/month combinations (Feb 30 etc). Timezone offset is required
// whenever a time component is present — a timezone-less datetime like
// "2025-10-15T12:00:00" would be ambiguous (Date.parse interprets it
// in the system's local timezone, making sort order non-deterministic
// across machines). Format: Z or ±HH:MM (colonized), hour bounded
// 0-14, minute bounded 0-59.
const PUBLISHED_AT_SHAPE =
  /^(\d{4})-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2}))?)?$/;
function isValidPublishedAt(v) {
  if (v == null) return true;
  if (typeof v !== "string") return false;
  const parts = v.match(PUBLISHED_AT_SHAPE);
  if (!parts) return false;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  if (year < 1970 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (parts[3] !== undefined) {
    const day = Number(parts[3]);
    if (day < 1 || day > 31) return false;
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (
      dt.getUTCFullYear() !== year ||
      dt.getUTCMonth() !== month - 1 ||
      dt.getUTCDate() !== day
    ) {
      return false;
    }
    if (parts[4] !== undefined) {
      const hh = Number(parts[4]);
      const mm = Number(parts[5]);
      const ss = Number(parts[6]);
      if (hh > 23 || mm > 59 || ss > 59) return false;
      if (parts[7] !== undefined && parts[7] !== "Z") {
        // parts[7] is "±HH:MM" (enforced by regex). Check offset bounds.
        const offHh = Number(parts[7].slice(1, 3));
        const offMm = Number(parts[7].slice(4, 6));
        if (offHh > 14 || offMm > 59) return false;
      }
    }
  }
  return true;
}

// Validate the PodLens success envelope against the documented contract.
// Any mismatch is treated as a protocol break and surfaces as exit 3 —
// better a loud AskaipodsError(exitCode=3) than a TypeError escaping as
// exit 1 when format.js tries to operate on malformed fields.
//
// Required envelope:
//   data                       : non-array object
//   data.total                 : finite number
//   data.results               : array (may be empty)
//   data.results[i]            : non-array object
//   data.results[i].text       : string (required, never null)
//   data.results[i].episode_title  : string or null/undefined
//   data.results[i].podcast_name   : string or null/undefined
//   data.results[i].published_at   : string or null/undefined
//   data.meta                  : non-array object
//   data.meta.tier             : closed enum {"anonymous","member"}
//   data.meta.quota            : non-array object
//   data.meta.quota.used       : finite number
//   data.meta.quota.limit      : finite number
//
// Optional (kept loose on purpose unless they affect render logic):
//   data.meta.quota.period, data.meta.quota.next_reset,
//   data.meta.query_hash, data.meta.restrictions, data.meta.window
//
// Optional but shape-checked because they drive conditional render
// branches in format.js — a malformed value would let the bad state
// silently cross the exit-0 / exit-3 boundary:
//   data.meta.quota.refunded    — boolean iff present (drives header
//                                 "· refunded" tag in renderMarkdown)
//   data.meta.warning           — {code: string} iff present (drives
//                                 empty-result priority ladder and the
//                                 freshness banner in non-empty render)
//   data.meta.corpus_freshness  — {newest_date: string|null} iff present
//                                 (the "data as of X" signal)
//   data.meta.cta               — object iff present (passthrough only,
//                                 no render logic depends on its shape,
//                                 but reject non-object so downstream
//                                 type assumptions hold)
function isValidSuccessEnvelope(data) {
  if (!isPlainObject(data)) return false;
  if (typeof data.total !== "number" || !Number.isFinite(data.total)) return false;
  if (!Array.isArray(data.results)) return false;
  for (const item of data.results) {
    if (!isPlainObject(item)) return false;
    // text must be a non-empty, non-whitespace-only string. An all-
    // whitespace text would otherwise render as an empty blockquote
    // row (`> ` with nothing after it) in --format markdown.
    if (typeof item.text !== "string" || item.text.trim().length === 0) return false;
    // `!= null` intentionally matches both null and undefined (contract
    // allows either as "missing"), but rejects numbers, objects, arrays.
    if (item.episode_title != null && typeof item.episode_title !== "string") return false;
    if (item.podcast_name != null && typeof item.podcast_name !== "string") return false;
    if (!isValidPublishedAt(item.published_at)) return false;
  }
  const m = data.meta;
  if (!isPlainObject(m)) return false;
  if (m.tier !== "anonymous" && m.tier !== "member") return false;
  const q = m.quota;
  if (!isPlainObject(q)) return false;
  if (typeof q.used !== "number" || !Number.isFinite(q.used)) return false;
  if (typeof q.limit !== "number" || !Number.isFinite(q.limit)) return false;
  // quota.refunded is optional; when present it MUST be boolean. A
  // string like "yes" would truthy-trigger the "· refunded" tag in
  // format.js renderMarkdown header, claiming a refund that didn't
  // happen.
  if (q.refunded !== undefined && typeof q.refunded !== "boolean") return false;
  // warning is optional; when present it MUST be a plain object with a
  // string `code`. A non-string code would bypass the equality checks
  // in format.js empty-result ladder and non-empty banner, producing
  // no user-facing message when one was intended.
  if (m.warning != null) {
    if (!isPlainObject(m.warning)) return false;
    if (typeof m.warning.code !== "string") return false;
  }
  // corpus_freshness is optional. The server contract is **best-effort
  // metadata**: when the upstream freshness probe fails, semantic.ts
  // emits `console.warn` and continues with `newest_date: null` rather
  // than aborting the request. The client must mirror that philosophy
  // — a malformed `newest_date` should NOT turn an otherwise-successful
  // search (valid results + tier + quota) into an exit-3 error.
  //
  // Split into two levels:
  //   - Structural (object shape, type of newest_date): envelope-fatal
  //     via `return false`. A non-string newest_date means the server
  //     broke contract shape-wise.
  //   - Content (non-ISO / non-calendar-valid YYYY-MM-DD): coerce
  //     `newest_date` to null in place. format.js banner treats null
  //     as "no freshness data" and omits the "newest indexed episode:
  //     X" suffix cleanly.
  if (m.corpus_freshness != null) {
    if (!isPlainObject(m.corpus_freshness)) return false;
    // `newest_date` is a required sub-field when corpus_freshness is
    // present (SKILL.md contract: always present as string|null). An
    // absent property is a protocol break — without this presence
    // check, the `nd != null` guard below would early-exit for
    // undefined after R4's structural/content split, letting a {}-
    // shaped corpus_freshness leak through (R5-01).
    if (!("newest_date" in m.corpus_freshness)) return false;
    const nd = m.corpus_freshness.newest_date;
    if (nd != null) {
      if (typeof nd !== "string") return false;
      let isoValid = /^\d{4}-\d{2}-\d{2}$/.test(nd);
      if (isoValid) {
        const [y, mo, d] = nd.split("-").map(Number);
        if (mo < 1 || mo > 12 || d < 1 || d > 31) {
          isoValid = false;
        } else {
          const dt = new Date(Date.UTC(y, mo - 1, d));
          if (
            dt.getUTCFullYear() !== y ||
            dt.getUTCMonth() !== mo - 1 ||
            dt.getUTCDate() !== d
          ) {
            isoValid = false;
          }
        }
      }
      if (!isoValid) {
        // Coerce malformed ISO content to null and continue validation.
        // Downstream format.js sees null and skips the freshness banner
        // suffix, matching the server's own probe-failure degradation.
        m.corpus_freshness.newest_date = null;
      }
    }
  }
  // cta is passthrough-only (no render logic reads its fields today),
  // but reject non-object so future render paths don't crash on a
  // primitive where they expect an object.
  if (m.cta != null && !isPlainObject(m.cta)) return false;
  // window shape-check (R3-01): format.js renderMarkdown reads
  // `window.truncated`, `window.expanded`, `window.requested_days`,
  // `window.served_days` to drive the empty-result priority ladder.
  // A malformed window (e.g., `expanded: "true"` string, missing
  // requested_days) would silently misroute rendering — e.g., a
  // string "false" is truthy and would trigger the expanded branch
  // when the server meant the opposite. Required fields are validated
  // strictly; truncated/reason_code/attempted_days are optional and
  // only checked when present.
  if (m.window != null) {
    if (!isPlainObject(m.window)) return false;
    const w = m.window;
    if (typeof w.requested_days !== "number" || !Number.isFinite(w.requested_days)) return false;
    if (typeof w.served_days !== "number" || !Number.isFinite(w.served_days)) return false;
    if (typeof w.expanded !== "boolean") return false;
    if (w.truncated !== undefined && typeof w.truncated !== "boolean") return false;
    if (w.reason_code !== undefined && typeof w.reason_code !== "string") return false;
    if (w.attempted_days !== undefined) {
      if (!Array.isArray(w.attempted_days)) return false;
      for (const n of w.attempted_days) {
        if (typeof n !== "number" || !Number.isFinite(n)) return false;
      }
    }
  }
  return true;
}

export async function search({ query, days, apiKey, endpoint = PODLENS_ENDPOINT }) {
  if (typeof query !== "string" || query.trim().length < MIN_QUERY_LEN) {
    throw exitErr(1, "query is required (1-300 characters)");
  }
  if (query.length > MAX_QUERY_LEN) {
    throw exitErr(1, `query too long (max ${MAX_QUERY_LEN} characters)`);
  }

  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "askaipods/0.2.6 (+https://github.com/Delibread0601/askaipods)",
  };
  if (apiKey) {
    headers["X-PodLens-API-Key"] = apiKey;
  }

  const body = { q: query };
  if (typeof days === "number" && days > 0) {
    body.days = days;
  }

  // 30s total budget covers both connection setup and body consumption
  // (audit R7-02). podlens.net edge workers may take 5-10s for the
  // Vectorize + Gemini embed round-trip on cold starts; 30s leaves
  // comfortable headroom while still producing a deterministic
  // exit-3 instead of hanging a CLI invocation indefinitely on a
  // half-open socket or unresponsive upstream. Applied via
  // AbortSignal.timeout() so the signal covers the downstream
  // `response.json()` body read as well — the same controller
  // aborts whichever phase happens to be pending.
  const TIMEOUT_MS = 30_000;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // AbortSignal.timeout fires with DOMException(name: "TimeoutError")
    // in modern runtimes; some Node 18 versions use AbortError. Treat
    // both as distinct, user-actionable exit-3 failures with the
    // concrete timeout budget in the message so the user/agent knows
    // the failure mode (stalled network vs. DNS failure vs. 404).
    const name = err?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw exitErr(
        3,
        `request to podlens.net timed out after ${TIMEOUT_MS / 1000}s (possible network stall or slow upstream). Retry in a moment.`,
      );
    }
    // fetch() throws TypeError on DNS / connection failure. Treat as
    // exit code 3 (transient/network) so the SKILL.md can advise
    // "retry in a moment" instead of looking like a usage error.
    throw exitErr(3, `network error contacting podlens.net: ${err?.message ?? err}`);
  }

  // The server always responds with JSON for both success and error
  // paths (see jsonResponse() in functions/api/search/semantic.ts), so
  // a non-JSON body means an upstream proxy/CDN is in the way.
  //
  // Two distinct failure classes in this catch (audit R8-01):
  //   1. TimeoutError/AbortError — headers arrived in time but the
  //      body read stalled past the signal's 30s budget. The same
  //      AbortSignal attached at fetch() propagates to the response
  //      body stream, so timeouts during `response.json()` surface
  //      here rather than at the fetch() catch above.
  //   2. Anything else — real JSON parse failure or truncated body
  //      (e.g., an upstream proxy returned HTML or closed the
  //      connection mid-stream).
  // Must distinguish because the user-actionable advice differs:
  // "retry, your network stalled" vs. "retry, an upstream proxy
  // mangled the response."
  let data;
  try {
    data = await response.json();
  } catch (err) {
    const name = err?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw exitErr(
        3,
        `request to podlens.net timed out after ${TIMEOUT_MS / 1000}s while reading response body (possible network stall or slow upstream). Retry in a moment.`,
      );
    }
    throw exitErr(
      3,
      `unexpected non-JSON response from podlens.net (HTTP ${response.status}). ` +
        "An upstream proxy may be interfering — retry in a moment.",
    );
  }

  if (response.ok) {
    if (!isValidSuccessEnvelope(data)) {
      throw exitErr(
        3,
        "unexpected response shape from podlens.net (envelope, results entries, meta.tier, or meta.quota failed contract validation). Retry in a moment.",
      );
    }
    return data;
  }

  // Distinguish 429 cases by inspecting the message: the server uses
  // distinct strings for "burst limit hit" vs "daily quota exhausted",
  // and only the latter warrants the "daily quota" exit code. The
  // quota message is tier-aware: a member hitting the 100/day cap must
  // not be told to "set ASKAIPODS_API_KEY" — they already have one.
  if (response.status === 429) {
    const msg = String(data?.error ?? "").toLowerCase();
    if (msg.includes("quota")) {
      const quotaMsg = apiKey
        ? "daily search quota exhausted (member tier: 100/day). Quota resets at 00:00 UTC."
        : "daily search quota exhausted (anonymous tier: 20/day). Quota resets at 00:00 UTC. " +
          "For 100 searches/day, set ASKAIPODS_API_KEY — member tier is invite-only, request access at https://podlens.net.";
      throw exitErr(2, quotaMsg);
    }
    throw exitErr(3, "rate limited by podlens.net (too many requests in a short window). Retry in a minute.");
  }

  if (response.status === 401 || response.status === 403) {
    throw exitErr(1, `API key rejected: ${data?.error ?? response.statusText}`);
  }

  if (response.status === 413) {
    throw exitErr(1, "request body too large (max 2 KB). Shorten the query.");
  }

  if (response.status === 503) {
    throw exitErr(3, `podlens.net temporarily unavailable: ${data?.error ?? "service unavailable"}`);
  }

  if (response.status === 400) {
    throw exitErr(1, `invalid request: ${data?.error ?? "bad request"}`);
  }

  throw exitErr(3, `podlens.net error (HTTP ${response.status}): ${data?.error ?? response.statusText}`);
}
