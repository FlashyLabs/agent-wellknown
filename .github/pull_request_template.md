### What this changes

### Why

### The rule it touches, if any

`SPEC.md` § Refusals lists every rule and `vectors/` carries one file per
refusal. If this change adds, removes or reshapes a rule, name it here and
say which vector changed with it. A rule with no vector is a sentence.

---

- [ ] `SPEC.md` changed first, then `schema/agent-1.json`, then `vendor-agent.mjs`, then a vector, then a test — see [CONTRIBUTING.md](../CONTRIBUTING.md)
- [ ] `npm run lint` and `npm test` pass with no install
- [ ] New behaviour has a test that provokes the behaviour, not one that greps a file for a string
- [ ] No company or product name entered the format (the lint checks this; say so anyway)
