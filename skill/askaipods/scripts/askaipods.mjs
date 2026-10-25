#!/usr/bin/env node
// Entry point for both install paths: the npm `bin` (bin/askaipods.js
// imports this file) and an agent running the copy bundled in the skill
// folder (`node <skill-dir>/scripts/askaipods.mjs ...`), which needs no
// npm registry access, cache writes, or download at run time. The `.mjs`
// extension keeps these modules ESM when the skill folder is copied out
// of the package and no package.json `"type": "module"` applies.
import { run } from "./cli.mjs";

run(process.argv.slice(2)).catch((err) => {
  const message = err?.message ?? String(err);
  process.stderr.write(`askaipods: ${message}\n`);
  // AskaipodsError carries an explicit exitCode for known user/protocol
  // failures. Any other exception is an internal or unexpected failure
  // (format-time RangeError, unhandled rejection, etc.) — these are
  // closer in semantics to exit 3 "protocol / unexpected failure" than
  // to exit 1 "usage error", so default to 3 instead of 1.
  process.exit(typeof err?.exitCode === "number" ? err.exitCode : 3);
});
