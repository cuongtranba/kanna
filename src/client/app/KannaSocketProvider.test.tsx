import { describe, expect, test } from "bun:test"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"
import {
  KannaSocketProvider,
  useKannaSocketInstance,
  useOptionalKannaSocket,
  wsUrl,
} from "./KannaSocketProvider"
import type { KannaSocket } from "./socket"
import { makeFakeDomPort, makeFakeStoragePort, makeFakeTimerPort } from "../lib/testing/fakePorts"
import type { WebSocketLike, WebSocketPort, WsEventPayload } from "../ports/webSocketPort"



class FakeWebSocket implements WebSocketLike {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = FakeWebSocket.CONNECTING
  closed = false

  send(_data: string): void { }
  close(): void { this.closed = true }
  addEventListener(_type: string, _handler: (event?: WsEventPayload) => void): void { }
}

function makeCountingWebSocketPort() {
  const created: string[] = []
  const port: WebSocketPort = {
    CONNECTING: FakeWebSocket.CONNECTING,
    OPEN: FakeWebSocket.OPEN,
    CLOSING: FakeWebSocket.CLOSING,
    CLOSED: FakeWebSocket.CLOSED,
    create(url: string): WebSocketLike {
      created.push(url)
      return new FakeWebSocket()
    },
  }
  return { port, created }
}

function makePorts(webSocket: WebSocketPort, href = "http://localhost:5174/chat/c-1") {
  return {
    dom: makeFakeDomPort({ href }),
    timer: makeFakeTimerPort(),
    localStorage: makeFakeStoragePort(),
    sessionStorage: makeFakeStoragePort(),
    webSocket,
  }
}


describe("wsUrl", () => {
  test("upgrades to wss for an https page", () => {
    expect(wsUrl(makeFakeDomPort({ href: "https://kanna.example/chat/c-1" })))
      .toBe("wss://kanna.example/ws")
  })

  test("keeps the port and drops the path", () => {
    expect(wsUrl(makeFakeDomPort({ href: "http://localhost:5174/chat/c-1" })))
      .toBe("ws://localhost:5174/ws")
  })
})


describe("KannaSocketProvider", () => {
  test("opens exactly ONE connection for two consumers", async () => {
    const { port, created } = makeCountingWebSocketPort()
    const seen: Array<KannaSocket | null> = []

    function Consumer() {
      seen.push(useKannaSocketInstance())
      return null
    }

    const result = await renderForLoopCheck(
      <KannaSocketProvider ports={makePorts(port)}>
        <Consumer />
        <Consumer />
      </KannaSocketProvider>,
    )

    expect(result.thrown).toBeNull()
    expect(result.loopWarnings).toEqual([])
    expect(created.length).toBe(1)
    expect(created[0]).toBe("ws://localhost:5174/ws")
    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(seen.every((socket) => socket === seen[0])).toBe(true)
    expect(seen[0]).not.toBeNull()

    await result.cleanup()
  })

  test("an injected socket is used as-is and none is created", async () => {
    const { port, created } = makeCountingWebSocketPort()
    const injected = { start() { }, dispose() { } } as unknown as KannaSocket
    const seen: KannaSocket[] = []

    function Consumer() {
      seen.push(useKannaSocketInstance())
      return null
    }

    const result = await renderForLoopCheck(
      <KannaSocketProvider socket={injected} ports={makePorts(port)}>
        <Consumer />
      </KannaSocketProvider>,
    )

    expect(result.thrown).toBeNull()
    expect(seen[0]).toBe(injected)
    expect(created.length).toBe(0)

    await result.cleanup()
  })

  test("useOptionalKannaSocket returns null with no provider", async () => {
    const seen: Array<KannaSocket | null> = []

    function Consumer() {
      seen.push(useOptionalKannaSocket())
      return null
    }

    const result = await renderForLoopCheck(<Consumer />)

    expect(result.thrown).toBeNull()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]).toBeNull()

    await result.cleanup()
  })
})
