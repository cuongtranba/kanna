import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./resizable"

describe("ResizableHandle", () => {
  test("forwards disabled state to the separator", () => {
    const html = renderToStaticMarkup(
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel id="left" defaultSize="50%">
          <div>left</div>
        </ResizablePanel>
        <ResizableHandle orientation="horizontal" disabled />
        <ResizablePanel id="right" defaultSize="50%">
          <div>right</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    )

    expect(html).toContain('data-separator="disabled"')
    expect(html).toContain('aria-disabled="true"')
  })

  /**
   * The grab area is the whole feature: a divider you cannot find or land on is
   * a resize affordance that does not exist. These pin the two states the user
   * actually experiences.
   */
  test("marks the divider at rest and lifts it on hover, focus and drag", () => {
    const html = renderToStaticMarkup(
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel id="left" defaultSize="50%">
          <div>left</div>
        </ResizablePanel>
        <ResizableHandle orientation="horizontal" withHandle />
        <ResizablePanel id="right" defaultSize="50%">
          <div>right</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    )

    // The library's own state attribute, not :hover/:active — it keeps
    // reporting "active" while a drag holds pointer capture outside the strip,
    // which is exactly when the divider must stay lit.
    expect(html).toContain('data-separator="inactive"')
    expect(html).toContain("before:bg-border")
    for (const lit of [
      "data-[separator=hover]:before:bg-ring",
      "data-[separator=active]:before:bg-ring",
      "focus-visible:before:bg-ring",
    ]) {
      expect(html).toContain(lit)
    }
  })

  test("widens the grab area for a coarse pointer", () => {
    // Touch devices get the real tree above the md breakpoint, so the divider
    // has to be reachable by finger and not just by cursor.
    const html = renderToStaticMarkup(
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel id="top" defaultSize="50%">
          <div>top</div>
        </ResizablePanel>
        <ResizableHandle orientation="vertical" withHandle />
        <ResizablePanel id="bottom" defaultSize="50%">
          <div>bottom</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    )

    expect(html).toContain("pointer-coarse:h-5")
    expect(html).toContain("pointer-coarse:-my-2.5")
  })

  test("omits the divider line when withHandle is not set", () => {
    const html = renderToStaticMarkup(
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel id="left" defaultSize="50%">
          <div>left</div>
        </ResizablePanel>
        <ResizableHandle orientation="horizontal" />
        <ResizablePanel id="right" defaultSize="50%">
          <div>right</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    )

    expect(html).not.toContain("before:bg-border")
  })
})
