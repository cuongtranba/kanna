/**
 * Merges what Kanna plugins contributed via `addCommandCenterItem` into the
 * composer's `/` picker catalog.
 *
 * ── WHAT SELECTING A PLUGIN COMMAND DOES, AND WHY ────────────────────────────
 *
 * It inserts the item's `prompt` TEXT into the composer. It does NOT insert
 * `/name`, and it does not create a `SlashCommandNode`.
 *
 * That is forced by how the picker actually applies a selection.
 * `SlashCommandTypeaheadPlugin`'s `onSelectOption` replaces the typed `/query`
 * with a `SlashCommandNode`, whose `getTextContent()` is literally
 * `` `/${name}` `` — so the string that leaves the composer on `chat.send` is a
 * slash command, and every existing catalog entry survives that round trip
 * because something downstream can resolve the name: a builtin is intercepted
 * by `runBuiltinCommand`, and a project/personal/Claude-Code-plugin entry is a
 * FILE the claude CLI reads off disk (`localCommandsForCwd`,
 * `local-catalog-io.adapter.ts`).
 *
 * A Kanna plugin command has neither. It is contributed at RUNTIME by an
 * evaluated browser bundle, so there is no file for the CLI to find and no
 * builtin arm to intercept it. Inserting `/my-plugin:greet` would therefore
 * send the model a command the CLI rejects — a picker entry that is broken by
 * construction, which is exactly the collision `CLAUDE.md` flagged when it said
 * this surface was "deliberately not guessed".
 *
 * The two coherent alternatives were:
 *
 *   1. Teach the server catalog about Kanna plugins so the CLI can resolve the
 *      name. Rejected: that catalog is DISK-scanned server-side and its
 *      `scope: "plugin"` already means Claude Code marketplace plugins — a
 *      different, older feature. A Kanna plugin exists only in the browser at
 *      runtime, so it has nothing to scan.
 *   2. Have the item carry the text it expands to. Chosen: the plugin already
 *      knows what it wants said, `prompt` is a required field on the item (so
 *      an item cannot be registered without one), and the expansion is
 *      resolved entirely client-side before the message is ever sent.
 *
 * Consequences worth knowing: the picker entry behaves like a text snippet, so
 * it works on EVERY provider, and the user can read and edit the inserted text
 * before sending — which is strictly better than a `/name` that only reveals
 * what it does after it runs.
 *
 * ── NAMESPACING AND DEDUPE ───────────────────────────────────────────────────
 *
 * A contributed name is namespaced `<pluginId>:<name>`, and a namespaced name
 * already present in the catalog is DROPPED rather than added. The namespace
 * alone makes a collision with a builtin practically impossible; the dedupe is
 * what makes "a plugin cannot shadow a builtin" true rather than unlikely.
 *
 * The prompt lookup is returned FROM the merge (`promptByName`) rather than
 * derived from the item list at the call site, so a dropped item can never
 * still answer a lookup — which would hijack the catalog entry that beat it.
 */
import type { SlashCommand } from "../../shared/types"
import type { PluginCommandCenterItem } from "../plugins/contributionRegistry"
import { normalizeCommandName } from "./slash-commands"

/** Shared empty identity: the no-plugins case is the default, and this map is
 * read inside a `useCallback` the composer's typeahead depends on. */
const EMPTY_PROMPTS: ReadonlyMap<string, string> = new Map()

export interface PluginCommandMerge {
  /** The catalog with accepted plugin entries appended. Identity is preserved
   * when nothing was contributed, so the common case re-renders nothing. */
  readonly commands: SlashCommand[]
  /** Normalized command name → the text to insert. Only ACCEPTED entries are
   * present, so a name in this map is always one a plugin owns. */
  readonly promptByName: ReadonlyMap<string, string>
}

/** `<pluginId>:<name>`, both halves normalized so an author writing `"/greet"`
 * cannot produce `my-plugin:/greet`. */
export function pluginCommandName(pluginId: string, name: string): string {
  return `${normalizeCommandName(pluginId)}:${normalizeCommandName(name)}`
}

/**
 * Appends the plugin entries the catalog has room for.
 *
 * An entry is skipped when its namespaced name is already taken — by the
 * catalog, or by an earlier plugin entry. Skipping (rather than replacing) is
 * the direction that keeps a plugin from shadowing a builtin.
 */
export function mergePluginCommands(
  catalog: SlashCommand[],
  items: readonly PluginCommandCenterItem[],
): PluginCommandMerge {
  if (items.length === 0) return { commands: catalog, promptByName: EMPTY_PROMPTS }

  const taken = new Set(catalog.map((command) => normalizeCommandName(command.name)))
  const commands = [...catalog]
  const promptByName = new Map<string, string>()

  for (const item of items) {
    const name = pluginCommandName(item.pluginId, item.name)
    if (taken.has(name)) continue
    taken.add(name)
    commands.push({
      name,
      description: item.description,
      // No argument hint: the entry expands to prose, not to a command with a
      // tail the user is expected to fill in.
      argumentHint: "",
      scope: "plugin",
    })
    promptByName.set(name, item.prompt)
  }

  if (promptByName.size === 0) return { commands: catalog, promptByName: EMPTY_PROMPTS }
  return { commands, promptByName }
}
