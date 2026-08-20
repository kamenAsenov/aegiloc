#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { runCli } from './cli-core.js';

export { parseCliArguments, runCli } from './cli-core.js';

const entryPoint = process.argv[1];
if (entryPoint !== undefined && pathToFileURL(entryPoint).href === import.meta.url) {
  process.exitCode = await runCli(process.argv.slice(2));
}
