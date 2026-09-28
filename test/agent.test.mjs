// agent/1 — the vectors behave as their names say, and every rule is
// provoked through the real validator rather than found by grepping source.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  validate,
  fetchDocument,
  isSameDomain,
  sameDomainUrl,
  redirectAllowed,
  parseHttpsUrl,
  isHostname,
  CONTRACT,
  TOP_LEVEL_KEYS,
  REQUIRED_KEYS,
  DEPARTMENTS,
  CAPABILITY_TOKEN,
  WELL_KNOWN_PATH,
  FETCH_DEFAULTS,
} from '../vendor-agent.mjs'
import * as domainRule from '../vendor-domain.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VECTORS = join(ROOT, 'vectors')
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const vector = (name) => readJson(join(VECTORS, `${name}.json`))
const minimal = () => vector('minimal-valid')
const rules = (doc, opts) => validate(doc, opts).errors.map((e) => e.rule)

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

const files = readdirSync(VECTORS).filter((f) => f.endsWith('.json'))
const validFiles = files.filter((f) => f.endsWith('-valid.json'))
const invalidFiles = files.filter((f) => !f.endsWith('-valid.json'))

test('the corpus is not empty on either side — a walk that finds nothing reads exactly like a clean one', () => {
  assert.ok(validFiles.length >= 3, `expected at least 3 valid vectors, found ${validFiles.length}`)
  assert.ok(invalidFiles.length >= 6, `expected at least 6 refusal vectors, found ${invalidFiles.length}`)
})

for (const f of validFiles) {
  test(`vectors/${f} validates`, () => {
    const r = validate(readJson(join(VECTORS, f)))
    assert.deepEqual(r.errors, [])
    assert.equal(r.valid, true)
  })
}

for (const f of invalidFiles) {
  const rule = basename(f, '.json')
  test(`vectors/${f} is refused for exactly the rule it is named for`, () => {
    const r = validate(readJson(join(VECTORS, f)))
    assert.equal(r.valid, false)
    const seen = [...new Set(r.errors.map((e) => e.rule))]
    assert.deepEqual(seen, [rule], `expected only [${rule}], got [${seen.join(', ')}]`)
  })
}

test('the six refusals the format is built around each have a vector', () => {
  for (const rule of ['http-endpoint', 'department-capability', 'no-accountable-human', 'float-price', 'cross-domain-endpoint', 'unknown-key']) {
    assert.ok(invalidFiles.includes(`${rule}.json`), `no vector named ${rule}.json`)
  }
})

// ---------------------------------------------------------------------------
// Unit tests per rule
// ---------------------------------------------------------------------------

test('a non-object is refused before anything else is read', () => {
  for (const bad of [null, 'x', 3, [], undefined]) assert.deepEqual(rules(bad), ['not-an-object'])
})

test('contract must be exactly agent/1', () => {
  assert.equal(CONTRACT, 'agent/1')
  const d = minimal()
  d.contract = 'agent/1.0'
  assert.deepEqual(rules(d), ['wrong-contract'])
})

test('every required key is reported when missing, and accountable is reported under its own rule', () => {
  const d = minimal()
  for (const k of REQUIRED_KEYS) delete d[k]
  const seen = rules(d)
  assert.ok(seen.includes('no-accountable-human'))
  assert.equal(seen.filter((r) => r === 'missing-field').length, REQUIRED_KEYS.length - 1)
})

test('unknown top-level keys are refused; x- keys are carried at every level', () => {
  const d = minimal()
  d['x-anything'] = { nested: true }
  d.capabilities[0]['x-extra'] = 1
  d.accountable['x-role'] = 'CTO'
  d.auth[0]['x-hint'] = 'ok'
  assert.equal(validate(d).valid, true)
  d.pricingModel = 'tiered'
  assert.deepEqual(rules(d), ['unknown-key'])
})

test('unknown keys inside a capability, a price and policies are refused too', () => {
  const d = minimal()
  d.capabilities[0].rate = 1
  assert.deepEqual(rules(d), ['unknown-key'])
  const e = vector('full-valid')
  e.capabilities[1].price.vat = 20
  e.policies.retention = '30d'
  assert.deepEqual(rules(e), ['unknown-key', 'unknown-key'])
})

