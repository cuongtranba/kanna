
declare module "@kanna/plugin" {
  import type { ComponentType } from "react"

  export interface PluginTheme {
    readonly colors: {
      readonly foreground: string
    }
  }

  export interface PluginSurfaceProps {
    readonly theme: PluginTheme
  }

  export type WorkspaceChatStatus = "idle" | "starting" | "running" | "waiting_for_user" | "failed"

  export interface WorkspaceChat {
    readonly chatId: string
    readonly title: string
    readonly status: WorkspaceChatStatus
    readonly unread: boolean
    readonly lastMessageAt: number | null
  }

  export interface WorkspaceCronRun {
    readonly status: "running" | "completed" | "failed" | "skipped"
    readonly firedAt: number
  }

  export interface WorkspaceCronJob {
    readonly jobId: string
    readonly chatId: string
    readonly instruction: string
    readonly mode: "inline" | "spawn"
    readonly schedule: string
    readonly scheduleHuman: string
    readonly paused: boolean
    readonly model: string | null
    readonly nextFireAt: number | null
    readonly lastRun: WorkspaceCronRun | null
  }

  export interface WorkspaceProject {
    readonly localPath: string
    readonly name: string
    readonly chats: readonly WorkspaceChat[]
    readonly cronJobs: readonly WorkspaceCronJob[]
  }

  export interface StartChatOptions {
    readonly prompt?: string
  }

  export interface Workspace {
    readonly projects: readonly WorkspaceProject[]
    readonly ready: boolean
    readonly starting: boolean
    openChat(chatId: string): void
    startChat(localPath: string, options?: StartChatOptions): void
  }

  export function useKannaWorkspace(): Workspace

  export type PluginSurfaceComponent = ComponentType<PluginSurfaceProps>

  export interface PluginSidebarItemInput {
    readonly id: string
    readonly title: string
    readonly icon: string
    readonly surface: string
  }

  export interface PluginCommandCenterItemInput {
    readonly name: string
    readonly description: string
    readonly prompt: string
  }

  export interface PluginContext {
    addSurface(id: string, component: PluginSurfaceComponent): void
    addSidebarItem(item: PluginSidebarItemInput): void
    addCommandCenterItem(item: PluginCommandCenterItemInput): void
    handle<TContract, THandler>(contract: TContract, handler: THandler): void
  }
}

declare module "@kanna/plugin/server" {
  import type { ZodType } from "zod"

  export interface PluginRpcContract {
    readonly name: string
    readonly input: ZodType
    readonly output: ZodType
  }

  export function defineRpc<T extends PluginRpcContract>(contract: T): T
}
