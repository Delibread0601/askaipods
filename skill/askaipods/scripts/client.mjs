// Thin client for podlens.net /api/search/semantic.
//
// Lives in its own file so the CLI layer never has to know about HTTP
// or status codes — it gets back either a parsed response object or a
// thrown error carrying a stable exitCode (1=usage, 2=quota or daily
// capacity, 3=network / transient).
// The test suite stubs `globalThis.fetch` and drives everything through
// `search()`, so status mapping and envelope validation are covered
// without the CLI layer.

import { WAITLIST_URL, hasVisibleText, lineOr, waitlistLink } from "./shared.mjs";

const PODLENS_ENDPOINT = "https://podlens.net/api/search/semantic";

// Hard caps mirror the server's own validation in
// functions/api/search/semantic.ts so the user gets a fast local error
// instead of a confusing 400 round-trip.
const MAX_QUERY_LEN = 300;
const MIN_QUERY_LEN = 1;

// Closed enums of the three-tier server contract. `meta.access_tier`
// carries the tier. The server also still sends a legacy two-value
// `meta.tier` for old clients; this client neither reads nor validates it.
const ACCESS_TIERS = new Set(["anonymous", "free", "member"]);
export const SORT_VALUES = new Set(["recency", "relevance"]);

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

// True when year-month-day names a real calendar day. Date.UTC rolls an
// out-of-range month or day over into a neighbouring one (month 13 →
// January of the next year, Feb 30 → Mar 2) and maps years 0-99 to
// 1900-1999, so comparing the round trip rejects all of them.
function isCalendarDate(year, month, day) {
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

// Strict validation for published_at. Accepts a full date (YYYY-MM-DD)
// or a full timestamp with an offset, from 1970 on; the date must be a
// real calendar day and the time within clock bounds.
// Timezone offset is required whenever a time component is present — a
// timezone-less datetime like "2025-10-15T12:00:00" would be ambiguous
// (Date.parse interprets it in the system's local timezone, making sort
// order non-deterministic across machines). Format: Z or ±HH:MM
// (colonized), hour bounded 0-14, minute bounded 0-59.
const PUBLISHED_AT_SHAPE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/;
function isValidPublishedAt(v) {
  if (v == null) return true;
  if (typeof v !== "string") return false;
  const parts = v.match(PUBLISHED_AT_SHAPE);
  if (!parts) return false;
  const year = Number(parts[1]);
  if (year < 1970 || !isCalendarDate(year, Number(parts[2]), Number(parts[3]))) return false;
  if (parts[4] !== undefined) {
    const hh = Number(parts[4]);
    const mm = Number(parts[5]);
    const ss = Number(parts[6]);
    if (hh > 23 || mm > 59 || ss > 59) return false;
    if (parts[7] !== "Z") {
      // parts[7] is "±HH:MM" (enforced by regex). Check offset bounds.
      const offHh = Number(parts[7].slice(1, 3));
      const offMm = Number(parts[7].slice(4, 6));
      if (offHh > 14 || offMm > 59) return false;
    }
  }
  return true;
}

// Episode source link shape. Mirrors the server's own whitelist
// (podlens-site functions/lib/pure.ts::youtubeWatchUrl): https, the
// www.youtube.com watch path, and an 11-char video id — nothing else.
const YOUTUBE_WATCH_URL = /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/;

// Validate the PodLens success envelope against the documented contract.
// Any mismatch is treated as a protocol break and surfaces as exit 3
// with a message that names the cause, instead of a bare TypeError from
// format.mjs operating on malformed fields.
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
//   data.results[i].url        : string or null/undefined; a string that
//                                is not a YouTube watch URL is coerced
//                                to null in place (see YOUTUBE_WATCH_URL)
//   data.results[i].anchor_s   : number or null/undefined (server 0015+)
//   data.results[i].anchor_url : string or null/undefined; the pair is
//                                kept only when anchor_s is a non-negative
//                                safe integer AND anchor_url is exactly
//                                `${url}&t=${anchor_s}s` — otherwise both
//                                are set to null in place
//   data.meta                  : non-array object
//   data.meta.access_tier      : closed enum {"anonymous","free","member"};
//                                drives the structured `tier` and the tier
//                                notes
//   data.meta.sort             : {requested, served}, both in
//                                {"recency","relevance"}; drives render_hint
//   data.meta.quota            : non-array object
//   data.meta.quota.used       : finite number
//   data.meta.quota.limit      : finite number
//
// Optional (kept loose on purpose unless they affect render logic):
//   data.meta.quota.period, data.meta.quota.next_reset,
//   data.meta.query_hash, data.meta.restrictions, data.meta.window
//
// Optional but shape-checked because they drive conditional render
// branches in format.mjs — a malformed value would let the bad state
// silently cross the exit-0 / exit-3 boundary:
//   data.meta.quota.refunded    — boolean iff present (drives header
//                                 "· refunded" tag in renderMarkdown)
//   data.meta.warning           — {code: string} iff present (drives
//                                 empty-result priority ladder and the
//                                 freshness banner in non-empty render)
//   data.meta.corpus_freshness  — {newest_date: string|null} iff present
//                                 (the "data as of X" signal)
//   data.meta.cta               — object iff present (format.mjs reads
//                                 cta.waitlist for the free-tier note
//                                 and checks that link itself)
//   data.meta.downgraded        — {from, reason, waitlist} strings iff
//                                 present; drives the degrade notice
function isValidSuccessEnvelope(data) {
  if (!isPlainObject(data)) return false;
  if (typeof data.total !== "number" || !Number.isFinite(data.total)) return false;
  if (!Array.isArray(data.results)) return false;
  for (const item of data.results) {
    if (!isPlainObject(item)) return false;
    // text must be a string with something visible in it. Whitespace,
    // control characters, format characters and joiners alone would
    // render as an empty blockquote row (`> ` with nothing after it) in
    // --format markdown, and as an empty quote for an agent.
    if (typeof item.text !== "string" || !hasVisibleText(item.text)) return false;
    // `!= null` intentionally matches both null and undefined (contract
    // allows either as "missing"), but rejects numbers, objects, arrays.
    if (item.episode_title != null && typeof item.episode_title !== "string") return false;
    if (item.podcast_name != null && typeof item.podcast_name !== "string") return false;
    if (!isValidPublishedAt(item.published_at)) return false;
    // url follows the same structural/content split as
    // corpus_freshness.newest_date below: a non-string is a contract
    // break (exit 3), while a string outside the server's YouTube
    // watch-URL shape is coerced to null so a host agent never renders
    // an arbitrary link as an episode source.
    if (item.url != null) {
      if (typeof item.url !== "string") return false;
      if (!YOUTUBE_WATCH_URL.test(item.url)) item.url = null;
    }
    // anchor_s / anchor_url: the approximate start of the passage the
    // quote comes from.  Same split: a wrong JSON type is a contract
    // break; a value that is not the exact url&t=<s>s pair is nulled, so
    // a host agent never renders an arbitrary or mismatched time link.
    if (item.anchor_s != null && typeof item.anchor_s !== "number") return false;
    if (item.anchor_url != null && typeof item.anchor_url !== "string") return false;
    const s = item.anchor_s;
    const pairOk = Number.isSafeInteger(s) && s >= 0 && typeof item.url === "string"
      && item.anchor_url === `${item.url}&t=${s}s`;
    item.anchor_s = pairOk ? s : null;
    item.anchor_url = pairOk ? item.anchor_url : null;
  }
  const m = data.meta;
  if (!isPlainObject(m)) return false;
  if (!ACCESS_TIERS.has(m.access_tier)) return false;
  if (!isPlainObject(m.sort)) return false;
  if (!SORT_VALUES.has(m.sort.requested) || !SORT_VALUES.has(m.sort.served)) return false;
  if (m.downgraded != null) {
    if (!isPlainObject(m.downgraded)) return false;
    const d = m.downgraded;
    if (typeof d.from !== "string" || typeof d.reason !== "string" || typeof d.waitlist !== "string") {
      return false;
    }
  }
  const q = m.quota;
  if (!isPlainObject(q)) return false;
  if (typeof q.used !== "number" || !Number.isFinite(q.used)) return false;
  if (typeof q.limit !== "number" || !Number.isFinite(q.limit)) return false;
  // quota.refunded is optional; when present it MUST be boolean. A
  // string like "yes" would truthy-trigger the "· refunded" tag in
  // format.mjs renderMarkdown header, claiming a refund that didn't
  // happen.
  if (q.refunded !== undefined && typeof q.refunded !== "boolean") return false;
  // warning is optional; when present it MUST be a plain object with a
  // string `code`. A non-string code would bypass the equality checks
  // in format.mjs empty-result ladder and non-empty banner, producing
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
  //     `newest_date` to null in place. format.mjs banner treats null
  //     as "no freshness data" and omits the "newest indexed episode:
  //     X" suffix cleanly.
  if (m.corpus_freshness != null) {
    if (!isPlainObject(m.corpus_freshness)) return false;
    // `newest_date` is a required sub-field when corpus_freshness is
    // present (references/notices.md: always string|null). An
    // absent property is a protocol break — without this presence
    // check, the `nd != null` guard below would early-exit for
    // undefined, letting a {}-shaped corpus_freshness leak through.
    if (!("newest_date" in m.corpus_freshness)) return false;
    const nd = m.corpus_freshness.newest_date;
    if (nd != null) {
      if (typeof nd !== "string") return false;
      const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nd);
      if (!ymd || !isCalendarDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]))) {
        // Coerce malformed ISO content to null and continue validation.
        // Downstream format.mjs sees null and skips the freshness banner
        // suffix, matching the server's own probe-failure degradation.
        m.corpus_freshness.newest_date = null;
      }
    }
  }
  // cta: format.mjs reads `cta.waitlist` for the free-tier closing note
  // and replaces anything but a podlens.net link with WAITLIST_URL, so
  // only the null-or-object shape is checked here.
  if (m.cta != null && !isPlainObject(m.cta)) return false;
  // window shape-check: format.mjs renderMarkdown reads
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

