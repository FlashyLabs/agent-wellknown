#!/usr/bin/env node
// agent/1 — the discovery document at /.well-known/agent, and its checker.
//
// This file is the CANONICAL copy. It travels by byte-identical copy into any
// repository that serves or consumes an agent/1 document, which is why it
// imports nothing but `node:` builtins and runs before an install.
//
// What the format says, in one breath: a human sees company.com; an agent
// fetches https://company.com/.well-known/agent and learns who is accountable,
// which ACTIONS the organisation exposes, where each one lives, what it costs
// in whole minor units, how to pay, how to authenticate, and what the
// organisation's policies are. Discovery only — no negotiation, no execution.
//
// The refusals are the substance. Each is a real failure shape, not a style
// preference, and each has a vector in vectors/ named for it:
//
//   http-endpoint             an endpoint that is not https is a door an
//                             intermediary can rewrite
//   department-capability     "sales" tells an agent who to talk to, not what
//                             it can DO — a capability is a verb
//   no-accountable-human      an interface nobody answers for is one nobody
//                             can be asked to stop
//   float-price               0.1 + 0.2 is not 0.3; money is whole minor units
//   no-currency               2500 of WHAT
//   cross-domain-endpoint     a document may not point agents at another
//                             company's endpoints
//   unknown-key               a field the checker does not know is a field it
//                             cannot check; x- is the extension convention
//
// Usage:
//   node vendor-agent.mjs check <file.json>       validate a document, exit 1 on failure
//   node vendor-agent.mjs fetch <domain>          fetch and validate the way a stranger would
//
// `fetch` follows the consumer rules in SPEC.md § Discovery: https only, a
// timeout, a size cap, redirects only within the same registrable domain, and
// `absent` (the host answered 404) is a different finding from `unreachable`
// (the host did not answer). Conflating those two turns an outage into a
// claim that an organisation has no agent interface.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const CONTRACT = 'agent/1'

/** Where a consumer looks, in order. The first is canonical; the second is accepted. */
export const WELL_KNOWN_PATHS = ['/.well-known/agent', '/.well-known/agent.json']

/** The consumer's fetch rules. Stated once, exported so nobody retypes them. */
export const FETCH_DEFAULTS = Object.freeze({
  timeoutMs: 5000,
  maxBytes: 65536,
  maxRedirects: 3,
})

/** Every top-level key the format knows. Anything else must be x- prefixed. */
export const TOP_LEVEL_KEYS = Object.freeze([
  'contract',
  'domain',
  'org',
  'accountable',
  'updated',
  'capabilities',
  'auth',
  'payment',
  'policies',
  'handshake',
  'frontdoor',
])

/** Required at the top level. `auth` is required so silence never reads as "open". */
export const REQUIRED_KEYS = Object.freeze(['contract', 'domain', 'org', 'accountable', 'updated', 'capabilities', 'auth'])

/**
 * A capability id is a lowercase verb-like token: /^[a-z][a-z0-9-]*$/.
 * The regex cannot tell a verb from a noun, so the format refuses the nouns it
 * has actually seen offered as capabilities — departments. "sales" tells an
 * agent who to talk to; "quote" tells it what it can do.
 */
export const CAPABILITY_TOKEN = /^[a-z][a-z0-9-]*$/
export const DEPARTMENTS = Object.freeze([
  'sales',
  'marketing',
  'engineering',
  'operations',
  'support',
  'finance',
  'legal',
  'hr',
])

/** An auth or payment method token: a capability token, optionally followed by /<version> so a standard may be named (`delegation/1`). */
export const METHOD_TOKEN = /^[a-z][a-z0-9-]*(\/[0-9]+)?$/

export const ORG_ID = /^org\/[a-z0-9]+(-[a-z0-9]+)*$/
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
export const CURRENCY = /^[A-Z]{3}$/
export const COUNTRY = /^[A-Z]{2}$/
export const RATE_PERIODS = Object.freeze(['second', 'minute', 'hour', 'day'])
/** The aao/0.1 shape for a reachable human, plus the template placeholder it refuses. */
export const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/
export const PLACEHOLDER_EMAIL = 'you@example.com'

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/

