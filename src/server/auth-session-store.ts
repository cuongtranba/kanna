import { createHash } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { LOG_PREFIX } from "../shared/branding"

const FILE_VERSION = 1
const PERSIST_DEBOUNCE_MS = 250
const PERSIST_DRIFT_MS = 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

export interface PersistedSession {
  tokenHash: string
  createdAt: number
  lastSeenAt: number
  expiresAt: number
}

interface SessionsFile {
  version: number
  sessions: PersistedSession[]
}

export interface AuthSessionStore {
  create(token: string, maxAgeMs: number): PersistedSession
  validate(token: string): PersistedSession | null
  touch(token: string, maxAgeMs: number): PersistedSession | null
  revoke(token: string): void
  sweep(): void
  dispose(): Promise<void>
}

export interface CreateAuthSessionStoreOptions {
  filePath: string
  now?: () => number
  sweepIntervalMs?: number
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

function isPersistedSession(value: unknown): value is PersistedSession {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.tokenHash === "string"
    && typeof candidate.createdAt === "number"
    && typeof candidate.lastSeenAt === "number"
    && typeof candidate.expiresAt === "number"
}

async function loadSessionsFile(filePath: string): Promise<PersistedSession[]> {
  try {
    const text = await readFile(filePath, "utf8")
    if (!text.trim()) return []
    const parsed = JSON.parse(text) as Partial<SessionsFile>
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.sessions)) {
      return []
    }
    return parsed.sessions.filter(isPersistedSession)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return []
    if (error instanceof SyntaxError) {
      console.warn(`${LOG_PREFIX} sessions.json is invalid JSON; ignoring.`)
      return []
    }
    throw error
  }
}

export async function createAuthSessionStore(options: CreateAuthSessionStoreOptions): Promise<AuthSessionStore> {
  const { filePath } = options
  const now = options.now ?? (() => Date.now())
  const sweepIntervalMs = options.sweepIntervalMs ?? SWEEP_INTERVAL_MS

  await mkdir(path.dirname(filePath), { recursive: true })
  const initialSessions = await loadSessionsFile(filePath)
  const sessions = new Map<string, PersistedSession>()
  const lastPersistedExpiry = new Map<string, number>()
  for (const session of initialSessions) {
    if (session.expiresAt > now()) {
      sessions.set(session.tokenHash, session)
      lastPersistedExpiry.set(session.tokenHash, session.expiresAt)
    }
  }

  let pendingPersist: ReturnType<typeof setTimeout> | null = null
  let activeWrite: Promise<void> | null = null
  let writeAgain = false

  async function writeFileAtomic() {
    const payload: SessionsFile = {
      version: FILE_VERSION,
      sessions: Array.from(sessions.values()),
    }
    const tmpPath = `${filePath}.tmp`
    await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    await rename(tmpPath, filePath)
    for (const session of payload.sessions) {
      lastPersistedExpiry.set(session.tokenHash, session.expiresAt)
    }
    for (const tokenHash of [...lastPersistedExpiry.keys()]) {
      if (!sessions.has(tokenHash)) lastPersistedExpiry.delete(tokenHash)
    }
  }

  async function runWrite() {
    do {
      writeAgain = false
      try {
        await writeFileAtomic()
      } catch (error) {
        console.warn(`${LOG_PREFIX} Failed to persist sessions.json:`, error)
      }
    } while (writeAgain)
    activeWrite = null
  }

  function schedulePersist() {
    if (pendingPersist) return
    pendingPersist = setTimeout(() => {
      pendingPersist = null
      if (activeWrite) {
        writeAgain = true
        return
      }
      activeWrite = runWrite()
    }, PERSIST_DEBOUNCE_MS)
  }

  async function flushPersist() {
    if (pendingPersist) {
      clearTimeout(pendingPersist)
      pendingPersist = null
      activeWrite = activeWrite ?? runWrite()
    }
    if (activeWrite) await activeWrite
  }

  function shouldPersistTouch(tokenHash: string, expiresAt: number) {
    const last = lastPersistedExpiry.get(tokenHash)
    if (last === undefined) return true
    return Math.abs(expiresAt - last) >= PERSIST_DRIFT_MS
  }

  function create(token: string, maxAgeMs: number): PersistedSession {
    const tokenHash = hashToken(token)
    const timestamp = now()
    const session: PersistedSession = {
      tokenHash,
      createdAt: timestamp,
      lastSeenAt: timestamp,
      expiresAt: timestamp + maxAgeMs,
    }
    sessions.set(tokenHash, session)
    schedulePersist()
    return session
  }

  function validate(token: string): PersistedSession | null {
    const tokenHash = hashToken(token)
    const session = sessions.get(tokenHash)
    if (!session) return null
    if (session.expiresAt <= now()) {
      sessions.delete(tokenHash)
      schedulePersist()
      return null
    }
    return session
  }

  function touch(token: string, maxAgeMs: number): PersistedSession | null {
    const tokenHash = hashToken(token)
    const session = sessions.get(tokenHash)
    if (!session) return null
    const timestamp = now()
    if (session.expiresAt <= timestamp) {
      sessions.delete(tokenHash)
      schedulePersist()
      return null
    }
    const next: PersistedSession = {
      ...session,
      lastSeenAt: timestamp,
      expiresAt: timestamp + maxAgeMs,
    }
    sessions.set(tokenHash, next)
    if (shouldPersistTouch(tokenHash, next.expiresAt)) {
      schedulePersist()
    }
    return next
  }

  function revoke(token: string) {
    const tokenHash = hashToken(token)
    if (sessions.delete(tokenHash)) {
      schedulePersist()
    }
  }

  function sweep() {
    const cutoff = now()
    let changed = false
    for (const [tokenHash, session] of sessions) {
      if (session.expiresAt <= cutoff) {
        sessions.delete(tokenHash)
        changed = true
      }
    }
    if (changed) schedulePersist()
  }

  const sweepHandle = setInterval(sweep, sweepIntervalMs)
  if (typeof sweepHandle === "object" && sweepHandle !== null && "unref" in sweepHandle) {
    sweepHandle.unref?.()
  }

  async function dispose() {
    clearInterval(sweepHandle)
    await flushPersist()
  }

  return { create, validate, touch, revoke, sweep, dispose }
}
