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

// Validate the PodLens success envelope against the documented contract.
// Any mismatch is treated as a protocol break and surfaces as exit 3 —
// better a loud failure than silent garbage rows downstream in format.js.
//
// Required envelope:
//   data                      : non-array object
//   data.results              : array (may be empty)
//   data.results[i]           : non-array object (no nulls, strings, arrays)
//   data.meta                 : non-array object
//   data.meta.tier            : closed enum {"anonymous","member"}
//   data.meta.quota           : non-array object
//   data.meta.quota.used      : finite number
//   data.meta.quota.limit     : finite number
//
// Optional (kept loose on purpose):
//   data.total, data.meta.quota.period, data.meta.quota.next_reset,
//   data.meta.query_hash, data.meta.restrictions, data.meta.cta
function isValidSuccessEnvelope(data) {
  if (!isPlainObject(data)) return false;
  if (!Array.isArray(data.results)) return false;
  for (const item of data.results) {
    if (!isPlainObject(item)) return false;
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
    "User-Agent": "askaipods/0.1.0 (+https://github.com/Delibread0601/askaipods)",
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
  // quota message is tier-aware: a member hitting the 50/day cap must
  // not be told to "set ASKAIPODS_API_KEY" — they already have one.
  if (response.status === 429) {
    const msg = String(data?.error ?? "").toLowerCase();
    if (msg.includes("quota")) {
      const quotaMsg = apiKey
        ? "daily search quota exhausted (member tier: 50/day). Quota resets at 00:00 UTC."
        : "daily search quota exhausted (anonymous tier: 10/day). Quota resets at 00:00 UTC. " +
          "For 50 searches/day, set ASKAIPODS_API_KEY (sign up at https://podlens.net).";
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
