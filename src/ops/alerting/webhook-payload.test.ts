import { describe, expect, test } from "bun:test"
import {
  CLIENT_PAYLOAD_KEYS,
  CONTACT_POINT_NAME,
  PERF_ALERT_EVENT_TYPE,
  TEMPLATED_FIELDS,
  buildContactPoint,
  buildWebhookPayloadTemplate,
  mergePerfRoute,
  type NotificationRoute,
} from "./webhook-payload"

const template = buildWebhookPayloadTemplate()

describe("webhook payload template", () => {
  test("sends every field the issue renderer reads", () => {
    for (const field of TEMPLATED_FIELDS) expect(template).toContain(field)
  })

  test("declares the event type the workflow listens for", () => {
    expect(template).toContain(`"event_type": "${PERF_ALERT_EVENT_TYPE}"`)
  })

  test("stays within GitHub's client_payload key limit", () => {
    expect(CLIENT_PAYLOAD_KEYS.length).toBeLessThanOrEqual(10)
    for (const key of CLIENT_PAYLOAD_KEYS) expect(template).toContain(`"${key}":`)
  })

  test("every interpolated value is JSON-escaped", () => {
    const interpolations = template.match(/\{\{[^}]*\}\}/g) ?? []
    const controlAction = /\{\{\s*(range|if|else|end)\b/
    const valueInterpolations = interpolations.filter((i) => !controlAction.test(i))
    expect(valueInterpolations.length).toBeGreaterThan(0)
    for (const interpolation of valueInterpolations) {
      expect(interpolation, interpolation).toContain('printf "%q"')
    }
  })

  test("renders to parseable JSON once actions are substituted", () => {
    const rendered = template
      .replace(/\{\{ range [^}]*\}\}|\{\{ if \$i \}\},\{\{ end \}\}|\{\{ end \}\}/g, "")
      .replace(/\{\{[^}]*\}\}/g, '"x"')
    const parsed = JSON.parse(rendered)
    expect(parsed.event_type).toBe(PERF_ALERT_EVENT_TYPE)
    expect(Object.keys(parsed.client_payload).sort()).toEqual([...CLIENT_PAYLOAD_KEYS].sort())
  })
})

describe("buildContactPoint", () => {
  const contactPoint = buildContactPoint({ repo: "cuongtranba/kanna", token: "secret-token" })

  test("posts to the repository dispatch endpoint with a bearer token", () => {
    expect(contactPoint.settings.url).toBe("https://api.github.com/repos/cuongtranba/kanna/dispatches")
    expect(contactPoint.settings.httpMethod).toBe("POST")
    expect(contactPoint.settings.authorization_scheme).toBe("Bearer")
    expect(contactPoint.settings.authorization_credentials).toBe("secret-token")
    expect(contactPoint.settings.headers.Accept).toBe("application/vnd.github+json")
  })

  test("resolved notifications are not suppressed", () => {
    expect(contactPoint.disableResolveMessage).toBe(false)
  })
})

describe("mergePerfRoute", () => {
  const existing = {
    receiver: "grafana-default-email",
    group_by: ["grafana_folder", "alertname"],
    routes: [{ receiver: "someone-elses-slack", object_matchers: [["team", "=", "infra"]] }],
  }

  test("groups by rule and release", () => {
    expect(mergePerfRoute(existing).routes?.[0]?.group_by).toEqual(["alertname", "service_version"])
  })

  test("routes only performance alerts to the GitHub contact point", () => {
    const route = mergePerfRoute(existing).routes?.[0]
    expect(route?.receiver).toBe(CONTACT_POINT_NAME)
    expect(route?.object_matchers).toEqual([["kanna_alert", "=", "perf"]])
  })

  test("preserves the default receiver and unrelated routes", () => {
    const merged = mergePerfRoute(existing)
    expect(merged.routes).toContainEqual(existing.routes[0])

    const { routes: _merged, ...mergedRest } = merged
    const { routes: _existing, ...existingRest } = existing
    expect(mergedRest).toEqual(existingRest)
  })

  test("re-applying replaces its own route rather than stacking copies", () => {
    const once = mergePerfRoute(existing)
    const twice = mergePerfRoute(once)
    const mineOnly = (twice.routes ?? []).filter(
      (route: NotificationRoute) => route.receiver === CONTACT_POINT_NAME,
    )
    expect(mineOnly).toHaveLength(1)
    expect(twice).toEqual(once)
  })

  test("puts the perf route first", () => {
    expect(mergePerfRoute(existing).routes?.[0]?.receiver).toBe(CONTACT_POINT_NAME)
  })

  test("works on a policy that has no routes yet", () => {
    expect(mergePerfRoute({ receiver: "x" }).routes).toHaveLength(1)
  })
})
