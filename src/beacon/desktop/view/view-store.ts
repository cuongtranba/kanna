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

interface DesktopViewState {
  view: DesktopView | null
  liveSince: number
  pasteText: string
  draft: GrantDraft | null
  menuOpen: boolean
  confirmingUnpair: boolean
  receiveView(view: DesktopView): void
  setPasteText(text: string): void
  addFolders(base: GrantDraft, paths: readonly string[]): void
  removeFolder(base: GrantDraft, path: string): void
  setExec(base: GrantDraft, exec: boolean): void
  setAskFirst(base: GrantDraft, askFirst: boolean): void
  setConsented(base: GrantDraft, consented: boolean): void
  clearDraft(): void
  toggleMenu(): void
  closeMenu(): void
  askUnpair(): void
  cancelUnpair(): void
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
  addFolders: (base, paths) => set({ draft: { ...base, readRoots: [...new Set([...base.readRoots, ...paths])] } }),
  removeFolder: (base, path) => set({ draft: { ...base, readRoots: base.readRoots.filter((root) => root !== path) } }),
  setExec: (base, exec) => set({ draft: { ...base, exec } }),
  setAskFirst: (base, askFirst) => set({ draft: { ...base, askFirst, consented: askFirst ? false : base.consented } }),
  setConsented: (base, consented) => set({ draft: { ...base, consented } }),
  clearDraft: () => set({ draft: null }),
  toggleMenu: () => set((state) => ({ menuOpen: !state.menuOpen, confirmingUnpair: false })),
  closeMenu: () => set({ menuOpen: false, confirmingUnpair: false }),
  askUnpair: () => set({ confirmingUnpair: true }),
  cancelUnpair: () => set({ confirmingUnpair: false }),
}))
