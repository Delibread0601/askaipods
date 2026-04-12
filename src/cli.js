// CLI entry point — argument parsing, format auto-detection, dispatch.
//
// Why it's structured this way:
//   - parseArgs (Node 18+ stdlib) keeps the package zero-dependency,
//     which matters for `npx askaipods` cold-start time and for the
//     skill story (zero install footprint beyond Node itself).
//   - Format auto-detects from `process.stdout.isTTY`: a human running
//     `askaipods "..."` in a terminal gets markdown, a host agent that
//     pipes the output gets JSON. SKILL.md still tells the agent to
//     pass `--format json` explicitly so the contract isn't load-bearing
//     on isTTY behavior across shells.

import { parseArgs } from "node:util";
import { search, AskaipodsError } from "./client.js";
import { renderJson, renderMarkdown } from "./format.js";

const VERSION = "0.1.0";

const HELP_TEXT = `askaipods ${VERSION} — search AI podcast quotes by topic

USAGE:
  askaipods <query>
  askaipods search <query> [options]

OPTIONS:
  --format <json|markdown>   Output format (default: markdown if TTY, json if piped)
  --days <N>                 Only return results from the last N days (max 7 for anonymous tier; member tier accepts any value)
  --api-key <key>            PodLens API key (overrides ASKAIPODS_API_KEY env var)
  -h, --help                 Show this message
  -v, --version              Show version

ENVIRONMENT:
  ASKAIPODS_API_KEY          PodLens API key. Without it: 10 searches/day per IP (anonymous).
                             With it: 50 searches/day per user (member).
                             Sign up at https://podlens.net to get one.

EXIT CODES:
  0  success
  1  usage error / invalid arguments / API key rejected
  2  daily quota exhausted (tier-aware message on stderr)
  3  transient or unexpected failure — network / rate-limit burst / 503 /
     protocol error / internal exception (stderr has the actionable detail)

EXAMPLES:
  askaipods "what are people saying about test-time compute"
  askaipods search "Anthropic safety research" --days 30
  askaipods "GPU shortage" --format json | jq .results
`;

function usageError(message) {
  const err = new AskaipodsError(`${message}\n\nRun 'askaipods --help' for usage.`, 1);
  return err;
}

export async function run(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        format: { type: "string" },
        days: { type: "string" },
        "api-key": { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    throw usageError(err?.message ?? "could not parse arguments");
  }

  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(HELP_TEXT);
    return;
  }
  if (values.version) {
    process.stdout.write(`askaipods ${VERSION}\n`);
    return;
  }

  // Allow `askaipods search "query"` or `askaipods "query"`. The
  // `search` subcommand is purely a usability hint — there is only one
  // operation today and adding it as a flag-free first positional means
  // future subcommands (e.g., `askaipods quota`) won't break the v0
  // muscle memory.
  let query;
  if (positionals[0] === "search") {
    query = positionals.slice(1).join(" ").trim();
  } else {
    query = positionals.join(" ").trim();
  }

  if (!query) {
    throw usageError("missing query");
  }

  let days;
  if (values.days !== undefined) {
    // Strict positive integer match. Three reasons for the shape:
    //   (1) parseInt("7abc",10) silently returns 7 — reject any
    //       non-digit suffix / scientific notation / decimals / sign.
    //   (2) client.js only forwards `days` to the API when it's > 0,
    //       so "0" or "00" would silently drop the filter entirely
    //       instead of filtering to "0 days" as the user expected.
    //   (3) Number.parseInt("9".repeat(400), 10) returns Infinity, and
    //       JSON.stringify({days: Infinity}) emits {"days":null}, which
    //       would send a malformed body instead of the user's intent.
    //       Reject inputs that don't survive round-trip as a safe int.
    if (!/^[1-9]\d*$/.test(values.days)) {
      throw usageError("--days must be a positive integer (1 or greater)");
    }
    const n = Number.parseInt(values.days, 10);
    if (!Number.isSafeInteger(n)) {
      throw usageError("--days value is too large");
    }
    days = n;
  }

  const format = values.format ?? (process.stdout.isTTY ? "markdown" : "json");
  if (format !== "json" && format !== "markdown") {
    throw usageError(`--format must be 'json' or 'markdown', got '${format}'`);
  }

  // Source of truth for the API key:
  //   1. --api-key flag if provided AND non-empty after trim. An empty
  //      or whitespace-only flag is rejected as a usage error — Node's
  //      Headers constructor normalizes a whitespace-only header value
  //      to empty, so without this trim the user would silently get no
  //      X-PodLens-API-Key header and a silent tier downgrade from
  //      member to anonymous.
  //   2. ASKAIPODS_API_KEY env var if --api-key is unset. The env var
  //      is trimmed and treated as unset when empty/whitespace — shell
  //      unset/export mishaps and trailing-newline cases are common and
  //      unlikely to reflect user intent, so we silently coerce rather
  //      than erroring.
  // HTTP header values must be ByteStrings (each character ≤ 0xFF).
  // Characters outside the printable ASCII + Latin-1 extended range
  // cause Node's Headers constructor to throw a ByteString TypeError,
  // which the fetch catch in client.js would mislabel as a network
  // error (exit 3) instead of a user input problem. This allowlist
  // rejects C0 controls (0x00-0x1F), DEL (0x7F), and any codepoint
  // above 0xFF (LS, PS, ZWSP, emoji, etc.) at the CLI boundary with
  // exit 1.
  const INVALID_KEY_CHARS = /[^\x20-\x7E\x80-\xFF]/;
  let apiKey;
  if (values["api-key"] !== undefined) {
    const trimmed = values["api-key"].trim();
    if (trimmed.length === 0) {
      throw usageError(
        "--api-key value cannot be empty or whitespace-only; omit the flag to use the anonymous tier or the ASKAIPODS_API_KEY env var",
      );
    }
    if (INVALID_KEY_CHARS.test(trimmed)) {
      throw usageError("--api-key value contains invalid characters (control chars, non-Latin-1 Unicode, or emoji are not allowed in HTTP headers)");
    }
    apiKey = trimmed;
  } else {
    const envTrimmed = (process.env.ASKAIPODS_API_KEY ?? "").trim();
    if (envTrimmed.length === 0) {
      apiKey = undefined;
    } else if (INVALID_KEY_CHARS.test(envTrimmed)) {
      throw usageError(
        "ASKAIPODS_API_KEY env var contains invalid characters (control chars, non-Latin-1 Unicode, or emoji are not allowed in HTTP headers)",
      );
    } else {
      apiKey = envTrimmed;
    }
  }

  const response = await search({ query, days, apiKey });

  const output = format === "json" ? renderJson(query, response) : renderMarkdown(query, response);

  process.stdout.write(output);
  if (!output.endsWith("\n")) process.stdout.write("\n");
}
