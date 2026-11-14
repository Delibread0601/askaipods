// Pieces the HTTP client and the renderers both use.

// Paid-membership waitlist on the PodLens dashboard: the link shown when
// the server did not supply its own.
export const WAITLIST_URL = "https://podlens.net/dashboard?source=askaipods#waitlist";

// Server strings (podcast-derived text, titles, codes, error text) go
// straight to a terminal in markdown output and in error messages.
// Replace control characters (an ESC sequence can rewrite the screen or
// plant an OSC-8 hyperlink) and bidi overrides, and fold line breaks so
// no field can open a new heading or leave its quote block. JSON output
// keeps the raw values.
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
export function oneLine(value) {
  return String(value).replace(UNSAFE_CHARS, " ").replace(/\s+/g, " ").trim();
}
