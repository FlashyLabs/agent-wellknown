# agent/1 — the discovery document at `/.well-known/agent`

Status: **draft**. Contract name `agent/1`. Nothing outside the repositories
that wrote this has been verified serving one, and this document says so
rather than rounding up.

## 0 · What it is for

A human sees `company.com`. An agent fetches
`https://company.com/.well-known/agent` and learns, without a conversation:

- **who is accountable** — an organisation id and a named, reachable human;
- **what it may do** — a list of action verbs, `quote`, `book`, `refund`;
- **where each action lives** — an https endpoint on the organisation's own
  domain, with a schema for each;
- **what each action costs** — whole minor units and a currency code;
- **how to pay** and **how to authenticate**;
- **the policies** — rate limits, jurisdictions served, human-approval
  thresholds;
- **where the organisation's other machine surfaces are** — its `flashyos/1`
  handshake and `frontdoor/1` door, when it publishes them.

That is the whole of version 1. It is a discovery document: it tells an agent
what exists and where. It does not negotiate, execute, or settle anything —
see § 7.

Publishing the document at a domain proves that somebody can write to that
host. It does not prove the organisation is who it says it is, and no consumer
should treat it as though it did. Where authority is needed it is delegated
and verified through a `delegation/1` chain, which this document may name as
an accepted authentication method and never replaces.

## 1 · The document

```json
{
  "contract": "agent/1",
  "domain": "example.com",
  "org": "org/example",
  "accountable": { "name": "Ada Example", "email": "ada@example.com" },
  "updated": "2026-09-28",
  "capabilities": [
    {
      "id": "quote",
      "description": "Price a job from a structured brief. Free; returns a quote id.",
      "method": "POST",
      "endpoint": "https://api.example.com/agent/quote",
      "schema": "https://api.example.com/agent/quote.schema.json"
    },
    {
      "id": "book",
      "description": "Book a quoted job. Charged per booking.",
      "method": "POST",
      "endpoint": "https://api.example.com/agent/book",
      "schema": "https://api.example.com/agent/book.schema.json",
      "price": { "amount": 2500, "currency": "GBP", "per": "booking" }
    },
    {
      "id": "refund",
      "description": "Refund a booking within the policy window.",
      "method": "POST",
      "endpoint": "https://api.example.com/agent/refund",
      "schema": "https://api.example.com/agent/refund.schema.json",
      "price": { "amount": 0, "currency": "GBP" }
    }
  ],
  "auth": [
    { "method": "delegation/1", "issuer": "https://id.example.com", "scopes": ["agent:quote", "agent:book", "agent:refund"], "detail": "A delegation chain rooted in a person or organisation this domain recognises." },
    { "method": "api-key", "detail": "Issued on request to the accountable human." }
  ],
  "payment": [
    { "method": "card", "currencies": ["GBP", "EUR"], "terms": "https://example.com/terms" },
    { "method": "invoice", "currencies": ["GBP"], "detail": "Net 30, organisations only." }
  ],
  "policies": {
    "rateLimit": { "requests": 60, "per": "minute" },
    "jurisdictions": ["GB", "IE"],
    "humanApprovalAtOrAbove": { "amount": 50000, "currency": "GBP" },
    "humanApprovalFor": ["refund"],
    "terms": "https://example.com/agent/policies"
  },
  "handshake": "https://example.com/.well-known/flashyos.json",
  "frontdoor": "https://example.com/.well-known/frontdoor.json",
  "x-vendor-note": "Extension keys are carried and never checked."
}
```

This is `vectors/full-valid.json`, and it validates. The smallest
document that validates is `vectors/minimal-valid.json`: contract, domain,
org, accountable, updated, one capability, one auth method.

## 2 · Field rules

Every object in the document — the root, a capability, a price, a method, the
policies — admits exactly the keys below plus any key prefixed `x-`. An `x-`
key is carried and never checked. Any other key is refused (`unknown-key`):
a field the checker does not know is a field it cannot check.

### Root

