import { describe, expect, test } from "bun:test"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import { Button } from "./button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog"
import { StatusPill } from "./status-pill"

describe("shared interaction design contract", () => {
  test("buttons use explicit motion, editorial radii, and coarse-pointer hit areas", async () => {
    const rendered = await renderForLoopCheck(<Button>Continue</Button>)
    try {
      const button = document.querySelector("button")
      expect(button?.className).toContain("transition-colors")
      expect(button?.className).not.toContain("transition-all")
      expect(button?.className).toContain("rounded-md")
      expect(button?.className).toContain("max-md:min-h-11")
    } finally {
      await rendered.cleanup()
    }
  })

  test("destructive buttons use the tested filled token pair", async () => {
    const rendered = await renderForLoopCheck(<Button variant="destructive">Delete</Button>)
    try {
      const button = document.querySelector("button")
      expect(button?.className).toContain("bg-destructive-filled")
      expect(button?.className).toContain("text-destructive-filled-foreground")
    } finally {
      await rendered.cleanup()
    }
  })

  test("status labels use sentence case label typography without pulsing", async () => {
    const rendered = await renderForLoopCheck(<StatusPill tone="attention" label="Running" pulse />)
    try {
      const pill = document.querySelector("span")
      expect(pill?.className).toContain("text-xs")
      expect(pill?.className).not.toContain("uppercase")
      expect(document.querySelector(".animate-pulse")).toBeNull()
    } finally {
      await rendered.cleanup()
    }
  })

  test("dialog close controls meet the mobile touch-target contract", async () => {
    const rendered = await renderForLoopCheck(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure this view.</DialogDescription>
        </DialogContent>
      </Dialog>,
    )
    try {
      const close = [...document.querySelectorAll("button")].find((button) => button.textContent === "Close")
      expect(close?.className).toContain("h-11 w-11")
    } finally {
      await rendered.cleanup()
    }
  })
})
