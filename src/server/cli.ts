import process from "node:process"
import { LOG_PREFIX } from "../shared/branding"
import { log } from "../shared/log"
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
const exitRequested = Promise.withResolvers<"ui_restart" | "exit">()

const result = await runCli(argv, {
  version: VERSION,
  bunVersion: getBunVersion(),
  startServer: async (options) => {
    const started = await startKannaServer(options)
    if (started.updateManager && options.update) {
      started.updateManager.onChange((snapshot) => {
        if (snapshot.status !== "restart_pending") return
        log.info(`${LOG_PREFIX} update installed, shutting down current process for restart`)
        exitRequested.resolve("ui_restart")
      })
    }

    return started
  },
  fetchLatestVersion: fetchLatestPackageVersion,
  installVersion: installPackageVersion,
  openUrl,
  log: log.info,
  warn: log.warn,
})

if (result.kind === "exited") {
  process.exit(result.code)
}

if (result.kind === "restarting") {
  process.exit(result.reason === "startup_update" ? CLI_STARTUP_UPDATE_RESTART_EXIT_CODE : CLI_UI_UPDATE_RESTART_EXIT_CODE)
}

const shutdown = () => {
  exitRequested.resolve("exit")
}

process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)
process.once("SIGHUP", shutdown)

const exitAction = await exitRequested.promise

await result.stop()
if (exitAction === "ui_restart") {
  log.info(`${LOG_PREFIX} current process stopped, handing restart back to supervisor`)
}
process.exit(exitAction === "ui_restart" ? CLI_UI_UPDATE_RESTART_EXIT_CODE : 0)
