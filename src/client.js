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
    // Minimal contract validation so a protocol break (e.g., upstream
    // proxy rewriting the body, or a future server-side schema change)
    // surfaces as a loud exit 3 instead of silently becoming an empty
    // "anonymous tier" payload via format.js's defensive fallbacks.
    if (
      !data ||
      typeof data !== "object" ||
      !Array.isArray(data.results) ||
      typeof data.meta !== "object" ||
      data.meta === null
    ) {
      throw exitErr(
        3,
        "unexpected response shape from podlens.net (missing results array or meta object). Retry in a moment.",
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
