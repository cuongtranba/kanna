import { describe, expect, it } from "bun:test"


const WORKFLOW_PATH = new URL("../.github/workflows/release-please.yml", import.meta.url)

type Job = {
  if?: string
  needs?: string | string[]
  steps?: Array<{ uses?: string; with?: Record<string, unknown> }>
}
type Workflow = {
  on: { workflow_dispatch?: { inputs?: Record<string, { required?: boolean; type?: string }> } }
  jobs: Record<string, Job>
}

const workflow = Bun.YAML.parse(await Bun.file(WORKFLOW_PATH).text()) as Workflow

function evaluate(expression: string, context: Record<string, unknown>): unknown {
  const source = expression
    .replace(/\$\{\{|\}\}/g, "")
    .replace(/[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)+/g, (path) => {
      const [root, ...rest] = path.split(".")
      return root + rest.map((segment) => `?.[${JSON.stringify(segment)}]`).join("")
    })
    .replace(/==/g, "===")

  const names = Object.keys(context)
  const evaluator = new Function(...names, `"use strict"; return (${source})`)
  const result = evaluator(...names.map((name) => context[name]))
  return result ?? ""
}

const pushEvent = (releaseCreated: boolean) => ({
  github: { event_name: "push", sha: "deadbeef" },
  inputs: {},
  needs: { "release-please": { outputs: { release_created: String(releaseCreated) } } },
  cancelled: () => false,
  success: () => true,
})

const dispatchEvent = (tag: string) => ({
  github: { event_name: "workflow_dispatch", sha: "deadbeef" },
  inputs: { tag },
  needs: { "release-please": { outputs: {} } },
  cancelled: () => false,
  success: () => true,
})

const publishRuns = (context: Record<string, unknown>) =>
  Boolean(evaluate(workflow.jobs.publish.if ?? "true", context))

describe("release-please workflow", () => {
  it("exposes a manual trigger that takes the tag to publish", () => {
    const tag = workflow.on.workflow_dispatch?.inputs?.tag
    expect(tag).toBeDefined()
    expect(tag?.required).toBe(true)
  })

  it("publishes when a push actually cut a release", () => {
    expect(publishRuns(pushEvent(true))).toBe(true)
  })

  it("stays idle on a push that cut no release", () => {
    expect(publishRuns(pushEvent(false))).toBe(false)
  })

  it("publishes on manual dispatch even though release-please was skipped", () => {
    expect(publishRuns(dispatchEvent("v1.32.0"))).toBe(true)
  })

  it("never re-cuts a release on manual dispatch", () => {
    const gate = workflow.jobs["release-please"].if ?? "true"
    expect(Boolean(evaluate(gate, dispatchEvent("v1.32.0")))).toBe(false)
    expect(Boolean(evaluate(gate, pushEvent(true)))).toBe(true)
  })

  it("checks out the requested tag on dispatch and the pushed commit otherwise", () => {
    const checkout = workflow.jobs.publish.steps?.find((step) => step.uses?.startsWith("actions/checkout"))
    const ref = String(checkout?.with?.ref ?? "")
    expect(ref).not.toBe("")
    expect(evaluate(ref, dispatchEvent("v1.32.0"))).toBe("v1.32.0")
    expect(evaluate(ref, pushEvent(true))).toBe("deadbeef")
  })
})
