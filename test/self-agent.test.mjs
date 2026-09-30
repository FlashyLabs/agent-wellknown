// Dogfood: the property serves its OWN agent/1 document, and it must pass the
// very checker this repository publishes. This test runs vendor-agent.mjs's
// validate() over the served document — the same code path `check` uses — and
// asserts zero problems, then holds the document honest against the sources it
// is derived from. node: builtins only, no install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, WELL_KNOWN_PATH } from '../vendor-agent.mjs';
import { siteHost, siteBase, SCHEMA_FILE } from '../scripts/emit-agent.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
// The served document lives at the SPEC's well-known path inside the site.
const SERVED = join(SITE, WELL_KNOWN_PATH.replace(/^\//, ''));

const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const charter = JSON.parse(readFileSync(join(ROOT, 'flashyos.roles.json'), 'utf8'));
const directory = JSON.parse(readFileSync(join(ROOT, 'directory.fragment.json'), 'utf8'));

test('the served agent/1 document exists at the well-known path', () => {
  assert.ok(existsSync(SERVED), `${WELL_KNOWN_PATH} is not served — run node scripts/emit-agent.mjs`);
});

test('the served agent/1 document passes the checker with no problems', () => {
  const doc = JSON.parse(readFileSync(SERVED, 'utf8'));
  const { valid, errors } = validate(doc);
  assert.deepEqual(errors, [], `the served document is refused: ${JSON.stringify(errors)}`);
  assert.ok(valid, 'the served document does not validate');
});

test('the document describes THIS property, derived from its own sources', () => {
  const doc = JSON.parse(readFileSync(SERVED, 'utf8'));
  assert.equal(doc.contract, 'agent/1');
  assert.equal(doc.domain, siteHost(cfg), 'domain is not the host the site is served from');
  assert.equal(doc.org, directory.org, 'org is not the directory/1 org');
  assert.equal(doc.accountable.email, charter.accountableTo, 'accountable email is not the charter accountableTo');
  const person = directory.nodes.find((n) => n.kind === 'person');
  assert.equal(doc.accountable.name, person.name, 'accountable name is not the directory person');
  assert.notEqual(doc.accountable.email, 'you@example.com', 'the placeholder mailbox must never appear');
  assert.ok(doc.capabilities.length >= 1, 'the document declares no capability');
});

test('the capability endpoint the document points at is really served', () => {
  const doc = JSON.parse(readFileSync(SERVED, 'utf8'));
  const base = siteBase(cfg);
  const cap = doc.capabilities.find((c) => c.endpoint === `${base}${SCHEMA_FILE}`);
  assert.ok(cap, 'the document does not point at the served schema');
  assert.ok(existsSync(join(SITE, SCHEMA_FILE)), `${SCHEMA_FILE} is named as an endpoint but is not served`);
  // The served schema is the canonical one this repository publishes.
  assert.equal(
    readFileSync(join(SITE, SCHEMA_FILE)).toString('binary'),
    readFileSync(join(ROOT, 'schema', 'agent-1.json')).toString('binary'),
    'the served schema has drifted from schema/agent-1.json',
  );
});

test('the handshake link, when present, is on the document domain', () => {
  const doc = JSON.parse(readFileSync(SERVED, 'utf8'));
  if (!doc.handshake) return;
  const host = new URL(doc.handshake).host;
  assert.ok(
    host === doc.domain || host.endsWith(`.${doc.domain}`),
    `handshake host ${host} is not the document domain or a subdomain of it`,
  );
});
