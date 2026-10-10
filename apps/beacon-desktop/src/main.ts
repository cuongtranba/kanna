import Electrobun, { BrowserView, BrowserWindow, Tray, Updater, Utils, type MenuItemConfig } from "electrobun/main"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { homedir, hostname, platform, userInfo } from "node:os"
import { dirname, join } from "node:path"
import { BEACON_DOWNLOAD_PAGE } from "../../../src/shared/beacon-pair-link"
import { createBeaconDesktopApp } from "../../../src/beacon/desktop/desktop-app"
import { createActivityLog, createLineLog, createPrefsStore } from "../../../src/beacon/desktop/desktop-files.adapter"
import { AUTOSTART_ENV, BEACON_APP_NAME, desktopPaths } from "../../../src/beacon/desktop/desktop-os"
import { createLoginItem, registerLinkHandler } from "../../../src/beacon/desktop/desktop-system.adapter"
import { createDesktopSelfUpdate } from "../../../src/beacon/desktop/desktop-updater"
import type { DesktopView } from "../../../src/beacon/desktop/desktop-types"
import { listenAsPrimaryInstance, notifyRunningInstance } from "../../../src/beacon/desktop/single-instance.adapter"
import { desktopStrings, type DesktopLocale } from "../../../src/beacon/desktop/strings"
import { createBeaconFs } from "../../../src/beacon/fs.adapter"
import { beaconOsFor } from "../../../src/beacon/host-os"
import { createKeyStore, eraseKeyStore } from "../../../src/beacon/key-store.adapter"
import { createPairClient } from "../../../src/beacon/pair-client.adapter"
import { createBeaconRunner } from "../../../src/beacon/runner"
import { createBeaconShell } from "../../../src/beacon/shell.adapter"
import { createStateStore } from "../../../src/beacon/state-store.adapter"
import { createBeaconTransfer } from "../../../src/beacon/transfer.adapter"
import { createWebSocketTransport } from "../../../src/beacon/transport.adapter"
import { BEACON_VERSION } from "../../../src/beacon/version"
import { RPC_MAX_REQUEST_MS, type BeaconDesktopRPC } from "./rpc"

const os = beaconOsFor(platform())
const paths = desktopPaths({
  os,
  beaconHome: process.env.KANNA_BEACON_HOME ?? join(homedir(), ".kanna-beacon"),
  userName: userInfo().username,
})
const binDir = dirname(process.execPath)
const launcherPath = join(binDir, os === "windows" ? "launcher.exe" : "launcher")
const helperPath = join(dirname(process.argv[1] ?? binDir), "open-link.js")
const launchedAtLogin = process.env[AUTOSTART_ENV] === "1"

const writeLog = createLineLog(paths.logFile)

function log(line: string): void {
  process.stderr.write(`[kanna-beacon] ${line}\n`)
  writeLog(line)
}

