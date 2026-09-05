import { describe, expect, test } from "bun:test"
import { mergePluginCommands, pluginCommandName } from "./plugin-slash-commands"
import type { PluginCommandCenterItem } from "../plugins/contributionRegistry"
import type { SlashCommand } from "../../shared/types"

function catalogEntry(name: string, scope: SlashCommand["scope"] = "builtin"): SlashCommand {
  return { name, description: "", argumentHint: "", scope }
}

function item(
  pluginId: string,
  name: string,
  prompt = "do the thing",
): PluginCommandCenterItem {
  return { pluginId, name, description: `${name} desc`, prompt }
}

describe("pluginCommandName", () => {
  test("namespaces by plugin id", () => {
    expect(pluginCommandName("my-plugin", "greet")).toBe("my-plugin:greet")
  })

  test("strips a leading slash an author may have written", () => {
    expect(pluginCommandName("my-plugin", "/greet")).toBe("my-plugin:greet")
  })
})

describe("mergePluginCommands", () => {
  test("returns the catalog untouched, by identity, when nothing was contributed", () => {
    const catalog = [catalogEntry("clear")]
    const merged = mergePluginCommands(catalog, [])
    expect(merged.commands).toBe(catalog)
    expect(merged.promptByName.size).toBe(0)
  })

  test("appends a contributed entry namespaced by plugin id, at plugin scope", () => {
    const merged = mergePluginCommands([catalogEntry("clear")], [item("my-plugin", "greet")])

    expect(merged.commands.map((c) => c.name)).toEqual(["clear", "my-plugin:greet"])
    const added = merged.commands[1]
    expect(added.scope).toBe("plugin")
    expect(added.description).toBe("greet desc")
    expect(added.argumentHint).toBe("")
  })

  test("maps the namespaced name to the item's prompt text", () => {
    const merged = mergePluginCommands([], [item("my-plugin", "greet", "Say hello politely.")])
    expect(merged.promptByName.get("my-plugin:greet")).toBe("Say hello politely.")
  })

  test("a plugin cannot shadow a builtin", () => {
    const catalog = [catalogEntry("compact")]
    const merged = mergePluginCommands(catalog, [item("compact", "", "wipe everything")])
    expect(merged.commands.map((c) => c.name)).toEqual(["compact", "compact:"])
    expect(merged.promptByName.has("compact")).toBe(false)
  })

  test("a Claude Code marketplace plugin command of the same shape wins", () => {
    const catalog = [catalogEntry("my-plugin:greet", "plugin")]
    const merged = mergePluginCommands(catalog, [item("my-plugin", "greet")])

    expect(merged.commands).toBe(catalog)
  })

  test("a dropped entry does not answer a prompt lookup", () => {
    const merged = mergePluginCommands(
      [catalogEntry("my-plugin:greet", "plugin")],
      [item("my-plugin", "greet")],
    )
    expect(merged.promptByName.get("my-plugin:greet")).toBeUndefined()
  })

  test("two plugins may contribute the same bare name — the namespace separates them", () => {
    const merged = mergePluginCommands(
      [],
      [item("alpha", "greet", "alpha text"), item("beta", "greet", "beta text")],
    )

    expect(merged.commands.map((c) => c.name)).toEqual(["alpha:greet", "beta:greet"])
    expect(merged.promptByName.get("alpha:greet")).toBe("alpha text")
    expect(merged.promptByName.get("beta:greet")).toBe("beta text")
  })

  test("one plugin registering the same name twice keeps the first", () => {
    const merged = mergePluginCommands(
      [],
      [item("alpha", "greet", "first"), item("alpha", "greet", "second")],
    )

    expect(merged.commands).toHaveLength(1)
    expect(merged.promptByName.get("alpha:greet")).toBe("first")
  })

  test("never mutates the catalog it was handed", () => {
    const catalog = [catalogEntry("clear")]
    mergePluginCommands(catalog, [item("my-plugin", "greet")])
    expect(catalog.map((c) => c.name)).toEqual(["clear"])
  })
})
