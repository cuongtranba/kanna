/**
 * The architecture budget: a ratchet over the structural-defect populations
 * that #889 is driving down.
 *
 * It exists because the previous complexity program (#674-#681) closed every
 * workstream as COMPLETED while its own metrics moved the wrong way — modules
 * over 700 lines went 18 -> 21 -> 23, and production LOC rose from ~121,700 to
 * ~125,779. Nothing in CI could observe that, so nothing objected.
 *
 * A pin here is a defect count, never a style preference. Raising one is a
 * visible diff that says "this PR made a filed issue worse".
 *
 * A budget GRADUATES rather than settling at a residue: once its issue lands and
 * the type system or a lint rule enforces the property permanently, delete the
 * entry. harness-optional-payload-guards was removed when #890 shipped the
 * HarnessEvent discriminated union (#908) — narrowing is now a compile error, so
 * a regex pin would only have counted false positives and implied a defect that
 * no longer exists.
 */

export const MODULE_LINE_THRESHOLD = 700

/**
 * Ceiling per oversized module — a listed module may shrink freely but never
 * grow past its pin, and a module that falls back under the threshold must be
 * delisted so the allowance cannot be reclaimed later.
 *
 * Deliberately a ceiling rather than an exact pin: this repo routinely has 15+
 * live worktrees, and exact line pins would turn every parallel edit to a large
 * module into a manifest merge conflict. The trade is that a module may shrink
 * and regrow within its allowance without objection; growth beyond it, and the
 * arrival of a new oversized module, are both still blocked.
 */
export const MODULE_ALLOWANCES: Readonly<Record<string, number>> = {
  "src/client/app/ChatPage/index.tsx": 738,
  "src/client/app/ChatPage/useChatPageSidebarActions.ts": 701,
  "src/client/app/KannaSidebar.tsx": 1007,
  "src/client/app/KannaTranscript.tsx": 1053,
  "src/client/app/SettingsPage.tsx": 2787,
  "src/client/app/SubagentsSection.tsx": 906,
  "src/client/app/useAppGlobalState.ts": 1472,
  "src/client/app/useKannaState.ts": 1447,
  "src/client/components/boards/CardDrawer.tsx": 830,
  "src/client/components/chat-ui/ChatInput.tsx": 1369,
  "src/client/components/chat-ui/RightSidebar.tsx": 2071,
  "src/client/stores/chatPreferencesStore.ts": 810,
  "src/server/agent-coordinator.ts": 1483,
  "src/server/app-settings.ts": 1897,
  "src/server/board-store.adapter.ts": 1364,
  "src/server/claude-pty/driver.ts": 1104,
  "src/server/codex-app-server.ts": 1023,
  "src/server/codex-transcript-translator.ts": 767,
  "src/server/event-store-messages.adapter.ts": 765,
  "src/server/kanna-mcp.ts": 1326,
  "src/server/server.ts": 775,
  "src/server/subagent-orchestrator.ts": 1375,
}

/** Paths excluded from the module scan: tests, fixtures and test doubles are not production surface. */
export const PRODUCTION_EXCLUDES: readonly string[] = [
  ".test.ts",
  ".test.tsx",
  ".live.test.ts",
  "/test-helpers/",
  "/__fixtures__/",
  "/testing/",
]

export interface PatternBudget {
  readonly id: string
  /** Path prefixes the scan reads; a prefix ending in `/` matches a subtree. */
  readonly include: readonly string[]
  /** Regex source, applied per line. */
  readonly pattern: string
  readonly max: number
  /** The issue that drives this population down. A breach names it. */
  readonly issue: number
  readonly rationale: string
}

