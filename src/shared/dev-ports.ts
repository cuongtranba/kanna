import type { ShareMode } from "./share"
import { assertNoHostOverride, getShareCliFlag, isShareEnabled } from "./share"

export const DEFAULT_DEV_CLIENT_PORT = 5174

export function getDefaultDevServerPort(clientPort = DEFAULT_DEV_CLIENT_PORT) {
  return clientPort + 1
}

export interface DevArgResolution {
  clientPort: number
  serverPort: number
  share: ShareMode
  backendTargetHost: string
  allowedHosts: true | string[]
  serverArgs: string[]
}

interface DevArgState {
  clientPort: number
  share: ShareMode
  sawHost: boolean
  sawRemote: boolean
  backendTargetHost: string
  allowAllHosts: boolean
  hosts: Set<string>
}

interface DevFlag {
  readonly forwarded: boolean
  apply(state: DevArgState, next: string | undefined): boolean
}

function flagValue(next: string | undefined): string | null {
  return next !== undefined && next.length > 0 && !next.startsWith("-") ? next : null
}

function requiredValue(flag: string, next: string | undefined): string {
  const value = flagValue(next)
  if (value === null) throw new Error(`Missing value for ${flag}`)
  return value
}

const DEV_FLAGS: Readonly<Record<string, DevFlag>> = {
  "--port": {
    forwarded: false,
    apply(state, next) {
      state.clientPort = Number(requiredValue("--port", next))
      return true
    },
  },
  "--share": {
    forwarded: false,
    apply(state) {
      assertNoHostOverride("--share", state.sawHost, state.sawRemote)
      state.share = "quick"
      return false
    },
  },
  "--cloudflared": {
    forwarded: false,
    apply(state, next) {
      assertNoHostOverride("--cloudflared", state.sawHost, state.sawRemote)
      state.share = { kind: "token", token: requiredValue("--cloudflared", next) }
      return true
    },
  },
  "--remote": {
    forwarded: true,
    apply(state) {
      if (isShareEnabled(state.share)) {
        throw new Error(`${getShareCliFlag(state.share)} cannot be used with --remote`)
      }
      state.sawRemote = true
      state.backendTargetHost = "127.0.0.1"
      state.allowAllHosts = true
      return false
    },
  },
  "--host": {
    forwarded: true,
    apply(state, next) {
      const host = flagValue(next)
      if (host === null) return false
      if (isShareEnabled(state.share)) {
        throw new Error(`${getShareCliFlag(state.share)} cannot be used with --host`)
      }
      state.sawHost = true
      state.hosts.add(host)
      state.backendTargetHost = host === "0.0.0.0" ? "127.0.0.1" : host
      return true
    },
  },
}

export function parseDevArgs(args: string[], localHostname: string): DevArgResolution {
  const state: DevArgState = {
    clientPort: DEFAULT_DEV_CLIENT_PORT,
    share: false,
    sawHost: false,
    sawRemote: false,
    backendTargetHost: "127.0.0.1",
    allowAllHosts: false,
    hosts: new Set<string>(["localhost", "127.0.0.1", "0.0.0.0", localHostname]),
  }
  const serverArgs: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const flag = Object.hasOwn(DEV_FLAGS, arg) ? DEV_FLAGS[arg] : undefined
    if (flag === undefined) {
      serverArgs.push(arg)
      continue
    }
    const next = args[index + 1]
    const consumed = flag.apply(state, next)
    if (flag.forwarded) serverArgs.push(...(consumed && next !== undefined ? [arg, next] : [arg]))
    if (consumed) index += 1
  }

  return {
    clientPort: state.clientPort,
    serverPort: getDefaultDevServerPort(state.clientPort),
    share: state.share,
    backendTargetHost: state.backendTargetHost,
    allowedHosts: isShareEnabled(state.share) || state.allowAllHosts ? true : [...state.hosts],
    serverArgs,
  }
}