| Field | Required | Rule |
|---|---|---|
| `contract` | yes | Exactly `"agent/1"` |
| `domain` | yes | The lowercase DNS hostname this document speaks for — the host it is served from, or a parent of it that the publisher also controls. No scheme, path or port; at least two labels; alphabetic top-level label (so no IP literal). When fetched, it must be the domain the consumer asked for or a subdomain of it (`domain-mismatch`): a document may not claim a parent of the domain it was fetched for |
| `org` | yes | `^org/[a-z0-9]+(-[a-z0-9]+)*$` — the estate id grammar, the same `org/<slug>` a `directory/1` node carries |
| `accountable` | yes | `{ name, email }`. `name` is a non-empty string naming a person; `email` matches `^[^@\s]+@[^@\s.]+\.[^@\s]+$` (the `aao/0.1` shape). The template placeholder `you@example.com` is refused (`placeholder-contact`). Missing or malformed → `no-accountable-human` |
| `updated` | yes | `YYYY-MM-DD`, and a real date |
| `capabilities` | yes | Non-empty array of capability objects; `id`s unique (`duplicate-capability`) |
| `auth` | yes | Non-empty array of method objects. Required so that silence never reads as open — an unauthenticated interface says `{ "method": "none" }` |
| `payment` | when priced | Non-empty array of method objects. Required if any capability carries a `price` (`price-without-payment`) |
| `policies` | no | Object, see below |
| `handshake` | no | https URL of the organisation's **own** `flashyos/1` handshake — its host is `domain` or a subdomain of it (`cross-domain-endpoint`) |
| `frontdoor` | no | https URL of the organisation's **own** `frontdoor/1` door — its host is `domain` or a subdomain of it (`cross-domain-endpoint`) |

### A capability

