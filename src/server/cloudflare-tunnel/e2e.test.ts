import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AppSettingsManager } from "../app-settings"
import { EventStore } from "../event-store"
import { waitFor } from "../test-helpers/wait-for"
import type { CloudflareTunnelEvent } from "./events"
import { TunnelGateway } from "./gateway"
import { TunnelLifecycle } from "./lifecycle"
import { deriveChatTunnels } from "./read-model"
import { TunnelManager, type ChildHandle } from "./tunnel-manager"

interface FakeChild extends ChildHandle {
  emitStdout: (chunk: string) => void
  emitExit: (code: number) => void
}

function fakeChild(): FakeChild {
  const stdoutListeners: Array<(c: string) => void> = []
  const exitListeners: Array<(c: number) => void> = []
  const child: FakeChild = {
    pid: 9999,
    kill: () => {
      for (const l of exitListeners) l(0)
    },
    onStdout: (l: (chunk: string) => void) => {
      stdoutListeners.push(l)
    },
    onStderr: () => {},
    onExit: (l: (code: number) => void) => {
      exitListeners.push(l)
    },
    isKilled: () => false,
    emitStdout: (chunk: string) => {
      for (const l of stdoutListeners) l(chunk)
    },
    emitExit: (code: number) => {
      for (const l of exitListeners) l(code)
    },
  }
  return child
}

