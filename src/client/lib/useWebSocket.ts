/**
 * useWebSocket.ts — the ONE place Kanna reads react-use-websocket's default export.
 *
 * react-use-websocket is CommonJS (no `module` field, no `exports` map) and is
 * TypeScript-transpiled, so its entry sets `__esModule: true` and exposes the hook as
 * `exports.default`. Two bundlers disagree about what a default import of that means:
 *
 *   - rollup / esbuild browser interop (Vite <= 7): honours `__esModule` and binds the
 *     import to `module.exports.default` — the hook.
 *   - rolldown (Vite 8+): applies NODE CommonJS semantics and binds it to `module.exports`
 *     — the namespace object, which is not callable.
 *
 * Under the second, calling the hook throws `TypeError: (0, Lr.default) is not a function`
 * the first time SocketBridge renders, which is at the App root — so the whole client
 * white-screens. Nothing upstream catches it: the `.d.ts` describes the ESM shape so it
 * type-checks, and bun's loader honours `__esModule` so every unit test passes.
 *
 * This module resolves the binding at runtime instead of trusting either interop, and is the
 * only file the cjs-interop gate (src/ops/architecture/cjs-interop.ts) allows to default-import
 * a transpiled-CommonJS package. Everything else imports the named binding from here.
 */

import reactUseWebSocketDefault from "react-use-websocket"
import { type LoadedModule } from "../../shared/dynamic-module"
import { isRecord } from "../../shared/errors"

type UseWebSocket = typeof reactUseWebSocketDefault

const isHook = (value: LoadedModule): value is UseWebSocket => typeof value === "function"

/**
 * Under Node/rolldown interop the binding is `module.exports`, whose own `default` is the
 * hook; under `__esModule`-aware interop the binding IS the hook. No bundler produces a third
 * shape, so a value matching neither means the package's entry changed — which throws here,
 * naming the cause, rather than surfacing as an unreadable minified TypeError at first render.
 */
function resolveUseWebSocket(binding: LoadedModule): UseWebSocket {
  if (isRecord(binding) && isHook(binding.default)) return binding.default
  if (isHook(binding)) return binding
  throw new Error(
    "react-use-websocket's default export is neither the hook nor a namespace carrying it; "
    + "its CommonJS entry shape changed and src/client/lib/useWebSocket.ts needs updating",
  )
}

export const useWebSocket: UseWebSocket = resolveUseWebSocket(reactUseWebSocketDefault)
