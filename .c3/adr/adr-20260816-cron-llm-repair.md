---
id: adr-20260816-cron-llm-repair
c3-seal: db17ca85442d27961037357e03f6d0d18616e96ddfb7c4b71a9ee55f79120e01
title: cron-llm-repair
type: adr
goal: 'When a `/cron` line fails validation and Kanna has no deterministic fix for it, hand the line to the model instead of dead-ending: it repairs and arms the job through a new `arm_cron` tool, or asks the user with `AskUserQuestion` when their intent is genuinely ambiguous. Record the offending line on the error entry so both the reader and the model can see what was typed. Escalation happens only where the parser produced no suggestion, so the existing zero-cost error card stays the fast path.'
status: accepted
date: "2026-08-16"
---

## Goal

When a `/cron` line fails validation and Kanna has no deterministic fix for it, hand the line to the model instead of dead-ending: it repairs and arms the job through a new `arm_cron` tool, or asks the user with `AskUserQuestion` when their intent is genuinely ambiguous. Record the offending line on the error entry so both the reader and the model can see what was typed. Escalation happens only where the parser produced no suggestion, so the existing zero-cost error card stays the fast path.

## Context

`/cron` always intercepts and never starts a turn, so a rejected line was terminal Kanna state. Chat `39b0d210-c5fd-4e76-9ba4-ed0ee2c522c0` is the whole cost: three `cron_command_error` entries in 34 seconds — one `missing mode`, then `cron schedule has 3 fields, expected 5` twice — and the user gave up. Three defects compounded. (1) The typed line was recorded nowhere: no `user_prompt` is appended on this path, and `CronCommandErrorEntry` carried only the message, so the transcript names a defect in a line no one can see. (2) None of the three carried a suggestion — `parseCronFields` emitted `correctedSchedule` for 4-field, 6-field and bare-interval cases only, so a 3-field schedule fell through bare and the Copy-fix affordance never rendered. (3) The model was never involved, so nothing could recover the user's intent.

The mermaid validation gate already solves this shape for model-authored defects: a cheap deterministic layer plus an in-turn `validate_mermaid` oracle, with an escalation bounded so it fires only when the reader would otherwise be stuck. Here the failing author is the user rather than the model, but the structure transfers.

## Decision

Mirror the mermaid gate, with the parser as the deterministic layer.

`CronParseError` gains a required `input`. `parseCronCommand` stamps it once on the way out over a new internal `Outcome` type whose error omits it, so no failure path can record a defect without the line that caused it and a newly added path cannot compile without one. `parseCronFields` gains wildcard padding for 2-to-4-field schedules, offered only when the padded form actually parses — `0 3` becomes `0 3 * * *`, while English like `9am every day` yields nothing and escalates.

Two MCP tools mirror `validate_mermaid`. `validate_cron` takes a complete `/cron` line and answers with the schedule in words plus the next three real fire times; `arm_cron` arms one. Both answer from a single `previewCronCommand`, so the model can never be told a line is valid by one tool and refused by the other, and both run the same parser the send pipeline uses. `validate_cron` gates on a chat alone; `arm_cron` additionally needs an injected capability the spawner supplies for main chats only, like `setup_loop` — a subagent's chat is ephemeral and must not leave recurring work behind. `AgentCoordinator.armCron` refuses anything that is not an armable line rather than dispatching it, which structurally closes the loop where a model answers its own repair prompt with another bad line.

`createCronRepair` is the escalation, shaped like `createMermaidGuard`. Four bounds, each load-bearing: it stands down when the parser produced a suggestion (the card already offers a free fix); it covers arm-shaped failures only, not management-subcommand typos; it asks about a given line exactly once per chat, in bounded memory; and it swallows its own failures. Unlike the mermaid guard it also drains the queue, because `/cron` starts no turn and nothing else would ever pick the prompt up. `KANNA_CRON_REPAIR=disabled` turns it off.

