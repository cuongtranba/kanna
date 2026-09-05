
export const PERF_ALERT_EVENT_TYPE = "kanna-perf-alert"

export const CONTACT_POINT_NAME = "github-perf-tickets"

export const TICKET_SCOPE_ANNOTATION = "ticket_scope"

export const MAX_ALERTS_PER_NOTIFICATION = 20

export const TEMPLATED_FIELDS: readonly string[] = [
  ".Status",
  ".CommonLabels.alertname",
  ".CommonLabels.service_version",
  ".CommonAnnotations.summary",
  ".CommonAnnotations.description",
  ".CommonAnnotations.runbook",
  ".CommonAnnotations.code_hints",
  ".CommonAnnotations.promql",
  ".CommonAnnotations.threshold",
  `.CommonAnnotations.${TICKET_SCOPE_ANNOTATION}`,
  ".Labels.host_name",
  ".Labels.service_name",
  ".ValueString",
  ".ExternalURL",
]

export const CLIENT_PAYLOAD_KEYS: readonly string[] = [
  "status",
  "alert",
  "instances",
  "grafana_url",
]

const q = (expr: string) => `{{ ${expr} | printf "%q" }}`

export function buildWebhookPayloadTemplate(): string {
  const instance = [
    `{"host": ${q("$alert.Labels.host_name")}`,
    `"service": ${q("$alert.Labels.service_name")}`,
    `"version": ${q("$alert.Labels.service_version")}`,
    `"value": ${q("$alert.ValueString")}`,
    `"status": ${q("$alert.Status")}}`,
  ].join(", ")

  return `{
  "event_type": "${PERF_ALERT_EVENT_TYPE}",
  "client_payload": {
    "status": ${q(".Status")},
    "alert": {
      "alertname": ${q(".CommonLabels.alertname")},
      "service_version": ${q(".CommonLabels.service_version")},
      "summary": ${q(".CommonAnnotations.summary")},
      "description": ${q(".CommonAnnotations.description")},
      "runbook": ${q(".CommonAnnotations.runbook")},
      "code_hints": ${q(".CommonAnnotations.code_hints")},
      "promql": ${q(".CommonAnnotations.promql")},
      "threshold": ${q(".CommonAnnotations.threshold")},
      "${TICKET_SCOPE_ANNOTATION}": ${q(`.CommonAnnotations.${TICKET_SCOPE_ANNOTATION}`)}
    },
    "instances": [{{ range $i, $alert := .Alerts }}{{ if $i }},{{ end }}${instance}{{ end }}],
    "grafana_url": ${q(".ExternalURL")}
  }
}`
}

export interface ContactPointTarget {
  repo: string
  token: string
}

export function buildContactPoint(target: ContactPointTarget) {
  return {
    name: CONTACT_POINT_NAME,
    type: "webhook",
    settings: {
      url: `https://api.github.com/repos/${target.repo}/dispatches`,
      httpMethod: "POST",
      authorization_scheme: "Bearer",
      authorization_credentials: target.token,
      maxAlerts: MAX_ALERTS_PER_NOTIFICATION,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      payload: { template: buildWebhookPayloadTemplate() },
    },
    disableResolveMessage: false,
  }
}

export interface NotificationRoute {
  receiver?: string
  object_matchers?: string[][]
  group_by?: string[]
  group_wait?: string
  group_interval?: string
  repeat_interval?: string
}

export interface NotificationPolicy {
  receiver?: string
  routes?: NotificationRoute[]
}

export function perfRoute(): NotificationRoute {
  return {
    receiver: CONTACT_POINT_NAME,
    object_matchers: [["kanna_alert", "=", "perf"]],
    group_by: ["alertname", "service_version"],
    group_wait: "5m",
    group_interval: "10m",
    repeat_interval: "12h",
  }
}

export function mergePerfRoute(existing: NotificationPolicy): NotificationPolicy {
  const others = (existing.routes ?? []).filter((route) => route.receiver !== CONTACT_POINT_NAME)
  return { ...existing, routes: [perfRoute(), ...others] }
}
