import { describe, expect, it } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical"
import { $createMentionNode, MentionNode } from "../nodes/MentionNode"
import {
  MentionMenuOption,
  NAMESPACE_PREVIEW_LIMIT,
  composeMentionOptions,
  createMentionArgs,
} from "./MentionTypeaheadPlugin"
import type { MentionOption } from "./MentionTypeaheadPlugin"
import type { ProjectSuggestion } from "../../../hooks/useProjectSuggestions"
import type { SubagentSuggestion } from "../../../hooks/useSubagentSuggestions"
import type { ProjectPath } from "../../../hooks/useMentionSuggestions"
import type { Subagent } from "../../../../shared/types"

function makeSubagent(id: string, name: string, description?: string): Subagent {
  return { id, name, description } as unknown as Subagent
}


function buildEditor() {
  return createHeadlessEditor({
    namespace: "test-mention-plugin",
    nodes: [MentionNode],
    onError: (e: Error) => {
      throw e
    },
  })
}


describe("MentionMenuOption — agent", () => {
  it("derives a stable key from agent id", () => {
    const data: MentionOption = {
      kind: "agent",
      subagent: makeSubagent("sub-123", "builder", "A builder subagent"),
    }
    const option = new MentionMenuOption(data)
    expect(option.key).toBe("agent:sub-123")
    expect(option.data.kind).toBe("agent")
  })

  it("stores subagent data intact", () => {
    const subagent = makeSubagent("abc", "my-agent")
    const option = new MentionMenuOption({ kind: "agent", subagent })
    if (option.data.kind !== "agent") throw new Error("expected agent")
    expect(option.data.subagent.name).toBe("my-agent")
    expect(option.data.subagent.id).toBe("abc")
  })
})

describe("MentionMenuOption — path", () => {
  it("derives a stable key for a file path", () => {
    const data: MentionOption = {
      kind: "path",
      path: { path: "src/server/agent.ts", kind: "file" },
    }
    const option = new MentionMenuOption(data)
    expect(option.key).toBe("path:file:src/server/agent.ts")
    expect(option.data.kind).toBe("path")
  })

  it("derives a stable key for a directory path", () => {
    const data: MentionOption = {
      kind: "path",
      path: { path: "src/server/", kind: "dir" },
    }
    const option = new MentionMenuOption(data)
    expect(option.key).toBe("path:dir:src/server/")
  })

  it("stores path data intact", () => {
    const data: MentionOption = {
      kind: "path",
      path: { path: "README.md", kind: "file" },
    }
    const option = new MentionMenuOption(data)
    if (option.data.kind !== "path") throw new Error("expected path")
    expect(option.data.path.path).toBe("README.md")
    expect(option.data.path.kind).toBe("file")
  })
})


describe("MentionNode wire-form text — agent (insertion target)", () => {
  it("inserted agent node serialises to @agent/<name>", () => {
    const editor = buildEditor()
    let text = ""

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createMentionNode({
          mentionKind: "agent",
          value: "builder",
          label: "builder",
        })
        para.append(node)
        root.append(para)
        text = node.getTextContent()
      },
      { discrete: true },
    )

    expect(text).toBe("@agent/builder")
  })

  it("agent node value is used as both value and label", () => {
    const editor = buildEditor()
    let exported: { value: string; label: string; mentionKind: string } | null = null

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createMentionNode({
          mentionKind: "agent",
          value: "researcher",
          label: "researcher",
        })
        para.append(node)
        root.append(para)
        exported = node.exportJSON()
      },
      { discrete: true },
    )

    expect(exported!.mentionKind).toBe("agent")
    expect(exported!.value).toBe("researcher")
    expect(exported!.label).toBe("researcher")
  })
})

describe("MentionNode wire-form text — path (insertion target)", () => {
  it("inserted path node serialises to @<path>", () => {
    const editor = buildEditor()
    let text = ""

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createMentionNode({
          mentionKind: "path",
          value: "src/client/index.ts",
          label: "src/client/index.ts",
        })
        para.append(node)
        root.append(para)
        text = node.getTextContent()
      },
      { discrete: true },
    )

    expect(text).toBe("@src/client/index.ts")
  })

  it("path node value matches the raw path from the suggestion", () => {
    const editor = buildEditor()
    let exported: { value: string; mentionKind: string } | null = null

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createMentionNode({
          mentionKind: "path",
          value: "docs/README.md",
          label: "docs/README.md",
        })
        para.append(node)
        root.append(para)
        exported = node.exportJSON()
      },
      { discrete: true },
    )

    expect(exported!.mentionKind).toBe("path")
    expect(exported!.value).toBe("docs/README.md")
  })
})