export const PATTERN_BUDGETS: readonly PatternBudget[] = [
  {
    id: "deps-bundles",
    include: ["src/server/"],
    // Counts the CONCEPT, not one keyword: a named interface, a named type
    // alias, and an inline anonymous `deps: {` parameter are the same bundle.
    // The first version counted only `interface`, and #914 evaded it by
    // respelling one bundle as an inline type — renaming, not removing.
    pattern: "interface [A-Za-z]*Deps\\b|type [A-Za-z]*Deps\\b *=|deps: \\{$",
    max: 82,
    issue: 893,
    rationale:
      "Each deps bundle is a hand-maintained slice of the coordinator's fields. Every field is optional, so a builder that omits one compiles and the consumer's fallback is indistinguishable from the feature being off — this is how getArmedLoop shipped declared-but-never-passed. Respelling a bundle as a type alias or an inline parameter object removes nothing, so all three spellings count.",
  },
  {
    id: "coordinator-passthroughs",
    include: ["src/server/agent-coordinator.ts"],
    pattern: "Fn\\(this\\.build",
    max: 0,
    issue: 893,
    rationale:
      "A method whose whole body is `return xFn(this.buildYDeps(), ...)` adds interface without adding implementation, and costs three hops through two files to reach one line of logic.",
  },
  {
    id: "event-store-passthroughs",
    include: ["src/server/event-store.ts"],
    pattern: "this\\.build[A-Za-z]*Deps\\(\\)",
    max: 0,
    issue: 892,
    rationale:
      "Per-call deps bundles on EventStore. buildChatTranscriptWriteDeps alone allocates a 19-field literal with ~10 closures on every appendMessage, the hottest write path in the system.",
  },
  {
    id: "ws-router-dispatch-arms",
    include: ["src/server/ws-router.ts"],
    pattern: '^\\s*case "',
    max: 106,
    issue: 899,
    rationale:
      "A flat switch that must be edited to add a command, with no exhaustiveness check — an unrouted variant falls through to broadcastSnapshots() silently. A route table makes the same omission a compile error.",
  },
  {
    id: "untyped-command-results",
    include: ["src/client/"],
    pattern: "\\.command<",
    max: 60,
    issue: 899,
    rationale:
      "socket.command<TResult> takes the result type as a free parameter with no relation to the command passed, so every explicit type argument is an unchecked assertion and a handler changing its return shape breaks zero call sites at compile time.",
  },
  {
    id: "mcp-inline-tool-results",
    include: ["src/server/kanna-mcp.ts"],
    pattern: 'type: "text" as const',
    max: 0,
    issue: 897,
    rationale:
      "Hand-built MCP tool results. ok()/fail() helpers in kanna-mcp-tool.ts replace every hand-built content array; the pattern must not regress.",
  },
  {
    id: "escalation-memory-caps",
    include: ["src/server/"],
    pattern: "MEMORY_PER_CHAT\\s*=",
    max: 1,
    issue: 896,
    rationale:
      "The single cap lives in model-escalation.ts (DEFAULT_MEMORY_PER_CHAT). All three consumers (mermaid-guard, cron/repair, cron/confirm) delegate through ModelEscalation. A second declaration here means someone bypassed the abstraction.",
  },
  {
    id: "loop-prompt-tool-literals",
    include: ["src/server/loop-template.ts"],
    pattern: "mcp__kanna__",
    max: 1,
    issue: 902,
    rationale:
      "MCP tool names written as bare strings inside the rendered loop prompt, with no link to their registration. A rename passes requiredSubstrings, ships a prompt instructing a nonexistent tool, and burns a background subagent per iteration.",
  },
  {
    id: "settings-bound-throws",
    include: ["src/server/app-settings.ts"],
    pattern: "throw new Error\\(",
    max: 14,
    issue: 898,
    rationale:
      "Each restates a bound that a normalize* function also enforces, with opposite semantics — the WS path throws where the file path clamps, so the same out-of-range value is rejected or silently corrected depending on how it arrived.",
  },
  {
    id: "shared-types-star-exports",
    include: ["src/shared/types.ts"],
    pattern: "^export \\* from",
    max: 8,
    issue: 889,
    rationale:
      "types.ts re-exports eight modules wholesale, giving 227 importers a dependency on 306 declarations to use two or three. Extraction moved the code out but preserved the fan-in, so nothing in the import graph says which part of the domain a module touches.",
  },
]

export interface EslintLimitPin {
  readonly rule: string
  readonly max: number
  readonly issue: number
  readonly rationale: string
}

/**
 * ESLint measures per-function complexity far better than a regex can, so the
 * budget does not re-implement it — it owns the DIRECTION instead. Each pin must
 * EQUAL what eslint.config.js configures: raising the ceiling is a regression,
 * and lowering it without lowering the pin would leave slack to creep back into.
 *
 * Ceilings sit at today's production maxima, so they are unbreached but hard.
 * `bun run lint:limits` proves a ceiling is still TIGHT — a ceiling nothing
 * reaches is a ceiling that gates nothing.
 */
