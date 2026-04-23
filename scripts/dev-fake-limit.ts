import process from "node:process"
import { startKannaServer } from "../src/server/server"

process.env.KANNA_RUNTIME_PROFILE = "dev"
process.env.KANNA_DISABLE_SELF_UPDATE = "1"

const resetSeconds = Number(process.argv[2] ?? 60)
const port = Number(process.env.KANNA_PORT ?? 5175)

const server = await startKannaServer({
  port,
  host: "127.0.0.1",
  agentOverrides: {
    throwOnClaudeSessionStart: true,
    claudeLimitDetector: {
      detect: (chatId) => ({
        chatId,
        resetAt: Date.now() + resetSeconds * 1000,
        tz: "system",
        raw: null,
      }),
    },
    codexLimitDetector: {
      detect: (chatId) => ({
        chatId,
        resetAt: Date.now() + resetSeconds * 1000,
        tz: "system",
        raw: null,
      }),
    },
  },
})

console.log(`[kanna-fake-limit] listening on http://127.0.0.1:${server.port}, reset window = ${resetSeconds}s`)

await new Promise<void>((resolve) => {
  const shutdown = () => resolve()
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
})

await server.stop()
