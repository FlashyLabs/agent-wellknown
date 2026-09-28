# agent-wellknown

`agent/1` is the vendor-neutral discovery document at `/.well-known/agent`,
for any website, API or company that wants to expose an authenticated,
discoverable, payable machine interface to agents — and for the agents that
need to find one. A human sees `company.com`; an agent fetches one file and
learns who is accountable, which actions it may take, where each lives, what
it costs in whole minor units, how to pay, how to authenticate, and the
policies that apply.

This is the **open protocol** half of a gateway layer. The format, its schema,
its checker and its conformance vectors are here. A service that fronts sites
which do not publish one is a separate thing in a separate repository, and it
is not named in this one — the format is brand-neutral by rule, and a lint
enforces that.

## Quick start

```bash
node vendor-agent.mjs check vectors/minimal-valid.json
node vendor-agent.mjs check vectors/department-capability.json
npm test
```

The first prints `example.com — 1 capability · 0 problem(s)` and exits 0. The
second prints the refusal with its rule code, `[department-capability]`, and
exits 1. The third runs the whole suite with no install: this repository
declares no dependencies and imports nothing but `node:` builtins.

`node vendor-agent.mjs fetch <domain>` fetches a live document the way a
stranger would — https only, one path (`/.well-known/agent`, no `.json`
alternate), a timeout, a size cap, redirects only to the domain asked for or a
subdomain of it — and tells `absent` (the host answered 404) apart from
`unreachable` (the host did not answer).

## What makes it different

**Capabilities are verbs.** `quote`, `book`, `refund` — never `sales`,
`support`, `finance`. A department tells an agent who to talk to; an action
tells it what it can do. The id rule is `^[a-z][a-z0-9-]*$` plus a denylist of
eight department words, and both are refused by name rather than by taste.

**Endpoints stay on the organisation's own domain.** Every endpoint's host must
be the document's `domain` or a subdomain of it — never a parent, a sibling or
a stranger. A document may not point agents at another company's endpoints,
whatever the arrangement between them; the other company publishes its own
document. The rule is deliberately not "same registrable domain": there is no
Public Suffix List here, so the checker cannot tell `co.uk` from `example.com`
and refuses to guess. The rule itself is `vendor-domain.mjs`, canonical in the
`agent-dns` repository and vendored here byte-identically; re-vendor, never
edit the copy.

**Prices are whole minor units with a currency.** `{ "amount": 2500,
"currency": "GBP" }`. A float is refused, a bare number is refused, an amount
with no currency is refused, and a price with no way to pay is refused.

**An accountable human is required.** A name and a mailbox somebody reads.
The template placeholder is refused. An interface nobody answers for is one
nobody can be asked to stop.

**The checker refuses; it does not guess.** Unknown keys are refused unless
`x-` prefixed. Fourteen refusals each have a vector named for them, and the
suite asserts every vector fails for exactly its rule and no other.

## Layout

| Path | What it is |
|---|---|
| `SPEC.md` | The specification: shape, field rules, refusals, serving and fetch rules, composition, what version 1 leaves out |
| `schema/agent-1.json` | JSON Schema, draft 2020-12. Structural; the cross-field rules live in the checker |
| `vendor-agent.mjs` | The canonical checker and consumer. `validate(doc)`, `fetchDocument(domain)`, and the CLI. Copied byte-identical wherever it travels, together with the next file |
| `vendor-domain.mjs` | The same-domain rule (`normalizeDomain`, `isSameDomain`, `sameDomainUrl`). **Not canonical here** — a byte-identical copy of `agent-dns/vendor-domain.mjs`; re-vendor, never edit |
| `vectors/` | The conformance corpus: `*-valid.json` must pass; every other file is named for the one rule that refuses it |
| `test/agent.test.mjs` | `node --test`: the corpus behaves, every rule is provoked through the real validator, the fetch rules run against an injected fetch, the schema and the checker agree |
| `test/vendor-drift.test.mjs` | Compares `vendor-domain.mjs` to the agent-dns canon byte for byte when that repository is checked out beside this one; reports unknown, not passed, when it is not |
| `scripts/lint.mjs` | Syntax-checks every `.mjs`, parses every `.json`, holds the brand-neutrality rule and the licence line |
| `CLAUDE.md` | What makes this repository different, for an agent working in it |

## Links

Sibling standards, by name — each is its own repository and its own question:

- `intent/1` — what an agent wants, before it finds who can serve it
- `ritual/1` — the recurring, witnessed act; the present tense of the record
- `aao/0.1` — the charter: roles, the accountable human, escalation
- `delegation/1` — the verifiable chain of attenuated authority `agent/1` names as an auth method
- `agent-dns/1` — how the document's domain is located from a DNS record
- `frontdoor/1`, `directory/1`, `flashyos/1` — the formats `agent/1` composes with rather than restates (`SPEC.md` § 5)

## Status

Status: draft. The format and its checker are complete enough to run and to
disagree with; no organisation outside the repositories that wrote it has been
verified serving a document, and that number is printed rather than rounded
up.

Licence: to be declared at launch. The estate licence register in flashyos governs; this repository is not yet open-sourced.
