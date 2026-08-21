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
import { PROCESS_RSS_BYTES, TURN_DURATION_MS } from "../../server/observability"

const REPO_ROOT = join(import.meta.dir, "../../..")

// This suite is the gate that keeps a rule honest. A rule is only useful if it
// queries a metric Kanna really exports, breaches on a number someone chose on
// purpose, and carries enough context for the ticket it opens to be actionable.

describe("promMetricName", () => {
  // Pinned against names observed on the live collector, which is the only
  // authority on how the OTLP receiver mangles an instrument name.
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

  // A short `for` turns a transient spike — one oversized transcript parse —
  // into a GitHub issue. Every rule here describes a SUSTAINED condition.
  test("every rule requires the condition to persist", () => {
    for (const rule of ALERT_RULES) {
      const minutes = Number.parseInt(rule.forDuration, 10)
      expect(rule.forDuration, rule.title).toMatch(/^\d+m$/)
      expect(minutes, rule.title).toBeGreaterThanOrEqual(5)
    }
  })

  // The drift guard: rename an instrument in observability.ts and the rule that
  // queries it stops matching anything — silently, forever, because a rule that
  // selects no series simply never fires.
  test("every metric referenced by a query is one Kanna exports", () => {
    for (const rule of ALERT_RULES) {
      for (const referenced of rule.promql.match(/kanna_[a-z_0-9]+/g) ?? []) {
        expect(EXPORTED_PROM_METRICS, `${rule.title} references ${referenced}`)
          .toContain(referenced)
      }
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

  // A code hint pointing to a non-existent file is worse than no hint: an agent
  // wastes a turn looking for a file that never existed, then reports nothing.
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

  // Grafana's rule-group endpoint takes SECONDS here and rejects a duration
  // string with a bare "bad request data" that names nothing — the individual
  // rules validate fine, so the failure looks like it is anywhere but here.
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

  // An unarmed rule is still PUT to Grafana, paused: the threshold and the
  // query stay visible and reviewable, and arming is one flag rather than a
  // rediscovery of what the rule was supposed to be.
  test("unarmed rules are applied paused, not withheld", () => {
    expect(group.rules.length).toBe(ALERT_RULES.length)
    for (const rule of group.rules) {
      const spec = ALERT_RULES.find((s) => s.title === rule.title) as AlertRuleSpec
      expect(rule.isPaused).toBe(!spec.armed)
    }
  })

  // The notification policy routes on this label alone. A rule missing it is
  // evaluated by Grafana and then goes nowhere.
  test("every rule is routable to the GitHub contact point", () => {
    for (const rule of group.rules) {
      expect(rule.labels.kanna_alert, rule.title).toBe("perf")
    }
  })

  // noData must not ticket: an install going quiet is not a performance
  // regression, and every laptop in the fleet goes quiet nightly.
  test("absent data never fires", () => {
    for (const rule of group.rules) expect(rule.noDataState).toBe("OK")
  })
})