/**
 * Second-level labels under which a third label is the registrable one when
 * the top-level label is a two-letter country code: example.co.uk registers
 * `example`, not `co`. This is NOT the Public Suffix List — a dependency-free
 * checker cannot carry one and stay current. The rule is exact and stated so
 * that two implementations agree; when a domain sits under a suffix this list
 * does not know, put the endpoints on the same host as the document.
 */
export const MULTI_LABEL_SLDS = Object.freeze(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'ltd', 'plc', 'sch', 'nhs'])

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isString = (v) => typeof v === 'string' && v.trim().length > 0

/** True for a lowercase DNS hostname with at least two labels and an alphabetic top-level label. IP literals fail. */
export function isHostname(s) {
  return typeof s === 'string' && HOSTNAME.test(s)
}

/**
 * The registrable domain of a hostname under the rule above, or null when the
 * input is not a hostname. `api.example.com` → `example.com`;
 * `shop.example.co.uk` → `example.co.uk`; `example.com` → `example.com`.
 */
export function registrableDomain(host) {
  if (typeof host !== 'string') return null
  const h = host.toLowerCase().replace(/\.$/, '')
  if (!isHostname(h)) return null
  const labels = h.split('.')
  const tld = labels[labels.length - 1]
  const sld = labels[labels.length - 2]
  if (labels.length >= 3 && tld.length === 2 && MULTI_LABEL_SLDS.includes(sld)) return labels.slice(-3).join('.')
  return labels.slice(-2).join('.')
}

/**
 * Parse an https URL an agent may be sent to. Returns { url } or { problem }.
 * Refused: any scheme but https, userinfo (a phishing shape), an explicit
 * port (a non-standard door), and a host that is not a DNS name (IP literals).
 */
export function parseHttpsUrl(s) {
  if (typeof s !== 'string') return { problem: 'must be a string' }
  let url
  try {
    url = new URL(s)
  } catch {
    return { problem: 'is not a URL' }
  }
  if (url.protocol !== 'https:') return { problem: 'must be https — an http endpoint is a door an intermediary can rewrite' }
  if (url.username || url.password) return { problem: 'carries userinfo, which is the shape of a phishing link' }
  if (url.port) return { problem: 'names an explicit port — an agent is sent only through the standard door' }
  if (!isHostname(url.hostname)) return { problem: 'host is not a DNS name' }
  return { url }
}

/** True when `to` (resolved against `from`) stays https and inside `from`'s registrable domain. */
export function redirectAllowed(from, location) {
  let to
  try {
    to = new URL(location, from)
  } catch {
    return false
  }
  if (to.protocol !== 'https:' || to.username || to.password || to.port) return false
  const a = registrableDomain(new URL(from).hostname)
  const b = registrableDomain(to.hostname)
  return a !== null && a === b
}

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

function unknownKeys(obj, known, path, err) {
  for (const k of Object.keys(obj)) {
    if (k.startsWith('x-')) continue
    if (!known.includes(k)) err('unknown-key', `${path}.${k}`, `is not a field agent/1 knows — a field the checker cannot check is refused; prefix an extension with x-`)
  }
}

function checkPrice(price, path, err) {
  if (!isObject(price)) {
    err('float-price', path, 'must be an object { amount, currency } — a bare number is a figure with no unit')
    return
  }
  unknownKeys(price, ['amount', 'currency', 'per'], path, err)
  const { amount, currency, per } = price
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) {
    err('float-price', `${path}.amount`, 'must be a non-negative integer of minor units (2500 is 25.00 in a two-decimal currency) — floats do not add up and strings are not amounts')
  }
  if (!('currency' in price)) {
    err('no-currency', `${path}.currency`, 'is missing — an amount with no currency is a number, not a price')
  } else if (typeof currency !== 'string' || !CURRENCY.test(currency)) {
    err('no-currency', `${path}.currency`, 'must be a three-letter uppercase currency code')
  }
  if (per !== undefined && !isString(per)) err('bad-field', `${path}.per`, 'must be a non-empty string naming the unit priced (request, minute, item)')
}

