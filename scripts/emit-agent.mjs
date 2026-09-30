#!/usr/bin/env node
// Dogfood: agent-wellknown serves its OWN agent/1 discovery document.
//
// This is the format describing the property that publishes the format. The
// document is DERIVED, never hand-typed, so it cannot drift from the sources
// the rest of the repository already trusts:
//   - domain / property   ← site.config.json (the same base build-site.mjs uses)
//   - org                  ← directory.fragment.json (the directory/1 node)
//   - accountable email    ← flashyos.roles.json accountableTo (the AAO charter)
//   - accountable name     ← the person node in directory.fragment.json
//
// It carries ONE honest, real capability: an agent may GET the canonical
// agent/1 JSON Schema this repository publishes (served beside the document as
// `agent-1.json`). No price, no payment, no auth — the schema is public. Nothing
// here is fabricated: agent-wellknown offers agents the format and its schema,
// and that is what the document says.
//
// It is written into the generated site so the property SERVES it at the SPEC's
// well-known path. The document validates against vendor-agent.mjs before it is
// written; an invalid document fails the build, exactly as build-site.mjs fails
// on an invalid stack.json. node: builtins only, no install.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validate, WELL_KNOWN_PATH } from '../vendor-agent.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEMA_FILE = 'agent-1.json';

/** The base URL the generated site is served from — identical to build-site.mjs. */
export function siteBase(cfg) {
  return cfg.domain ? `https://${cfg.domain}/` : `https://flashylabs.github.io/${cfg.property}/`;
}

/** The DNS host of that base — the document's `domain`. */
export function siteHost(cfg) {
  return cfg.domain ?? 'flashylabs.github.io';
}

/** Build agent-wellknown's own agent/1 document from the repository's sources. */
export function agentDocument(root = ROOT) {
  const cfg = JSON.parse(readFileSync(join(root, 'site.config.json'), 'utf8'));
  const charter = JSON.parse(readFileSync(join(root, 'flashyos.roles.json'), 'utf8'));
  const directory = JSON.parse(readFileSync(join(root, 'directory.fragment.json'), 'utf8'));

  const org = directory.org;
  const email = charter.accountableTo;
  const person = directory.nodes.find((n) => n.kind === 'person');
  if (!person) throw new Error('directory.fragment.json names no person node to be accountable');

  const base = siteBase(cfg);
  const host = siteHost(cfg);

  const doc = {
    contract: 'agent/1',
    domain: host,
    org,
    accountable: { name: person.name, email },
    updated: '2026-09-30',
    capabilities: [
      {
        id: 'get-schema',
        description: 'Retrieve the canonical agent/1 JSON Schema this repository publishes.',
        method: 'GET',
        endpoint: `${base}${SCHEMA_FILE}`,
        schema: 'https://json-schema.org/draft/2020-12/schema',
      },
    ],
    auth: [{ method: 'none' }],
    handshake: `${base}.well-known/flashyos.json`,
    // The document is committed and served from the project path below, not the
    // host root: this property deploys as a GitHub Pages / Vercel project under
    // `${cfg.property}`, and `domain` names the host it is served from. An x-
    // key is carried and never checked — it records the real location honestly.
    'x-served-at': `${base}${WELL_KNOWN_PATH.replace(/^\//, '')}`,
    'x-status': 'draft — dogfood; no independent adopter is verified serving agent/1 yet',
  };

  const { valid, errors } = validate(doc);
  if (!valid) {
    throw new Error(
      `the derived agent/1 document does not validate:\n  ${errors.map((e) => `${e.path}: ${e.message} [${e.rule}]`).join('\n  ')}`,
    );
  }
  return doc;
}

/** Write the document and the schema it points at into a generated site dir. */
export function emitAgent(out) {
  const doc = agentDocument();
  const put = (rel, body) => {
    const full = join(out, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  };
  // The well-known document itself, at the SPEC path `/.well-known/agent`.
  put(join('.well-known', 'agent'), JSON.stringify(doc, null, 2) + '\n');
  // The canonical schema the get-schema capability serves, byte copy.
  put(SCHEMA_FILE, readFileSync(join(ROOT, 'schema', 'agent-1.json')));
  return ['.well-known/agent', SCHEMA_FILE];
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const out = process.argv[2] ?? join(ROOT, 'site');
  const written = emitAgent(out);
  console.log(`agent/1: wrote ${written.length} files to ${out}\n  ${written.join('\n  ')}`);
}
