
import {
  decideAction,
  type CloseReason,
  type KnownIssue,
  type PerfAlertPayload,
} from "../src/ops/alerting/perf-issue"

const token = process.env.GITHUB_TOKEN
const repo = process.env.GITHUB_REPOSITORY
const raw = process.env.KANNA_ALERT_PAYLOAD

if (!token || !repo) {
  console.error("GITHUB_TOKEN and GITHUB_REPOSITORY are required")
  process.exit(1)
}
if (!raw) {
  console.error("KANNA_ALERT_PAYLOAD is required")
  process.exit(1)
}

const payload = JSON.parse(raw) as PerfAlertPayload
if (!payload.alert?.alertname) {
  console.warn("payload carries no alertname; nothing to file")
  process.exit(0)
}
payload.instances ??= []

const api = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...init.headers,
    },
  })
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} → ${response.status} ${await response.text()}`)
  }
  return response.json()
}

const listed = await api(
  `/repos/${repo}/issues?state=all&labels=performance&sort=updated&direction=desc&per_page=100`,
) as Array<{
  number: number
  body: string | null
  updated_at: string
  state: string
  closed_at: string | null
  state_reason: string | null
  pull_request?: unknown
}>

const MUTING_CLOSE_REASONS = new Set(["not_planned", "duplicate"])

function closedState(issue: (typeof listed)[number]): KnownIssue["closed"] {
  if (issue.state !== "closed") return null
  const reason: CloseReason = MUTING_CLOSE_REASONS.has(issue.state_reason ?? "")
    ? "not_planned"
    : "completed"
  return { at: Date.parse(issue.closed_at ?? issue.updated_at), reason }
}

const issues: KnownIssue[] = listed
  .filter((issue) => !issue.pull_request)
  .map((issue) => ({
    number: issue.number,
    body: issue.body ?? "",
    updatedAt: Date.parse(issue.updated_at),
    closed: closedState(issue),
  }))

const action = decideAction(payload, issues, Date.now())

switch (action.kind) {
  case "create": {
    const created = await api(`/repos/${repo}/issues`, {
      method: "POST",
      body: JSON.stringify({ title: action.title, body: action.body, labels: action.labels }),
    }) as { number: number }
    console.log(`opened #${created.number} for ${payload.alert.alertname}`)
    break
  }
  case "comment": {
    await api(`/repos/${repo}/issues/${action.number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: action.body }),
    })
    console.log(`commented on #${action.number}`)
    break
  }
  case "reopen": {
    await api(`/repos/${repo}/issues/${action.number}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "open", state_reason: "reopened" }),
    })
    await api(`/repos/${repo}/issues/${action.number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: action.body }),
    })
    console.log(`reopened #${action.number}`)
    break
  }
  case "close": {
    await api(`/repos/${repo}/issues/${action.number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: action.body }),
    })
    await api(`/repos/${repo}/issues/${action.number}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "closed", state_reason: "completed" }),
    })
    console.log(`closed #${action.number}`)
    break
  }
  case "skip":
    console.log(`skipped: ${action.reason}`)
    break
}
