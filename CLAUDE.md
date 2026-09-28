# agent-wellknown — the open discovery protocol

`agent/1`: the vendor-neutral document at `/.well-known/agent` through which a
website exposes an authenticated, discoverable, payable machine interface to
agents. Dependency-free: `node:` builtins only, Node 22, ESM.

## What makes this repository different

**It is the open half, and only the open half.** The format, schema, checker
and vectors live here. The commercial gateway service that fronts sites which
publish nothing is a separate repository, and it is never named, linked or
branded here. `scripts/lint.mjs` scans `SPEC.md`, the schema, the checker and
every vector for a denylist of estate brand words and fails on any hit;
contract names (`flashyos/1`, `frontdoor/1`, `directory/1`, `delegation/1`)
are vocabulary and are allowed.

**`vendor-agent.mjs` is the canonical copy; `vendor-domain.mjs` is not.**
Elsewhere in the estate a file named `vendor-*.mjs` is a copy of something in
flashyos; here `vendor-agent.mjs` is the source. It imports `node:fs`,
`node:url` and `./vendor-domain.mjs` and nothing else, so the pair travels by
byte-identical copy and runs before an install. Change `vendor-agent.mjs`
here; copies elsewhere are re-vendored, never edited. `vendor-domain.mjs` is
the other way round: it is the same-domain rule, canonical in the `agent-dns`
repository, vendored here byte-identically, and `test/vendor-drift.test.mjs`
compares it against that canon when agent-dns is checked out beside this
repository (unknown, not passed, when it is not). Change it *there*, then
re-vendor here. It replaced a "last two labels" slice this file used to carry,
which read `acme.co.uk` and `other.co.uk` as one publisher — the third
implementation of one rule across specifications built to interoperate.

**Discovery only.** No negotiation, no execution semantics, no settlement, no
identity proof, no DNS material. Anything that reads like one of those is a
different format or version 2 — `SPEC.md` § 7 is the list.

## Commands

```bash
npm run lint     # node --check every .mjs, parse every .json, brand-neutrality, licence line
npm test         # node --test test/*.test.mjs — no install
node vendor-agent.mjs check <file.json>     # exit 1 on refusal
node vendor-agent.mjs fetch <domain>        # the consumer rules against a live host
```

## Rules — each enforced by a test

- **Capabilities are verbs.** `^[a-z][a-z0-9-]*$` plus the eight-word
  department denylist, refused by name. The test iterates the whole denylist.
- **Same domain means `domain` or a subdomain of it.** Every endpoint, and
  the `handshake` and `frontdoor` links, sit on the document's `domain` or a
  subdomain of it under the rule in `SPEC.md` § 2 — a parent, a sibling and a
  `co.uk` neighbour are each refused as `cross-domain-endpoint`, and a test
  asserts the label-slice rule (`registrableDomain`, `slice(-2)`) is gone
  from the checker. `isSameDomain` is imported from `vendor-domain.mjs`,
  never restated. The well-known path is `/.well-known/agent` only; a test
  asserts the `.json` spelling is never requested.
- **Prices are whole minor units with a currency.** Floats, strings,
  negatives, bare numbers and missing currencies are each refused; a price
  with no `payment` section is refused.
- **An accountable human is required.** `{ name, email }`; the placeholder
  mailbox is refused.
- **Unknown keys are refused at every level unless `x-` prefixed.** The
  schema's `additionalProperties: false` + `^x-` pattern is asserted on every
  object in it, and the schema's top-level keys equal the checker's.
- **Every refusal vector fails for exactly its rule.** A file in `vectors/`
  not ending `-valid.json` must be refused with one distinct rule code equal
  to its basename. A vector that fails for two reasons is a mislabelled
  vector.
- **The consumer keeps `absent` and `unreachable` apart**, follows redirects
  only to the fetched domain or a subdomain of it and only over https, and
  never requests the refused target. Tested with an injected fetch; nothing here touches the
  network under test.
- **The corpus is non-empty on both sides.** A walk that finds no vectors
  reads exactly like a clean one, so the count is asserted.

## Adding or changing a rule

Spec first, then schema, then checker, then a vector named for the rule, then
a test that provokes it — in that order (`CONTRIBUTING.md`). A rule in prose
with no vector is a sentence.

## House rules — true in every repository in this estate

**`main` is not necessarily the default branch.** Ask, every time: `git symbolic-ref --short refs/remotes/origin/HEAD`.

**Say which branch you measured.** Reading the working tree tells you about your checkout, not the repository.

**Re-vendor before you trust a vendored change.** Files named `vendor-*.mjs` are byte-identical copies; a stale copy disagrees silently.

**No secret in a file, a repo, or an artifact.** Secret Manager only.

**The licence is declared once**, in `tools/estate-licences.mjs` in flashyos. Do not decide this repository's licence inside it.

**A generated file is regenerated, never hand-edited.**

**Report what happened, including when it is worse than expected.**
