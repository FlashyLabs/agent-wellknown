# Security

## Reporting

Report a vulnerability privately to **security@flashylabs** — note: this
address is to be confirmed before launch; until it is, use GitHub's
**Report a vulnerability** button on this repository's Security tab, which
opens a private advisory only the maintainers can read.

Do not open a public issue for a vulnerability.

## What to expect

| | |
|---|---|
| Acknowledgement | within 3 working days |
| First assessment | within 10 working days |
| Fix, or a stated reason there will not be one | within 90 days |

If we miss one of those, say so publicly.

## Scope

The checker (`vendor-agent.mjs`), the consumer fetch rules it implements, the
schema and the vectors. Of particular interest:

- a document the checker **accepts** that sends an agent somewhere the rules
  say it must not — an http endpoint, another registrable domain, a URL with
  userinfo;
- a consumer path that **follows** a redirect the rules say it must refuse,
  or reads past the size cap;
- a way to make `absent` and `unreachable` read the same.

## What is not a vulnerability here

A rule you consider unwise is a specification disagreement — open a spec
change issue, because that conversation belongs in public. A published
document proving less than a reader assumes is **the stated design**:
publishing a file at a domain proves that somebody can write to that host, and
it never proves an organisation is who it says it is (`SPEC.md` § 0).
