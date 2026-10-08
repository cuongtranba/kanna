import { expect, test } from "bun:test"
import { describeBeaconRequest, parseBeaconActivity, type BeaconActivity } from "./activity"

test("every request shape gets a verb and a readable target", () => {
  expect(describeBeaconRequest({ op: "grep", root: "/srv", pattern: "TODO" })).toEqual({ verb: "search", target: "TODO in /srv" })
  expect(describeBeaconRequest({ op: "glob", path: "/srv/*.md" })).toEqual({ verb: "list", target: "/srv/*.md" })
  expect(describeBeaconRequest({ op: "script", body: "\n\n  echo hi\nexit 1" })).toEqual({ verb: "script", target: "echo hi" })
})

test("a stored activity round-trips and a malformed one is dropped", () => {
  const activity: BeaconActivity = { id: "r1", at: 5, verb: "run", target: "git", outcome: { kind: "exit", code: 2 } }
  expect(parseBeaconActivity(JSON.parse(JSON.stringify(activity)))).toEqual(activity)
  expect(parseBeaconActivity({ id: "r1", at: 5, verb: "fly", target: "x", outcome: { kind: "done" } })).toBeNull()
  expect(parseBeaconActivity({ id: "r1", at: 5, verb: "read", target: "x", outcome: { kind: "exit" } })).toBeNull()
  expect(parseBeaconActivity("nope")).toBeNull()
})
