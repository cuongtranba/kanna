/**
 * Ambient declarations for `@kanna/plugin` — the package a plugin AUTHOR
 * imports. Kanna itself never imports it: the host constructs the context
 * object it hands to a plugin's `default` export locally
 * (`src/client/plugins/contributionRegistry.ts`'s `createPluginContext`) and
 * implements `defineRpc` as the identity function in the child entry
 * (`src/server/plugins/plugin-child-entry.adapter.ts`). Plugin source imports
 * these as TYPES only, so the specifier is elided at compile time and no such
 * package needs to exist on disk to build a plugin.
 *
 * It does need to exist for `tsc`, though. Without this file the fixture
 * plugins under `src/server/__fixtures__/plugins/**` raise six TS2307
 * "Cannot find module '@kanna/plugin'" errors, `bun run typecheck` exits 1,
 * and the loop's verify command — `bun test ... && bun run typecheck && ...` —
 * can NEVER exit 0. That made the plugin-system loop unwinnable by
 * construction: GOAL MET was structurally unreachable, so it ran for two days
 * and ~20 iterations without a terminal state.
 *
 * These shapes MIRROR the host's real runtime counterparts and must keep
 * doing so — they are the same contract seen from the author's side:
 *   - `PluginContext` / `PluginSurfaceProps` / `PluginSidebarItemInput`
 *     ← `src/client/plugins/contributionRegistry.ts`
 *   - `defineRpc` / the contract it returns
 *     ← `src/server/plugins/plugin-rpc-protocol.ts`
 * When a real `@kanna/plugin` package is published, it replaces this file and
 * these declarations become its `.d.ts`.
 */

declare module "@kanna/plugin" {
  import type { ComponentType } from "react"

  export interface PluginTheme {
    readonly colors: {
      readonly foreground: string
    }
  }

  /** Props every contributed surface receives from the host. */
  export interface PluginSurfaceProps {
    readonly theme: PluginTheme
  }

  export type PluginSurfaceComponent = ComponentType<PluginSurfaceProps>

  export interface PluginSidebarItemInput {
    readonly id: string
    readonly title: string
    readonly icon: string
    readonly surface: string
  }

  /** What a plugin's `default` export is called with. */
  export interface PluginContext {
    addSurface(id: string, component: PluginSurfaceComponent): void
    addSidebarItem(item: PluginSidebarItemInput): void
    /**
     * Wire an RPC contract to its implementation. Server-side concern: the
     * CLIENT context accepts the call as a no-op so shared plugin code calling
     * `plugin.handle(...)` does not throw when evaluated in the browser.
     *
     * Generic rather than `unknown`-typed: this repo bans the `unknown`
     * keyword outside `toError`, and the contract/handler pair is only related
     * to each other inside the SERVER bundle, which type-checks it there.
     */
    handle<TContract, THandler>(contract: TContract, handler: THandler): void
  }
}

declare module "@kanna/plugin/server" {
  import type { ZodTypeAny } from "zod"

  /**
   * Data only, no behaviour — the host's `defineRpc` is the identity function.
   * Mirrors `PluginRpcContract` in `plugin-rpc-protocol.ts`.
   */
  export interface PluginRpcContract {
    readonly name: string
    readonly input: ZodTypeAny
    readonly output: ZodTypeAny
  }

  export function defineRpc(contract: PluginRpcContract): PluginRpcContract
}