test('domain must be a lowercase hostname with no scheme, path or port', () => {
  for (const bad of ['https://example.com', 'example.com/', 'Example.com', 'example.com:8443', 'localhost', '192.0.2.1', 'example']) {
    const d = minimal()
    d.domain = bad
    assert.deepEqual(rules(d), ['bad-domain'], bad)
  }
})

test('org must be org/<slug>', () => {
  for (const bad of ['example', 'org/Example', 'org/ex_ample', 'person/ada', 'org/-x']) {
    const d = minimal()
    d.org = bad
    assert.deepEqual(rules(d), ['bad-org'], bad)
  }
})

test('the accountable human needs a name and a reachable email', () => {
  let d = minimal()
  d.accountable = 'ada@example.com'
  assert.deepEqual(rules(d), ['no-accountable-human'])
  d = minimal()
  d.accountable = { email: 'ada@example.com' }
  assert.deepEqual(rules(d), ['no-accountable-human'])
  d = minimal()
  d.accountable = { name: 'Ada', email: 'not-an-email' }
  assert.deepEqual(rules(d), ['no-accountable-human'])
  d = minimal()
  d.accountable = { name: '   ', email: 'ada@example.com' }
  assert.deepEqual(rules(d), ['no-accountable-human'])
})

test('the template placeholder mailbox is refused in any case', () => {
  const d = minimal()
  d.accountable.email = 'You@Example.com'
  assert.deepEqual(rules(d), ['placeholder-contact'])
})

test('updated must be a real ISO date', () => {
  for (const bad of ['2026-9-28', '28/09/2026', '2026-13-40', 20260928]) {
    const d = minimal()
    d.updated = bad
    assert.deepEqual(rules(d), ['bad-date'], String(bad))
  }
})

test('capabilities must be a non-empty array', () => {
  const d = minimal()
  d.capabilities = []
  assert.deepEqual(rules(d), ['no-capabilities'])
})

test('a capability id is a lowercase verb-like token', () => {
  assert.equal(String(CAPABILITY_TOKEN), '/^[a-z][a-z0-9-]*$/')
  for (const ok of ['quote', 'book', 'refund', 'check-stock', 'get2']) assert.ok(CAPABILITY_TOKEN.test(ok), ok)
  for (const bad of ['Quote', '2fa', 'get_quote', 'get quote', '', '-x', 'quote/1']) {
    const d = minimal()
    d.capabilities[0].id = bad
    assert.deepEqual(rules(d), ['capability-not-verb'], JSON.stringify(bad))
  }
})

test('every department word is refused as a capability, and the denylist is exactly the eight the spec names', () => {
  assert.deepEqual([...DEPARTMENTS], ['sales', 'marketing', 'engineering', 'operations', 'support', 'finance', 'legal', 'hr'])
  for (const word of DEPARTMENTS) {
    const d = minimal()
    d.capabilities[0].id = word
    assert.deepEqual(rules(d), ['department-capability'], word)
  }
})

test('two capabilities may not share an id', () => {
  const d = minimal()
  d.capabilities.push({ ...d.capabilities[0] })
  assert.deepEqual(rules(d), ['duplicate-capability'])
})

test('an endpoint is required, https, and free of userinfo, ports and IP literals', () => {
  let d = minimal()
  delete d.capabilities[0].endpoint
  assert.deepEqual(rules(d), ['no-endpoint'])
  d = minimal()
  d.capabilities[0].endpoint = 'HTTP://example.com/x'
  assert.deepEqual(rules(d), ['http-endpoint'])
  for (const bad of ['ftp://example.com/x', 'https://user:pw@example.com/x', 'https://example.com:8443/x', 'https://192.0.2.1/x', 'not a url', 42]) {
    d = minimal()
    d.capabilities[0].endpoint = bad
    assert.deepEqual(rules(d), ['bad-endpoint'], String(bad))
  }
})

test('an endpoint on the document\'s domain or a subdomain of it is valid', () => {
  const d = minimal()
  d.capabilities[0].endpoint = 'https://example.com/agent/quote'
  assert.equal(validate(d).valid, true)
  d.capabilities[0].endpoint = 'https://api.example.com/agent/quote'
  assert.equal(validate(d).valid, true)
  d.capabilities[0].endpoint = 'https://eu.api.example.com/agent/quote'
  assert.equal(validate(d).valid, true)
  // acme.example → api.acme.example, the case the task is named for
  d.domain = 'acme.example'
  d.accountable.email = 'ada@acme.example'
  d.capabilities[0].endpoint = 'https://api.acme.example/agent/quote'
  assert.equal(validate(d).valid, true)
})

