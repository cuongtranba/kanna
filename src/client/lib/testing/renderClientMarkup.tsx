import "./setupHappyDom"
import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"

/**
 * Render a component the way the browser does, and hand back its markup.
 *
 * `renderToStaticMarkup` is the default in this codebase and should stay that
 * way — it is synchronous and needs no DOM. But it cannot exercise anything
 * that reads a zustand store: zustand v5 serves `getInitialState()` as the
 * `useSyncExternalStore` SERVER snapshot, so a `setState` in a test is invisible
 * to a server render and the component always sees its initial state.
 *
 * Use this only for that case — a component whose behaviour under test depends
 * on store state (viewport width, feature flags). Everything else belongs in a
 * `renderToStaticMarkup` test.
 */
export interface ClientRenderResult {
  html: string
  /**
   * The live mount point, for the tests that have to DISPATCH rather than read:
   * a synthetic React handler only fires through the root React delegated to,
   * so an event has to be sent at a node inside this element. `html` is a
   * snapshot taken at mount and does not update as the tree does.
   */
  container: HTMLElement
  cleanup: () => Promise<void>
}

export async function renderClientMarkup(element: ReactElement): Promise<ClientRenderResult> {
  const container = document.createElement("div")
  document.body.appendChild(container)

  let root: Root | null = null
  await act(async () => {
    root = createRoot(container)
    root.render(element)
  })

  return {
    html: container.innerHTML,
    container,
    cleanup: async () => {
      await act(async () => {
        root?.unmount()
      })
      container.remove()
    },
  }
}
