# Contributing to agent-wellknown

## The most useful thing you can send

**An implementation that disagrees with ours about a refusal.** Two
implementations that have never met agreeing about what to reject is the only
real evidence a specification says what it means. If yours accepts a document
in `vectors/` that ours refuses, or refuses one ours accepts, open an issue
with the document and both verdicts — the *spec change* template is for
exactly that.

## Before you open a pull request

No install. Both commands run on a clean checkout with Node 22:

```bash
npm run lint
npm test
```

## Spec first — the order a rule lands in

A rule that exists in the checker and not the spec is a surprise; a rule that
exists in the spec and not the checker is a sentence. Land them in this order,
in one pull request:

1. `SPEC.md` — the rule, in the field-rules table and in § 3 with its rule code.
2. `schema/agent-1.json` — the structural half, where JSON Schema can express it.
3. `vendor-agent.mjs` — the refusal, with the rule code from step 1 and a
   message that says what was found and why it is refused.
4. `vectors/<rule-code>.json` — one document refused for that rule and no
   other. The suite asserts exactly one distinct rule code per vector, so a
   vector that also trips `unknown-key` is a mislabelled vector.
5. `test/agent.test.mjs` — a unit test that provokes the rule through
   `validate()`, not one that greps a file for a string.

Relaxing a rule runs the same list backwards and is an `agent/2` question
(`SPEC.md` § 6).

## What stays out

Company and product names, inside the format. `npm run lint` scans the spec,
schema, checker and vectors and fails on a hit. Contract names are fine.

## Sign-off

Sign your commits with `git commit -s`. There is no CLA and you assign
copyright to nobody. The licence this repository will carry is declared in the
estate register in flashyos, not here.

## What gets a pull request rejected

Nothing, silently. If a change is not right for this repository you get a
reason, on the pull request, where the next person can read it.
