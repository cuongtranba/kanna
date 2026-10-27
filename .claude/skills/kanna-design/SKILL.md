---
name: kanna-design
description: Designs and refactors Kanna code by A Philosophy of Software Design — deep modules, information hiding, one owner per decision, no pass-through layers, errors defined out of existence — and owns the architecture ratchets that hold those gains (bun run check:arch). Use when adding a module, function, store, WS command, setting, event or protocol string; when a change has to edit the same rule in several files; when deciding where new code belongs; when reviewing a design or a PR for structure; or when check:arch reports a population that "grew to N (pinned at M)", "dropped to N", a module over 700 lines, or a raised lint ceiling.
---

# Designing code in Kanna

Complexity is anything that makes the system hard to change: change amplification (one
change, many edits), cognitive load (how much a reader must hold), and unknown unknowns
(what a reader cannot see they must change). Every change either pays it down or adds to
it. A full audit of this codebase found 380 defects; 146 were the same rule restated in
several places and 98 were one decision known by several modules. Those two are what to
watch for first.

## Contents

- Before writing code
- Red flags, with Kanna examples
- Where things belong in Kanna
- Ratchets: the hard gate
- Review checklist

## Before writing code

1. **Name the decision** the change embodies: a format, a bound, a vocabulary, a protocol
   string, an ordering, a policy.
2. **Find its owner.** `grep` for the literal and for its meaning. If an owner exists, call
   it. If two copies exist, merge them before adding a third.
3. **No owner? Create one** in the lowest layer that knows the decision, with an interface
   simpler than its implementation. Callers ask a question; they do not re-derive the answer.
4. **Pull complexity down.** If every caller would pass the same option, check the same
   null, or catch the same error, the module should do it once.

## Red flags, with Kanna examples

| Red flag | What it looked like here | The fix |
| --- | --- | --- |
| Repetition | "send command, set or clear `commandError`" written ~50 times in the client | One helper the callers call |
| Information leakage | `"kind" in event` probed in three modules to spot the auto-continue variant | `isChatAutomationEvent` in `events.ts`, which owns the union |
| Pass-through method | 49 `AgentCoordinator` methods whose body is `return xFn(this.xDeps(), …)` | Callers reach the owning module; delete the forward |
| Pass-through variable | 38 handlers threaded through `KannaSidebar` props it never reads | A context or store read where the value is used |
| Errors not defined away | A WS setter throws on a bound that the file loader clamps | One bound definition; each boundary derives its policy from it |
| Restated vocabulary | A closed set spelled as type, runtime list, zod enum and hand guard | One `as const` tuple; derive the type, schema and guard from it |
| Temporal decomposition | One settings section split across type, normalize and merge phases | Group by knowledge (one module per section), not by phase |
| Shallow module | A wrapper whose interface is as wide as what it wraps | Delete it, or give it a decision to own |
| Special-general mixture | Generic Dialog/Popover hard-coding chat-input focus restoration | Inject the special case at the call site |
| Non-obvious code | Run outcomes encoded as Error message strings and decoded by comparison | A discriminated union |

A name you cannot make precise is a design smell: `utils.ts`, `helpers`, `*-misc` collect
code with no shared decision. Split by what each piece knows.

Not a red flag: an adapter method implementing a port over a resource
(`close() { socket.close() }`) hides the resource; keep it. Length alone is not a defect.
Split a module when it owns two decisions, not when it is long.

## Where things belong in Kanna

- **A shared contract** (type, vocabulary, schema, command result) lives once in
  `src/shared/`. Server and client import it; neither restates it.
- **IO** lives in `*.adapter.ts` behind a typed port. Domain modules take the operation as
  a parameter, which is also what makes them testable without mocks.
- **A WS command** declares its `result` schema in `src/shared/commands/`; the handler
  answers through `ackResult`, so no reply shape can drift.
- **Client state transitions** are named store actions, not JSX logic. A per-instance
  store is scoped, never module-global.
- **A setting** has one bound or default definition. File load, WS write and client
  editor all read it.

## Ratchets: the hard gate

`bun run check:arch` (`src/ops/architecture/budget.ts`) pins every measured defect
population. Growth fails. Shrinking fails until the pin is lowered, so a gain cannot be
quietly given back.

| Ratchet | Semantics |
| --- | --- |
| `PATTERN_BUDGETS` | Exact pin per production defect pattern, each with its issue and rationale |
| `TEST_PATTERN_BUDGETS` | Exact pin per test-policy defect: mocks, global patches, sleeps, `.only`/`.skip`, double casts, nested describes |
| `COUNT_BUDGETS` | Exact pin per counted population: `leaked-protocol-literals` (env names, routes, bus subjects, storage keys hard-coded in two or more modules) and `code-clones` (duplicated 8-line windows across production modules, measured by `src/ops/architecture/duplication.ts`) |
| `MODULE_ALLOWANCES` | Ceiling per module over 700 lines; delist once under |
| `LINT_LIMIT_PINS` | Equals the configured complexity, max-params, max-depth and nesting ceilings; `bun run lint:limits` proves each is tight |

Reading a breach:

- **`grew to N (pinned at M)`**: the change added a defect. Remove it. Never raise a pin;
  the message names the issue the change regresses.
- **`dropped to N`**: the change removed defects. Set the pin to `N` in the same PR.
- **`scanned no files`**: the include path is stale. Repoint it; never pin at 0.

A pattern must count the concept, not a spelling. If renaming would satisfy a budget, the
pattern is wrong: widen it. This already happened twice here. `deps-bundles` once counted
only `interface *Deps`, and `coordinator-passthroughs` read 0 for two months after a
rename while 50 forwarding methods remained.

## Review checklist

Run this against every change before calling it done:

```
- [ ] Each decision this change touches has exactly one owner (grep the literal and its meaning)
- [ ] No new forwarding layer: no method, prop or parameter whose only job is passing through
- [ ] Callers do not handle errors, nulls or options the module could handle once
- [ ] Every new name says what the thing knows; no utils/helpers/misc bucket
- [ ] bun run check:arch passes, and every pin that dropped was lowered in this PR
```

When an item fails, fix the design rather than the symptom, then run the checklist again.