function checkCapability(cap, i, docRegistrable, err) {
  const path = `capabilities[${i}]`
  if (!isObject(cap)) {
    err('bad-field', path, 'must be an object')
    return null
  }
  unknownKeys(cap, ['id', 'description', 'endpoint', 'schema', 'price', 'method'], path, err)
  const { id, description, endpoint, schema, price, method } = cap

  if (typeof id !== 'string' || !CAPABILITY_TOKEN.test(id)) {
    err('capability-not-verb', `${path}.id`, `must match ${CAPABILITY_TOKEN} — a lowercase token starting with a letter, such as quote, book or refund`)
  } else if (DEPARTMENTS.includes(id)) {
    err('department-capability', `${path}.id`, `"${id}" is a department, not an action — a capability tells an agent what it can DO, not who to talk to`)
  }

  if (description !== undefined && !isString(description)) err('bad-field', `${path}.description`, 'must be a non-empty string')

  if (endpoint === undefined) {
    err('no-endpoint', `${path}.endpoint`, 'is missing — a capability with nowhere to go is a claim')
  } else {
    const parsed = parseHttpsUrl(endpoint)
    if (parsed.problem) {
      const rule = typeof endpoint === 'string' && /^http:/i.test(endpoint) ? 'http-endpoint' : 'bad-endpoint'
      err(rule, `${path}.endpoint`, parsed.problem)
    } else if (docRegistrable && registrableDomain(parsed.url.hostname) !== docRegistrable) {
      err('cross-domain-endpoint', `${path}.endpoint`, `is on ${registrableDomain(parsed.url.hostname)}, and this document speaks for ${docRegistrable} — a document may not point agents at another company's endpoints`)
    }
  }

  if (schema === undefined) {
    err('no-schema-link', `${path}.schema`, 'is missing — an endpoint with no schema is one an agent has to guess at')
  } else {
    const parsed = parseHttpsUrl(schema)
    if (parsed.problem) err('bad-schema-link', `${path}.schema`, parsed.problem)
  }

  if (price !== undefined) checkPrice(price, `${path}.price`, err)

  if (method !== undefined && (typeof method !== 'string' || !/^(GET|POST|PUT|PATCH|DELETE)$/.test(method))) {
    err('bad-field', `${path}.method`, 'must be one of GET, POST, PUT, PATCH, DELETE')
  }

  return typeof id === 'string' ? id : null
}

function checkMethods(list, key, err) {
  const path = key
  if (!Array.isArray(list) || list.length === 0) {
    err('bad-field', path, `must be a non-empty array of { method } objects`)
    return
  }
  const seen = new Set()
  list.forEach((m, i) => {
    const at = `${path}[${i}]`
    if (!isObject(m)) {
      err('bad-field', at, 'must be an object')
      return
    }
    unknownKeys(m, key === 'auth' ? ['method', 'issuer', 'scopes', 'detail'] : ['method', 'currencies', 'terms', 'detail'], at, err)
    if (typeof m.method !== 'string' || !METHOD_TOKEN.test(m.method)) {
      err('bad-method', `${at}.method`, `must match ${METHOD_TOKEN} — a lowercase token, optionally naming a versioned standard such as delegation/1`)
    } else if (seen.has(m.method)) {
      err('duplicate-method', `${at}.method`, `"${m.method}" is listed twice`)
    }
    seen.add(m.method)
    if (m.detail !== undefined && !isString(m.detail)) err('bad-field', `${at}.detail`, 'must be a non-empty string')
    if (key === 'auth') {
      if (m.issuer !== undefined) {
        const parsed = parseHttpsUrl(m.issuer)
        if (parsed.problem) err('bad-field', `${at}.issuer`, parsed.problem)
      }
      if (m.scopes !== undefined && (!Array.isArray(m.scopes) || !m.scopes.every(isString))) err('bad-field', `${at}.scopes`, 'must be an array of non-empty strings')
    } else {
      if (m.currencies !== undefined && (!Array.isArray(m.currencies) || m.currencies.length === 0 || !m.currencies.every((c) => typeof c === 'string' && CURRENCY.test(c)))) {
        err('no-currency', `${at}.currencies`, 'must be a non-empty array of three-letter uppercase currency codes')
      }
      if (m.terms !== undefined) {
        const parsed = parseHttpsUrl(m.terms)
        if (parsed.problem) err('bad-field', `${at}.terms`, parsed.problem)
      }
    }
  })
}

