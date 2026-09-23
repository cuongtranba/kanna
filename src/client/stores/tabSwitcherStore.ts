import { create } from "zustand"

interface TabSwitcherState {
  order: readonly string[] | null
  highlight: number
  holdBinding: string | null
  jumpHintsVisible: boolean
  openSwitcher: (order: readonly string[], holdBinding: string, reverse: boolean) => void
  stepSwitcher: (delta: number) => void
  highlightTab: (index: number) => void
  commitSwitcher: () => string | null
  closeSwitcher: () => void
  setJumpHintsVisible: (visible: boolean) => void
}

const CLOSED = { order: null, highlight: 0, holdBinding: null } as const

function wrap(index: number, length: number): number {
  return ((index % length) + length) % length
}

export const useTabSwitcherStore = create<TabSwitcherState>()((set, get) => ({
  ...CLOSED,
  jumpHintsVisible: false,
  openSwitcher: (order, holdBinding, reverse) => {
    if (order.length < 2) return
    set({ order, holdBinding, highlight: reverse ? order.length - 1 : 1 })
  },
  stepSwitcher: (delta) => {
    const { order, highlight } = get()
    if (!order) return
    set({ highlight: wrap(highlight + delta, order.length) })
  },
  highlightTab: (index) => {
    const { order } = get()
    if (!order || index < 0 || index >= order.length) return
    set({ highlight: index })
  },
  commitSwitcher: () => {
    const { order, highlight } = get()
    set({ ...CLOSED })
    return order?.[highlight] ?? null
  },
  closeSwitcher: () => set({ ...CLOSED }),
  setJumpHintsVisible: (visible) => {
    if (get().jumpHintsVisible !== visible) set({ jumpHintsVisible: visible })
  },
}))