Dispatch refuses through one new choke point, `refuseCronCommand`, so the card the reader sees and the offer to the model are a single step. A schedule that parses but has no occurrence (Feb 30) escalates too, on a reconstructed canonical line — it is equally an invalid setup the user meant something by.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-311 | component | CronParseError gains a required `input` stamped in one place; parseCronFields gains validated short-cron padding; new repair-report.ts owns the words both the tool result and the repair prompt speak | c3-311#n11171@v1:sha256:d66739d6550868c0459462e9872b49ef3502f865dad8d386665316784eaee953 | Side-effect seal: repair-report.ts is pure, no IO; strong-typing on the Outcome/CronParseError split |
| c3-233 | component | New repair.ts (escalation) and preview.ts (the shared validate/arm answer); runCronCommand refuses through one choke point that both cards and escalates | c3-233#n10713@v1:sha256:1920bd4791bc0e60018aa1c109ca22f40ab35b616c3946b467a897558d30fca4 | Side-effect seal: repair takes enqueue/drain/hasQueued as injected deps, no direct IO |
| c3-226 | component | Publishes the two new mcp__kanna__ tools, validate_cron and arm_cron | c3-226#n10277@v1:sha256:c7f023a1e96fe0083d70efefaea470092cf828ab4d822b1ed1cc46c7c453f3bc | Tool surface contract: arm_cron gated on an injected capability supplied for main chats only |
| c3-120 | component | CronCommandErrorMessage renders the typed line, the only surface on which it can appear | c3-120#n8876@v1:sha256:f7a5e141225fcbed4fe2f1b26d273f0216b3fcf3029dcfd5678f4767ee55cbf0 | Design-system gate: token classes only, no arbitrary hex, no backdrop-blur |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Escalate every invalid /cron to the model | Spends a turn on cases the parser already solves instantly and for free — a typo'd `inlne` has one right answer and a Copy-fix card. The mermaid guard's equivalent bound (stand down when the client's repair saves the diagram) exists for the same reason. |
| Model proposes a corrected line, never arms | The user in 39b0d210 already failed to type the line three times; handing back a fourth line to retype is barely better than today's card. The value is in the model finishing the job. |
| Model always confirms with AskUserQuestion before arming | Adds a click to every unambiguous repair. The model asks where intent is genuinely ambiguous, which is the case the confirmation was protecting against. |
| Only fix the parser (padding, better suggestions) | Closes `0 9 *` but not `9am every day` or a missing mode with no parseable suffix — both of which the debugged chat actually hit. Deterministic coverage was widened anyway, as the cheap half. |
| Append a user_prompt for the failed line | Would make a rejected command look like a prompt the model received, and still leaves the entry unable to name its own input when read alone. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| The model arms a recurring job the user did not intend | arm_cron re-parses through the same grammar and refuses anything non-armable; the prompt requires AskUserQuestion when mode or time is ambiguous; every armed job is visible in the footer panel and removable with /cron remove | src/server/kanna-mcp.test.ts arm_cron refusal cases; src/shared/cron/repair-report.test.ts pins the ask-when-ambiguous instruction |
| A repair turn triggers another repair turn | arm_cron never re-enters dispatch on failure (AgentCoordinator.armCron throws instead), the repair prompt's first token is not /cron so it cannot re-intercept, and each line is offered at most once per chat | src/server/cron/repair.test.ts "asks about a given line exactly once" |
| The escalation spends turns on lines Kanna could fix | The repair stands down whenever error.suggestion is present, and on management-subcommand parts | src/server/cron/repair.test.ts "spends no turn when the parser produced a suggestion" |
| Padding invents a schedule the user did not mean | Padding is offered only when the padded form parses, and every suggestion still passes the existing re-parse drift guard | src/shared/cron/parse-command.test.ts padding + drift-guard tests |
| A repair failure breaks the send path | createCronRepair swallows enqueue and drain failures and logs | src/server/cron/repair.test.ts "swallows an enqueue failure" / "swallows a drain failure" |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| Outcome type in parse-command.ts | A failure path that does not stamp `input` does not compile — the internal type omits it and only parseCronCommand adds it | src/shared/cron/parse-command.ts, bun run typecheck |
| refuseCronCommand | The single refusal path: appends the card and offers the line, so a new refusal cannot record one without the other | src/server/cron/commands.ts, src/server/cron/commands.test.ts |
| previewCronCommand | validate_cron and arm_cron share one answer, so the two tools cannot disagree about a line | src/server/cron/preview.ts, src/server/kanna-mcp.test.ts |
| repair-report.test.ts | Pins that the repair prompt names both tools, AskUserQuestion, the grammar, and the never-invent rule | src/shared/cron/repair-report.test.ts |
| KANNA_CRON_REPAIR | `disabled` turns the escalation off; the tools stay | src/server/agent-deps-builders.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run test | 6064 pass, 2 skip, 0 fail across 497 files, including 11 new repair tests, 10 new MCP tool tests, and new parser/report/card tests |
| bun run typecheck | Clean on TS7 |
| bun run lint | Clean at --max-warnings=0 (side-effect seal + design gate) |
| bunx ast-grep test && bun run lint:usestate | 14 passed, 0 failed; scan clean |
| Manual reproduction of chat 39b0d210 | `/cron check CI inline 9am every day` cards the typed line, then the model calls validate_cron and arm_cron and the job arms; `/cron ... inlne @daily` still cards instantly with no model turn |