export const ESLINT_LIMIT_PINS: readonly EslintLimitPin[] = [
  {
    rule: "complexity",
    max: 132,
    issue: 893,
    rationale:
      "Cyclomatic complexity per function. The peak is runClaudeSession in claude-session-runner.ts (132). handleCommand dropped from 138 → 116 after the settings pre-dispatch refactor (#951).",
  },
  {
    rule: "max-params",
    max: 12,
    issue: 892,
    rationale:
      "The peak is deriveChatSnapshot's 12 positional parameters, six of them defaulted, so a caller wanting the last must spell out five it does not care about, and two adjacent Map parameters can be swapped with no type error.",
  },
  {
    rule: "max-depth",
    max: 7,
    issue: 893,
    rationale:
      "Nested block depth. The peak is again runClaudeSession, where the event loop's branches nest seven deep and no single concern can be read in isolation.",
  },
  {
    rule: "max-nested-callbacks",
    max: 4,
    issue: 897,
    rationale:
      "Nested callback depth in production code. The peak is in the MCP tool registration closures, where guard plus handler plus result mapping stack inside one factory.",
  },
]

/** This module and its scanner quote every budget regex as a string literal, so a budget that scanned them would count itself. */
export const SELF_EXCLUDED_PATHS: readonly string[] = [
  "src/ops/architecture/budget.ts",
  "src/ops/architecture/budget-scan.adapter.ts",
]

export const coveredBy = (relativePath: string, include: readonly string[]): boolean =>
  include.some((prefix) => (prefix.endsWith("/") ? relativePath.startsWith(prefix) : relativePath === prefix))

export interface ModuleMeasurement {
  readonly path: string
  readonly lines: number
}

export interface PatternMeasurement {
  readonly id: string
  readonly count: number
  readonly sites: readonly string[]
  /**
   * How many files the include paths actually reached. Zero means the gate read
   * nothing — a renamed target would otherwise report as a population that shrank
   * to zero, inviting someone to pin it at 0 and silently disable the check.
   */
  readonly filesScanned: number
}

export type BudgetBreach =
  | { readonly kind: "module_grew"; readonly path: string; readonly allowance: number; readonly actual: number }
  | { readonly kind: "module_unlisted"; readonly path: string; readonly threshold: number; readonly actual: number }
  | { readonly kind: "module_delistable"; readonly path: string; readonly threshold: number }
  | { readonly kind: "pattern_grew"; readonly id: string; readonly max: number; readonly actual: number; readonly issue: number }
  | { readonly kind: "pattern_shrank"; readonly id: string; readonly max: number; readonly actual: number; readonly issue: number }
  | { readonly kind: "pattern_unknown"; readonly id: string }
  | { readonly kind: "pattern_unmeasured"; readonly id: string }
  | { readonly kind: "limit_raised"; readonly rule: string; readonly max: number; readonly actual: number; readonly issue: number }
  | { readonly kind: "limit_slack"; readonly rule: string; readonly max: number; readonly actual: number; readonly issue: number }
  | { readonly kind: "limit_unpinned"; readonly rule: string; readonly actual: number }
  | { readonly kind: "limit_unconfigured"; readonly rule: string }

export function checkEslintLimits(
  configured: ReadonlyMap<string, number>,
  pins: readonly EslintLimitPin[] = ESLINT_LIMIT_PINS,
): BudgetBreach[] {
  const breaches: BudgetBreach[] = []
  const byRule = new Map(pins.map((p) => [p.rule, p]))

  for (const [rule, actual] of configured) {
    const pin = byRule.get(rule)
    if (!pin) {
      breaches.push({ kind: "limit_unpinned", rule, actual })
      continue
    }
    if (actual > pin.max) breaches.push({ kind: "limit_raised", rule, max: pin.max, actual, issue: pin.issue })
    else if (actual < pin.max) breaches.push({ kind: "limit_slack", rule, max: pin.max, actual, issue: pin.issue })
  }

  for (const pin of pins) {
    if (!configured.has(pin.rule)) breaches.push({ kind: "limit_unconfigured", rule: pin.rule })
  }

  return breaches
}

export function checkModuleBudget(
  measured: readonly ModuleMeasurement[],
  allowances: Readonly<Record<string, number>> = MODULE_ALLOWANCES,
): BudgetBreach[] {
  const breaches: BudgetBreach[] = []
  const oversized = new Map(measured.filter((m) => m.lines > MODULE_LINE_THRESHOLD).map((m) => [m.path, m.lines]))

  for (const [path, actual] of oversized) {
    const allowance = allowances[path]
    if (allowance === undefined) {
      breaches.push({ kind: "module_unlisted", path, threshold: MODULE_LINE_THRESHOLD, actual })
      continue
    }
    if (actual > allowance) breaches.push({ kind: "module_grew", path, allowance, actual })
  }

  for (const path of Object.keys(allowances)) {
    if (!oversized.has(path)) breaches.push({ kind: "module_delistable", path, threshold: MODULE_LINE_THRESHOLD })
  }

  return breaches
}

