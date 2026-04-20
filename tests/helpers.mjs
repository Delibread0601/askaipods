// Shared test helpers: zero-dependency mocks for global.fetch.
//
// We stub `globalThis.fetch` per-test instead of reaching for a library.
// The production code only uses `.ok`, `.status`, `.statusText`, `.json()`
// from the Response, so a plain object is enough.

// Snapshot the real fetch once at module load. Per-test restore then
// always resets to the native implementation, not to whatever
// `globalThis.fetch` happened to hold when the previous mock was
// installed. Without this, a describe block that runs `afterEach(restoreFetch)`
// around a test that never mocked fetch (e.g., input-validation tests that
// throw before the HTTP call) would cascade `undefined` forward and make
// subsequent mocks record `undefined` as the "original" — order-dependent
// flakiness (R13-01).
const _nativeFetch = globalThis.fetch;

export function installFetchMock(factory) {
  globalThis.fetch = factory;
}

export function restoreFetch() {
  globalThis.fetch = _nativeFetch;
}

// Returns a fetch stub that resolves with the given status + body. Records
// every call so tests can assert on the outgoing request shape.
export function mockResponse({ status = 200, body = {}, statusText } = {}) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: statusText ?? (status >= 200 && status < 300 ? "OK" : "Error"),
      async json() {
        return body;
      },
    };
  };
  installFetchMock(fetchFn);
  return calls;
}

// fetch stub that throws a TimeoutError-like exception from the fetch() call
// itself (connection-phase timeout, mirrors AbortSignal.timeout firing
// before headers arrive).
export function mockTimeoutFetch(name = "TimeoutError") {
  installFetchMock(async () => {
    const err = new Error("signal timed out");
    err.name = name;
    throw err;
  });
}

// fetch stub that returns headers OK but throws on body read — exercises
// the R8-01 distinction between header-phase and body-phase timeouts.
export function mockBodyReadTimeoutFetch(name = "TimeoutError") {
  installFetchMock(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      const err = new Error("stalled reading body");
      err.name = name;
      throw err;
    },
  }));
}

// fetch stub that simulates an upstream proxy returning non-JSON (HTML
// error page, truncated body, etc.). The SyntaxError path must be
// reported as proxy interference, not as a timeout.
export function mockNonJsonFetch(status = 502) {
  installFetchMock(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: "Bad Gateway",
    async json() {
      throw new SyntaxError("Unexpected token < in JSON at position 0");
    },
  }));
}

// fetch stub that throws a TypeError (fetch()'s canonical "network
// failure" exception — DNS, connection refused, etc.).
export function mockNetworkErrorFetch(message = "fetch failed") {
  installFetchMock(async () => {
    throw new TypeError(message);
  });
}

// Minimal valid success envelope. Tests spread onto this and mutate fields
// to exercise individual validator branches without re-writing the whole
// shape each time.
export function validEnvelope(overrides = {}) {
  return {
    total: 0,
    results: [],
    meta: {
      tier: "anonymous",
      quota: { used: 1, limit: 20 },
    },
    ...overrides,
  };
}

// Valid result row with enough structure to pass isValidSuccessEnvelope.
export function validResult(overrides = {}) {
  return {
    text: "some quote text from the podcast",
    episode_title: "Episode Title",
    podcast_name: "Test Podcast",
    published_at: "2025-10-15",
    ...overrides,
  };
}
