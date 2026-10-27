import { describe, expect, test } from "bun:test"
import { Map, Terminal, ToyBrick, UserRound, ListTodo } from "lucide-react"
import { normalizeToolCall } from "../../shared/tools"
import { toolActivity, toolCategory, toolIcon, toolIconByName, toolTitle } from "./toolPresentation"

describe("toolIcon", () => {
  test("is chosen by tool kind, so any provider spelling of a kind shares one icon", () => {
    const claude = normalizeToolCall({ toolName: "Bash", toolId: "1", input: { command: "ls" } })
    expect(toolIcon(claude)).toBe(Terminal)
    expect(toolIcon({ toolKind: "bash", toolName: "commandExecution" })).toBe(Terminal)
  })

  test("a subagent task gets the agent icon", () => {
    expect(toolIcon({ toolKind: "subagent_task", toolName: "Task" })).toBe(UserRound)
  })

  test("a tool name with no kind falls back to its own icon, then the default", () => {
    expect(toolIconByName("EnterPlanMode")).toBe(Map)
    expect(toolIconByName("Task")).toBe(ListTodo)
    expect(toolIconByName("SomethingNew")).toBe(ToyBrick)
  })
})

describe("toolCategory", () => {
  test("groups the task tools under one key and everything unlisted under other", () => {
    expect(toolCategory("task_create").key).toBe(toolCategory("task_list").key)
    expect(toolCategory("workflow").key).toBe("other")
  })
})

describe("toolTitle and toolActivity", () => {
  test("title names the file relative to the workspace", () => {
    const tool = normalizeToolCall({ toolName: "Read", toolId: "1", input: { file_path: "/work/app/src/a.ts" } })
    expect(toolTitle(tool, "/work/app")).toBe("Read src/a.ts")
    expect(toolActivity(tool, "/work/app")).toBe("reading src/a.ts")
  })

  test("activity falls back to a generic label when the tool has no subject", () => {
    const tool = normalizeToolCall({ toolName: "Read", toolId: "1", input: {} })
    expect(toolActivity(tool, "/work/app")).toBe("reading file...")
  })

  test("an unrecognised tool is titled by its own name", () => {
    const tool = normalizeToolCall({ toolName: "Mystery", toolId: "1", input: {} })
    expect(toolTitle(tool, null)).toBe("Mystery")
    expect(toolActivity(tool, "")).toBe("running Mystery")
  })
})