export function checkPatternBudget(
  measured: readonly PatternMeasurement[],
  budgets: readonly PatternBudget[] = PATTERN_BUDGETS,
): BudgetBreach[] {
  const breaches: BudgetBreach[] = []
  const byId = new Map(budgets.map((b) => [b.id, b]))
  const seen = new Set<string>()

  for (const { id, count, filesScanned } of measured) {
    const budget = byId.get(id)
    if (!budget) {
      breaches.push({ kind: "pattern_unknown", id })
      continue
    }
    seen.add(id)
    if (filesScanned === 0) breaches.push({ kind: "pattern_unmeasured", id })
    else if (count > budget.max) breaches.push({ kind: "pattern_grew", id, max: budget.max, actual: count, issue: budget.issue })
    else if (count < budget.max) breaches.push({ kind: "pattern_shrank", id, max: budget.max, actual: count, issue: budget.issue })
  }

  for (const budget of budgets) {
    if (!seen.has(budget.id)) breaches.push({ kind: "pattern_unmeasured", id: budget.id })
  }

  return breaches
}

export function formatBreach(breach: BudgetBreach): string {
  switch (breach.kind) {
    case "module_grew":
      return `${breach.path} grew to ${breach.actual} lines, past its ${breach.allowance}-line allowance.\n`
        + `  A module on this list is already too large to read. Put the new code in a module that owns it,\n`
        + `  or shrink this one. Raising the allowance in budget.ts makes a filed issue worse.`
    case "module_unlisted":
      return `${breach.path} is ${breach.actual} lines, over the ${breach.threshold}-line threshold, and is not in MODULE_ALLOWANCES.\n`
        + `  Split it before it lands. Adding an allowance grows the oversized-module set that #889 exists to shrink.`
    case "module_delistable":
      return `${breach.path} is now under ${breach.threshold} lines — delete its MODULE_ALLOWANCES entry in this PR.\n`
        + `  Leaving the allowance behind lets the module grow straight back to it unchallenged.`
    case "pattern_grew":
      return `"${breach.id}" grew to ${breach.actual} (pinned at ${breach.max}) — this PR regresses #${breach.issue}.\n`
        + `  ${rationaleOf(breach.id)}`
    case "pattern_shrank":
      return `"${breach.id}" dropped to ${breach.actual} (pinned at ${breach.max}) — lower the pin in this PR.\n`
        + `  Set max: ${breach.actual} in PATTERN_BUDGETS so the population cannot creep back up.`
    case "pattern_unknown":
      return `Measured "${breach.id}" has no PATTERN_BUDGETS entry.`
    case "limit_raised":
      return `eslint.config.js raised "${breach.rule}" to ${breach.actual} (pinned at ${breach.max}) — this PR regresses #${breach.issue}.\n`
        + `  ${eslintRationaleOf(breach.rule)}`
    case "limit_slack":
      return `eslint.config.js sets "${breach.rule}" to ${breach.actual} but the pin is still ${breach.max} — lower the pin in this PR.\n`
        + `  Set max: ${breach.actual} in ESLINT_LIMIT_PINS so the ceiling cannot drift back up.`
    case "limit_unpinned":
      return `eslint.config.js configures "${breach.rule}" at ${breach.actual} with no ESLINT_LIMIT_PINS entry.\n`
        + `  Add one naming the issue it bounds, or the ceiling can be raised with nothing objecting.`
    case "limit_unconfigured":
      return `ESLINT_LIMIT_PINS pins "${breach.rule}" but eslint.config.js configures no such rule — this gate is currently inert.\n`
        + `  Restore the rule, or drop the pin deliberately. Do NOT leave a pin with no enforcement behind it.`
    case "pattern_unmeasured":
      return `"${breach.id}" scanned no files — its include paths are stale, so this gate is currently inert.\n`
        + `  Repoint include in PATTERN_BUDGETS. Do NOT pin it at 0: a renamed target reads as a population\n`
        + `  that vanished, and pinning that in would retire the check instead of the defect.`
  }
}

function rationaleOf(id: string): string {
  return PATTERN_BUDGETS.find((b) => b.id === id)?.rationale ?? ""
}

function eslintRationaleOf(rule: string): string {
  return ESLINT_LIMIT_PINS.find((p) => p.rule === rule)?.rationale ?? ""
}
