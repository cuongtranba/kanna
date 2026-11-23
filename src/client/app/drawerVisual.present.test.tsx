import { expect, test } from "vite-plus/test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { usePresentDrawerOnToggle, type DrawerVisual } from "./drawerVisual"

function mountToggle(enabled: boolean) {
  const presented: Array<0 | 1> = []
  const visual: DrawerVisual = {
    track: () => {},
    settle: async () => {},
    present: async (target) => { presented.push(target) },
    release: () => {},
  }
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  function Probe({ open }: { open: boolean }) {
    usePresentDrawerOnToggle(open, enabled, visual)
    return null
  }
  act(() => { root.render(<Probe open={false} />) })
  return {
    presented,
    setOpen: (open: boolean) => act(() => { root.render(<Probe open={open} />) }),
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

test("toggling the sidebar on a phone presents the drawer, but the first render does not", () => {
  const toggle = mountToggle(true)
  expect(toggle.presented).toEqual([])

  toggle.setOpen(true)
  toggle.setOpen(false)

  expect(toggle.presented).toEqual([1, 0])
  toggle.unmount()
})

test("toggling the docked desktop sidebar presents nothing", () => {
  const toggle = mountToggle(false)

  toggle.setOpen(true)

  expect(toggle.presented).toEqual([])
  toggle.unmount()
})
