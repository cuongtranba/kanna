
import reactUseWebSocketDefault from "react-use-websocket"
import { type LoadedModule } from "../../shared/dynamic-module"
import { isRecord } from "../../shared/errors"

type UseWebSocket = typeof reactUseWebSocketDefault

const isHook = (value: LoadedModule): value is UseWebSocket => typeof value === "function"

function resolveUseWebSocket(binding: LoadedModule): UseWebSocket {
  if (isRecord(binding) && isHook(binding.default)) return binding.default
  if (isHook(binding)) return binding
  throw new Error(
    "react-use-websocket's default export is neither the hook nor a namespace carrying it; "
    + "its CommonJS entry shape changed and src/client/lib/useWebSocket.ts needs updating",
  )
}

export const useWebSocket: UseWebSocket = resolveUseWebSocket(reactUseWebSocketDefault)
