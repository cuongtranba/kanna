import { describe, expect, test } from "bun:test"
import { DEFAULT_BEACON_SCOPE } from "../../../shared/beacon-scope"
import type { BeaconActivity } from "../../activity"
import { desktopStrings } from "../strings"
import { groupActivityByDay, presentGrant, presentOutcome, presentStatus, splitFolderPath } from "./present"

const en = desktopStrings("en")
const vi = desktopStrings("vi")
const NOON = new Date(2026, 9, 8, 12, 0, 0).getTime()

describe("status line", () => {
  test("online reads as running, with the time it connected", () => {
    const presented = presentStatus({ status: { phase: "online", since: NOON }, scope: null, scopeSync: true }, en, NOON, "en")
    expect(presented).toEqual({ tone: "active", label: "Online", detail: "since 12:00" })
  })

  test("offline counts down to the retry in whole seconds", () => {
    const presented = presentStatus(
      { status: { phase: "offline", attempt: 2, retryAt: NOON + 7_200, reason: "unreachable" }, scope: null, scopeSync: false },
      vi,
      NOON,
      "vi",
    )
    expect(presented).toEqual({ tone: "attention", label: "Mất kết nối", detail: "thử lại sau 8 giây" })
  })

  test("a beacon removed in Kanna is struck, a paused one rests", () => {
    expect(presentStatus({ status: { phase: "revoked" }, scope: null, scopeSync: false }, en, NOON, "en").tone).toBe("destructive")
    expect(presentStatus({ status: { phase: "paused" }, scope: null, scopeSync: false }, en, NOON, "en")).toEqual({
      tone: "muted",
      label: "Paused",
      detail: "Kanna can't reach this computer until you resume.",
    })
  })
})

describe("update status line", () => {
  test("the last step before the app quits says it is restarting", () => {
    const presented = presentStatus(
      { status: { phase: "updating", version: "1.71.0", step: "restarting" }, scope: null, scopeSync: true },
      en,
      NOON,
      "en",
    )
    expect(presented).toEqual({ tone: "attention", label: "Updating", detail: "restarting into version 1.71.0" })
  })

  test("a beacon too old for Kanna that could not update itself says why", () => {
    const presented = presentStatus(
      { status: { phase: "incompatible", minSupported: 4, updateError: "the latest release is 1.70.0" }, scope: null, scopeSync: false },
      vi,
      NOON,
      "vi",
    )
    expect(presented.detail).toBe(
      "Phiên bản Kanna Beacon này đã quá cũ so với Kanna của bạn. Tự cập nhật không thành công: the latest release is 1.70.0.",
    )
  })
})

describe("grant summary", () => {
  test("names every folder and states commands and approval separately", () => {
    expect(
      presentGrant({ ...DEFAULT_BEACON_SCOPE, readRoots: ["/home/me/notes"], exec: true, autoRunScripts: false }, en),
    ).toEqual({
      folders: ["/home/me/notes"],
      commands: "Allowed",
      approval: "Asks you in Kanna first",
      approvalTone: "muted",
    })
    expect(presentGrant({ ...DEFAULT_BEACON_SCOPE, autoRunScripts: true }, vi)).toEqual({
      folders: [],
      commands: "Không cho phép",
      approval: "Làm mà không hỏi",
      approvalTone: "attention",
    })
  })
})

describe("record", () => {
  function at(id: string, time: number): BeaconActivity {
    return { id, at: time, verb: "read", target: id, outcome: { kind: "done" } }
  }

  test("groups newest-first entries under today, yesterday and a date", () => {
    const groups = groupActivityByDay([at("a", NOON), at("b", NOON - 86_400_000), at("c", NOON - 3 * 86_400_000)], en, NOON, "en")
    expect(groups.map((group) => [group.label, group.entries.map((entry) => entry.id)])).toEqual([
      ["Today", ["a"]],
      ["Yesterday", ["b"]],
      [new Date(NOON - 3 * 86_400_000).toLocaleDateString("en", { day: "numeric", month: "long" }), ["c"]],
    ])
  })

  test("outcomes pair a mark with a word", () => {
    expect(presentOutcome({ kind: "exit", code: 0 }, en)).toEqual({ tone: "muted", label: "Finished" })
    expect(presentOutcome({ kind: "exit", code: 2 }, en)).toEqual({ tone: "attention", label: "Exited 2" })
    expect(presentOutcome({ kind: "refused", message: "outside roots" }, vi)).toEqual({ tone: "destructive", label: "Bị chặn" })
  })

  test("a folder path splits into its name and where it lives", () => {
    expect(splitFolderPath("C:\\Users\\Admin\\Documents")).toEqual({ name: "Documents", parent: "C:\\Users\\Admin" })
    expect(splitFolderPath("/home/me/notes/")).toEqual({ name: "notes", parent: "/home/me" })
    expect(splitFolderPath("D:\\")).toEqual({ name: "D:\\", parent: "" })
    expect(splitFolderPath("D:\\Projects")).toEqual({ name: "Projects", parent: "D:\\" })
    expect(splitFolderPath("\\\\nas\\share\\photos")).toEqual({ name: "photos", parent: "\\\\nas\\share" })
  })
})
