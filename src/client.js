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
// Optional (kept loose on purpose):
//   data.meta.quota.period, data.meta.quota.next_reset,
//   data.meta.query_hash, data.meta.restrictions, data.meta.cta,
//   data.meta.window
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
    "User-Agent": "askaipods/0.2.3 (+https://github.com/Delibread0601/askaipods)",
  };
  if (apiKey) {
    headers["X-PodLens-API-Key"] = apiKey;
  }

  const body = { q: query };
  if (typeof days === "number" && days > 0) {
    body.days = days;
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    // fetch() throws TypeError on DNS / connection failure / abort.
    // Treat all of these as exit code 3 (transient/network) so the
    // SKILL.md can advise "retry in a moment" instead of looking like
    // a usage error.
    throw exitErr(3, `network error contacting podlens.net: ${err?.message ?? err}`);
  }

  // The server always responds with JSON for both success and error
  // paths (see jsonResponse() in functions/api/search/semantic.ts), so
  // a non-JSON body means an upstream proxy/CDN is in the way.
  let data;
  try {
    data = await response.json();
  } catch {
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
          "For 100 searches/day, set ASKAIPODS_API_KEY (sign up at https://podlens.net).";
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