test('acme.co.uk may point at www.acme.co.uk — a subdomain is a subdomain whatever the suffix', () => {
  const d = minimal()
  d.domain = 'acme.co.uk'
  d.accountable.email = 'ada@acme.co.uk'
  d.capabilities[0].endpoint = 'https://www.acme.co.uk/agent/quote'
  assert.equal(validate(d).valid, true)
})

test('an endpoint on another domain, a parent domain, a sibling or a lookalike is refused as cross-domain-endpoint', () => {
  const d = minimal()
  d.capabilities[0].endpoint = 'https://other.example/agent/quote'
  assert.deepEqual(rules(d), ['cross-domain-endpoint'])
  d.capabilities[0].endpoint = 'https://example.net/agent/quote'
  assert.deepEqual(rules(d), ['cross-domain-endpoint'])
  d.capabilities[0].endpoint = 'https://example.com.evil.example/agent/quote'
  assert.deepEqual(rules(d), ['cross-domain-endpoint'])
  d.capabilities[0].endpoint = 'https://notexample.com/agent/quote'
  assert.deepEqual(rules(d), ['cross-domain-endpoint'])

  // A parent: the document speaks for shop.example.com and may not send agents up to example.com.
  const shop = minimal()
  shop.domain = 'shop.example.com'
  shop.capabilities[0].endpoint = 'https://example.com/agent/quote'
  assert.deepEqual(rules(shop), ['cross-domain-endpoint'])

  // A sibling: shop.example.com may not point at api.example.com either — that is the parent's document to publish.
  shop.capabilities[0].endpoint = 'https://api.example.com/agent/quote'
  assert.deepEqual(rules(shop), ['cross-domain-endpoint'])
})

test('acme.co.uk may NOT point at other.co.uk — the checker does not guess that co.uk is a suffix', () => {
  const d = minimal()
  d.domain = 'acme.co.uk'
  d.accountable.email = 'ada@acme.co.uk'
  d.capabilities[0].endpoint = 'https://other.co.uk/agent/quote'
  assert.deepEqual(rules(d), ['cross-domain-endpoint'])
  d.capabilities[0].endpoint = 'https://co.uk/agent/quote'
  assert.deepEqual(rules(d), ['cross-domain-endpoint'])
})

test('the handshake and frontdoor links are the organisation\'s own', () => {
  const d = minimal()
  d.handshake = 'https://other.example/.well-known/flashyos.json'
  d.frontdoor = 'http://example.com/.well-known/frontdoor.json'
  assert.deepEqual(rules(d).sort(), ['bad-field', 'cross-domain-endpoint'])
  const e = minimal()
  e.handshake = 'https://mesh.example.com/.well-known/flashyos.json'
  e.frontdoor = 'https://example.com/.well-known/frontdoor.json'
  assert.equal(validate(e).valid, true)
})

test('a schema link is required and must be https', () => {
  const d = minimal()
  d.capabilities[0].schema = 'http://example.com/quote.schema.json'
  assert.deepEqual(rules(d), ['bad-schema-link'])
})

test('a price is whole minor units with a currency — floats, strings, negatives and bare numbers are refused', () => {
  for (const bad of [24.99, '2500', -1, 1e300, Number.NaN]) {
    const d = minimal()
    d.payment = [{ method: 'card' }]
    d.capabilities[0].price = { amount: bad, currency: 'GBP' }
    assert.deepEqual(rules(d), ['float-price'], String(bad))
  }
  const d = minimal()
  d.payment = [{ method: 'card' }]
  d.capabilities[0].price = 2500
  assert.deepEqual(rules(d), ['float-price'])
})

test('a currency is a three-letter uppercase code', () => {
  for (const bad of ['gbp', 'GB', 'GBPX', '£', 826]) {
    const d = minimal()
    d.payment = [{ method: 'card' }]
    d.capabilities[0].price = { amount: 2500, currency: bad }
    assert.deepEqual(rules(d), ['no-currency'], String(bad))
  }
})