if (await notifyRunningInstance(paths.instanceEndpoint, { kind: "show" })) {
  process.exit(0)
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const selfUpdate = createDesktopSelfUpdate({
  localInfo: () => Updater.getLocalInfo(),
  checkForUpdate: () => Updater.checkForUpdate(),
  downloadUpdate: () => Updater.downloadUpdate(),
  updateInfo: () => Updater.updateInfo(),
  applyUpdate: () => Updater.applyUpdate(),
})

Updater.onStatusChange((entry) => {
  if (entry.status !== "download-progress") log(`updater ${entry.status}: ${entry.message}`)
})

const app = createBeaconDesktopApp({
  os,
  machine: hostname(),
  beaconVersion: BEACON_VERSION,
  stateStore: createStateStore(paths.stateFile),
  keys: {
    open: () => createKeyStore(paths.keyFile),
    erase: async () => eraseKeyStore(paths.keyFile),
  },
  pairClient: createPairClient(),
  prefs: createPrefsStore(paths.prefsFile),
  activityLog: createActivityLog(paths.activityFile),
  loginItem: createLoginItem({
    os,
    launcherPath,
    homeDir: homedir(),
    systemRoot: process.env.SystemRoot ?? "C:\\Windows",
  }),
  createRunner: ({ state, keyStore, startPaused, onActivity }) =>
    createBeaconRunner({
      state,
      os,
      beaconVersion: BEACON_VERSION,
      keyStore,
      openTransport: (url) => createWebSocketTransport({ url }),
      createFs: createBeaconFs,
      createShell: createBeaconShell,
      createTransfer: createBeaconTransfer,
      updater: selfUpdate.updater,
      autoUpdate: process.env.KANNA_BEACON_AUTO_UPDATE !== "disabled",
      sleep,
      now: Date.now,
      startPaused,
      onActivity,
    }),
  selfUpdate,
  sleep,
  log,
})

let locale: DesktopLocale = "en"
let instance: { close(): void } | null = null
let window: BrowserWindow | null = null
let windowRpc: ReturnType<typeof defineWindowRpc> | null = null

function defineWindowRpc() {
  return BrowserView.defineRPC<BeaconDesktopRPC>({
    maxRequestTime: RPC_MAX_REQUEST_MS,
    handlers: {
      requests: {
        getView: () => app.view(),
        submitPairingInput: ({ text }) => app.submitPairingInput(text),
        confirmPairing: () => app.confirmPairing(),
        cancelPairing: () => app.cancelPairing(),
        openGrant: () => app.openGrant(),
        closeGrant: () => app.closeGrant(),
        applyGrant: ({ grant }) => app.applyGrant(grant),
        pickFolders: async () => {
          const chosen = await Utils.openFileDialog({
            startingFolder: homedir(),
            canChooseFiles: false,
            canChooseDirectory: true,
            allowsMultipleSelection: true,
          })
          return { paths: chosen.filter((path) => path.trim().length > 0) }
        },
        setPaused: ({ paused }) => app.setPaused(paused),
        setLaunchAtLogin: ({ enabled }) => app.setLaunchAtLogin(enabled),
        unpair: () => app.unpair(),
        dismissNotice: () => app.dismissNotice(),
        openExternal: ({ url }) => ({ ok: url === BEACON_DOWNLOAD_PAGE && Utils.openExternal(url) }),
      },
      messages: {
        announceLocale: ({ locale: announced }) => {
          locale = announced
          refreshTray(app.view())
        },
      },
    },
  })
}

function showWindow(): void {
  if (window !== null) {
    window.show()
    window.activate()
    return
  }
  const rpc = defineWindowRpc()
  const opened = new BrowserWindow({
    title: BEACON_APP_NAME,
    url: "views://main/index.html",
    frame: { width: 460, height: 700, x: 160, y: 120 },
    rpc,
  })
  opened.on("close", () => {
    window = null
    windowRpc = null
  })
  window = opened
  windowRpc = rpc
}

const trayExtension = os === "windows" ? "ico" : "png"
const tray = new Tray({
  title: BEACON_APP_NAME,
  image: `views://assets/tray-idle.${trayExtension}`,
  template: false,
  width: 16,
  height: 16,
})

function trayImage(view: DesktopView): string {
  const live = view.runner?.status.phase === "online"
  return `views://assets/tray-${live ? "online" : "idle"}.${trayExtension}`
}

function refreshTray(view: DesktopView): void {
  const strings = desktopStrings(locale)
  const status = view.pairing === null ? strings.status.notPaired : statusWord(view)
  const items: MenuItemConfig[] = [
    { type: "normal", label: `${BEACON_APP_NAME}: ${status}`, action: "status", enabled: false },
    { type: "divider" },
    { type: "normal", label: strings.tray.open, action: "open" },
  ]
  if (view.pairing !== null) {
    items.push({ type: "normal", label: view.prefs.paused ? strings.tray.resume : strings.tray.pause, action: "toggle-pause" })
  }
  items.push({ type: "divider" }, { type: "normal", label: strings.tray.quit, action: "quit" })
  tray.setMenu(items)
  tray.setImage(trayImage(view))
  tray.setTitle(`${BEACON_APP_NAME}: ${status}`)
}

function statusWord(view: DesktopView): string {
  const strings = desktopStrings(locale)
  switch (view.runner?.status.phase) {
    case "online":
      return strings.status.online
    case "paused":
      return strings.status.paused
    case "revoked":
      return strings.status.revoked
    case "incompatible":
      return strings.status.incompatible
    case "updating":
      return strings.status.updating
    case "offline":
      return strings.status.offline
    default:
      return strings.status.connecting
  }
}

let released = false

function releaseInstance(): void {
  if (released) return
  released = true
  app.shutdown()
  instance?.close()
  instance = null
  tray.remove()
}

Electrobun.events.on("before-quit", releaseInstance)

async function quit(): Promise<void> {
  releaseInstance()
  Utils.quit()
}

tray.on("tray-clicked", (event) => {
  const action =
    typeof event === "object" && event !== null && "data" in event && typeof event.data === "object" && event.data !== null
      ? Reflect.get(event.data, "action")
      : undefined
  if (action === "quit") {
    void quit()
    return
  }
  if (action === "toggle-pause") {
    void app.setPaused(!app.view().prefs.paused)
    return
  }
  if (action === "status") return
  showWindow()
})

app.subscribe((view) => {
  windowRpc?.send.view(view)
  refreshTray(view)
})

instance = await listenAsPrimaryInstance(paths.instanceEndpoint, (message) => {
  if (message.kind === "link") app.receiveLink(message.url)
  showWindow()
}).catch((error: Error) => {
  log(`another instance owns ${paths.instanceEndpoint}: ${error.message}`)
  return null
})

Electrobun.events.on("open-url", (event) => {
  const url = Reflect.get(event.data ?? {}, "url")
  if (typeof url === "string") app.receiveLink(url)
  showWindow()
})

await app.start()
refreshTray(app.view())

registerLinkHandler({ os, bunPath: process.execPath, helperPath, homeDir: homedir() }).catch((error: Error) =>
  log(`could not register the kanna-beacon: link handler: ${error.message}`),
)

let pendingLink: string | null = null
if (existsSync(paths.pendingLinkFile)) {
  pendingLink = readFileSync(paths.pendingLinkFile, "utf8").trim()
  rmSync(paths.pendingLinkFile, { force: true })
}
if (pendingLink) app.receiveLink(pendingLink)

if (!launchedAtLogin || app.view().pairing === null || pendingLink) showWindow()
