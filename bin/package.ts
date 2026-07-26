#!/usr/bin/env node
import { main } from '../src/cli/main.js';

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`package: ${message}`);
  process.exitCode = 1;
});