test('a zero price is a price and still needs a currency and a payment section', () => {
  const d = minimal()
  d.capabilities[0].price = { amount: 0, currency: 'GBP' }
  assert.deepEqual(rules(d), ['price-without-payment'])
  d.payment = [{ method: 'card' }]
  assert.equal(validate(d).valid, true)
})

test('auth is required and each method is a token that may name a versioned standard', () => {
  let d = minimal()
  d.auth = []
  assert.deepEqual(rules(d), ['bad-field'])
  d = minimal()
  d.auth = [{ method: 'delegation/1' }, { method: 'oauth2' }, { method: 'none' }]
  assert.equal(validate(d).valid, true)
  d.auth = [{ method: 'OAuth 2.0' }]
  assert.deepEqual(rules(d), ['bad-method'])
  d.auth = [{ method: 'api-key' }, { method: 'api-key' }]
  assert.deepEqual(rules(d), ['duplicate-method'])
  d.auth = [{ method: 'api-key', issuer: 'http://id.example.com' }]
  assert.deepEqual(rules(d), ['bad-field'])
})

test('payment methods carry currencies as codes and terms as https', () => {
  const d = minimal()
  d.payment = [{ method: 'card', currencies: ['usd'] }]
  assert.deepEqual(rules(d), ['no-currency'])
  d.payment = [{ method: 'card', currencies: [] }]
  assert.deepEqual(rules(d), ['no-currency'])
  d.payment = [{ method: 'card', terms: 'http://example.com/terms' }]
  assert.deepEqual(rules(d), ['bad-field'])
})

test('policies: rate limits, jurisdictions and approval thresholds are typed', () => {
  const d = minimal()
  d.policies = { rateLimit: { requests: 0, per: 'fortnight' } }
  assert.deepEqual(rules(d), ['bad-field', 'bad-field'])
  d.policies = { jurisdictions: ['gb', 'GBR'] }
  assert.deepEqual(rules(d), ['bad-field'])
  d.policies = { humanApprovalAtOrAbove: { amount: 500.5, currency: 'GBP' } }
  assert.deepEqual(rules(d), ['float-price'])
  d.policies = { humanApprovalFor: ['quote'] }
  assert.equal(validate(d).valid, true)
  d.policies = { humanApprovalFor: ['refund'] }
  assert.deepEqual(rules(d), ['approval-unknown-capability'])
})

test('a document fetched for one domain may speak for that domain or a subdomain of it, never a parent or a stranger', () => {
  const d = minimal()
  assert.equal(validate(d, { domain: 'example.com' }).valid, true)
  assert.equal(validate(d, { domain: 'EXAMPLE.COM.' }).valid, true)
  assert.deepEqual(rules(d, { domain: 'other.example' }), ['domain-mismatch'])
  // Served for www.example.com but claiming example.com — a subdomain speaking for its parent.
  assert.deepEqual(rules(d, { domain: 'www.example.com' }), ['domain-mismatch'])
  // The consumer asked for example.com and was redirected to www; the document says www. Fine.
  const www = minimal()
  www.domain = 'www.example.com'
  www.capabilities[0].endpoint = 'https://www.example.com/agent/quote'
  assert.equal(validate(www, { domain: 'example.com' }).valid, true)
})

// ---------------------------------------------------------------------------
// The same-domain rule — vendored from agent-dns, re-exported, never restated
// ---------------------------------------------------------------------------

test('the checker re-exports the vendored rule and does not define its own', () => {
  assert.equal(isSameDomain, domainRule.isSameDomain)
  assert.equal(sameDomainUrl, domainRule.sameDomainUrl)
  const src = readFileSync(join(ROOT, 'vendor-agent.mjs'), 'utf8')
  assert.doesNotMatch(src, /registrableDomain|MULTI_LABEL_SLDS|slice\(-[23]\)/, 'the label-slice rule is gone')
  assert.match(src, /from '\.\/vendor-domain\.mjs'/)
})

