const KANNA_RUNTIME_ONLY_KEYS = ["NODE_ENV"] as const

export function projectProcessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const projectEnv: NodeJS.ProcessEnv = { ...env }
  for (const key of KANNA_RUNTIME_ONLY_KEYS) {
    delete projectEnv[key]
  }
  return projectEnv
}
