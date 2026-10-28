import { describe, expect, test } from "vite-plus/test"
import { beaconFilePaths, beaconHome, launcherPathFor } from "./paths"

describe("beacon paths", () => {
  test("the configured home wins over the default under the user's home directory", () => {
    expect(beaconHome("linux", "/data/beacon", "/home/me")).toBe("/data/beacon")
    expect(beaconHome("linux", undefined, "/home/me")).toBe("/home/me/.kanna-beacon")
    expect(beaconHome("windows", undefined, "C:\\Users\\me")).toBe("C:\\Users\\me\\.kanna-beacon")
  })

  test("the key and state files live directly in the home, joined for the beacon's os", () => {
    expect(beaconFilePaths("darwin", "/home/me/.kanna-beacon")).toEqual({
      keyFile: "/home/me/.kanna-beacon/key.der",
      stateFile: "/home/me/.kanna-beacon/state.json",
    })
    expect(beaconFilePaths("windows", "C:\\b")).toEqual({ keyFile: "C:\\b\\key.der", stateFile: "C:\\b\\state.json" })
  })

  test("the launcher sits beside the running executable", () => {
    expect(launcherPathFor("linux", "/opt/kanna/bin/bun")).toBe("/opt/kanna/bin/launcher")
    expect(launcherPathFor("windows", "C:\\Kanna\\bin\\bun.exe")).toBe("C:\\Kanna\\bin\\launcher.exe")
  })
})
