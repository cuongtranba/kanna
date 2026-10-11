import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { JsonObject } from "../json"
import { parseSubscriptionTopic } from "./topics"

const PROTOCOL_PATH = join(import.meta.dir, "..", "protocol.ts")

function declaredTopicTypes(): string[] {
  const source = readFileSync(PROTOCOL_PATH, "utf8")
  const start = source.indexOf("export type SubscriptionTopic =")
  const rest = source.slice(start)
  const end = rest.search(/\nexport (?:interface|const|function) /)
  const body = end < 0 ? rest : rest.slice(0, end)
  return [...body.matchAll(/\btype: "([a-z-]+)"/g)].map((match) => match[1]!)
}

const MINIMAL_TOPICS: Readonly<Record<string, JsonObject>> = {
  sidebar: {},
  "local-projects": {},
  update: {},
  keybindings: {},
  "app-settings": {},
  "push-config": {},
  chat: { chatId: "c1" },
  "project-git": { projectId: "p1" },
  "project-commands": { projectId: "p1" },
  terminal: { terminalId: "t1" },
  workflows: { chatId: "c1" },
  boards: { ownerKind: "project", ownerId: "p1" },
  board: { boardId: "b1" },
  "followed-sessions": {},
  "cron-jobs": {},
  beacons: {},
  "background-task-output": { chatId: "c1", taskId: "k1" },
  "package-updates": {},
}

describe("subscription topic schema", () => {
  test("every declared topic type parses with its minimal fields", () => {
    const declared = declaredTopicTypes()
    expect(declared.length).toBeGreaterThan(10)
    for (const type of declared) {
      const minimal = MINIMAL_TOPICS[type]
      expect(minimal, `fixture for ${type}`).toBeDefined()
      expect(parseSubscriptionTopic({ type, ...minimal })).toEqual({ type, ...minimal })
    }
  })

  test("optional fields are preserved", () => {
    expect(parseSubscriptionTopic({ type: "chat", chatId: "c1", recentLimit: 5, since: 3 }))
      .toEqual({ type: "chat", chatId: "c1", recentLimit: 5, since: 3 })
  })

  test("an unknown type or a missing required field returns null", () => {
    expect(parseSubscriptionTopic({ type: "nope" })).toBeNull()
    expect(parseSubscriptionTopic({ type: "chat" })).toBeNull()
    expect(parseSubscriptionTopic("sidebar")).toBeNull()
  })
})