function checkPolicies(p, capabilityIds, err) {
  const path = 'policies'
  if (!isObject(p)) {
    err('bad-field', path, 'must be an object')
    return
  }
  unknownKeys(p, ['rateLimit', 'jurisdictions', 'humanApprovalAtOrAbove', 'humanApprovalFor', 'terms'], path, err)
  const { rateLimit, jurisdictions, humanApprovalAtOrAbove, humanApprovalFor, terms } = p

  if (rateLimit !== undefined) {
    if (!isObject(rateLimit)) {
      err('bad-field', `${path}.rateLimit`, 'must be an object { requests, per }')
    } else {
      unknownKeys(rateLimit, ['requests', 'per'], `${path}.rateLimit`, err)
      if (!Number.isSafeInteger(rateLimit.requests) || rateLimit.requests <= 0) err('bad-field', `${path}.rateLimit.requests`, 'must be a positive integer')
      if (!RATE_PERIODS.includes(rateLimit.per)) err('bad-field', `${path}.rateLimit.per`, `must be one of ${RATE_PERIODS.join(', ')}`)
    }
  }
  if (jurisdictions !== undefined) {
    if (!Array.isArray(jurisdictions) || jurisdictions.length === 0 || !jurisdictions.every((j) => typeof j === 'string' && COUNTRY.test(j))) {
      err('bad-field', `${path}.jurisdictions`, 'must be a non-empty array of two-letter uppercase country codes')
    }
  }
  if (humanApprovalAtOrAbove !== undefined) checkPrice(humanApprovalAtOrAbove, `${path}.humanApprovalAtOrAbove`, err)
  if (humanApprovalFor !== undefined) {
    if (!Array.isArray(humanApprovalFor) || !humanApprovalFor.every((c) => typeof c === 'string')) {
      err('bad-field', `${path}.humanApprovalFor`, 'must be an array of capability ids')
    } else {
      for (const c of humanApprovalFor) {
        if (!capabilityIds.has(c)) err('approval-unknown-capability', `${path}.humanApprovalFor`, `names "${c}", which this document does not declare — a policy about nothing is decoration`)
      }
    }
  }
  if (terms !== undefined) {
    const parsed = parseHttpsUrl(terms)
    if (parsed.problem) err('bad-field', `${path}.terms`, parsed.problem)
  }
}

function checkOwnLink(value, key, docRegistrable, err) {
  const parsed = parseHttpsUrl(value)
  if (parsed.problem) {
    err('bad-field', key, parsed.problem)
    return
  }
  if (docRegistrable && registrableDomain(parsed.url.hostname) !== docRegistrable) {
    err('cross-domain-endpoint', key, `is on ${registrableDomain(parsed.url.hostname)}, and this document speaks for ${docRegistrable} — an organisation links its OWN ${key}`)
  }
}

/**
 * Validate an agent/1 document.
 *
 * @param {unknown} doc            the parsed JSON
 * @param {{ domain?: string }} [opts]  when set, the hostname the document was
 *                                 fetched from; its registrable domain must
 *                                 match the document's own `domain`
 * @returns {{ valid: boolean, errors: Array<{ rule: string, path: string, message: string }> }}
 */
