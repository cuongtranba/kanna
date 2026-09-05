import { describe, expect, it } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical"
import { $createSlashCommandNode, SlashCommandNode } from "../nodes/SlashCommandNode"
import {
  $applySlashCommandSelection,
  SlashCommandMenuOption,
  dedupeCommandsByName,
} from "./SlashCommandTypeaheadPlugin"
import { filterCommands, normalizeCommandName } from "../../../lib/slash-commands"
import type { SlashCommand } from "../../../../shared/types"


function buildEditor() {
  return createHeadlessEditor({
    namespace: "test-slash-plugin",
    nodes: [SlashCommandNode],
    onError: (e: Error) => {
      throw e
    },
  })
}

function makeCmd(
  name: string,
  opts: {
    description?: string
    argumentHint?: string
    kind?: SlashCommand["kind"]
    scope?: SlashCommand["scope"]
  } = {},
): SlashCommand {
  return {
    name,
    description: opts.description ?? "",
    argumentHint: opts.argumentHint ?? "",
    kind: opts.kind,
    scope: opts.scope,
  }
}


describe("dedupeCommandsByName", () => {
  it("drops later commands sharing a normalized name, keeping the first", () => {
    const result = dedupeCommandsByName([
      makeCmd("c3", { scope: "personal" }),
      makeCmd("model"),
      makeCmd("c3", { scope: "project" }),
      makeCmd("help"),
    ])
    expect(result.map((c) => c.name)).toEqual(["c3", "model", "help"])
    expect(result[0]?.scope).toBe("personal")
  })

  it("yields unique option keys (no duplicate React keys)", () => {
    const result = dedupeCommandsByName([makeCmd("c3"), makeCmd("c3"), makeCmd("c3")])
    const keys = result.map((c) => new SlashCommandMenuOption(c).key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual(["c3"])
  })

  it("leaves an already-unique list unchanged", () => {
    const input = [makeCmd("a"), makeCmd("b"), makeCmd("c")]
    expect(dedupeCommandsByName(input).map((c) => c.name)).toEqual(["a", "b", "c"])
  })
})


describe("SlashCommandMenuOption", () => {
  it("uses command name as the key", () => {
    const cmd = makeCmd("clear")
    const option = new SlashCommandMenuOption(cmd)
    expect(option.key).toBe("clear")
  })

  it("stores the full command object", () => {
    const cmd = makeCmd("model", { argumentHint: "<model-name>", description: "Switch model" })
    const option = new SlashCommandMenuOption(cmd)
    expect(option.command.name).toBe("model")
    expect(option.command.argumentHint).toBe("<model-name>")
    expect(option.command.description).toBe("Switch model")
  })

  it("stores skill-kind command", () => {
    const cmd = makeCmd("my-skill", { kind: "skill", description: "A custom skill" })
    const option = new SlashCommandMenuOption(cmd)
    expect(option.command.kind).toBe("skill")
  })
})


describe("SlashCommandNode wire-form text — no argument (insertion target)", () => {
  it("inserts /clear without trailing space", () => {
    const editor = buildEditor()
    let text = ""

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createSlashCommandNode({
          commandName: "clear",
          hasArgument: false,
        })
        para.append(node)
        root.append(para)
        text = node.getTextContent()
      },
      { discrete: true },
    )

    expect(text).toBe("/clear")
  })

  it("normalizeCommandName strips a leading slash when the command name already has one", () => {
    expect(normalizeCommandName("/clear")).toBe("clear")
    expect(normalizeCommandName("clear")).toBe("clear")
    expect(normalizeCommandName("//clear")).toBe("clear")
  })
})

describe("SlashCommandNode wire-form text — with argument (insertion target)", () => {
  it("inserts /model with trailing space (argument placeholder)", () => {
    const editor = buildEditor()
    let text = ""

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createSlashCommandNode({
          commandName: "model",
          hasArgument: true,
        })
        para.append(node)
        root.append(para)
        text = node.getTextContent()
      },
      { discrete: true },
    )

    expect(text).toBe("/model ")
  })

  it("hasArgument is derived from argumentHint presence — Boolean(cmd.argumentHint)", () => {
    const withHint = makeCmd("model", { argumentHint: "<model-name>" })
    const withoutHint = makeCmd("clear")

    expect(Boolean(withHint.argumentHint)).toBe(true)
    expect(Boolean(withoutHint.argumentHint)).toBe(false)
  })
})


