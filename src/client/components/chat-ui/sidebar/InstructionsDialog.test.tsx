
import { describe, expect, test } from "bun:test"
import { renderClientMarkup } from "../../../lib/testing/renderClientMarkup"
import { GLOBAL_PROMPT_APPEND_MAX_CHARS } from "../../../../shared/app-settings-types"
import { InstructionsDialog } from "./InstructionsDialog"

function props(overrides: Partial<Parameters<typeof InstructionsDialog>[0]> = {}) {
  return {
    open: true,
    onOpenChange: () => undefined,
    title: "Backend API",
    description: "Conventions for this project.",
    initialValue: "",
    onSave: () => undefined,
    ...overrides,
  }
}

describe("InstructionsDialog", () => {
  test("renders nothing while closed", async () => {
    const { cleanup } = await renderClientMarkup(<InstructionsDialog {...props({ open: false })} />)
    try {
      expect(document.body.textContent).not.toContain("Backend API")
    } finally {
      await cleanup()
    }
  })

  test("names what the instructions are for", async () => {
    const { cleanup } = await renderClientMarkup(<InstructionsDialog {...props()} />)
    try {
      expect(document.body.textContent).toContain("Instructions — Backend API")
      expect(document.body.textContent).toContain("Conventions for this project.")
    } finally {
      await cleanup()
    }
  })

  test("shows the persisted value", async () => {
    const { cleanup } = await renderClientMarkup(
      <InstructionsDialog {...props({ initialValue: "never edit generated/" })} />,
    )
    try {
      const textarea = document.body.querySelector("textarea")
      expect(textarea?.value).toBe("never edit generated/")
    } finally {
      await cleanup()
    }
  })

  test("counts against the same cap the server enforces", async () => {
    const { cleanup } = await renderClientMarkup(
      <InstructionsDialog {...props({ initialValue: "abc" })} />,
    )
    try {
      expect(document.body.textContent).toContain(`3 / ${GLOBAL_PROMPT_APPEND_MAX_CHARS}`)
    } finally {
      await cleanup()
    }
  })

  test("Save is disabled once the value is over the cap", async () => {
    const overCap = "x".repeat(GLOBAL_PROMPT_APPEND_MAX_CHARS + 1)
    const { cleanup } = await renderClientMarkup(
      <InstructionsDialog {...props({ initialValue: overCap })} />,
    )
    try {
      const save = [...document.body.querySelectorAll("button")]
        .find((b) => b.textContent === "Save")
      expect(save?.disabled).toBe(true)
    } finally {
      await cleanup()
    }
  })
})
