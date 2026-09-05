import { getDataRootDir } from "../branding"

type RuntimeEnv = Record<string, string | undefined> | undefined

export function getPluginsRootDir(homeDir: string, env?: RuntimeEnv) {
  return `${getDataRootDir(homeDir, env)}/plugins`
}

export function getPluginDir(homeDir: string, id: string, env?: RuntimeEnv) {
  return `${getPluginsRootDir(homeDir, env)}/${id}`
}

export function getPluginBuildDir(homeDir: string, id: string, env?: RuntimeEnv) {
  return `${getPluginDir(homeDir, id, env)}/build`
}

export const PLUGIN_SOCKET_PATH_MAX_BYTES = 104

const PATH_BYTE_COUNTER = new TextEncoder()

export function pluginSocketPathFits(socketPath: string): boolean {
  return PATH_BYTE_COUNTER.encode(socketPath).length <= PLUGIN_SOCKET_PATH_MAX_BYTES
}
