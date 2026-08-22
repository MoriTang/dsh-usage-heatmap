/**
 * Build the usage-heatmap plugin artifacts:
 *
 * - `lib/index.js`   — host half (Node), esbuild ESM bundle.
 * - `lib/client.js`  — browser half, emitted as the loader's lazy-CJS
 *   factory artifact (`window.__ModuleLoader__.load({ id, factory })`) with
 *   module-table externals resolved through the injected `require`.
 *
 * The harness ships its own tsdown clientBundle preset, but that preset is
 * not published, so an out-of-tree package reproduces the output format here
 * (see docs/cookbook/adding-a-settings-card.md).
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// esbuild is not a dependency of this package; it lives in the harness
// checkout's pnpm store (the registry is not reachable, so no install here).
// Load it by its store path, which the harness's .pnpm virtual store exposes.
const require = createRequire(
  '/Users/mori/src/deepseek-harness/node_modules/.pnpm/node_modules/esbuild/lib/main.js',
)
const { build } = require('esbuild')

const root = dirname(fileURLToPath(import.meta.url))
const PKG_ID = 'dsh-usage-heatmap'

/** Specifiers the browser resolves from the client module table (never bundled). */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

mkdirSync(`${root}/lib`, { recursive: true })

// ── host half ──────────────────────────────────────────────────────────────
await build({
  entryPoints: [`${root}/src/index.ts`],
  outfile: `${root}/lib/index.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['node:*', ...CLIENT_EXTERNALS.filter(s => s.startsWith('@deepseek-ai/'))],
})

// ── browser half ───────────────────────────────────────────────────────────
const client = await build({
  entryPoints: [`${root}/src/client/index.ts`],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2020',
  external: CLIENT_EXTERNALS,
  write: false,
})

const body = client.outputFiles[0].text
const artifact = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(PKG_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${body}
\t\treturn module.exports;
\t}
});
`
await writeFile(`${root}/lib/client.js`, artifact)
console.log('built lib/index.js + lib/client.js')
