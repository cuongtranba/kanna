export const RESTART_EXIT_CODE = 75
export const SUPERVISED_ENV = "KANNA_BEACON_SUPERVISED"

export type ForwardedSignal = "SIGINT" | "SIGTERM"

export const FORWARDED_SIGNALS: readonly ForwardedSignal[] = ["SIGINT", "SIGTERM"]

export interface SupervisedChild {
  exited: Promise<number>
  kill(signal: ForwardedSignal): void
}

export interface SupervisorPort {
  spawn(): SupervisedChild
  onSignal(listener: (signal: ForwardedSignal) => void): () => void
}

export type AfterRun = { kind: "exit"; code: number } | { kind: "supervise" }

export function afterBeaconRun(code: number, supervised: boolean): AfterRun {
  if (code !== RESTART_EXIT_CODE || supervised) return { kind: "exit", code }
  return { kind: "supervise" }
}

export async function superviseRestarts(port: SupervisorPort): Promise<number> {
  let child: SupervisedChild | null = null
  let signalled = false
  const stopListening = port.onSignal((signal) => {
    signalled = true
    child?.kill(signal)
  })
  try {
    for (;;) {
      child = port.spawn()
      const code = await child.exited
      if (code !== RESTART_EXIT_CODE || signalled) return code
    }
  } finally {
    stopListening()
  }
}
