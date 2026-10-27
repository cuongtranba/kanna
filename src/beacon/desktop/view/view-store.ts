import { create } from "zustand"
import type { BeaconScope } from "../../../shared/beacon-scope"
import type { DesktopView } from "../desktop-types"

export interface GrantDraft {
  readRoots: readonly string[]
  exec: boolean
  askFirst: boolean
  consented: boolean
}

export function draftFromScope(scope: BeaconScope | null): GrantDraft {
  return {
    readRoots: scope?.readRoots ?? [],
    exec: scope?.exec ?? false,
    askFirst: !(scope?.autoRunScripts ?? false),
    consented: scope?.autoRunScripts ?? false,
  }
}

export function draftNeedsConsent(draft: GrantDraft): boolean {
  return !draft.askFirst && !draft.consented
}

const draftForScope = memoizeLast(draftFromScope)

function memoizeLast<TArg, TResult>(compute: (arg: TArg) => TResult): (arg: TArg) => TResult {
  let last: { arg: TArg; result: TResult } | null = null
  return (arg) => {
    if (last !== null && Object.is(last.arg, arg)) return last.result
    const result = compute(arg)
    last = { arg, result }
    return result
  }
}

interface DesktopViewState {
  view: DesktopView | null
  liveSince: number
  pasteText: string
  draft: GrantDraft | null
  menuOpen: boolean
  confirmingUnpair: boolean
  receiveView(view: DesktopView): void
  setPasteText(text: string): void
  addFolders(paths: readonly string[]): void
  removeFolder(path: string): void
  setExec(exec: boolean): void
  setAskFirst(askFirst: boolean): void
  setConsented(consented: boolean): void
  clearDraft(): void
  toggleMenu(): void
  closeMenu(): void
  askUnpair(): void
  cancelUnpair(): void
}

export function selectGrantDraft(state: Pick<DesktopViewState, "draft" | "view">): GrantDraft {
  return state.draft ?? draftForScope(state.view?.runner?.scope ?? null)
}

export const useDesktopViewStore = create<DesktopViewState>()((set) => ({
  view: null,
  liveSince: Number.POSITIVE_INFINITY,
  pasteText: "",
  draft: null,
  menuOpen: false,
  confirmingUnpair: false,
  receiveView: (view) =>
    set((state) => ({
      view,
      liveSince: state.view === null ? Math.max(0, ...view.activity.map((entry) => entry.at)) : state.liveSince,
      draft: view.screen.kind === "grant" ? state.draft : null,
      pasteText: view.screen.kind === "welcome" ? state.pasteText : "",
      menuOpen: view.screen.kind === "home" ? state.menuOpen : false,
      confirmingUnpair: view.screen.kind === "home" ? state.confirmingUnpair : false,
    })),
  setPasteText: (pasteText) => set({ pasteText }),
  addFolders: (paths) =>
    set((state) => {
      const base = selectGrantDraft(state)
      return { draft: { ...base, readRoots: [...new Set([...base.readRoots, ...paths])] } }
    }),
  removeFolder: (path) =>
    set((state) => {
      const base = selectGrantDraft(state)
      return { draft: { ...base, readRoots: base.readRoots.filter((root) => root !== path) } }
    }),
  setExec: (exec) => set((state) => ({ draft: { ...selectGrantDraft(state), exec } })),
  setAskFirst: (askFirst) =>
    set((state) => {
      const base = selectGrantDraft(state)
      return { draft: { ...base, askFirst, consented: askFirst ? false : base.consented } }
    }),
  setConsented: (consented) => set((state) => ({ draft: { ...selectGrantDraft(state), consented } })),
  clearDraft: () => set({ draft: null }),
  toggleMenu: () => set((state) => ({ menuOpen: !state.menuOpen, confirmingUnpair: false })),
  closeMenu: () => set({ menuOpen: false, confirmingUnpair: false }),
  askUnpair: () => set({ confirmingUnpair: true }),
  cancelUnpair: () => set({ confirmingUnpair: false }),
}))
