import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('uses GitHub contribution colors without host-theme cell borders', async () => {
  const css = await readFile(new URL('../src/client/usage-heatmap.css', import.meta.url), 'utf8')
  const component = await readFile(new URL('../src/client/UsageHeatmap.tsx', import.meta.url), 'utf8')

  assert.match(css, /:root[^{]*\{[^}]*--dsh-usage-heatmap-level-0: rgb\(0 0 0 \/ 9%\)/s)
  assert.match(css, /body\[data-ds-dark-theme\][^{]*\{[^}]*#161b22[^}]*#0e4429[^}]*#006d32[^}]*#26a641[^}]*#39d353/s)
  assert.match(css, /\[data-usage-heatmap-cell\][^{]*\{[^}]*border: 0;[^}]*box-shadow: inset 0 0 0 1px/s)
  assert.doesNotMatch(component, /dsw-alias-border-l1/)
  assert.match(component, /\[0, 1, 2, 3, 4\]\.map/)
})
