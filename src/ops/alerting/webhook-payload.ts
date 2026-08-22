/**
 * The Grafana side of the Grafana → GitHub hop.
 *
 * Grafana's webhook contact point posts a custom body, so it can speak GitHub's
 * repository-dispatch API directly with no relay service in between. The Go
 * template below is the only piece of logic that lives in Grafana's database
 * rather than in this repo, which is why its shape is declared here as data and
 * asserted against what `perf-issue.ts` reads.
 */

/** The dispatch event name. The workflow listens for exactly this. */
export const PERF_ALERT_EVENT_TYPE = "kanna-perf-alert"

export const CONTACT_POINT_NAME = "github-perf-tickets"

/**
 * Annotation carrying the rule's `TicketScope` to the ticket pipeline.
 *
 * The scope is a property of the rule, so reading it from `ALERT_RULES` would
 * be the obvious thing — but `.github/workflows/perf-alert.yml` runs
 * `perf-alert-issue.ts` with NO `bun install`, deliberately, so a lockfile
 * problem can never stop an alert being filed. Importing `rules.ts` from the
 * decision module would drag in `observability.ts` and `@opentelemetry/api`
 * with it. Every other rule property the ticket renders — promql, threshold,
 * runbook, code_hints — already travels this way; the scope is one more.
 *
 * An annotation rather than a label: labels take part in Alertmanager's
 * fingerprint and routing, and this is neither.
 */
export const TICKET_SCOPE_ANNOTATION = "ticket_scope"

/** Bounds the body: GitHub rejects a client_payload over 64 KB. */
export const MAX_ALERTS_PER_NOTIFICATION = 20

/**
 * Every field `PerfAlertPayload` reads, as a template-source substring. A field
 * added to the payload type but not to the template arrives undefined and
 * silently drops out of the ticket, so the suite asserts each of these appears.
 */
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

/**
 * Top-level keys of `client_payload`. GitHub caps this at 10, which is why the
 * alert's own fields are nested under `alert` rather than spread flat.
 */
export const CLIENT_PAYLOAD_KEYS: readonly string[] = [
  "status",
  "alert",
  "instances",
  "grafana_url",
]

// `printf "%q"` is what makes this safe: it emits a quoted, escaped string, so
// a label containing a quote or a backslash cannot break out and produce
// invalid JSON. Every interpolation below goes through it.
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
  /** e.g. "cuongtranba/kanna" */
  repo: string
  /** A GitHub token permitted to POST repository dispatches. */
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

// Only the fields this module reads are declared. Grafana's policy tree carries
// more (mute timings, per-route overrides), and mergePerfRoute preserves them by
// spreading — declaring them here would be a second, drifting copy of a schema
// this repo does not own.
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

/**
 * Routes performance alerts to the GitHub contact point, grouped so that ten
 * breaching installs are one ticket rather than ten — by rule and release,
 * because that is the unit a fix targets.
 */
export function perfRoute(): NotificationRoute {
  return {
    receiver: CONTACT_POINT_NAME,
    object_matchers: [["kanna_alert", "=", "perf"]],
    group_by: ["alertname", "service_version"],
    group_wait: "5m",
    group_interval: "10m",
    // A firing rule re-notifies at this cadence; the workflow's own quiet
    // period decides whether that becomes a comment.
    repeat_interval: "12h",
  }
}

/**
 * Adds (or refreshes) the performance route inside the EXISTING policy tree.
 *
 * Grafana's policy endpoint is a whole-tree PUT, so building a policy from
 * scratch would silently delete every route someone else configured on this
 * shared instance. This preserves the tree and owns exactly one route, keyed by
 * the contact point name, which also makes re-applying idempotent. The perf
 * route is placed FIRST because Alertmanager matches routes in order and a
 * broad catch-all ahead of it would swallow the alert.
 */
export function mergePerfRoute(existing: NotificationPolicy): NotificationPolicy {
  const others = (existing.routes ?? []).filter((route) => route.receiver !== CONTACT_POINT_NAME)
  return { ...existing, routes: [perfRoute(), ...others] }
}
