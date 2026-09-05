import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import {
  ALERT_RULES,
  EXPORTED_PROM_METRICS,
  buildRuleGroup,
  promMetricName,
  type AlertRuleSpec,
} from "./rules"
import { TICKET_SCOPE_ANNOTATION } from "./webhook-payload"
import { PROCESS_RSS_BYTES, TURN_DURATION_MS } from "../../server/observability"

const REPO_ROOT = join(import.meta.dir, "../../..")


describe("promMetricName", () => {
  test("matches the mangling the collector actually applies", () => {
    expect(promMetricName(PROCESS_RSS_BYTES)).toBe("kanna_process_rss_bytes")
    expect(promMetricName(TURN_DURATION_MS)).toBe("kanna_turn_duration_ms")
  })
})

describe("ALERT_RULES", () => {
  test("every rule carries what the ticket renders", () => {
    for (const rule of ALERT_RULES) {
      expect(rule.summary.length, rule.title).toBeGreaterThan(0)
      expect(rule.description.length, rule.title).toBeGreaterThan(0)
      expect(rule.runbook.length, rule.title).toBeGreaterThan(0)
      expect(rule.codeHints.length, rule.title).toBeGreaterThan(0)
      expect(Number.isFinite(rule.threshold), rule.title).toBe(true)
    }
  })

  test("rule uids and titles are unique", () => {
    expect(new Set(ALERT_RULES.map((r) => r.uid)).size).toBe(ALERT_RULES.length)
    expect(new Set(ALERT_RULES.map((r) => r.title)).size).toBe(ALERT_RULES.length)
  })

  test("every rule requires the condition to persist", () => {
    for (const rule of ALERT_RULES) {
      const minutes = Number.parseInt(rule.forDuration, 10)
      expect(rule.forDuration, rule.title).toMatch(/^\d+m$/)
      expect(minutes, rule.title).toBeGreaterThanOrEqual(5)
    }
  })

  test("every metric referenced by a query is one Kanna exports", () => {
    for (const rule of ALERT_RULES) {
      for (const referenced of rule.promql.match(/kanna_[a-z_0-9]+/g) ?? []) {
        expect(EXPORTED_PROM_METRICS, `${rule.title} references ${referenced}`)
          .toContain(referenced)
      }
    }
  })

  test("a release-scoped rule actually distinguishes releases", () => {
    for (const rule of ALERT_RULES.filter((r) => r.ticketScope === "release")) {
      expect(rule.promql, rule.title).toContain("service_version")
    }
  })

  test("an unarmed rule says what must be observed before arming it", () => {
    for (const rule of ALERT_RULES.filter((r) => !r.armed)) {
      expect(rule.baselineNote?.length, rule.title).toBeGreaterThan(0)
    }
  })

  test("at least one rule is armed", () => {
    expect(ALERT_RULES.some((r) => r.armed)).toBe(true)
  })

  test("every src/ path in a code hint refers to a file that exists", () => {
    for (const rule of ALERT_RULES) {
      for (const hint of rule.codeHints) {
        const match = hint.match(/^(src\/[^\s—]+)/)
        if (!match) continue
        const filePath = join(REPO_ROOT, match[1])
        expect(existsSync(filePath), `${rule.title}: "${match[1]}" does not exist`).toBe(true)
      }
    }
  })

  test("KannaMemoryPressure TranscriptCache hint reflects post-PR-829 behaviour", () => {
    const rule = ALERT_RULES.find((r) => r.uid === "kanna-perf-memory")
    expect(rule).toBeDefined()
    const transcriptHint = rule!.codeHints.find((h) => h.includes("TranscriptCache"))
    expect(transcriptHint).toBeDefined()
    expect(transcriptHint).not.toMatch(/degrades to re-reads rather than eviction/)
  })
})

describe("buildRuleGroup", () => {
  const group = buildRuleGroup(ALERT_RULES, { folderUid: "f1", datasourceUid: "prometheus" })

  test("threshold lives on the condition node the rule points at", () => {
    for (const rule of group.rules) {
      const condition = rule.data.find((node) => node.refId === rule.condition)
      expect(condition, rule.title).toBeDefined()
      const spec = ALERT_RULES.find((s) => s.title === rule.title) as AlertRuleSpec
      expect(condition?.model.conditions?.[0]?.evaluator.params).toEqual([spec.threshold])
    }
  })

  test("the evaluation interval is seconds, not a duration string", () => {
    expect(typeof group.interval).toBe("number")
    expect(group.interval).toBeGreaterThanOrEqual(60)
  })

  test("the query node runs the spec's PromQL against the given datasource", () => {
    const [first] = group.rules
    const query = first?.data.find((node) => node.refId === "A")
    expect(query?.datasourceUid).toBe("prometheus")
    expect(query?.model.expr).toBe(ALERT_RULES[0]?.promql)
  })

  test("unarmed rules are applied paused, not withheld", () => {
    expect(group.rules.length).toBe(ALERT_RULES.length)
    for (const rule of group.rules) {
      const spec = ALERT_RULES.find((s) => s.title === rule.title) as AlertRuleSpec
      expect(rule.isPaused).toBe(!spec.armed)
    }
  })

  test("every rule is routable to the GitHub contact point", () => {
    for (const rule of group.rules) {
      expect(rule.labels.kanna_alert, rule.title).toBe("perf")
    }
  })

  test("every rule ships the scope its ticket is deduped by", () => {
    for (const rule of group.rules) {
      const spec = ALERT_RULES.find((s) => s.title === rule.title) as AlertRuleSpec
      expect(rule.annotations[TICKET_SCOPE_ANNOTATION], rule.title).toBe(spec.ticketScope)
    }
  })

  test("absent data never fires", () => {
    for (const rule of group.rules) expect(rule.noDataState).toBe("OK")
  })
})
