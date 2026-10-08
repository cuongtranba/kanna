import { describe, expect, test } from "bun:test"
import type { BeaconFrame } from "../shared/beacon-protocol"
import { backoffMs, beaconSocketUrl, parseBeaconArgs, runBeaconCli, type BeaconCliDeps } from "./main"
import type { BeaconPairingRequest, BeaconState, BeaconTransport } from "./ports"

function createDeps(overrides: Partial<BeaconCliDeps> = {}): { deps: BeaconCliDeps; logs: string[] } {
  const logs: string[] = []
  const deps: BeaconCliDeps = {
    os: "linux",
    hostname: "box",
    beaconVersion: "0.1.0",
    openKeyStore: () => ({ publicKeySpkiBase64: () => "PUB", sign: () => "SIG" }),
    stateStore: { load: async () => null, save: async () => {} },
    pairClient: { pair: async () => ({ ok: false, error: "unused" }) },
    openTransport: () => {
      throw new Error("no transport expected")
    },
    createFs: () => ({
      read: async () => null,
      stat: async () => null,
      glob: async () => null,
      grep: async () => null,
      fetchChunk: async () => null,
    }),
    createShell: () => ({ exec: async () => 0, script: async () => 0 }),
    sleep: async () => {},
    log: (line) => {
      logs.push(line)
    },
    ...overrides,
  }
  return { deps, logs }
}

describe("parseBeaconArgs", () => {
  test("parses pair with a url and code, trimming trailing slashes", () => {
    expect(parseBeaconArgs(["pair", "https://kanna.example/", "ABCD2345"])).toEqual({
      command: "pair",
      kannaUrl: "https://kanna.example",
      code: "ABCD2345",
    })
  })

  test("parses run", () => {
    expect(parseBeaconArgs(["run"])).toEqual({ command: "run" })
  })

  test("rejects unknown, incomplete and malformed invocations", () => {
    expect(parseBeaconArgs([]).command).toBe("invalid")
    expect(parseBeaconArgs(["bogus"]).command).toBe("invalid")
    expect(parseBeaconArgs(["pair", "https://kanna.example"]).command).toBe("invalid")
    expect(parseBeaconArgs(["pair", "kanna.example", "CODE"]).command).toBe("invalid")
    expect(parseBeaconArgs(["run", "extra"]).command).toBe("invalid")
  })
})

describe("beacon connection helpers", () => {
  test("maps the kanna url onto the /beacon websocket endpoint", () => {
    expect(beaconSocketUrl("http://localhost:3210")).toBe("ws://localhost:3210/beacon")
    expect(beaconSocketUrl("https://kanna.example/")).toBe("wss://kanna.example/beacon")
  })

  test("backs off exponentially up to a ceiling", () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([1000, 2000, 4000])
    expect(backoffMs(40)).toBe(30_000)
  })
})

describe("runBeaconCli", () => {
  test("pair posts the public key and saves the returned identity", async () => {
    const requests: BeaconPairingRequest[] = []
    const saved: BeaconState[] = []
    const { deps } = createDeps({
      pairClient: {
        pair: async (_url, request) => {
          requests.push(request)
          return { ok: true, beaconId: "b-9" }
        },
      },
      stateStore: { load: async () => null, save: async (state) => void saved.push(state) },
    })
    expect(await runBeaconCli(["pair", "http://kanna.local/", "CODE"], deps)).toBe(0)
    expect(requests).toEqual([{ code: "CODE", publicKey: "PUB", label: "box", os: "linux" }])
    expect(saved).toEqual([{ kannaUrl: "http://kanna.local", beaconId: "b-9" }])
  })

  test("pair reports a refused code with a failing exit code", async () => {
    const { deps, logs } = createDeps({ pairClient: { pair: async () => ({ ok: false, error: "expired" }) } })
    expect(await runBeaconCli(["pair", "http://kanna.local", "CODE"], deps)).toBe(1)
    expect(logs.join("\n")).toContain("expired")
  })

  test("run refuses to start on an unpaired machine", async () => {
    const { deps } = createDeps()
    expect(await runBeaconCli(["run"], deps)).toBe(1)
  })

  test("run reconnects after a drop and stops for good on an incompatible server", async () => {
    const urls: string[] = []
    const sleeps: number[] = []
    let attempt = 0
    const openTransport = (url: string): BeaconTransport => {
      urls.push(url)
      attempt += 1
      const current = attempt
      let onFrame: (frame: BeaconFrame) => void = () => {}
      const closers: Array<() => void> = []
      const closeAll = () => {
        for (const close of closers) close()
      }
      return {
        send: (frame) => {
          if (frame.kind !== "hello") return
          if (current === 1) closeAll()
          else onFrame({ kind: "incompatible", minSupported: 9, downloadUrl: "https://dl.example" })
        },
        onFrame: (callback) => {
          onFrame = callback
        },
        onClose: (callback) => {
          closers.push(callback)
        },
        close: closeAll,
      }
    }
    const { deps, logs } = createDeps({
      stateStore: { load: async () => ({ kannaUrl: "http://kanna.local", beaconId: "b-1" }), save: async () => {} },
      openTransport,
      sleep: async (ms) => void sleeps.push(ms),
    })
    expect(await runBeaconCli(["run"], deps)).toBe(2)
    expect(urls).toEqual(["ws://kanna.local/beacon", "ws://kanna.local/beacon"])
    expect(sleeps).toEqual([1000])
    expect(logs.join("\n")).toContain("https://dl.example")
  })
})
