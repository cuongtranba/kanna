import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { PERF_ALERT_EVENT_TYPE } from "../src/ops/alerting/webhook-payload"

// The event name is agreed between two places that never import each other:
// the Go template Grafana holds, and this workflow's trigger. Nothing at
// runtime would report a mismatch — the dispatch would simply be accepted by
// GitHub and match no workflow, so alerts would vanish silently.

const WORKFLOW_PATH = new URL("../.github/workflows/perf-alert.yml", import.meta.url)

type Workflow = {
  on: { repository_dispatch?: { types?: string[] } }
  permissions?: Record<string, string>
  concurrency?: { group?: string; "cancel-in-progress"?: boolean }
  jobs: Record<string, { steps?: Array<{ run?: string; uses?: string; env?: Record<string, string> }> }>
}

const workflow = Bun.YAML.parse(await Bun.file(WORKFLOW_PATH).text()) as Workflow
const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? [])
const issueScript = await Bun.file(new URL("./perf-alert-issue.ts", import.meta.url)).text()

describe("perf-alert workflow", () => {
  test("listens for the event type the Grafana template sends", () => {
    expect(workflow.on.repository_dispatch?.types).toEqual([PERF_ALERT_EVENT_TYPE])
  })

  test("can write issues with the built-in token", () => {
    expect(workflow.permissions?.issues).toBe("write")
  })

  test("runs a script that exists", () => {
    const run = steps.find((step) => step.run?.includes("perf-alert-issue.ts"))
    expect(run).toBeDefined()
    expect(existsSync(new URL("./perf-alert-issue.ts", import.meta.url))).toBe(true)
  })

  test("passes the dispatch payload and repo to the script", () => {
    const env = steps.find((step) => step.run?.includes("perf-alert-issue.ts"))?.env ?? {}
    expect(env.KANNA_ALERT_PAYLOAD).toContain("client_payload")
    expect(env.GITHUB_TOKEN).toContain("secrets.GITHUB_TOKEN")
    expect(env.GITHUB_REPOSITORY).toContain("github.repository")
  })

  // Two dispatches for one alert racing would each find no ticket and open one.
  test("serialises runs per alert so the dedup check cannot race", () => {
    expect(workflow.concurrency?.group).toContain("client_payload.alert.alertname")
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false)
  })
})

// decideAction can only reopen a ticket it is shown. Narrowing this query back
// to state=open would leave every unit test green while the pipeline silently
// returned to filing a fresh ticket per flap.
describe("perf-alert issue script", () => {
  test("fetches closed tickets too, so a re-firing alert can reopen one", () => {
    expect(issueScript).toContain("state=all")
    expect(issueScript).not.toContain("state=open")
  })

  test("orders by recent activity so the reopen window fits in one page", () => {
    expect(issueScript).toContain("sort=updated")
    expect(issueScript).toContain("direction=desc")
  })
})
