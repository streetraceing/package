#!/usr/bin/env node
import { main } from '../src/cli/main.js';
import { errorMessage } from '../src/util/terminal.js';

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(errorMessage(message));
  process.exitCode = 1;
});