export function validate(doc, opts = {}) {
  const errors = []
  const err = (rule, path, message) => errors.push({ rule, path, message })

  if (!isObject(doc)) {
    err('not-an-object', '$', 'the document must be a JSON object')
    return { valid: false, errors }
  }

  unknownKeys(doc, TOP_LEVEL_KEYS, '$', err)
  for (const k of REQUIRED_KEYS) {
    if (!(k in doc)) {
      err(k === 'accountable' ? 'no-accountable-human' : 'missing-field', `$.${k}`, k === 'accountable' ? 'is missing — an interface nobody answers for is one nobody can be asked to stop' : 'is required')
    }
  }

  if ('contract' in doc && doc.contract !== CONTRACT) err('wrong-contract', '$.contract', `must be "${CONTRACT}", got ${JSON.stringify(doc.contract)}`)

  let docRegistrable = null
  if ('domain' in doc) {
    if (!isHostname(doc.domain)) {
      err('bad-domain', '$.domain', 'must be a lowercase DNS hostname with no scheme, path or port — the host this document is served from')
    } else {
      docRegistrable = registrableDomain(doc.domain)
      if (opts.domain !== undefined) {
        const fetched = registrableDomain(opts.domain)
        if (fetched !== docRegistrable) err('domain-mismatch', '$.domain', `says ${doc.domain}, but the document was fetched from ${opts.domain} — a document speaks only for the host that serves it`)
      }
    }
  }

  if ('org' in doc && (typeof doc.org !== 'string' || !ORG_ID.test(doc.org))) err('bad-org', '$.org', `must match ${ORG_ID}`)

  if ('accountable' in doc) {
    const a = doc.accountable
    if (!isObject(a)) {
      err('no-accountable-human', '$.accountable', 'must be an object { name, email } naming a reachable person')
    } else {
      unknownKeys(a, ['name', 'email'], '$.accountable', err)
      if (!isString(a.name)) err('no-accountable-human', '$.accountable.name', 'must name a person — an accountability record naming nobody answers nobody')
      if (typeof a.email !== 'string' || !EMAIL.test(a.email)) {
        err('no-accountable-human', '$.accountable.email', 'must be an email address, so the accountable human is reachable')
      } else if (a.email.toLowerCase() === PLACEHOLDER_EMAIL) {
        err('placeholder-contact', '$.accountable.email', `is the template placeholder ${PLACEHOLDER_EMAIL} — nobody reads that mailbox`)
      }
    }
  }

  if ('updated' in doc && (typeof doc.updated !== 'string' || !ISO_DATE.test(doc.updated) || Number.isNaN(Date.parse(doc.updated)))) {
    err('bad-date', '$.updated', 'must be an ISO date, YYYY-MM-DD')
  }

  const capabilityIds = new Set()
  let anyPriced = false
  if ('capabilities' in doc) {
    if (!Array.isArray(doc.capabilities) || doc.capabilities.length === 0) {
      err('no-capabilities', '$.capabilities', 'must be a non-empty array — a document that offers nothing is a business card')
    } else {
      doc.capabilities.forEach((cap, i) => {
        const id = checkCapability(cap, i, docRegistrable, err)
        if (id !== null) {
          if (capabilityIds.has(id)) err('duplicate-capability', `capabilities[${i}].id`, `"${id}" is declared twice`)
          capabilityIds.add(id)
        }
        if (isObject(cap) && cap.price !== undefined) anyPriced = true
      })
    }
  }

  if ('auth' in doc) checkMethods(doc.auth, 'auth', err)

  if ('payment' in doc) {
    checkMethods(doc.payment, 'payment', err)
  } else if (anyPriced) {
    err('price-without-payment', '$.payment', 'is missing, and a capability carries a price — a price with no way to pay is a number, not an offer')
  }

  if ('policies' in doc) checkPolicies(doc.policies, capabilityIds, err)
  if ('handshake' in doc) checkOwnLink(doc.handshake, 'handshake', docRegistrable, err)
  if ('frontdoor' in doc) checkOwnLink(doc.frontdoor, 'frontdoor', docRegistrable, err)

  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// The consumer: fetch the way a stranger would
// ---------------------------------------------------------------------------

async function readCapped(res, maxBytes) {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return { over: true }
  if (!res.body) {
    const text = await res.text()
    return Buffer.byteLength(text) > maxBytes ? { over: true } : { text }
  }
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return { over: true }
    }
    chunks.push(value)
  }
  return { text: Buffer.concat(chunks).toString('utf8') }
}

