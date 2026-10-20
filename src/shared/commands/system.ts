import { z } from "zod"
import { defineCommand, defineCommands, noParams, REMOTE_ALLOWED } from "./define"
import { projectIdShape } from "./fragments"
import { editorOpenSettingsSchema } from "../core-types.schema"

const openExternalActionSchema = z.enum(["open_finder", "open_terminal", "open_editor", "open_preview", "open_default"])

export const systemCommands = defineCommands(
  defineCommand("system.ping", {
    params: noParams,
    summary: "Liveness check; answers with an ack.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("system.openExternal", {
    params: z.object({
      localPath: z.string(),
      action: openExternalActionSchema,
      line: z.number().optional(),
      column: z.number().optional(),
      editor: editorOpenSettingsSchema.optional(),
    }),
    summary: "Open a path in Finder, a terminal, an editor or the default app on the host machine.",
    risk: "local",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("update.check", {
    params: z.object({ force: z.boolean().optional() }),
    summary: "Check whether a newer Kanna version is available.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("update.install", {
    params: z.object({ version: z.string().optional() }),
    summary: "Install a Kanna update and restart the server.",
    risk: "destructive",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("update.reload", {
    params: noParams,
    summary: "Reload the running Kanna client after an update.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("beacons.mintPairingCode", {
    params: noParams,
    summary: "Mint a one-time pairing code for a remote beacon.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("beacons.update", {
    params: z.object({ beaconId: z.string() }),
    summary: "Ask a paired beacon to update itself.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("skills.search", {
    params: z.object({ query: z.string(), limit: z.number().optional() }),
    summary: "Search the skills registry.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("skills.install", {
    params: z.object({ source: z.string(), skillId: z.string() }),
    summary: "Install a skill from a source.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("skills.uninstall", {
    params: z.object({ skillId: z.string() }),
    summary: "Uninstall a skill.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("skills.listInstalled", {
    params: noParams,
    summary: "List installed skills.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("packages.listInstalled", {
    params: noParams,
    summary: "List installed skills and plugins with their update state.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("packages.checkUpdates", {
    params: noParams,
    summary: "Check installed packages for available updates.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("packages.update", {
    params: z.object({ id: z.string() }),
    summary: "Update one installed package.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("packages.updateAll", {
    params: z.object({ ids: z.array(z.string()) }),
    summary: "Update several installed packages.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("terminal.create", {
    params: z.object({
      ...projectIdShape,
      terminalId: z.string(),
      cols: z.number(),
      rows: z.number(),
      scrollback: z.number(),
    }),
    summary: "Spawn a shell terminal on the host machine in the project directory.",
    risk: "local",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("terminal.input", {
    params: z.object({ terminalId: z.string(), data: z.string() }),
    summary: "Send keystrokes to a host terminal.",
    risk: "local",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("terminal.resize", {
    params: z.object({ terminalId: z.string(), cols: z.number(), rows: z.number() }),
    summary: "Resize a host terminal.",
    risk: "local",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("terminal.close", {
    params: z.object({ terminalId: z.string() }),
    summary: "Close a host terminal and kill its shell.",
    risk: "destructive",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("serviceBus.resetStore", {
    params: noParams,
    summary: "Stop the embedded NATS server, delete its JetStream store and start it again.",
    risk: "destructive",
    remote: REMOTE_ALLOWED,
  }),
)
