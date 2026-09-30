#!/usr/bin/env node
// Zero-install lint: syntax-checks every .mjs, parses every .json, and holds
// the house rules a test cannot see from inside the validator:
//
//   - the FORMAT is brand-neutral: SPEC.md, the schema, the validator and the
//     vectors name no company or product. Contract names (flashyos/1,
//     delegation/1, frontdoor/1, directory/1) are vocabulary, not brands, and
//     are allowed.
//   - nothing shipped imports anything but node: builtins.
//   - the README's final line is the licence line the estate register expects.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['.git', 'node_modules'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = walk(ROOT)
const rel = (p) => relative(ROOT, p)
const problems = []

const mjs = files.filter((f) => extname(f) === '.mjs')
const json = files.filter((f) => extname(f) === '.json')
if (mjs.length === 0 || json.length === 0) problems.push('the walk found no .mjs or no .json files — a lint that checks nothing passes for nothing')

for (const f of mjs) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
  if (r.status !== 0) problems.push(`${rel(f)}: ${r.stderr.trim()}`)
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
    const spec = m[1]
    if (!spec.startsWith('node:') && !spec.startsWith('./') && !spec.startsWith('../')) problems.push(`${rel(f)}: imports "${spec}" — only node: builtins and relative files are allowed`)
  }
}

for (const f of json) {
  try {
    JSON.parse(readFileSync(f, 'utf8'))
  } catch (e) {
    problems.push(`${rel(f)}: not valid JSON — ${e.message}`)
  }
}

// Brand neutrality, applied to the format and nothing else. The README and
// CLAUDE.md may say where the licence register lives; the format may not.
const FORMAT_FILES = ['SPEC.md', 'vendor-agent.mjs', 'vendor-domain.mjs', 'schema/agent-1.json', ...files.filter((f) => rel(f).startsWith('vectors/')).map(rel)]
export const BRAND_WORDS = ['magician', 'claimyour', 'flashy gold', 'flashy labs', 'flashylabs', 'flashy network', 'flashyid', 'gda.capital', 'gord.holdings', 'flashy group']
for (const name of FORMAT_FILES) {
  const text = readFileSync(join(ROOT, name), 'utf8').toLowerCase()
  for (const w of BRAND_WORDS) {
    if (text.includes(w)) problems.push(`${name}: names "${w}" — the format is brand-neutral by rule`)
  }
}

const README_LAST = 'Licensed under Apache-2.0 (holder Flashy Labs); the estate register in flashyos `tools/estate-licences.mjs` is the authority.'
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8').trimEnd().split('\n')
if (readme[readme.length - 1] !== README_LAST) problems.push('README.md: the final line must be the licence line, verbatim')

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
if (pkg.dependencies && Object.keys(pkg.dependencies).length) problems.push('package.json: declares dependencies — this repository is dependency-free')
if (pkg.license) problems.push('package.json: declares a licence — the estate register in flashyos does that')

if (problems.length) {
  console.error(`\n  ${problems.length} problem(s)\n`)
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error()
  process.exit(1)
}
console.log(`\n  lint clean · ${mjs.length} .mjs checked · ${json.length} .json parsed · ${FORMAT_FILES.length} format files brand-neutral\n`)