describe("cloudflare tunnel e2e", () => {
  let dataDir: string
  let store: EventStore
  let appSettings: AppSettingsManager
  let manager: TunnelManager
  let lifecycle: TunnelLifecycle
  let gateway: TunnelGateway
  let pendingChildren: FakeChild[]
  let broadcasts: string[]
  let pendingWrites: Promise<void>[]

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kanna-tunnel-e2e-"))
    store = new EventStore(dataDir)
    await store.initialize()

    const settingsPath = join(dataDir, "settings.json")
    await Bun.write(
      settingsPath,
      JSON.stringify({
        analyticsEnabled: false,
        cloudflareTunnel: { enabled: true, cloudflaredPath: "cloudflared", mode: "always-ask" },
      }),
    )
    appSettings = new AppSettingsManager(settingsPath)
    await appSettings.initialize()

    pendingChildren = []
    broadcasts = []
    pendingWrites = []

    manager = new TunnelManager({
      cloudflaredPath: "cloudflared",
      spawn: () => {
        const child = fakeChild()
        pendingChildren.push(child)
        return child
      },
      onEvent: (event: CloudflareTunnelEvent) => {
        pendingWrites.push(store.appendTunnelEvent(event))
        broadcasts.push(event.chatId)
      },
    })
    lifecycle = new TunnelLifecycle({
      pollIntervalMs: 1000,
      isPidAlive: () => true,
      onSourceExit: () => {},
    })
    gateway = new TunnelGateway({
      manager,
      lifecycle,
      settings: appSettings,
      store,
      broadcast: (chatId: string) => {
        broadcasts.push(chatId)
      },
    })
  })

  afterEach(async () => {
    gateway.shutdown()
    appSettings.dispose()
    await Promise.all(pendingWrites)
    await rm(dataDir, { recursive: true, force: true })
  })

  test("propose → accept → active → stop full flow", async () => {
    const proposal = await gateway.proposeFromTool({ chatId: "c1", port: 5173 })
    expect(proposal.status).toBe("proposed")
    if (proposal.status !== "proposed") throw new Error("expected proposed outcome")

    const eventsAfterPropose = store.getTunnelEvents("c1")
    const proposed = eventsAfterPropose.find((e) => e.kind === "tunnel_proposed")
    expect(proposed).toBeDefined()
    if (!proposed || proposed.kind !== "tunnel_proposed") throw new Error("no proposed event")
    expect(proposed.port).toBe(5173)
    expect(proposed.tunnelId).toBe(proposal.tunnelId)

    await gateway.accept("c1", proposed.tunnelId)
    expect(pendingChildren).toHaveLength(1)

    pendingChildren[0].emitStdout("https://abc.trycloudflare.com\n")

    await waitFor(
      () => store.getTunnelEvents("c1").some((e) => e.kind === "tunnel_active"),
      2000,
      "tunnel_active event",
    )

    const eventsAfterActive = store.getTunnelEvents("c1")
    const active = eventsAfterActive.find((e) => e.kind === "tunnel_active")
    expect(active).toBeDefined()
    if (!active || active.kind !== "tunnel_active") throw new Error("no active event")
    expect(active.url).toBe("https://abc.trycloudflare.com")

    await gateway.stop("c1", proposed.tunnelId)

    await waitFor(
      () => store.getTunnelEvents("c1").some((e) => e.kind === "tunnel_stopped"),
      2000,
      "tunnel_stopped event",
    )

    const stopped = store.getTunnelEvents("c1").find((e) => e.kind === "tunnel_stopped")
    expect(stopped).toBeDefined()
    if (stopped && stopped.kind === "tunnel_stopped") {
      expect(stopped.reason).toBe("user")
    }
  })

  test("stop on proposed tunnel emits tunnel_stopped and clears liveTunnelId", async () => {
    const proposal = await gateway.proposeFromTool({ chatId: "c1", port: 5173 })
    if (proposal.status !== "proposed") throw new Error("expected proposed outcome")

    expect(deriveChatTunnels(store.getTunnelEvents("c1"), "c1").liveTunnelId).toBe(proposal.tunnelId)
    expect(pendingChildren).toHaveLength(0)

    await gateway.stop("c1", proposal.tunnelId)

    const events = store.getTunnelEvents("c1")
    const stopped = events.find((e) => e.kind === "tunnel_stopped")
    expect(stopped).toBeDefined()
    if (stopped && stopped.kind === "tunnel_stopped") {
      expect(stopped.reason).toBe("user")
      expect(stopped.tunnelId).toBe(proposal.tunnelId)
    }
    expect(deriveChatTunnels(events, "c1").liveTunnelId).toBeNull()
  })

  test("disabled setting → returns disabled, no proposed event", async () => {
    await appSettings.setCloudflareTunnel({ enabled: false })
    const outcome = await gateway.proposeFromTool({ chatId: "c1", port: 5173 })
    expect(outcome.status).toBe("disabled")
    expect(store.getTunnelEvents("c1")).toEqual([])
  })

  test("duplicate propose for live port returns already_live without new event", async () => {
    const first = await gateway.proposeFromTool({ chatId: "c1", port: 5173 })
    expect(first.status).toBe("proposed")
    const second = await gateway.proposeFromTool({ chatId: "c1", port: 5173 })
    expect(second.status).toBe("already_live")
    const proposed = store.getTunnelEvents("c1").filter((e) => e.kind === "tunnel_proposed")
    expect(proposed).toHaveLength(1)
  })

  test("invalid port returns invalid_port", async () => {
    const outcome = await gateway.proposeFromTool({ chatId: "c1", port: 99999 })
    expect(outcome.status).toBe("invalid_port")
    expect(store.getTunnelEvents("c1")).toEqual([])
  })

  test("auto-expose mode triggers cloudflared without explicit accept", async () => {
    await appSettings.setCloudflareTunnel({ mode: "auto-expose" })
    const outcome = await gateway.proposeFromTool({ chatId: "c1", port: 5173 })
    expect(outcome.status).toBe("auto_exposed")

    await waitFor(
      () => store.getTunnelEvents("c1").some((e) => e.kind === "tunnel_accepted"),
      2000,
      "tunnel_accepted event",
    )

    expect(pendingChildren).toHaveLength(1)
    const accepted = store.getTunnelEvents("c1").find((e) => e.kind === "tunnel_accepted")
    expect(accepted).toBeDefined()
    if (accepted && accepted.kind === "tunnel_accepted") {
      expect(accepted.source).toBe("auto_setting")
    }
  })

  test("auto-expose mode returns already_live for same port without spawning twice", async () => {
    await appSettings.setCloudflareTunnel({ mode: "auto-expose" })
    const first = await gateway.proposeFromTool({ chatId: "c1", port: 5173 })
    expect(first.status).toBe("auto_exposed")
    const second = await gateway.proposeFromTool({ chatId: "c1", port: 5173 })
    expect(second.status).toBe("already_live")
    expect(pendingChildren).toHaveLength(1)
  })
})
