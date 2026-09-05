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
      // The contract is that a button ENUMERATES what it animates. It used to
      // read `transition-colors`; it now also carries the press scale, so the
      // list is explicit rather than a single property — `transition-all`
      // stays banned, which is the part that was ever load-bearing.
      expect(button?.className).toContain("transition-[colors,transform]")
      expect(button?.className).not.toContain("transition-all")
      // The press feedback itself, and its reduced-motion opt-out. On a phone
      // this is the only acknowledgement a 44px target gives.
      expect(button?.className).toContain("active:scale-[0.955]")
      expect(button?.className).toContain("motion-reduce:active:scale-100")
      // A disabled control must not appear to respond to a press.
      expect(button?.className).toContain("disabled:active:scale-100")
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
