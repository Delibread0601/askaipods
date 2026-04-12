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
  --days <N>                 Only return results from the last N days (max 7 for anonymous tier)
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
  2  daily quota exhausted
  3  network error / podlens.net unavailable

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
    const n = Number.parseInt(values.days, 10);
    if (!Number.isFinite(n) || n < 0) {
      throw usageError("--days must be a non-negative integer");
    }
    days = n;
  }

  const format = values.format ?? (process.stdout.isTTY ? "markdown" : "json");
  if (format !== "json" && format !== "markdown") {
    throw usageError(`--format must be 'json' or 'markdown', got '${format}'`);
  }

  const apiKey = values["api-key"] ?? process.env.ASKAIPODS_API_KEY;

  const response = await search({ query, days, apiKey });

  const output = format === "json" ? renderJson(query, response) : renderMarkdown(query, response);

  process.stdout.write(output);
  if (!output.endsWith("\n")) process.stdout.write("\n");
}