async function fetchOne(startUrl, f, { timeoutMs, maxBytes, maxRedirects }) {
  let url = startUrl
  for (let hops = 0; ; hops++) {
    let res
    try {
      res = await f(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json' },
      })
    } catch (e) {
      return { finding: 'unreachable', url, reason: e?.name === 'TimeoutError' ? `no answer within ${timeoutMs}ms` : (e?.message ?? String(e)) }
    }
    const { status } = res
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = res.headers.get('location')
      if (!location) return { finding: 'refused', url, reason: `redirect (${status}) with no location` }
      if (hops >= maxRedirects) return { finding: 'refused', url, reason: `more than ${maxRedirects} redirects` }
      if (!redirectAllowed(url, location)) return { finding: 'refused', url, reason: `redirect to ${location} leaves https or the registrable domain — not followed` }
      url = new URL(location, url).href
      continue
    }
    if (status === 404 || status === 410) return { finding: 'absent', url, status }
    if (status !== 200) return { finding: 'error', url, status, reason: `unexpected status ${status}` }
    const body = await readCapped(res, maxBytes)
    if (body.over) return { finding: 'refused', url, reason: `body exceeds ${maxBytes} bytes` }
    let doc
    try {
      doc = JSON.parse(body.text)
    } catch {
      return { finding: 'refused', url, reason: 'body is not JSON' }
    }
    return { finding: 'found', url, doc }
  }
}

/**
 * Fetch and validate a domain's agent/1 document under the consumer rules.
 *
 * Findings, which a consumer must keep apart:
 *   found        200 + JSON at one of the well-known paths; `valid`/`errors` say whether it validates
 *   absent       every well-known path answered 404 or 410 — the host has no agent interface
 *   unreachable  the host did not answer (DNS, TCP, TLS, timeout) — says nothing about the host's intent
 *   refused      the consumer stopped: redirect off-domain or off-https, too many redirects, oversize, not JSON
 *   error        any other HTTP status
 *
 * `fetch` is injectable so the rules can be tested without a network.
 */
export async function fetchDocument(domain, opts = {}) {
  const { fetch: f = globalThis.fetch, ...rest } = opts
  const settings = { ...FETCH_DEFAULTS, ...rest }
  if (!isHostname(domain)) return { finding: 'refused', reason: `${JSON.stringify(domain)} is not a hostname` }
  let last = null
  for (const path of WELL_KNOWN_PATHS) {
    const r = await fetchOne(`https://${domain}${path}`, f, settings)
    if (r.finding === 'absent') {
      last = r
      continue
    }
    if (r.finding === 'found') {
      const { valid, errors } = validate(r.doc, { domain })
      return { ...r, valid, errors }
    }
    return r
  }
  return last
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printErrors(errors) {
  for (const e of errors) console.log(`  ✗ ${e.path}: ${e.message} [${e.rule}]`)
}

async function main(argv) {
  const [cmd, target] = argv
  if (cmd === 'check' && target) {
    let doc
    try {
      doc = JSON.parse(readFileSync(target, 'utf8'))
    } catch (e) {
      console.error(`\n  ${target} could not be read as JSON: ${e.message}\n`)
      return 1
    }
    const { valid, errors } = validate(doc)
    const label = isObject(doc) && typeof doc.domain === 'string' ? doc.domain : target
    const n = isObject(doc) && Array.isArray(doc.capabilities) ? doc.capabilities.length : 0
    console.log(`\n  ${label} — ${n} capabilit${n === 1 ? 'y' : 'ies'} · ${errors.length} problem(s)\n`)
    printErrors(errors)
    if (errors.length) console.log()
    return valid ? 0 : 1
  }
  if (cmd === 'fetch' && target) {
    const r = await fetchDocument(target)
    console.log(`\n  ${target} — ${r.finding}${r.url ? ` · ${r.url}` : ''}${r.reason ? ` · ${r.reason}` : ''}\n`)
    if (r.finding === 'found') {
      printErrors(r.errors)
      if (r.errors.length) console.log()
      return r.valid ? 0 : 1
    }
    return r.finding === 'absent' ? 2 : 1
  }
  console.error('\n  usage:\n    node vendor-agent.mjs check <file.json>\n    node vendor-agent.mjs fetch <domain>\n')
  return 1
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) main(process.argv.slice(2)).then((code) => process.exit(code))
