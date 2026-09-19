import { fileURLToPath } from 'node:url';
import { checkRelease } from './playtest-build-check.mjs';
checkRelease(fileURLToPath(new URL('../dist/', import.meta.url)));