| Field | Required | Rule |
|---|---|---|
| `id` | yes | Matches `^[a-z][a-z0-9-]*$` (`capability-not-verb`) **and** is not one of `sales`, `marketing`, `engineering`, `operations`, `support`, `finance`, `legal`, `hr` (`department-capability`). A regex cannot tell a verb from a noun, so the format refuses by name the nouns actually offered as capabilities. "sales" tells an agent who to talk to; "quote" tells it what it can do |
| `description` | no | Non-empty string |
| `method` | no | One of `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| `endpoint` | yes | An https URL (`http-endpoint` for http, `bad-endpoint` for anything else that is not a clean https URL — userinfo, an explicit port, an IP literal) whose host is the document's `domain` or a subdomain of it (`cross-domain-endpoint`) |
| `schema` | yes | An https URL to the request/response schema for this endpoint (`no-schema-link`, `bad-schema-link`). It may live on any host: a schema is a description, not a door |
| `price` | no | A price object |

### A price

Used by `capabilities[].price` and `policies.humanApprovalAtOrAbove`.

| Field | Required | Rule |
|---|---|---|
| `amount` | yes | A non-negative safe integer of **minor units** — 2500 is 25.00 in a two-decimal currency. A float, a string, a negative or a bare number in place of the object is `float-price` |
| `currency` | yes | `^[A-Z]{3}$`. Missing or malformed is `no-currency`: an amount with no currency is a number, not a price |
| `per` | no | Non-empty string naming the unit priced: `request`, `booking`, `minute` |

### An auth method

| Field | Required | Rule |
|---|---|---|
| `method` | yes | `^[a-z][a-z0-9-]*(\/[0-9]+)?$` — a token, optionally naming a versioned standard: `none`, `api-key`, `oauth2`, `delegation/1`. Unique within the list (`duplicate-method`) |
| `issuer` | no | https URL |
| `scopes` | no | Array of non-empty strings |
| `detail` | no | Non-empty string |

### A payment method

| Field | Required | Rule |
|---|---|---|
| `method` | yes | Same token rule as an auth method: `card`, `invoice`, `wallet`, or a versioned standard. Unique within the list |
| `currencies` | no | Non-empty array of `^[A-Z]{3}$` codes (`no-currency`) |
| `terms` | no | https URL |
| `detail` | no | Non-empty string |

### Policies

| Field | Required | Rule |
|---|---|---|
| `rateLimit` | no | `{ requests, per }` — a positive integer and one of `second`, `minute`, `hour`, `day` |
| `jurisdictions` | no | Non-empty array of ISO 3166-1 alpha-2 codes, `^[A-Z]{2}$` |
| `humanApprovalAtOrAbove` | no | A price object: at or above this amount a human on the serving side approves before execution |
| `humanApprovalFor` | no | Array of capability ids that always require human approval. Each must be declared in `capabilities` (`approval-unknown-capability`) |
| `terms` | no | https URL |

### The same-domain rule

An endpoint, a `handshake` or a `frontdoor` is "the organisation's own" when
its host is the document's `domain` **or a subdomain of it** — compared
case-insensitively, a trailing dot ignored, and nothing else:

> `host` is the same domain as `domain` when `host` equals `domain` or ends
> with `.` followed by `domain`.

So a document for `example.com` may point at `example.com`, `api.example.com`
or `eu.api.example.com`; a document for `acme.co.uk` may point at
`www.acme.co.uk`. It may **not** point at a parent (`shop.example.com` →
`example.com`), a sibling (`shop.example.com` → `api.example.com`), a
lookalike (`example.com.evil.example`) or a stranger. A publisher whose
endpoints sit on a sibling host puts `domain` at the parent both share and
serves the document for it.

This is deliberately **not** "same registrable domain". A dependency-free
checker cannot carry the Public Suffix List, and without one a resolver cannot
tell `co.uk` from `example.com`: the label-slice rule this section used to
state read `acme.co.uk` and `other.co.uk` as one publisher. The checker
refuses rather than guesses. Everything this rule admits, a PSL-based rule
would admit too.

The rule is not written here. It lives in `vendor-domain.mjs`
(`normalizeDomain`, `isSameDomain`, `sameDomainUrl`), **canonical in the
`agent-dns` repository** and vendored into this one byte-identically;
`test/vendor-drift.test.mjs` compares the copy against that canon when it is
checked out beside this repository and reports unknown when it is not. The
same file is vendored into every other specification and implementation in
this neighbourhood that asks the question, so `agent/1`, `agent-dns/1`, a
gateway deriving a document and a consumer following a redirect all answer it
identically. Re-vendor; never edit the copy.

## 3 · Refusals

The checker refuses; it does not guess. Every refusal carries a stable rule
code, and every code in the first group has a vector in `vectors/` named for
it — the test suite asserts each vector is refused for exactly that rule.

| Rule | What was found |
|---|---|
| `http-endpoint` | An endpoint whose scheme is `http`. A door an intermediary can rewrite |
| `department-capability` | A capability id from the department denylist. Who to talk to, not what to do |
| `no-accountable-human` | `accountable` missing, or not `{ name, email }` with a person's name and a valid email |
| `float-price` | An amount that is not a non-negative safe integer, or a price that is not an object |
| `no-currency` | A price or payment method with a missing or malformed currency code |
| `cross-domain-endpoint` | An endpoint, handshake or frontdoor whose host is not `domain` or a subdomain of it — a stranger, a parent or a sibling |
| `unknown-key` | A key the format does not know, at any level, without an `x-` prefix |
| `capability-not-verb` | A capability id that does not match `^[a-z][a-z0-9-]*$` |
| `wrong-contract` | `contract` is not `agent/1` |
| `price-without-payment` | A capability carries a price and no `payment` section exists |
| `approval-unknown-capability` | `policies.humanApprovalFor` names a capability the document does not declare |
| `placeholder-contact` | The accountable email is the template placeholder |
| `duplicate-capability` | Two capabilities share an id |
| `no-schema-link` | A capability has no `schema` |

Structural refusals without a dedicated vector, each provoked by a unit test:
`not-an-object`, `missing-field`, `bad-domain`, `bad-org`, `bad-date`,
`no-capabilities`, `no-endpoint`, `bad-endpoint`, `bad-schema-link`,
`bad-method`, `duplicate-method`, `bad-field`, `domain-mismatch`.

## 4 · Discovery and serving

### Serving

The document is served at `https://<domain>/.well-known/agent` — that path
and no other. There is no `.json` spelling: a host whose static file serving
needs an extension configures a rewrite, because a consumer that has to try
two paths cannot tell "absent" from "spelled differently". Serve it as
`application/json`, whole, verbatim — never a derived summary. The `domain`
field is the domain the document speaks for.

A document served from `shop.example.com` may say `"domain":
"shop.example.com"` and point at `api.shop.example.com`. It may **not** point
at `api.example.com` — a sibling — nor at `example.com`, the parent; the
organisation that controls `example.com` publishes the document for
`example.com`, which may then point at every host under it. It may not point
at `other-company.example`, whatever the commercial arrangement — an
organisation that wants agents sent elsewhere has that other organisation
publish its own document.

### Consumer fetch rules

