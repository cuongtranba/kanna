import type { ClientCommand } from "../shared/protocol"
import { AGENT_CTRL_COMMAND_TYPES } from "./ws-router-agent-ctrl"
import { BOARD_COMMAND_TYPES } from "./ws-router-boards"
import { CHAT_COMMAND_TYPES } from "./ws-router-chat"
import { DIFF_COMMAND_TYPES } from "./ws-router-diff"
import { MISC_COMMAND_TYPES } from "./ws-router-misc"
import { OBSERVABILITY_COMMAND_TYPES } from "./ws-router-observability"
import { PROJECT_COMMAND_TYPES } from "./ws-router-project"
import { PUSH_COMMAND_TYPES } from "./ws-router-push"
import { SETTINGS_COMMAND_TYPES } from "./ws-router-settings"

export const BACKGROUND_TASK_COMMAND_TYPES = [
  "backgroundTasks.getOutput",
] as const satisfies readonly ClientCommand["type"][]

const ROUTE_GROUPS = [
  "agentCtrl",
  "backgroundTasks",
  "board",
  "chat",
  "diff",
  "misc",
  "observability",
  "project",
  "push",
  "settings",
] as const

export type CommandRouteGroup = (typeof ROUTE_GROUPS)[number]

export const COMMAND_TYPES_BY_GROUP = {
  agentCtrl: AGENT_CTRL_COMMAND_TYPES,
  backgroundTasks: BACKGROUND_TASK_COMMAND_TYPES,
  board: BOARD_COMMAND_TYPES,
  chat: CHAT_COMMAND_TYPES,
  diff: DIFF_COMMAND_TYPES,
  misc: MISC_COMMAND_TYPES,
  observability: OBSERVABILITY_COMMAND_TYPES,
  project: PROJECT_COMMAND_TYPES,
  push: PUSH_COMMAND_TYPES,
  settings: SETTINGS_COMMAND_TYPES,
} as const satisfies Record<CommandRouteGroup, readonly ClientCommand["type"][]>

type RoutedCommandType = (typeof COMMAND_TYPES_BY_GROUP)[CommandRouteGroup][number]

type UnroutedCommandType = Exclude<ClientCommand["type"], RoutedCommandType>

type RequireNever<T extends never> = T

export type EveryCommandIsRouted = RequireNever<UnroutedCommandType>

const GROUP_BY_COMMAND_TYPE: ReadonlyMap<string, CommandRouteGroup> = new Map(
  ROUTE_GROUPS.flatMap((group) =>
    COMMAND_TYPES_BY_GROUP[group].map((type) => [type, group] as const),
  ),
)

export function routeGroupOf(commandType: ClientCommand["type"]): CommandRouteGroup | undefined {
  return GROUP_BY_COMMAND_TYPE.get(commandType)
}

const MODULE_SUFFIX_BY_GROUP: Readonly<Record<CommandRouteGroup, string>> = {
  agentCtrl: "agent-ctrl",
  backgroundTasks: "routes",
  board: "boards",
  chat: "chat",
  diff: "diff",
  misc: "misc",
  observability: "observability",
  project: "project",
  push: "push",
  settings: "settings",
}

export function unhandledRoutedCommandMessage(
  commandType: string,
  group: CommandRouteGroup,
): string {
  return `Command "${commandType}" is routed to the ${group} handler, which did not handle it. `
    + `Add a case for it in ws-router-${MODULE_SUFFIX_BY_GROUP[group]}.ts, `
    + `or move it to the group that owns it in ws-router-routes.ts.`
}
