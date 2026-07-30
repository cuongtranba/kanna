import "../lib/testing/setupHappyDom"
import { describe, expect, test, afterEach } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ImportSessionsDialog, type ImportSessionsDialogProps } from "./ImportSessionsDialog"

const ID = "4f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f"

let root: Root | null = null
let container: HTMLDivElement | null = null
afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove()
  root = null
  container = null
})

async function renderDialog(overrides: Partial<ImportSessionsDialogProps> = {}) {
  const calls = { importAll: 0, importSessions: [] as string[][] }
  container = document.createElement("div")
  document.body.appendChild(container)
  const props: ImportSessionsDialogProps = {
    open: true,
    busy: false,
    onClose: () => {},
    onImportAll: () => { calls.importAll += 1 },
    onImportSessions: (ids) => { calls.importSessions.push(ids) },
    ...overrides,
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(<ImportSessionsDialog {...props} />)
  })
  return { calls }
}

function importSessionsButton(): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find((b) =>
    /^import sessions?$/i.test(b.textContent ?? ""),
  )
  expect(button).not.toBeUndefined()
  return button as HTMLButtonElement
}

function importAllButton(): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find((b) =>
    /import all/i.test(b.textContent ?? ""),
  )
  expect(button).not.toBeUndefined()
  return button as HTMLButtonElement
}

function setNativeValue(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  setter?.call(el, value)
}

describe("ImportSessionsDialog", () => {
  test("empty input: Import session disabled, Import all fires bulk", async () => {
    const { calls } = await renderDialog()
    expect(importSessionsButton().disabled).toBe(true)
    await act(async () => { importAllButton().click() })
    expect(calls.importAll).toBe(1)
  })

  test("pasted path + uuid list: extracts ids and fires onImportSessions", async () => {
    const { calls } = await renderDialog()
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement
    expect(textarea).not.toBeNull()
    await act(async () => {
      setNativeValue(textarea, `/x/y/${ID}.jsonl\n00000000-0000-4000-8000-000000000000`)
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => { importSessionsButton().click() })
    expect(calls.importSessions).toEqual([[ID, "00000000-0000-4000-8000-000000000000"]])
  })

  test("garbage input shows inline validation, no call", async () => {
    const { calls } = await renderDialog()
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement
    await act(async () => {
      setNativeValue(textarea, "not-a-uuid")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(document.body.textContent?.toLowerCase()).toContain("no valid session id")
    expect(importSessionsButton().disabled).toBe(true)
    expect(calls.importSessions).toEqual([])
  })

  test("busy disables all action buttons", async () => {
    await renderDialog({ busy: true })
    expect(importAllButton().disabled).toBe(true)
    expect(importSessionsButton().disabled).toBe(true)
  })
})