// The server's `error` field as a string for matching; "" when the body
// is not an object or the field is not a string. No coercion: String() on
// an arbitrary JSON value can throw.
function errorString(data) {
  return typeof data?.error === "string" ? data.error : "";
}

// Daily-quota (429) copy. The 429 envelope carries the same tier fields
// as a success: `meta.downgraded` (a free request served at the anonymous
// level — today's free-tier capacity ran out, or the account is younger
// than 48 hours) wins, then `meta.access_tier`. A 429 with neither gets a
// tier-neutral message instead of a guess.
//
// The anonymous level has two caps: 20/day per IP and, for IPv6 callers,
// 200/day across the whole /48 network (podlens-site
// ANON_V6_SITE_DAILY_LIMIT). Both answer the same 429; only the binding
// limit in `meta.quota.limit` tells them apart.
const ANON_V6_NETWORK_DAILY_LIMIT = 200;

function quotaExhaustedMessage(meta, apiKey) {
  const reset = "Quota resets at 00:00 UTC.";
  const network = isPlainObject(meta?.quota) && meta.quota.limit === ANON_V6_NETWORK_DAILY_LIMIT;
  const level = network ? "20/day per IP, 200/day per IPv6 /48 network" : "20/day per IP";
  const usedUp = network ? "the network's shared 200/day is used up" : "that quota is used up";
  const anonTier = network ? `${level}; ${usedUp}` : level;
  if (isPlainObject(meta?.downgraded)) {
    const reason = meta.downgraded.reason;
    if (reason === "new_account") {
      return (
        `daily search quota exhausted (new free accounts search at the anonymous level — ${level} — ` +
        `for their first 48 hours, and ${usedUp}). ${reset} ` +
        "The free tier's 50 searches/day apply once the account is 48 hours old."
      );
    }
    if (reason === "free_pool_exhausted") {
      const waitlist = waitlistLink(meta.downgraded.waitlist);
      return (
        "daily search quota exhausted (today's free-tier capacity is used up, so this request ran at the " +
        `anonymous level — ${level} — and ${usedUp} too). ${reset} ` +
        `Paid-membership waitlist: ${waitlist} (joining records interest; it does not grant membership).`
      );
    }
    return (
      `daily search quota exhausted (this request ran at the anonymous level — ${level} — ` +
      `and ${usedUp}). ${reset}`
    );
  }
  const tier = meta?.access_tier;
  if (!ACCESS_TIERS.has(tier)) {
    return `daily search quota exhausted. ${reset}`;
  }
  if (tier === "member") {
    return `daily search quota exhausted (member tier: 100/day). ${reset}`;
  }
  if (tier === "free") {
    return (
      `daily search quota exhausted (free tier: 50/day). ${reset} ` +
      "Paid membership (100/day, --days up to 365, relevance ordering) has a waitlist at " +
      `${WAITLIST_URL} (joining records interest; it does not grant membership).`
    );
  }
  if (apiKey) {
    return (
      `daily search quota exhausted (anonymous tier: ${anonTier} — this API key was served as anonymous). ${reset} ` +
      "Sign in at https://podlens.net and set ASKAIPODS_API_KEY to the API key shown on the dashboard " +
      "for 50 searches/day once the account is 48 hours old."
    );
  }
  return (
    `daily search quota exhausted (anonymous tier: ${anonTier}). ${reset} ` +
    "For 50 searches/day, sign in free with Google or GitHub at https://podlens.net " +
    "and set ASKAIPODS_API_KEY to the account's API key (new accounts search at the anonymous level " +
    "for their first 48 hours)."
  );
}

