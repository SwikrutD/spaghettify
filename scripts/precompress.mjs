// Writes .br and .gz copies of the compressible files in dist/ so the server can send them
// without compressing per request. Run after `vite build` (the Docker image does this).
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = process.argv[2] ?? 'dist';
const compressible = /\.(html|js|mjs|css|json|svg|txt|xml|wasm|map)$/;
const minBytes = 1024;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (compressible.test(name)) compress(path);
  }
}

function compress(path) {
  const data = readFileSync(path);
  if (data.length < minBytes) return;
  const br = brotliCompressSync(data, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length },
  });
  const gz = gzipSync(data, { level: 9 });
  writeFileSync(`${path}.br`, br);
  writeFileSync(`${path}.gz`, gz);
  console.log(`${path}: ${data.length} > br ${br.length}, gz ${gz.length}`);
}

walk(root);
