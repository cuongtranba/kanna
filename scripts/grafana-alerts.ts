
import {
  ALERT_RULES,
  RULE_GROUP_TITLE,
  buildRuleGroup,
} from "../src/ops/alerting/rules"
import {
  CONTACT_POINT_NAME,
  buildContactPoint,
  mergePerfRoute,
  type NotificationPolicy,
} from "../src/ops/alerting/webhook-payload"

const dryRun = process.argv.includes("--dry-run")

const baseUrl = process.env.KANNA_GRAFANA_URL ?? "https://kanna-grafana.lowbit.link"
const user = process.env.KANNA_GRAFANA_USER ?? "admin"
const password = process.env.KANNA_GRAFANA_PASSWORD
const repo = process.env.KANNA_GITHUB_REPO ?? "cuongtranba/kanna"
const dispatchToken = process.env.KANNA_GITHUB_DISPATCH_TOKEN

const FOLDER_UID = "kanna-alerts"
const FOLDER_TITLE = "Kanna Alerts"
const DATASOURCE_UID = process.env.KANNA_PROM_DATASOURCE_UID ?? "prometheus"

if (!dryRun && !password) {
  console.error("KANNA_GRAFANA_PASSWORD is required (omit it with --dry-run)")
  process.exit(1)
}
if (!dryRun && !dispatchToken) {
  console.error("KANNA_GITHUB_DISPATCH_TOKEN is required (omit it with --dry-run)")
  process.exit(1)
}

const auth = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`

async function grafana(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      "X-Disable-Provenance": "true",
      ...init.headers,
    },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${response.status} ${text}`)
  return text ? JSON.parse(text) : null
}

const ruleGroup = buildRuleGroup(ALERT_RULES, {
  folderUid: FOLDER_UID,
  datasourceUid: DATASOURCE_UID,
})
const contactPoint = buildContactPoint({ repo, token: dispatchToken ?? "<token>" })

if (dryRun) {
  const redacted = {
    ...contactPoint,
    settings: { ...contactPoint.settings, authorization_credentials: "<redacted>" },
  }
  console.log("--- rule group ---")
  console.log(JSON.stringify(ruleGroup, null, 2))
  console.log("--- contact point ---")
  console.log(JSON.stringify(redacted, null, 2))
  console.log("--- route ---")
  console.log(JSON.stringify(mergePerfRoute({ receiver: "<existing>" }).routes?.[0], null, 2))
  console.log(`\n${ALERT_RULES.filter((r) => r.armed).length}/${ALERT_RULES.length} rules armed`)
  process.exit(0)
}

const folderExists = await grafana(`/api/folders/${FOLDER_UID}`)
  .then(() => true)
  .catch(() => false)
if (!folderExists) {
  await grafana("/api/folders", {
    method: "POST",
    body: JSON.stringify({ uid: FOLDER_UID, title: FOLDER_TITLE }),
  })
  console.log(`created folder ${FOLDER_TITLE}`)
}

const existingContactPoints = await grafana("/api/v1/provisioning/contact-points") as Array<{
  uid?: string
  name?: string
}>
const mine = existingContactPoints.find((point) => point.name === CONTACT_POINT_NAME)
if (mine?.uid) {
  await grafana(`/api/v1/provisioning/contact-points/${mine.uid}`, {
    method: "PUT",
    body: JSON.stringify({ ...contactPoint, uid: mine.uid }),
  })
  console.log(`updated contact point ${CONTACT_POINT_NAME}`)
} else {
  await grafana("/api/v1/provisioning/contact-points", {
    method: "POST",
    body: JSON.stringify(contactPoint),
  })
  console.log(`created contact point ${CONTACT_POINT_NAME}`)
}

const policy = await grafana("/api/v1/provisioning/policies") as NotificationPolicy
await grafana("/api/v1/provisioning/policies", {
  method: "PUT",
  body: JSON.stringify(mergePerfRoute(policy)),
})
console.log("merged the performance route into the notification policy")

await grafana(`/api/v1/provisioning/folder/${FOLDER_UID}/rule-groups/${RULE_GROUP_TITLE}`, {
  method: "PUT",
  body: JSON.stringify(ruleGroup),
})
for (const rule of ALERT_RULES) {
  console.log(`  ${rule.armed ? "armed " : "paused"}  ${rule.title}`)
}
console.log(`applied ${ALERT_RULES.length} rules to ${FOLDER_TITLE}`)
