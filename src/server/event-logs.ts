import path from "node:path"

export const REPLAYED_LOGS = [
  "projects",
  "stacks",
  "chats",
  "messages",
  "queued-messages",
  "turns",
  "schedules",
  "tool-requests",
  "chat-tasks",
] as const

export const PERIPHERAL_LOGS = ["tunnels", "shares", "push"] as const

export type LogName = (typeof REPLAYED_LOGS)[number]

export type PeripheralLogName = (typeof PERIPHERAL_LOGS)[number]

export type StoreLogName = LogName | PeripheralLogName

const LOG_FILES = {
  projects: "projects.jsonl",
  stacks: "stacks.jsonl",
  chats: "chats.jsonl",
  messages: "messages.jsonl",
  "queued-messages": "queued-messages.jsonl",
  turns: "turns.jsonl",
  schedules: "schedules.jsonl",
  "tool-requests": "tool-requests.jsonl",
  "chat-tasks": "chat-tasks.jsonl",
  tunnels: "tunnels.jsonl",
  shares: "shares.jsonl",
  push: "push.jsonl",
} satisfies Record<StoreLogName, string>

const SURVIVES_STORAGE_RESET: readonly StoreLogName[] = ["push"]

export const ALL_LOGS: readonly StoreLogName[] = [...REPLAYED_LOGS, ...PERIPHERAL_LOGS]

export const LOGS_CLEARED_ON_STORAGE_RESET: readonly StoreLogName[] = ALL_LOGS.filter(
  (name) => !SURVIVES_STORAGE_RESET.includes(name),
)

export function replaySourceOf(name: LogName): number {
  return REPLAYED_LOGS.indexOf(name)
}

export interface StoreLayout {
  readonly dataDir: string
  readonly snapshotPath: string
  readonly sidebarOrderPath: string
  readonly transcriptsDir: string
  logPath(name: StoreLogName): string
  transcriptPath(chatId: string): string
}

export function storeLayoutFor(dataDir: string): StoreLayout {
  const transcriptsDir = path.join(dataDir, "transcripts")
  return {
    dataDir,
    snapshotPath: path.join(dataDir, "snapshot.json"),
    sidebarOrderPath: path.join(dataDir, "sidebar-order.json"),
    transcriptsDir,
    logPath: (name) => path.join(dataDir, LOG_FILES[name]),
    transcriptPath: (chatId) => path.join(transcriptsDir, `${chatId}.jsonl`),
  }
}
