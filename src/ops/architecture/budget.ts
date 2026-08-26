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
  "src/server/agent-coordinator.ts": 1137,
  "src/server/app-settings.ts": 1897,
  "src/server/board-store.adapter.ts": 1364,
  "src/server/claude-pty/driver.ts": 1104,
  "src/server/claude-session-runner.ts": 708,
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
    pattern: "interface [A-Za-z]*Deps\\b",
    max: 79,
    issue: 893,
    rationale:
      "Each *Deps interface is a hand-maintained slice of the coordinator's fields. Every field is optional, so a builder that omits one compiles and the consumer's fallback is indistinguishable from the feature being off — this is how getArmedLoop shipped declared-but-never-passed.",
  },
  {
    id: "coordinator-passthroughs",
    include: ["src/server/agent-coordinator.ts"],
    pattern: "Fn\\(this\\.build",
    max: 55,
    issue: 893,
    rationale:
      "A method whose whole body is `return xFn(this.buildYDeps(), ...)` adds interface without adding implementation, and costs three hops through two files to reach one line of logic.",
  },
  {
    id: "event-store-passthroughs",
    include: ["src/server/event-store.ts"],
    pattern: "this\\.build[A-Za-z]*Deps\\(\\)",
    max: 61,
    issue: 892,
    rationale:
      "Per-call deps bundles on EventStore. buildChatTranscriptWriteDeps alone allocates a 19-field literal with ~10 closures on every appendMessage, the hottest write path in the system.",
  },
  {
    id: "ws-router-dispatch-arms",
    include: ["src/server/ws-router.ts"],
    pattern: '^\\s*case "',
    max: 129,
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
    max: 30,
    issue: 897,
    rationale:
      "Hand-built MCP tool results. kanna-mcp-boards.ts already has ok()/fail() helpers for exactly this; the abstraction exists one file over and never moved up.",
  },
  {
    id: "escalation-memory-caps",
    include: ["src/server/"],
    pattern: "MEMORY_PER_CHAT\\s*=",
    max: 3,
    issue: 896,
    rationale:
      "mermaid-guard, cron/repair and cron/confirm each declare their own = 32 cap and a byte-identical remember() FIFO. CLAUDE.md carries a four-row table asserting the three stay equivalent — that table is the abstraction, written as prose.",
  },
  {
    id: "loop-prompt-tool-literals",
    include: ["src/server/loop-template.ts"],
    pattern: "mcp__kanna__",
    max: 16,
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
    max: 9,
    issue: 889,
    rationale:
      "types.ts re-exports nine modules wholesale, giving 227 importers a dependency on 306 declarations to use two or three. Extraction moved the code out but preserved the fan-in, so nothing in the import graph says which part of the domain a module touches.",
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
    case "pattern_unmeasured":
      return `"${breach.id}" scanned no files — its include paths are stale, so this gate is currently inert.\n`
        + `  Repoint include in PATTERN_BUDGETS. Do NOT pin it at 0: a renamed target reads as a population\n`
        + `  that vanished, and pinning that in would retire the check instead of the defect.`
  }
}

function rationaleOf(id: string): string {
  return PATTERN_BUDGETS.find((b) => b.id === id)?.rationale ?? ""
}
