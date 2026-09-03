import { getDataRootDir } from "../branding"

type RuntimeEnv = Record<string, string | undefined> | undefined

/**
 * Installed plugins live under the data ROOT (not `data/`), matching
 * `getKeybindingsFilePath`. That also means `KANNA_RUNTIME_PROFILE=dev` gets
 * `~/.kanna-dev/plugins` for free, so a dev server never compiles into — or
 * spawns from — the production install's plugin tree.
 */
export function getPluginsRootDir(homeDir: string, env?: RuntimeEnv) {
  return `${getDataRootDir(homeDir, env)}/plugins`
}

export function getPluginDir(homeDir: string, id: string, env?: RuntimeEnv) {
  return `${getPluginsRootDir(homeDir, env)}/${id}`
}

/** Compiled `client.js` / `server.js` and the build stamp cache. */
export function getPluginBuildDir(homeDir: string, id: string, env?: RuntimeEnv) {
  return `${getPluginDir(homeDir, id, env)}/build`
}

/**
 * The kernel's `sockaddr_un.sun_path` limit. macOS caps it at 104 bytes
 * (Linux at 108), so 104 is the portable bound.
 */
export const PLUGIN_SOCKET_PATH_MAX_BYTES = 104

/**
 * MEASURED, not defensive: `${HOME}/.kanna/plugins/<64-char-id>/run/host.sock`
 * is 110 bytes — over the cap. The plugin RPC socket therefore lives in the
 * system temp directory under a short generated name, never beside the build
 * output. Byte length, not string length: a multi-byte id passes a `.length`
 * check and still overflows the kernel's buffer.
 *
 * `TextEncoder` rather than `Buffer`: this module sits in `src/shared/**`, which
 * the client bundle may import, and `Buffer` is a Node global Vite does not
 * polyfill. It would also be the only `Buffer` reference in all of `src/shared/`.
 */
const PATH_BYTE_COUNTER = new TextEncoder()

export function pluginSocketPathFits(socketPath: string): boolean {
  return PATH_BYTE_COUNTER.encode(socketPath).length <= PLUGIN_SOCKET_PATH_MAX_BYTES
}
