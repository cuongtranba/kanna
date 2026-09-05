import "./setupHappyDom"
import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"

export interface ClientRenderResult {
  html: string
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
