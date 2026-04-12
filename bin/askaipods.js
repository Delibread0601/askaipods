#!/usr/bin/env node
import { run } from "../src/cli.js";

run(process.argv.slice(2)).catch((err) => {
  const message = err?.message ?? String(err);
  process.stderr.write(`askaipods: ${message}\n`);
  process.exit(typeof err?.exitCode === "number" ? err.exitCode : 1);
});
