import { describe, expect, test, vi } from "vite-plus/test"
import type { PushCommandDeps, PushManagerDep } from "./ws-router-push"
import { handlePushCommand } from "./ws-router-push"
import type { ClientCommand } from "../shared/protocol"


function makePushManager(overrides: Partial<PushManagerDep> = {}): PushManagerDep {
  return {
    recordDeviceSeen: vi.fn(async () => {}),
    addSubscription: vi.fn(async () => ({ id: "sub-1" })),
    removeSubscription: vi.fn(async () => {}),
    sendTest: vi.fn(async () => {}),
    setProjectMute: vi.fn(async () => {}),
    setChatMute: vi.fn(async () => {}),
    setFocusedChat: vi.fn(() => {}),
    ...overrides,
  }
}

interface TestDeps extends PushCommandDeps {
  sent: unknown[]
  broadcasts: Array<{ includePushConfig: boolean }>
  _deviceId: string | null | undefined
}

function makeDeps(
  pushManagerOverrides?: Partial<PushManagerDep>,
  initialDeviceId?: string | null,
): TestDeps {
  const sent: unknown[] = []
  const broadcasts: Array<{ includePushConfig: boolean }> = []
  let deviceId: string | null | undefined = initialDeviceId

  return {
    pushManager: makePushManager(pushManagerOverrides),
    getPushDeviceId: () => deviceId,
    setPushDeviceId: (id) => { deviceId = id },
    send: (envelope) => { sent.push(envelope) },
    broadcastPushConfig: async () => { broadcasts.push({ includePushConfig: true }) },
    sent,
    broadcasts,
    get _deviceId() { return deviceId },
  }
}


describe("handlePushCommand", () => {
  test("returns false for a non-push command", async () => {
    const deps = makeDeps()
    const handled = await handlePushCommand(
      deps,
      { type: "settings.readAppSettings" } as unknown as ClientCommand,
      "r0",
    )
    expect(handled).toBe(false)
    expect(deps.sent).toHaveLength(0)
    expect(deps.broadcasts).toHaveLength(0)
  })


  test("push.identifyDevice — sets deviceId, calls recordDeviceSeen, broadcasts, acks", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "push.identifyDevice", pushDeviceId: "dev-1" }
    const handled = await handlePushCommand(deps, cmd, "r1")
    expect(handled).toBe(true)
    expect(deps._deviceId).toBe("dev-1")
    expect(deps.pushManager.recordDeviceSeen as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("dev-1")
    expect(deps.broadcasts).toHaveLength(1)
    expect(deps.broadcasts[0]).toEqual({ includePushConfig: true })
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
  })

  test("push.identifyDevice with null — sets null, skips recordDeviceSeen, no broadcast", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "push.identifyDevice", pushDeviceId: null }
    const handled = await handlePushCommand(deps, cmd, "r2")
    expect(handled).toBe(true)
    expect(deps._deviceId).toBeNull()
    expect(deps.pushManager.recordDeviceSeen as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
    expect(deps.broadcasts).toHaveLength(0)
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
  })


  test("push.subscribe — calls addSubscription, sets deviceId from result, broadcasts, acks with result", async () => {
    const deps = makeDeps({ addSubscription: vi.fn(async () => ({ id: "sub-new" })) })
    const cmd: ClientCommand = {
      type: "push.subscribe",
      subscription: { endpoint: "https://example.com/push", keys: { p256dh: "abc", auth: "def" } },
      label: "Test device",
      userAgent: "Bun/1.0",
    }
    const handled = await handlePushCommand(deps, cmd, "r3")
    expect(handled).toBe(true)
    expect(deps._deviceId).toBe("sub-new")
    expect(deps.broadcasts).toHaveLength(1)
    const ack = deps.sent[0] as { type: string; result: unknown }
    expect(ack.type).toBe("ack")
    expect(ack.result).toEqual({ id: "sub-new" })
  })


  test("push.unsubscribe — calls removeSubscription, clears deviceId when it matches, broadcasts, acks", async () => {
    const deps = makeDeps(undefined, "dev-1")
    const cmd: ClientCommand = { type: "push.unsubscribe", pushDeviceId: "dev-1" }
    const handled = await handlePushCommand(deps, cmd, "r4")
    expect(handled).toBe(true)
    expect(deps.pushManager.removeSubscription as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("dev-1", "user_revoked")
    expect(deps._deviceId).toBeNull()
    expect(deps.broadcasts).toHaveLength(1)
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
  })

  test("push.unsubscribe — does not clear deviceId when different device is unsubscribed", async () => {
    const deps = makeDeps(undefined, "dev-1")
    const cmd: ClientCommand = { type: "push.unsubscribe", pushDeviceId: "dev-2" }
    await handlePushCommand(deps, cmd, "r5")
    expect(deps._deviceId).toBe("dev-1")
  })


  test("push.test — calls sendTest with current deviceId and acks", async () => {
    const deps = makeDeps(undefined, "dev-1")
    const cmd: ClientCommand = { type: "push.test" }
    const handled = await handlePushCommand(deps, cmd, "r6")
    expect(handled).toBe(true)
    expect(deps.pushManager.sendTest as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("dev-1")
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
  })

  test("push.test — skips sendTest when no deviceId, still acks", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "push.test" }
    const handled = await handlePushCommand(deps, cmd, "r7")
    expect(handled).toBe(true)
    expect(deps.pushManager.sendTest as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
  })


  test("push.setProjectMute — calls setProjectMute, broadcasts, acks", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "push.setProjectMute", localPath: "/projects/foo", muted: true }
    const handled = await handlePushCommand(deps, cmd, "r8")
    expect(handled).toBe(true)
    expect(deps.pushManager.setProjectMute as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("/projects/foo", true)
    expect(deps.broadcasts).toHaveLength(1)
    expect(deps.broadcasts[0]).toEqual({ includePushConfig: true })
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
  })


  test("push.setChatMute — calls setChatMute, broadcasts, acks", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "push.setChatMute", chatId: "chat-42", muted: true }
    const handled = await handlePushCommand(deps, cmd, "r11")
    expect(handled).toBe(true)
    expect(deps.pushManager.setChatMute as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("chat-42", true)
    expect(deps.broadcasts).toHaveLength(1)
    expect(deps.broadcasts[0]).toEqual({ includePushConfig: true })
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
  })

  test("push.setChatMute — unmute broadcasts, acks", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "push.setChatMute", chatId: "chat-42", muted: false }
    const handled = await handlePushCommand(deps, cmd, "r12")
    expect(handled).toBe(true)
    expect(deps.pushManager.setChatMute as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("chat-42", false)
    expect(deps.broadcasts).toHaveLength(1)
  })


  test("push.setFocusedChat — calls setFocusedChat when deviceId is set, acks", async () => {
    const deps = makeDeps(undefined, "dev-1")
    const cmd: ClientCommand = { type: "push.setFocusedChat", chatId: "chat-42" }
    const handled = await handlePushCommand(deps, cmd, "r9")
    expect(handled).toBe(true)
    expect(deps.pushManager.setFocusedChat as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("dev-1", "chat-42")
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
  })

  test("push.setFocusedChat — skips setFocusedChat when no deviceId, still acks", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "push.setFocusedChat", chatId: "chat-42" }
    const handled = await handlePushCommand(deps, cmd, "r10")
    expect(handled).toBe(true)
    expect(deps.pushManager.setFocusedChat as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
  })
})