test('isSameDomain: the host itself or a subdomain; a parent, a sibling and a co.uk neighbour are refused', () => {
  assert.equal(isSameDomain('example.com', 'example.com'), true)
  assert.equal(isSameDomain('api.example.com', 'example.com'), true)
  assert.equal(isSameDomain('a.b.c.example.com', 'example.com'), true)
  assert.equal(isSameDomain('API.Example.COM.', 'example.com'), true)
  assert.equal(isSameDomain('www.acme.co.uk', 'acme.co.uk'), true)
  assert.equal(isSameDomain('example.com', 'shop.example.com'), false)
  assert.equal(isSameDomain('api.example.com', 'shop.example.com'), false)
  assert.equal(isSameDomain('other.co.uk', 'acme.co.uk'), false)
  assert.equal(isSameDomain('192.0.2.1', 'example.com'), false)
  assert.equal(isSameDomain('', 'example.com'), false)
  assert.equal(isSameDomain(undefined, 'example.com'), false)
})

test('isHostname and parseHttpsUrl agree with the validator', () => {
  assert.equal(isHostname('example.com'), true)
  assert.equal(isHostname('Example.com'), false)
  assert.equal(isHostname('-x.example.com'), false)
  assert.equal(parseHttpsUrl('https://example.com/a').url.hostname, 'example.com')
  assert.ok(parseHttpsUrl('http://example.com/a').problem)
  assert.ok(parseHttpsUrl('https://example.com:444/a').problem)
})

// ---------------------------------------------------------------------------
// The consumer's fetch rules, tested without a network
// ---------------------------------------------------------------------------

