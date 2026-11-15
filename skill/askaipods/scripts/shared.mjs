// Pieces the HTTP client and the renderers both use.

// Paid-membership waitlist on the PodLens dashboard: the link shown when
// the server did not supply a usable one.
export const WAITLIST_URL = "https://podlens.net/dashboard?source=askaipods#waitlist";

// A waitlist link from the server is printed for the user, and SKILL.md
// tells the host agent to print it too. Only an https podlens.net URL made
// of plain URL characters is passed on; anything else yields the built-in
// link, so neither output can carry a link to another site.
const PODLENS_LINK = /^https:\/\/podlens\.net\/[A-Za-z0-9\-._~/?#&=%+]*$/;
export function waitlistLink(value) {
  return typeof value === "string" && PODLENS_LINK.test(value) ? value : WAITLIST_URL;
}

// Server codes (warning code, downgrade reason, window reason code) are
// printed verbatim in notes. A value that is not a short identifier is
// replaced, so a code field cannot carry prose.
const CODE_TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;
export function codeToken(value) {
  return typeof value === "string" && CODE_TOKEN.test(value) ? value : "unknown";
}

// Format characters (Unicode Cf): bidi marks and overrides, zero-width
// characters, the BOM, soft hyphens and tag characters. They are invisible
// and can reorder or hide text. Two groups of Cf stay: the joiners
// (U+200C, U+200D), which emoji sequences and several scripts need, and
// the Cf characters that are visible marks (Arabic, Syriac and Kaithi
// number and verse signs).
const JOINERS = "\\u200C\\u200D";
const VISIBLE_CF = "\\u0600-\\u0605\\u06DD\\u070F\\u0890\\u0891\\u08E2\\u{110BD}\\u{110CD}";
const FORMAT_CHARS = new RegExp(`[^\\P{Cf}${JOINERS}${VISIBLE_CF}]`, "gu");

// Server strings on their way into JSON output: control characters (tab
// and line breaks excepted) and format characters are dropped.
export function stripInvisible(value) {
  return String(value).replace(/[^\P{Cc}\t\n\r]/gu, "").replace(FORMAT_CHARS, "");
}

// Server strings (podcast-derived text, titles, error text) on their way
// to a terminal, in markdown output and in error messages: control
// characters become spaces (an ESC sequence can rewrite the screen or
// plant an OSC-8 hyperlink), format characters are dropped, and line
// breaks are folded so no field can open a new heading or leave its quote
// block.
export function oneLine(value) {
  return String(value).replace(/\p{Cc}/gu, " ").replace(FORMAT_CHARS, "").replace(/\s+/g, " ").trim();
}

// True when a string has something to show: more than whitespace, control
// characters, format characters and joiners.
const JOINERS_ONLY = new RegExp(`[${JOINERS}]`, "g");
export function hasVisibleText(value) {
  return oneLine(String(value).replace(JOINERS_ONLY, "")).length > 0;
}

// A server string for display on one line; the fallback when the value is
// not a string or has nothing to show. Every display fallback goes through
// here, so "has something to show" has one definition.
export function lineOr(value, fallback) {
  return typeof value === "string" && hasVisibleText(value) ? oneLine(value) : fallback;
}
