import { describe, expect, test } from "bun:test"
import {
  RESTART_EXIT_CODE,
  afterBeaconRun,
  superviseRestarts,
  type ForwardedSignal,
  type SupervisorPort,
} from "./supervisor"

function scriptedPort(codes: number[]) {
  const spawned: Array<{ kills: ForwardedSignal[]; exit: (code: number) => void }> = []
  const signalListeners = new Set<(signal: ForwardedSignal) => void>()
  const port: SupervisorPort = {
    spawn() {
      let exit: (code: number) => void = () => {}
      const exited = new Promise<number>((resolve) => {
        exit = resolve
      })
      const kills: ForwardedSignal[] = []
      const record = { kills, exit }
      spawned.push(record)
      const scripted = codes.shift()
      if (scripted !== undefined) exit(scripted)
      return { exited, kill: (signal) => void record.kills.push(signal) }
    },
    onSignal(listener) {
      signalListeners.add(listener)
      return () => {
        signalListeners.delete(listener)
      }
    },
  }
  return {
    port,
    spawned,
    signalListeners,
    signal(signal: ForwardedSignal) {
      for (const listener of signalListeners) listener(signal)
    },
  }
}

describe("superviseRestarts", () => {
  test("respawns while the child asks for a restart, then exits with its code", async () => {
    const fake = scriptedPort([RESTART_EXIT_CODE, RESTART_EXIT_CODE, 0])
    expect(await superviseRestarts(fake.port)).toBe(0)
    expect(fake.spawned).toHaveLength(3)
    expect(fake.signalListeners.size).toBe(0)
  })

  test("stops on any other exit code", async () => {
    const fake = scriptedPort([2])
    expect(await superviseRestarts(fake.port)).toBe(2)
    expect(fake.spawned).toHaveLength(1)
  })

  test("forwards a signal to the child and does not respawn after it", async () => {
    const fake = scriptedPort([])
    const supervised = superviseRestarts(fake.port)
    fake.signal("SIGTERM")
    expect(fake.spawned[0]?.kills).toEqual(["SIGTERM"])
    fake.spawned[0]?.exit(RESTART_EXIT_CODE)
    expect(await supervised).toBe(RESTART_EXIT_CODE)
    expect(fake.spawned).toHaveLength(1)
  })
})

describe("afterBeaconRun", () => {
  test("an unsupervised restart request becomes the supervisor; a supervised one exits 75 for its parent", () => {
    expect(afterBeaconRun(RESTART_EXIT_CODE, false)).toEqual({ kind: "supervise" })
    expect(afterBeaconRun(RESTART_EXIT_CODE, true)).toEqual({ kind: "exit", code: RESTART_EXIT_CODE })
    expect(afterBeaconRun(0, false)).toEqual({ kind: "exit", code: 0 })
  })
})
