/**
 * CronJobEditDialog — the whole editable surface of an armed cron job.
 *
 * The dialog is the client half of a server contract that already exists:
 * `cron.update` carries a `CronJobPatch` and the server merges it over the
 * job. Two properties of that patch are what these tests pin — it must carry
 * ONLY what changed (a patch that restates an unchanged field is a patch that
 * can clobber a concurrent edit), and `schedule` must never travel without the
 * `scheduleText` the row renders, because the server takes them as a pair.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import type { CronJobPatch, CronJobSnapshot } from "../../shared/cron/types"
import { CronJobEditDialog } from "./CronJobEditDialog"

function job(overrides: Partial<CronJobSnapshot> = {}): CronJobSnapshot {
  return {
    jobId: "cron-abc",
    instruction: "check ci",
    mode: "inline",
    scheduleText: "every 5m",
    schedule: { type: "interval", ms: 300_000 },
    paused: false,
    armedAt: 1_000,
    nextFireAt: 301_000,
    lastRun: null,
    recentRuns: [],
    ...overrides,
  }
}

interface Harness {
  saved: CronJobPatch[]
  unmount: () => Promise<void>
}

const mounted: Root[] = []
const containers: HTMLElement[] = []

async function mount(snapshot = job()): Promise<Harness> {
  const saved: CronJobPatch[] = []
  const container = document.createElement("div")
  document.body.appendChild(container)
  containers.push(container)
  const root = createRoot(container)
  mounted.push(root)
  await act(async () => {
    root.render(
      <CronJobEditDialog
        job={snapshot}
        open
        onOpenChange={() => {}}
        onSave={(patch) => saved.push(patch)}
      />,
    )
  })
  return {
    saved,
    unmount: async () => {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    },
  }
}

afterEach(async () => {
  // The dialog portals into document.body, so a root left mounted commits
  // against nodes the shared-document sweep already took — failing an
  // unrelated test in a later file.
  await act(async () => {
    for (const root of mounted.splice(0)) root.unmount()
  })
  for (const container of containers.splice(0)) container.remove()
})

/** Portalled content lives on `document`, not inside the mount container. */
function field(id: string): HTMLInputElement | HTMLTextAreaElement {
  const node = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)
  if (!node) throw new Error(`no #${id}`)
  return node
}

function namedButton(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((node) => node.textContent === label)
  if (!found) throw new Error(`no "${label}" button`)
  return found
}

async function typeInto(id: string, value: string): Promise<void> {
  const node = field(id)
  const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    // React installs its own value setter on the node; going through the
    // prototype descriptor is what makes the synthetic onChange fire.
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(node, value)
    node.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
  })
}

describe("CronJobEditDialog", () => {
  test("prefills every editable field from the job", async () => {
    const harness = await mount()
    try {
      expect(field("cron-edit-instruction").value).toBe("check ci")
      expect(field("cron-edit-schedule").value).toBe("every 5m")
      const inline = namedButton("inline")
      expect(inline.getAttribute("aria-pressed")).toBe("true")
    } finally {
      await harness.unmount()
    }
  })

  test("Save is disabled until something actually changes", async () => {
    const harness = await mount()
    try {
      expect(namedButton("Save").disabled).toBe(true)
      await typeInto("cron-edit-instruction", "check ci twice")
      expect(namedButton("Save").disabled).toBe(false)
    } finally {
      await harness.unmount()
    }
  })

  test("the patch carries only the fields that changed", async () => {
    const harness = await mount()
    try {
      await typeInto("cron-edit-instruction", "check ci twice")
      await click(namedButton("Save"))
      expect(harness.saved).toEqual([{ instruction: "check ci twice" }])
    } finally {
      await harness.unmount()
    }
  })

  test("a schedule change always travels with its scheduleText", async () => {
    const harness = await mount()
    try {
      await typeInto("cron-edit-schedule", "every 10m")
      await click(namedButton("Save"))
      expect(harness.saved).toHaveLength(1)
      const patch = harness.saved[0]!
      expect(patch.scheduleText).toBe("every 10m")
      expect(patch.schedule).toEqual({ type: "interval", ms: 600_000 })
      expect(patch.instruction).toBeUndefined()
      expect(patch.mode).toBeUndefined()
    } finally {
      await harness.unmount()
    }
  })

  test("all three fields can change in one patch — one round trip, one cron_armed", async () => {
    const harness = await mount()
    try {
      await typeInto("cron-edit-instruction", "deploy")
      await typeInto("cron-edit-schedule", "0 9 * * 1")
      await click(namedButton("spawn"))
      await click(namedButton("Save"))
      expect(harness.saved).toHaveLength(1)
      const patch = harness.saved[0]!
      expect(patch.instruction).toBe("deploy")
      expect(patch.mode).toBe("spawn")
      expect(patch.scheduleText).toBe("0 9 * * 1")
    } finally {
      await harness.unmount()
    }
  })

  test("an invalid schedule blocks Save and shows the parser's own message", async () => {
    const harness = await mount()
    try {
      await typeInto("cron-edit-schedule", "* * *")
      expect(namedButton("Save").disabled).toBe(true)
      expect(document.body.textContent ?? "").toContain("3 fields")
    } finally {
      await harness.unmount()
    }
  })

  test("an empty instruction blocks Save — the server would refuse it too", async () => {
    const harness = await mount()
    try {
      await typeInto("cron-edit-instruction", "   ")
      expect(namedButton("Save").disabled).toBe(true)
    } finally {
      await harness.unmount()
    }
  })

  test("a correctable schedule offers the parser's fix, and applying it re-validates", async () => {
    const harness = await mount()
    try {
      await typeInto("cron-edit-schedule", "every 5min")
      const fix = namedButton("Use every 5m")
      await click(fix)
      expect(field("cron-edit-schedule").value).toBe("every 5m")
      // "every 5m" is the job's existing schedule, so correcting back to it
      // leaves nothing changed — Save must go quiet rather than re-arm.
      expect(namedButton("Save").disabled).toBe(true)
    } finally {
      await harness.unmount()
    }
  })

  test("a valid schedule is echoed back humanized, so the user sees what they armed", async () => {
    const harness = await mount()
    try {
      await typeInto("cron-edit-schedule", "@daily")
      expect(document.body.textContent ?? "").toContain("daily at 00:00")
    } finally {
      await harness.unmount()
    }
  })

  test("saving warns that run history and the created age are reset", async () => {
    const harness = await mount()
    try {
      // An update re-emits `cron_armed`, which deriveCronJobs reads as a fresh
      // arming. That is the typed `/cron update` behaviour too; it must not be
      // a surprise arriving from a button.
      expect(document.body.textContent ?? "").toContain("run history")
    } finally {
      await harness.unmount()
    }
  })
})
