import { createRoot } from "react-dom/client"
import { Electroview } from "electrobun/view"
import type { DesktopView } from "../../../src/beacon/desktop/desktop-types"
import { desktopStrings, pickDesktopLocale } from "../../../src/beacon/desktop/strings"
import { BeaconDesktopView } from "../../../src/beacon/desktop/view/BeaconDesktopView"
import type { DesktopBridge } from "../../../src/beacon/desktop/view/bridge"
import { RPC_MAX_REQUEST_MS, type BeaconDesktopRPC } from "./rpc"

const viewListeners = new Set<(view: DesktopView) => void>()

const rpc = Electroview.defineRPC<BeaconDesktopRPC>({
  maxRequestTime: RPC_MAX_REQUEST_MS,
  handlers: {
    requests: {},
    messages: {
      view: (view) => {
        for (const listener of viewListeners) listener(view)
      },
    },
  },
})
new Electroview({ rpc })

const bridge: DesktopBridge = {
  request: (name, params) => rpc.request[name](params),
  onView(listener) {
    viewListeners.add(listener)
    return () => {
      viewListeners.delete(listener)
    }
  },
  announceLocale(locale) {
    rpc.send.announceLocale({ locale })
  },
}

const locale = pickDesktopLocale(navigator.languages.length > 0 ? navigator.languages : [navigator.language])
document.documentElement.lang = locale
const root = document.getElementById("root")
if (root) createRoot(root).render(<BeaconDesktopView bridge={bridge} strings={desktopStrings(locale)} locale={locale} />)
