import { createRoot } from "react-dom/client"
import { DEFAULT_BEACON_SCOPE } from "../../../src/shared/beacon-scope"
import type { BeaconActivity } from "../../../src/beacon/activity"
import type { DesktopScreen, DesktopView } from "../../../src/beacon/desktop/desktop-types"
import { desktopStrings, type DesktopLocale } from "../../../src/beacon/desktop/strings"
import { BeaconDesktopView } from "../../../src/beacon/desktop/view/BeaconDesktopView"
import { useDesktopViewStore } from "../../../src/beacon/desktop/view/view-store"
import type { DesktopBridge } from "../../../src/beacon/desktop/view/bridge"

const params = new URLSearchParams(location.search)
const locale: DesktopLocale = params.get("locale") === "vi" ? "vi" : "en"
const state = params.get("state") ?? "home"
const now = Date.now()
const minutes = (count: number) => now - count * 60_000

const SAMPLE_ACTIVITY: BeaconActivity[] = [
  { id: "a1", at: minutes(2), verb: "read", target: "C:\\Users\\Linh\\Documents\\Quarterly report.pdf", outcome: { kind: "done" } },
  { id: "a2", at: minutes(6), verb: "run", target: "git status --short", outcome: { kind: "exit", code: 0 } },
  { id: "a3", at: minutes(7), verb: "run", target: "npm test", outcome: { kind: "exit", code: 1 } },
  { id: "a4", at: minutes(9), verb: "search", target: "invoice in D:\\Projects\\shop", outcome: { kind: "done" } },
  { id: "a5", at: minutes(12), verb: "read", target: "C:\\Windows\\System32\\drivers\\etc\\hosts", outcome: { kind: "refused", message: "outside roots" } },
  { id: "a6", at: minutes(60 * 26), verb: "list", target: "D:\\Projects\\shop\\src", outcome: { kind: "done" } },
]

const SCOPE = {
  ...DEFAULT_BEACON_SCOPE,
  readRoots: ["C:\\Users\\Linh\\Documents", "D:\\Projects", "\\\\nas\\family\\photos"],
  exec: true,
  autoRunScripts: params.has("auto"),
}

function screenFor(name: string): DesktopScreen {
  switch (name) {
    case "welcome":
      return { kind: "welcome", inputRejected: params.has("rejected") }
    case "confirm":
      return {
        kind: "confirm",
        target: { kannaUrl: "https://kanna.example.com", code: "ABCD2345" },
        pairing: false,
        error: params.has("error") ? { kind: "expired" } : null,
      }
    case "grant":
      return { kind: "grant", firstRun: true, saving: false, saveError: null }
    default:
      return { kind: "home" }
  }
}

const paired = state !== "welcome" && state !== "confirm"
const phase = params.get("phase") ?? "online"
const view: DesktopView = {
  os: "windows",
  machine: "LINH-LAPTOP",
  screen: screenFor(state),
  pairing: paired ? { kannaUrl: "https://kanna.example.com", beaconId: "b-1" } : null,
  runner: paired
    ? {
        status:
          phase === "offline"
            ? { phase: "offline", attempt: 3, retryAt: now + 8_000, reason: "unreachable" }
            : phase === "paused"
              ? { phase: "paused" }
              : phase === "revoked"
                ? { phase: "revoked" }
                : { phase: "online", since: minutes(42) },
        scope: SCOPE,
        scopeSync: true,
      }
    : null,
  activity: params.has("empty") ? [] : SAMPLE_ACTIVITY,
  prefs: { paused: phase === "paused", launchAtLogin: true },
  notice: params.has("notice") ? { kind: "unpaired", kannaInformed: false, kannaUrl: "https://kanna.example.com" } : null,
  busy: { unpairing: false, launchAtLogin: false },
}

const bridge: DesktopBridge = {
  request: async (name) => (name === "getView" ? view : name === "pickFolders" ? { paths: [] } : { ok: true }) as never,
  onView: () => () => {},
  announceLocale: () => {},
}

if (params.has("consent")) {
  useDesktopViewStore.setState({ draft: { readRoots: SCOPE.readRoots, exec: true, askFirst: false, consented: false } })
}

const root = document.getElementById("root")
if (root) createRoot(root).render(<BeaconDesktopView bridge={bridge} strings={desktopStrings(locale)} locale={locale} />)