describe("slash trigger (SLASH_TRIGGER_RE — start or after whitespace)", () => {
  const SLASH_TRIGGER_RE = /(?:^|\s)(\/(\S*))$/

  function match(text: string) {
    return SLASH_TRIGGER_RE.exec(text)
  }

  it("matches bare `/`", () => {
    const m = match("/")
    expect(m).not.toBeNull()
    expect(m![2]).toBe("")
  })

  it("matches `/clear` — full command name (query in group 2)", () => {
    const m = match("/clear")
    expect(m).not.toBeNull()
    expect(m![2]).toBe("clear")
  })

  it("matches `/mod` — partial command name", () => {
    const m = match("/mod")
    expect(m).not.toBeNull()
    expect(m![2]).toBe("mod")
  })

  it("matches `hello /clear` — slash after whitespace (mid-input)", () => {
    const m = match("hello /clear")
    expect(m).not.toBeNull()
    expect(m![2]).toBe("clear")
    expect(m![1]).toBe("/clear")
  })

  it("does NOT match `src/file` — slash mid-word (not preceded by whitespace)", () => {
    expect(match("src/file")).toBeNull()
  })

  it("does NOT match empty string", () => {
    expect(match("")).toBeNull()
  })

  it("does NOT match `/model ` — trailing space closes the query", () => {
    expect(match("/model ")).toBeNull()
  })

  it("matchingString (group 2) is the query used to filter commands", () => {
    const m = match("/cle")
    expect(m![2]).toBe("cle")
  })
})


describe("filterCommands (used by the plugin to derive options)", () => {
  const commands: SlashCommand[] = [
    makeCmd("clear", { description: "Clear the chat" }),
    makeCmd("model", { description: "Switch model", argumentHint: "<name>" }),
    makeCmd("help", { description: "Show help" }),
    makeCmd("exit", { description: "Exit" }),
  ]

  it("empty query returns all commands sorted alphabetically", () => {
    const result = filterCommands(commands, "")
    const names = result.map((c) => c.name)
    expect(names).toEqual(["clear", "exit", "help", "model"])
  })

  it("prefix match ranks before substring match", () => {
    const result = filterCommands(commands, "c")
    const names = result.map((c) => c.name)
    expect(names[0]).toBe("clear")
  })

  it("filters out non-matching commands", () => {
    const result = filterCommands(commands, "xit")
    const names = result.map((c) => c.name)
    expect(names).toContain("exit")
    expect(names).not.toContain("clear")
  })

  it("returns empty array when nothing matches", () => {
    const result = filterCommands(commands, "zzz")
    expect(result).toHaveLength(0)
  })

  it("SlashCommandMenuOption has `hasArgument` correctly derived from argumentHint", () => {
    const cmdWithArg = makeCmd("model", { argumentHint: "<name>" })
    const cmdNoArg = makeCmd("clear")

    const optWithArg = new SlashCommandMenuOption(cmdWithArg)
    const optNoArg = new SlashCommandMenuOption(cmdNoArg)

    expect(Boolean(optWithArg.command.argumentHint)).toBe(true)
    expect(Boolean(optNoArg.command.argumentHint)).toBe(false)
  })
})


const NO_PROMPTS: ReadonlyMap<string, string> = new Map()

function applySelectionOverQuery(
  command: SlashCommand,
  promptByName: ReadonlyMap<string, string>,
): string {
  const editor = buildEditor()
  let text = ""
  editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      const para = $createParagraphNode()
      const queryNode = $createTextNode(`/${normalizeCommandName(command.name)}`)
      para.append(queryNode)
      root.append(para)
      $applySlashCommandSelection({
        command,
        promptByName,
        textNodeContainingQuery: queryNode,
      })
    },
    { discrete: true },
  )
  editor.getEditorState().read(() => {
    text = $getRoot().getTextContent()
  })
  return text
}

describe("$applySlashCommandSelection", () => {
  it("inserts /name for a catalog command", () => {
    expect(applySelectionOverQuery(makeCmd("clear"), NO_PROMPTS)).toBe("/clear ")
  })

  it("inserts the plugin item's prompt TEXT, never /name", () => {
    const command = makeCmd("my-plugin:greet", { scope: "plugin" })
    const prompts = new Map([["my-plugin:greet", "Greet the user warmly."]])

    const text = applySelectionOverQuery(command, prompts)

    expect(text).toBe("Greet the user warmly.")
    expect(text).not.toContain("/my-plugin:greet")
  })

  it("leaves a catalog command alone when some OTHER name carries a prompt", () => {
    const prompts = new Map([["my-plugin:greet", "Greet the user warmly."]])
    expect(applySelectionOverQuery(makeCmd("clear"), prompts)).toBe("/clear ")
  })

  it("produces no SlashCommandNode for a plugin entry", () => {
    const editor = buildEditor()
    let nodeCount = 0
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const queryNode = $createTextNode("/my-plugin:greet")
        para.append(queryNode)
        root.append(para)
        $applySlashCommandSelection({
          command: makeCmd("my-plugin:greet", { scope: "plugin" }),
          promptByName: new Map([["my-plugin:greet", "Greet warmly."]]),
          textNodeContainingQuery: queryNode,
        })
      },
      { discrete: true },
    )
    editor.getEditorState().read(() => {
      nodeCount = $getRoot().getAllTextNodes().length
    })
    expect(JSON.stringify(editor.getEditorState().toJSON())).not.toContain("kanna-slash-command")
    expect(nodeCount).toBe(1)
  })
})
