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
    // Identity, not just equality: this feeds a useMemo the composer's option
    // list is derived from, so a fresh array would rebuild it on every render.
    expect(merged.commands).toBe(catalog)
    expect(merged.promptByName.size).toBe(0)
  })

  test("appends a contributed entry namespaced by plugin id, at plugin scope", () => {
    const merged = mergePluginCommands([catalogEntry("clear")], [item("my-plugin", "greet")])

    expect(merged.commands.map((c) => c.name)).toEqual(["clear", "my-plugin:greet"])
    const added = merged.commands[1]
    expect(added.scope).toBe("plugin")
    expect(added.description).toBe("greet desc")
    // No argument hint: the entry expands to prose, not to a command with a tail.
    expect(added.argumentHint).toBe("")
  })

  test("maps the namespaced name to the item's prompt text", () => {
    const merged = mergePluginCommands([], [item("my-plugin", "greet", "Say hello politely.")])
    expect(merged.promptByName.get("my-plugin:greet")).toBe("Say hello politely.")
  })

  test("a plugin cannot shadow a builtin", () => {
    const catalog = [catalogEntry("compact")]
    // A Kanna plugin id would have to BE `compact` with an empty item name to
    // even reach `compact`, which the namespace already prevents; the merge
    // still refuses anything the catalog already holds.
    const merged = mergePluginCommands(catalog, [item("compact", "", "wipe everything")])
    expect(merged.commands.map((c) => c.name)).toEqual(["compact", "compact:"])
    expect(merged.promptByName.has("compact")).toBe(false)
  })

  test("a Claude Code marketplace plugin command of the same shape wins", () => {
    // The real collision. `local-catalog-io.adapter.ts` already names Claude
    // Code plugin commands `<pluginName>:<command>` at scope "plugin" — the
    // exact shape this module mints. That entry is a FILE the CLI resolves, so
    // it keeps the name and the Kanna item is dropped.
    const catalog = [catalogEntry("my-plugin:greet", "plugin")]
    const merged = mergePluginCommands(catalog, [item("my-plugin", "greet")])

    expect(merged.commands).toBe(catalog)
  })

  test("a dropped entry does not answer a prompt lookup", () => {
    // The sharp case: if the prompt map were derived from the item list rather
    // than from what the merge ACCEPTED, selecting the surviving disk-catalog
    // command would insert the dropped plugin's text instead of `/name`.
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
