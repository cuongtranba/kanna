import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TooltipProvider } from "../ui/tooltip"
import { PtyTuiStatusLine } from "./ChatNavbar"

describe("PtyTuiStatusLine", () => {
  test("renders the raw spinner line as monospace tabular-nums text", () => {
    const raw = "Whirlpooling… (11m 11s · ↓ 40.5k tokens · almost done thinking with xhigh effort)"
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <PtyTuiStatusLine raw={raw} />
      </TooltipProvider>,
    )
    expect(html).toContain("almost done thinking with xhigh effort")
    expect(html).toContain("↓ 40.5k tokens")
    expect(html).toContain("font-mono")
    expect(html).toContain("tabular-nums")
  })
})
