#!/usr/bin/env node
import { main } from "../dist/src/cli.js";

main(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`smith: ${message}`);
  process.exitCode = 1;
});