// The server's site-wide anonymous-level pool (shared by anonymous callers
// and by free callers served at the anonymous level) answers exhaustion
// with 503 and `code: "daily_capacity_reached"` in the body — unlike its
// transient 503s, which carry no code. It lasts until the UTC day rolls
// over, so it maps to exit 2 (stop for today), not exit 3 (retry). The
// code is the contract; the error text is matched too, for a response
// that carries the text without the code.
const CAPACITY_REACHED_CODE = "daily_capacity_reached";
const CAPACITY_REACHED = /daily capacity reached/i;

// Connection-level failure codes a network-blocking sandbox produces
// (DNS refused or unresolvable, connect denied or unroutable).
const NETWORK_BLOCK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EACCES",
  "EPERM",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

function capacityReachedMessage() {
  return (
    "podlens.net's daily capacity for anonymous-level searches is used up (shared by every caller served at the " +
    "anonymous level, including free accounts in their first 48 hours). It resets at 00:00 UTC — retrying at the " +
    "anonymous level before then will fail. Searches served at the free or member level are not affected."
  );
}

export async function search({ query, days, sort, apiKey, endpoint = PODLENS_ENDPOINT }) {
  if (typeof query !== "string" || query.trim().length < MIN_QUERY_LEN) {
    throw exitErr(1, "query is required (1-300 characters)");
  }
  if (query.length > MAX_QUERY_LEN) {
    throw exitErr(1, `query too long (max ${MAX_QUERY_LEN} characters)`);
  }

  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "askaipods/0.3.9 (+https://github.com/Delibread0601/askaipods)",
  };
  if (apiKey) {
    headers["X-PodLens-API-Key"] = apiKey;
  }

  // `sort` is always sent (default recency). A non-member asking for
  // relevance is served recency, and `meta.sort` says so.
  const body = { q: query, sort: sort ?? "recency" };
  if (typeof days === "number" && days > 0) {
    body.days = days;
  }

  // 30s total budget covers both connection setup and body consumption.
  // podlens.net edge workers may take 5-10s for the
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
    // fetch() throws TypeError("fetch failed") on DNS / connection
    // failure and keeps the reason only in `err.cause.code`. Surface that
    // code: a host sandbox that blocks the network shows up as one of
    // these, and an agent cannot tell "blocked" from "flaky" without it.
    // The codes cannot prove a sandbox (a real DNS outage looks the same),
    // so the hint says "may be". Still exit 3 (transient/network).
    const code = typeof err?.cause?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(err.cause.code) ? err.cause.code : null;
    let hint = "";
    if (code && NETWORK_BLOCK_CODES.has(code)) {
      // Proxy-based sandboxes (Claude Code's among them) allow traffic only
      // through the proxy named in HTTPS_PROXY / HTTP_PROXY, and Node's fetch
      // ignores those variables unless NODE_USE_ENV_PROXY=1 (Node 22.21+ / 24+).
      // With that flag, Node uses HTTP_PROXY for HTTPS requests too when
      // HTTPS_PROXY is unset, so either variable makes the rerun worthwhile.
      const proxyVar = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"].find((k) => process.env[k]);
      hint = proxyVar && process.env.NODE_USE_ENV_PROXY !== "1"
        ? ` — ${proxyVar} is set but Node's fetch ignores it unless NODE_USE_ENV_PROXY=1: rerun with NODE_USE_ENV_PROXY=1 in the environment (Node 22.21+ or 24+)`
        : " — if this runs inside a sandbox, outbound HTTPS to podlens.net may be blocked; allow podlens.net or ask the user to approve network access instead of retrying";
    }
    throw exitErr(3, `network error contacting podlens.net: ${err?.message ?? err}${code ? ` (${code})` : ""}${hint}`);
  }

  // The server always responds with JSON for both success and error
  // paths (see jsonResponse() in functions/api/search/semantic.ts), so
  // a non-JSON body means an upstream proxy/CDN is in the way.
  //
  // Two distinct failure classes in this catch:
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
        "unexpected response shape from podlens.net (envelope, results entries, meta.access_tier / sort / downgraded, or meta.quota failed contract validation). Retry in a moment.",
      );
    }
    return data;
  }

  // Two 429s: the daily quota (exit 2) and the burst limit (exit 3). The
  // daily-quota body carries `meta.quota`, the burst one carries no meta,
  // so the structure decides; the error text is matched too, for a quota
  // response without meta. The quota message is tier-aware: a member
  // hitting the 100/day cap must not be told to sign in — they already
  // have a key.
  if (response.status === 429) {
    const meta = isPlainObject(data) && isPlainObject(data.meta) ? data.meta : null;
    const msg = errorString(data).toLowerCase();
    if (isPlainObject(meta?.quota) || msg.includes("quota")) {
      throw exitErr(2, quotaExhaustedMessage(meta, apiKey));
    }
    throw exitErr(3, "rate limited by podlens.net (too many requests in a short window). Retry in a minute.");
  }

  // The server's own error text, else the HTTP status text. Both are
  // remote strings on their way to the terminal on stderr, so both go
  // through lineOr (shared.mjs).
  const errorText = lineOr(data?.error, lineOr(response.statusText, "no detail given"));

  if (response.status === 401 || response.status === 403) {
    throw exitErr(1, `API key rejected: ${errorText}`);
  }

  if (response.status === 413) {
    throw exitErr(1, "request body too large (max 2 KB). Shorten the query.");
  }

  if (response.status === 503) {
    if (data?.code === CAPACITY_REACHED_CODE || CAPACITY_REACHED.test(errorString(data))) {
      throw exitErr(2, capacityReachedMessage());
    }
    throw exitErr(3, `podlens.net temporarily unavailable: ${lineOr(data?.error, "service unavailable")}`);
  }

  if (response.status === 400) {
    throw exitErr(1, `invalid request: ${lineOr(data?.error, "bad request")}`);
  }

  throw exitErr(3, `podlens.net error (HTTP ${response.status}): ${errorText}`);
}
