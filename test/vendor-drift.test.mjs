// vendor-domain.mjs is a byte-identical copy of the canonical file in the
// agent-dns repository. When that repository is checked out beside this one,
// the copy is compared byte for byte; when it is not, the test reports
// UNKNOWN (skips) rather than passing — a comparison against nothing is not
// a pass, and this file never claims one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPY = join(ROOT, 'vendor-domain.mjs')
const CANON = join(ROOT, '..', 'agent-dns', 'vendor-domain.mjs')

test('vendor-domain.mjs exists and imports nothing at all', () => {
  const src = readFileSync(COPY, 'utf8')
  assert.doesNotMatch(src, /^\s*import\b/m, 'the rule must run in a pure module and a browser')
  assert.match(src, /export function isSameDomain\(/)
  assert.match(src, /export function sameDomainUrl\(/)
  assert.match(src, /export function normalizeDomain\(/)
})

test('vendor-domain.mjs is byte-identical to agent-dns/vendor-domain.mjs (unknown when no sibling checkout)', (t) => {
  if (!existsSync(CANON)) {
    t.skip(`unknown: ${CANON} is not checked out beside this repository — drift was not measured`)
    return
  }
  assert.equal(readFileSync(COPY, 'utf8'), readFileSync(CANON, 'utf8'), 'vendor-domain.mjs has drifted from canon — re-vendor from agent-dns, never edit the copy')
})
