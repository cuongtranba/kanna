import { AsyncLocalStorage } from "node:async_hooks"
import type { RemoteMcpOrigin } from "../../shared/command-origin"

const callScope = new AsyncLocalStorage<RemoteMcpOrigin>()

export function runInRemoteMcpCall<T>(origin: RemoteMcpOrigin, work: () => T): T {
  return callScope.run(origin, work)
}

export function currentRemoteMcpOrigin(): RemoteMcpOrigin | undefined {
  return callScope.getStore()
}
