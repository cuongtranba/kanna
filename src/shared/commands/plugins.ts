import { z } from "zod"
import { defineCommand, defineCommands, noParams, REMOTE_ALLOWED } from "./define"

export const pluginsCommands = defineCommands(
  defineCommand("plugins.list", {
    params: noParams,
    summary: "List installed plugins with their enabled flag and runtime state; empty while plugins are switched off.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("plugins.reload", {
    params: z.object({ pluginId: z.string() }),
    summary: "Restart one installed plugin from its source folder.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
)