describe("onSelectOption insertion (regression — must not clear composer)", () => {
  it("replaces the @query text node with a mention node + trailing space, keeping prior text", () => {
    const editor = buildEditor()
    let rootText = ""

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const lead = $createTextNode("hello ")
        const queryNode = $createTextNode("@bui")
        para.append(lead)
        para.append(queryNode)
        root.append(para)

        const mentionNode = $createMentionNode({
          mentionKind: "agent",
          value: "builder",
          label: "builder",
        })
        queryNode.replace(mentionNode)
        const trailingSpace = $createTextNode(" ")
        mentionNode.insertAfter(trailingSpace)
        trailingSpace.select()
      },
      { discrete: true },
    )

    editor.getEditorState().read(() => {
      rootText = $getRoot().getTextContent()
    })

    expect(rootText).toBe("hello @agent/builder ")
  })
})


describe("@ trigger pattern (custom MENTION_TRIGGER_RE semantics)", () => {
  const MENTION_TRIGGER_RE = /(?:^|\s)(@((?:[^@\s]){0,200}))$/

  function match(text: string) {
    return MENTION_TRIGGER_RE.exec(text)
  }

  it("matches bare `@` at start of text", () => {
    expect(match("@")).not.toBeNull()
  })

  it("matches `@foo` — query is `foo`", () => {
    const m = match("@foo")
    expect(m).not.toBeNull()
    expect(m![2]).toBe("foo")
  })

  it("matches `@agent/builder` — slash is allowed in the query", () => {
    const m = match("@agent/builder")
    expect(m).not.toBeNull()
    expect(m![2]).toBe("agent/builder")
  })

  it("matches `@src/client/index.ts` — full path query", () => {
    const m = match("@src/client/index.ts")
    expect(m).not.toBeNull()
    expect(m![2]).toBe("src/client/index.ts")
  })

  it("matches `@` after whitespace", () => {
    const m = match("hello @")
    expect(m).not.toBeNull()
  })

  it("does NOT match mid-word @", () => {
    expect(match("no@trigger")).toBeNull()
  })

  it("does NOT match when query contains whitespace (space terminates the token)", () => {
    expect(match("@foo bar")).toBeNull()
  })

  it("replaceableString is the full `@query` text to replace", () => {
    const m = match("@agent/builder")
    expect(m![1]).toBe("@agent/builder")
  })
})

describe("MentionMenuOption — project", () => {
  const project = {
    kind: "project" as const,
    projectId: "proj-9",
    slug: "wiki",
    title: "wiki",
    localPath: "/home/cuong/repo/wiki",
  }

  it("derives a stable key from the project id", () => {
    const option = new MentionMenuOption({ kind: "project", project })
    expect(option.key).toBe("project:proj-9")
  })

  it("builds a mention node carrying the slug as the wire value", () => {
    const args = createMentionArgs({ kind: "project", project })
    expect(args).toEqual({
      mentionKind: "project",
      value: "wiki",
      label: "project/wiki",
    })
  })

  it("serializes into the message as @project/<slug>", () => {
    const editor = buildEditor()
    let text = ""
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("look at "))
        para.append($createMentionNode(createMentionArgs({ kind: "project", project })))
        root.append(para)
        text = root.getTextContent()
      },
      { discrete: true },
    )
    expect(text).toBe("look at @project/wiki")
  })
})

describe("composeMentionOptions", () => {
  function agents(count: number): SubagentSuggestion[] {
    return Array.from({ length: count }, (_, i) => ({
      kind: "agent" as const,
      subagent: makeSubagent(`sub-${i}`, `agent-${i}`),
    }))
  }

  function projects(count: number): ProjectSuggestion[] {
    return Array.from({ length: count }, (_, i) => ({
      kind: "project" as const,
      projectId: `proj-${i}`,
      slug: `repo-${i}`,
      title: `repo-${i}`,
      localPath: `/home/cuong/repo/repo-${i}`,
    }))
  }

  function paths(count: number): ProjectPath[] {
    return Array.from({ length: count }, (_, i) => ({
      path: `file-${i}.ts`,
      kind: "file" as const,
    }))
  }

  it("keeps agents and paths visible on a bare @ when many projects exist", () => {
    const options = composeMentionOptions({
      query: "",
      agents: agents(5),
      projects: projects(8),
      paths: paths(4),
    })
    expect(options.map((option) => option.kind)).toEqual([
      "agent", "agent", "agent",
      "project", "project", "project",
      "path", "path", "path", "path",
    ])
  })

  it("lists every project once @project/ is typed", () => {
    const options = composeMentionOptions({
      query: "project/",
      agents: [],
      projects: projects(NAMESPACE_PREVIEW_LIMIT + 5),
      paths: [],
    })
    expect(options).toHaveLength(NAMESPACE_PREVIEW_LIMIT + 5)
  })

  it("lists every agent once @agent/ is typed", () => {
    const options = composeMentionOptions({
      query: "agent/",
      agents: agents(NAMESPACE_PREVIEW_LIMIT + 5),
      projects: [],
      paths: [],
    })
    expect(options).toHaveLength(NAMESPACE_PREVIEW_LIMIT + 5)
  })

  it("leaves a group the query already narrowed uncapped", () => {
    const options = composeMentionOptions({
      query: "repo",
      agents: [],
      projects: projects(5),
      paths: paths(2),
    })
    expect(options.filter((option) => option.kind === "project")).toHaveLength(5)
  })
})