const json = (doc, init = {}) => new Response(JSON.stringify(doc), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
const status = (code, headers = {}) => new Response(null, { status: code, headers })
const fakeFetch = (routes) => {
  const calls = []
  const f = async (url, init) => {
    calls.push({ url, init })
    const r = routes[url]
    if (r === undefined) return status(404)
    if (r instanceof Error) throw r
    return typeof r === 'function' ? r() : r
  }
  f.calls = calls
  return f
}

test('the consumer looks at /.well-known/agent and nowhere else — a .json spelling is not an alternate', async () => {
  assert.equal(WELL_KNOWN_PATH, '/.well-known/agent')
  const f = fakeFetch({ 'https://example.com/.well-known/agent': () => json(minimal()) })
  const r = await fetchDocument('example.com', { fetch: f })
  assert.equal(r.finding, 'found')
  assert.equal(r.valid, true)
  assert.deepEqual(f.calls.map((c) => c.url), ['https://example.com/.well-known/agent'])
  assert.equal(f.calls[0].init.redirect, 'manual')
  assert.ok(f.calls[0].init.signal instanceof AbortSignal)

  const onlyJson = fakeFetch({ 'https://example.com/.well-known/agent.json': () => json(minimal()) })
  const r2 = await fetchDocument('example.com', { fetch: onlyJson })
  assert.equal(r2.finding, 'absent')
  assert.deepEqual(onlyJson.calls.map((c) => c.url), ['https://example.com/.well-known/agent'], 'the .json path is never requested')
})

test('a found document that fails validation is found AND invalid — the two are separate answers', async () => {
  const f = fakeFetch({ 'https://example.com/.well-known/agent': () => json(vector('http-endpoint')) })
  const r = await fetchDocument('example.com', { fetch: f })
  assert.equal(r.finding, 'found')
  assert.equal(r.valid, false)
  assert.deepEqual(r.errors.map((e) => e.rule), ['http-endpoint'])
})

test('absent: the path answered 404 — the host has no agent interface', async () => {
  const r = await fetchDocument('example.com', { fetch: fakeFetch({}) })
  assert.equal(r.finding, 'absent')
  assert.equal(r.status, 404)
})

test('unreachable: the host did not answer, and that is not absence', async () => {
  const boom = Object.assign(new Error('getaddrinfo ENOTFOUND'), { name: 'Error' })
  const r = await fetchDocument('example.com', { fetch: fakeFetch({ 'https://example.com/.well-known/agent': boom }) })
  assert.equal(r.finding, 'unreachable')
  assert.notEqual(r.finding, 'absent')
})

test('a timeout is unreachable and names the budget', async () => {
  const t = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  const r = await fetchDocument('example.com', { fetch: fakeFetch({ 'https://example.com/.well-known/agent': t }), timeoutMs: 1234 })
  assert.equal(r.finding, 'unreachable')
  assert.match(r.reason, /1234ms/)
})

test('a redirect to the fetched domain or a subdomain of it is followed; one that leaves it is refused, not followed', async () => {
  const good = fakeFetch({
    'https://example.com/.well-known/agent': () => status(301, { location: 'https://www.example.com/.well-known/agent' }),
    'https://www.example.com/.well-known/agent': () => json(minimal()),
  })
  const r1 = await fetchDocument('example.com', { fetch: good })
  assert.equal(r1.finding, 'found')
  assert.equal(r1.url, 'https://www.example.com/.well-known/agent')

  // Two hops, each measured against the FETCHED domain, not the previous hop: api → www is a sibling
  // of api but both are under example.com, so both are followed.
  const twoHops = fakeFetch({
    'https://example.com/.well-known/agent': () => status(301, { location: 'https://api.example.com/.well-known/agent' }),
    'https://api.example.com/.well-known/agent': () => status(301, { location: 'https://www.example.com/.well-known/agent' }),
    'https://www.example.com/.well-known/agent': () => json(minimal()),
  })
  const r1b = await fetchDocument('example.com', { fetch: twoHops })
  assert.equal(r1b.finding, 'found')

  const bad = fakeFetch({ 'https://example.com/.well-known/agent': () => status(302, { location: 'https://other.example/.well-known/agent' }) })
  const r2 = await fetchDocument('example.com', { fetch: bad })
  assert.equal(r2.finding, 'refused')
  assert.equal(bad.calls.length, 1, 'the off-domain location must never be fetched')

  // A parent is off-domain too: the consumer asked shop.example.com and is not sent up to example.com.
  const parent = fakeFetch({ 'https://shop.example.com/.well-known/agent': () => status(302, { location: 'https://example.com/.well-known/agent' }) })
  const r2b = await fetchDocument('shop.example.com', { fetch: parent })
  assert.equal(r2b.finding, 'refused')
  assert.equal(parent.calls.length, 1, 'the parent must never be fetched')

  const downgrade = fakeFetch({ 'https://example.com/.well-known/agent': () => status(307, { location: 'http://example.com/.well-known/agent' }) })
  const r3 = await fetchDocument('example.com', { fetch: downgrade })
  assert.equal(r3.finding, 'refused')
  assert.equal(downgrade.calls.length, 1)
})

test('redirectAllowed states the rule on its own', () => {
  assert.equal(redirectAllowed('https://example.com/a', '/b'), true)
  assert.equal(redirectAllowed('https://example.com/a', 'https://api.example.com/b'), true)
  assert.equal(redirectAllowed('https://acme.co.uk/a', 'https://www.acme.co.uk/b'), true)
  assert.equal(redirectAllowed('https://acme.co.uk/a', 'https://other.co.uk/b'), false)
  assert.equal(redirectAllowed('https://www.example.com/a', 'https://example.com/b'), false, 'a parent is refused')
  assert.equal(redirectAllowed('https://example.com/a', 'https://example.org/b'), false)
  assert.equal(redirectAllowed('https://example.com/a', 'http://example.com/b'), false)
  assert.equal(redirectAllowed('https://example.com/a', 'https://example.com:8443/b'), false)
  // With the fetched domain given, the hop is measured against it rather than against `from`.
  assert.equal(redirectAllowed('https://api.example.com/a', 'https://www.example.com/b', 'example.com'), true)
  assert.equal(redirectAllowed('https://api.example.com/a', 'https://www.example.com/b'), false)
  // A relative location resolves against the base and stays on the host, so it is followed.
  assert.equal(redirectAllowed('https://example.com/a', '::odd but relative::'), true)
  // An unparseable location is refused.
  assert.equal(redirectAllowed('https://example.com/a', 'https://[::1'), false)
})

test('too many redirects is refused', async () => {
  const f = fakeFetch({ 'https://example.com/.well-known/agent': () => status(301, { location: 'https://example.com/.well-known/agent' }) })
  const r = await fetchDocument('example.com', { fetch: f, maxRedirects: 2 })
  assert.equal(r.finding, 'refused')
  assert.match(r.reason, /more than 2 redirects/)
  assert.equal(f.calls.length, 3)
})

test('a body over the size cap is refused, whether declared or streamed', async () => {
  const big = 'x'.repeat(FETCH_DEFAULTS.maxBytes + 1)
  const declared = fakeFetch({ 'https://example.com/.well-known/agent': () => new Response(big, { status: 200, headers: { 'content-length': String(big.length) } }) })
  const r1 = await fetchDocument('example.com', { fetch: declared })
  assert.equal(r1.finding, 'refused')
  assert.match(r1.reason, /exceeds/)

  const streamed = fakeFetch({ 'https://example.com/.well-known/agent': () => new Response(JSON.stringify(minimal()), { status: 200 }) })
  const r2 = await fetchDocument('example.com', { fetch: streamed, maxBytes: 64 })
  assert.equal(r2.finding, 'refused')
})

test('a 200 that is not JSON is refused; any other status is an error, not absence', async () => {
  const r1 = await fetchDocument('example.com', { fetch: fakeFetch({ 'https://example.com/.well-known/agent': () => new Response('<html>', { status: 200 }) }) })
  assert.equal(r1.finding, 'refused')
  const r2 = await fetchDocument('example.com', { fetch: fakeFetch({ 'https://example.com/.well-known/agent': () => status(500) }) })
  assert.equal(r2.finding, 'error')
  assert.equal(r2.status, 500)
  const r3 = await fetchDocument('example.com', { fetch: fakeFetch({ 'https://example.com/.well-known/agent': () => status(403) }) })
  assert.equal(r3.finding, 'error')
})

test('a served document claiming another domain is found and invalid under domain-mismatch', async () => {
  const d = minimal()
  d.domain = 'other.example'
  d.capabilities[0].endpoint = 'https://other.example/agent/quote'
  const r = await fetchDocument('example.com', { fetch: fakeFetch({ 'https://example.com/.well-known/agent': () => json(d) }) })
  assert.equal(r.finding, 'found')
  assert.deepEqual(r.errors.map((e) => e.rule), ['domain-mismatch'])
})

test('a target that is not a hostname is refused without a request', async () => {
  const f = fakeFetch({})
  const r = await fetchDocument('https://example.com', { fetch: f })
  assert.equal(r.finding, 'refused')
  assert.equal(f.calls.length, 0)
})

// ---------------------------------------------------------------------------
// The schema and the validator agree about what exists
// ---------------------------------------------------------------------------

test('schema/agent-1.json is draft 2020-12 and knows exactly the top-level keys the validator knows', () => {
  const schema = readJson(join(ROOT, 'schema', 'agent-1.json'))
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.equal(schema.properties.contract.const, CONTRACT)
  assert.deepEqual(Object.keys(schema.properties).sort(), [...TOP_LEVEL_KEYS].sort())
  assert.deepEqual(schema.required.sort(), [...REQUIRED_KEYS].sort())
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(Object.keys(schema.patternProperties), ['^x-'])
})

test('the schema denylist is the validator denylist and every object in the schema admits only x- extras', () => {
  const schema = readJson(join(ROOT, 'schema', 'agent-1.json'))
  const deny = schema.$defs.capability.properties.id.allOf.find((c) => c.not)?.not.enum
  assert.deepEqual(deny, [...DEPARTMENTS])
  const walk = (node, path) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`))
    if (node.type === 'object' && node.properties) {
      assert.equal(node.additionalProperties, false, `${path} admits unknown keys`)
      assert.deepEqual(Object.keys(node.patternProperties ?? {}), ['^x-'], `${path} does not carry x- keys`)
    }
    for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`)
  }
  walk(schema, '$')
})

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

const cli = (...args) => spawnSync(process.execPath, [join(ROOT, 'vendor-agent.mjs'), ...args], { encoding: 'utf8' })

test('the CLI exits 0 on a valid vector and 1 on a refusal, naming the rule', () => {
  const ok = cli('check', join(VECTORS, 'minimal-valid.json'))
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /example\.com — 1 capability · 0 problem\(s\)/)
  const bad = cli('check', join(VECTORS, 'department-capability.json'))
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /\[department-capability\]/)
})

test('the CLI exits 1 on a file that is not JSON, and on no arguments', () => {
  const r = cli('check', join(ROOT, 'README.md'))
  assert.equal(r.status, 1)
  assert.match(r.stderr, /could not be read as JSON/)
  assert.equal(cli().status, 1)
})
