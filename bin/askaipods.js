#!/usr/bin/env node
import { run } from "../src/cli.js";

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