A consumer fetches the way a stranger would, and these rules are the whole of
it. They are exported as `FETCH_DEFAULTS`, `WELL_KNOWN_PATH` and
`redirectAllowed()` and implemented by `fetchDocument()`:

1. **https only, one path.** The request is to
   `https://<domain>/.well-known/agent` and nothing else. Nothing is ever
   requested over http, and no alternate spelling is tried.
2. **A timeout** (default 5000 ms) **and a size cap** (default 65536 bytes).
   A body over the cap is refused whether declared in `content-length` or
   discovered while streaming; the read stops at the cap.
3. **Redirects are followed only to `<domain>` or a subdomain of it and only
   to https**, and at most 3 times. Every hop is measured against the domain
   the consumer asked for, not against the previous hop. A redirect that
   leaves either is refused and the target is never requested.
4. **`absent` and `unreachable` are different findings**, and a consumer must
   keep them apart:

   | Finding | Meaning |
   |---|---|
   | `found` | 200 and JSON at the path. Validity is a *separate* answer, carried as `valid` and `errors`; `validate()` is run with the domain asked for so `domain-mismatch` applies |
   | `absent` | The path answered 404 or 410. The host has no agent interface |
   | `unreachable` | DNS, TCP, TLS or timeout failure. Says nothing about the host's intent; an outage is not a refusal to serve |
   | `refused` | The consumer stopped: off-domain or off-https redirect, too many redirects, body over the cap, or a 200 that is not JSON |
   | `error` | Any other HTTP status |

   Conflating `absent` with `unreachable` turns a network fact about the
   consumer into a claim about the organisation.

`node vendor-agent.mjs fetch <domain>` runs exactly these rules and exits 0
when the document is found and valid, 2 when it is absent, and 1 otherwise.

### Locating the document

The well-known path is the location. How a consumer discovers *which* domain
to ask — from a DNS record on a name it already holds — is `agent-dns/1`'s
question, not this format's. This document does not carry DNS material.

## 5 · Composition

`agent/1` sits beside four formats and duplicates none of them.

| Format | What it answers | How agent/1 relates |
|---|---|---|
| `flashyos/1` | The mesh handshake: this property, its charter roles and their capabilities | `handshake` links to it. Its `capabilities` are *role* capabilities — what the organisation's own roles may do in its governance. `agent/1` capabilities are *actions an outside agent may invoke*. The two vocabularies are different on purpose and a consumer must not match one against the other |
| `frontdoor/1` | How a **human** engages: lanes, rungs, what each rung buys, the `notAuthority` caution | `frontdoor` links to it. The door is for a person with a question; `agent/1` is for a machine with a task. Neither restates the other |
| `directory/1` | Nodes and edges: who delegated what to which agent, asserted by whom, expiring when | `org` uses the same id grammar so a `directory/1` node and an `agent/1` document name the same organisation the same way. The document carries no edges — a `delegatedTo` fact belongs in the directory |
| `delegation/1` | A verifiable chain of attenuated authority from a root to an acting agent | Named as an `auth[].method`. `agent/1` says *that* a chain is accepted and where the issuer is; verifying one is `delegation/1`'s job. This document is never itself evidence of authority |
| `aao/0.1` | The charter: roles, accountable human, escalation | `accountable.email` uses the charter's `accountableTo` shape so one person can answer for both files |

## 6 · Versioning

`contract` is the version. A change that would make a valid `agent/1`
document invalid, or make the checker accept something it refuses today, is
`agent/2`. Adding an `x-` key is never a version change. Adding a new
top-level key without the prefix is.

## 7 · What version 1 does not carry

- **No negotiation protocol.** How an agent and an endpoint agree a price,
  a scope or a time is between the agent and the endpoint's schema.
- **No execution semantics.** The document says an action exists and where;
  what a call does, returns, or is idempotent under is the endpoint's schema.
- **No settlement.** A `price` is a declared amount, not a ledger entry, a
  quote, or a promise to hold it.
- **No identity proof.** See § 0. A document at a host proves control of the
  host.
- **No DNS material.** See § 4, *Locating the document*.
- **No signatures or sealing.** A signed or checkpointed document is a
  candidate for version 2 and will reuse an existing sealing rule rather than
  state a new one.

Discovery only. A consumer that reads more than that into the document is
making a claim the document does not.
