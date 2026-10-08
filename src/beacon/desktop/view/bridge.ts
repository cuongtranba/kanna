import type { DesktopRequests, DesktopView } from "../desktop-types"
import type { DesktopLocale } from "../strings"

export type DesktopRequestName = keyof DesktopRequests

export interface DesktopBridge {
  request<K extends DesktopRequestName>(
    name: K,
    params: DesktopRequests[K]["params"],
  ): Promise<DesktopRequests[K]["response"]>
  onView(listener: (view: DesktopView) => void): () => void
  announceLocale(locale: DesktopLocale): void
}

export const NO_PARAMS: Record<string, never> = {}
