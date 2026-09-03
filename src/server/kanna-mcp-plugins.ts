/**
 * Plugin authoring tools for the agent — list shape only.
 *
 * This module decides WHICH tools exist at which depth; it does not yet wire
 * any of them to `plugin-service.ts` (that is later work — see
 * PROGRESS-plugin-system.md's P8 chunk note). Every handler here is a stub.
 *
 * Mirrors `buildBoardToolList` (`kanna-mcp-boards.ts`): `tool` is injected
 * rather than imported, so this module stays free of the MCP SDK's shape and
 * can be unit-tested by calling `buildPluginToolList` directly. Unlike the
 * board/tracking-doc tool families, this one takes POSITIONAL args
 * `(service, chatId, depth, tool)` rather than a deps object — see the
 * acceptance test in `plugin-system-acceptance.test.tsx`, describe
 * "P8 — MCP authoring tools".
 *
 * Depth mirrors the tracking-doc / board split: `plugin_scaffold`,
 * `plugin_install` and `plugin_reload` mutate host state (write plugin
 * source, install a bundle, restart a running plugin process), so they are
 * withheld from subagents (`depth > 0`) the same way board writes and loop
 * management are. `plugin_list`, `plugin_validate` and `plugin_logs` are
 * read-only and available at every depth.
 */
import { z } from "zod"
import type { AnyValue } from "../shared/errors"
import { fail, type ToolResult } from "./kanna-mcp-tool"

const PLUGIN_LIST_DESCRIPTION = "List installed Kanna plugins and their runtime state."

const PLUGIN_VALIDATE_DESCRIPTION =
  "Validate a plugin source directory's manifest and entry points without installing it."

const PLUGIN_LOGS_DESCRIPTION = "Read the recent log lines for one installed plugin."

const PLUGIN_SCAFFOLD_DESCRIPTION = "Scaffold a new Kanna plugin project at a directory."

const PLUGIN_INSTALL_DESCRIPTION = "Compile a plugin source directory and install it."

const PLUGIN_RELOAD_DESCRIPTION = "Stop and restart a running plugin, picking up a rebuilt bundle."

/**
 * `tool` is injected rather than imported so this module stays free of the
 * MCP SDK's shape and can be unit-tested by calling the handlers directly.
 * Mirrors `BoardToolFactory` in `kanna-mcp-boards.ts`.
 */
export type PluginToolFactory<TTool> = (
  name: string,
  description: string,
  schema: Record<string, z.ZodTypeAny>,
  handler: (input: Record<string, AnyValue>) => Promise<ToolResult>,
) => TTool

/** Every handler in this chunk is a stub — wiring to `plugin-service.ts` is later work. */
async function notImplemented(): Promise<ToolResult> {
  return fail("not implemented")
}

/**
 * Build the plugin authoring tool list.
 *
 * `service` is unconstrained on purpose: this chunk is about which tools
 * exist at which depth, not the RPC behind each one, so no handler here
 * reads from it yet. Absent a service or a chatId the family does not exist.
 */
export function buildPluginToolList<TTool>(
  service: object | null,
  chatId: string | null,
  depth: number,
  tool: PluginToolFactory<TTool>,
): TTool[] {
  if (!service || !chatId) return []

  const readOnly: TTool[] = [
    tool("plugin_list", PLUGIN_LIST_DESCRIPTION, {}, notImplemented),
    tool("plugin_validate", PLUGIN_VALIDATE_DESCRIPTION, { source_dir: z.string() }, notImplemented),
    tool("plugin_logs", PLUGIN_LOGS_DESCRIPTION, { id: z.string() }, notImplemented),
  ]

  if (depth > 0) return readOnly

  return [
    ...readOnly,
    tool("plugin_scaffold", PLUGIN_SCAFFOLD_DESCRIPTION, { dir: z.string(), id: z.string() }, notImplemented),
    tool("plugin_install", PLUGIN_INSTALL_DESCRIPTION, { source_dir: z.string() }, notImplemented),
    tool("plugin_reload", PLUGIN_RELOAD_DESCRIPTION, { id: z.string() }, notImplemented),
  ]
}
