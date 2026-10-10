import { describe, expect, test } from "bun:test"
import { BEACON_DOWNLOAD_PAGE } from "../shared/beacon-pair-link"
import type { BeaconFrame } from "../shared/beacon-protocol"
import { DEFAULT_BEACON_SCOPE } from "../shared/beacon-scope"
import {
  backoffMs,
  beaconSocketUrl,
  parseBeaconArgs,
  RESTART_EXIT_CODE,
  runBeaconCli,
  type BeaconCliDeps,
} from "./main"
import type { BeaconPairingRequest, BeaconState, BeaconTransport } from "./ports"
import { UNSUPPORTED_UPDATER } from "./self-update"

const PAIRED: BeaconState = { kannaUrl: "http://kanna.local", beaconId: "b-1" }

function scriptedServer(reply: (frame: BeaconFrame) => BeaconFrame | null): (url: string) => BeaconTransport {
  return () => {
    let onFrame: (frame: BeaconFrame) => void = () => {}
    const closers: Array<() => void> = []
    return {
      send: (frame) => {
        const answer = reply(frame)
        if (answer !== null) onFrame(answer)
      },
      onFrame: (callback) => {
        onFrame = callback
      },
      onClose: (callback) => {
        closers.push(callback)
      },
      close: () => {
        for (const close of closers.splice(0)) close()
      },
    }
  }
}

function createDeps(overrides: Partial<BeaconCliDeps> = {}): { deps: BeaconCliDeps; logs: string[]; printed: string[] } {
  const logs: string[] = []
  const printed: string[] = []
  const deps: BeaconCliDeps = {
    os: "linux",
    hostname: "box",
    beaconVersion: "0.1.0",
    openKeyStore: () => ({ publicKeySpkiBase64: () => "PUB", sign: () => "SIG" }),
    stateStore: { load: async () => null, save: async () => {}, clear: async () => {} },
    pairClient: { pair: async () => ({ ok: false, error: "unused", status: null }) },
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
    createTransfer: () => ({
      upload: async () => ({ path: "", bytes: 0, sha256: "" }),
      download: async () => ({ path: "", bytes: 0, sha256: "" }),
    }),
    updater: UNSUPPORTED_UPDATER,
    autoUpdate: true,
    sleep: async () => {},
    log: (line) => {
      logs.push(line)
    },
    print: (line) => {
      printed.push(line)
    },
    ...overrides,
  }
  return { deps, logs, printed }
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

  test("parses version", () => {
    expect(parseBeaconArgs(["version"])).toEqual({ command: "version" })
    expect(parseBeaconArgs(["version", "extra"]).command).toBe("invalid")
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
      stateStore: { load: async () => null, save: async (state) => void saved.push(state), clear: async () => {} },
    })
    expect(await runBeaconCli(["pair", "http://kanna.local/", "CODE"], deps)).toBe(0)
    expect(requests).toEqual([{ code: "CODE", publicKey: "PUB", label: "box", os: "linux" }])
    expect(saved).toEqual([{ kannaUrl: "http://kanna.local", beaconId: "b-9" }])
  })

  test("pair reports a refused code with a failing exit code", async () => {
    const { deps, logs } = createDeps({ pairClient: { pair: async () => ({ ok: false, error: "expired", status: 400 }) } })
    expect(await runBeaconCli(["pair", "http://kanna.local", "CODE"], deps)).toBe(1)
    expect(logs.join("\n")).toContain("expired")
  })

  test("started with no command it points at the desktop app", async () => {
    const { deps, logs } = createDeps()
    expect(await runBeaconCli([], deps)).toBe(64)
    expect(logs.join("\n")).toContain(BEACON_DOWNLOAD_PAGE)
  })

  test("version prints exactly the beacon version on stdout", async () => {
    const { deps, logs, printed } = createDeps({ beaconVersion: "1.71.0" })
    expect(await runBeaconCli(["version"], deps)).toBe(0)
    expect(printed).toEqual(["1.71.0"])
    expect(logs).toEqual([])
  })

  test("run exits with the restart code once the beacon has updated itself", async () => {
    const { deps, logs } = createDeps({
      stateStore: { load: async () => PAIRED, save: async () => {}, clear: async () => {} },
      updater: { install: async () => ({ ok: true }) },
      openTransport: scriptedServer((frame) => {
        if (frame.kind === "hello") return { kind: "challenge", nonce: "n" }
        if (frame.kind === "auth") {
          return { kind: "ready", scope: DEFAULT_BEACON_SCOPE, protocolVersion: 4, serverVersion: "0.2.0" }
        }
        return null
      }),
    })
    expect(await runBeaconCli(["run"], deps)).toBe(RESTART_EXIT_CODE)
    expect(logs.join("\n")).toContain("updated to 0.2.0; restarting")
  })

  test("a beacon newer than its server says so instead of calling itself too old", async () => {
    const { deps, logs } = createDeps({
      beaconVersion: "2.0.0",
      stateStore: { load: async () => PAIRED, save: async () => {}, clear: async () => {} },
      openTransport: scriptedServer((frame) =>
        frame.kind === "hello" ? { kind: "incompatible", minSupported: 1, serverVersion: "1.69.0" } : null,
      ),
    })
    expect(await runBeaconCli(["run"], deps)).toBe(2)
    const output = logs.join("\n")
    expect(output).toContain("this beacon is newer than the Kanna server (1.69.0)")
    expect(output).not.toContain("too old")
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
      stateStore: {
        load: async () => ({ kannaUrl: "http://kanna.local", beaconId: "b-1" }),
        save: async () => {},
        clear: async () => {},
      },
      openTransport,
      sleep: async (ms) => void sleeps.push(ms),
    })
    expect(await runBeaconCli(["run"], deps)).toBe(2)
    expect(urls).toEqual(["ws://kanna.local/beacon", "ws://kanna.local/beacon"])
    expect(sleeps).toEqual([1000])
    expect(logs.join("\n")).toContain("https://dl.example")
  })
})
