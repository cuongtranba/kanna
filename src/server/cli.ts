import process from "node:process"
import { LOG_PREFIX } from "../shared/branding"
import { getBunVersion, loadPackageVersion } from "./cli-bootstrap.adapter"
import {
  fetchLatestPackageVersion,
  installPackageVersion,
  openUrl,
  runCli,
} from "./cli-runtime"
import { CLI_STARTUP_UPDATE_RESTART_EXIT_CODE, CLI_UI_UPDATE_RESTART_EXIT_CODE } from "./restart"
import { startKannaServer } from "./server"

const VERSION: string = await loadPackageVersion()

const argv = process.argv.slice(2)
let resolveExitAction: ((action: "ui_restart" | "exit") => void) | null = null

const result = await runCli(argv, {
  version: VERSION,
  bunVersion: getBunVersion(),
  startServer: async (options) => {
    const started = await startKannaServer(options)
    if (started.updateManager && options.update) {
      started.updateManager.onChange((snapshot) => {
        if (snapshot.status !== "restart_pending") return
        console.log(`${LOG_PREFIX} update installed, shutting down current process for restart`)
        resolveExitAction?.("ui_restart")
      })
    }

    return started
  },
  fetchLatestVersion: fetchLatestPackageVersion,
  installVersion: installPackageVersion,
  openUrl,
  log: console.log,
  warn: console.warn,
})

if (result.kind === "exited") {
  process.exit(result.code)
}

if (result.kind === "restarting") {
  process.exit(result.reason === "startup_update" ? CLI_STARTUP_UPDATE_RESTART_EXIT_CODE : CLI_UI_UPDATE_RESTART_EXIT_CODE)
}

const exitAction = await new Promise<"ui_restart" | "exit">((resolve) => {
  resolveExitAction = resolve

  const shutdown = () => {
    resolve("exit")
  }

  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
  process.once("SIGHUP", shutdown)
})

// Hard backstop around the graceful stop: if server shutdown hangs (a stalled
// auth.dispose, a wedged snapshot), the process must still exit rather than wait
// for the supervisor's SIGKILL. Sized just above the server's own drain grace so
// the in-server bounded drain runs first. Any turn left unfinished by a forced
// exit is auto-resumed on next boot by turn-recovery.
const stopBackstopMs = (Number(process.env.KANNA_SHUTDOWN_GRACE_MS) || 4000) + 1000
const stoppedCleanly = await Promise.race([
  result.stop().then(() => true),
  new Promise<boolean>((resolve) => setTimeout(() => resolve(false), stopBackstopMs)),
])
if (!stoppedCleanly) {
  console.warn(`${LOG_PREFIX} graceful stop exceeded ${stopBackstopMs}ms; forcing exit`)
}
if (exitAction === "ui_restart") {
  console.log(`${LOG_PREFIX} current process stopped, handing restart back to supervisor`)
}
process.exit(exitAction === "ui_restart" ? CLI_UI_UPDATE_RESTART_EXIT_CODE : 0)
