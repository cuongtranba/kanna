import { Database } from "bun:sqlite"
import { randomBytes } from "node:crypto"
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { betterAuth, type BetterAuthOptions } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
import { isErrnoException, toError } from "../shared/errors"
import { log } from "../shared/log"
import type { AppSettingsManager } from "./app-settings"
import { createAuthManager, type AuthManager } from "./auth"
import { CLIENT_IP_HEADER, OWNER_EMAIL, SESSION_COOKIE_NAME, type AuthBackend } from "./auth-backend"

const SECRET_FILE = "auth-secret"
const DATABASE_FILE = "auth.db"
const LEGACY_SESSIONS_FILE = "sessions.json"
const SECONDS_PER_DAY = 86_400
const SESSION_UPDATE_AGE_SECONDS = SECONDS_PER_DAY
const AUTH_BASE_PATH = "/api/auth"
const INTERNAL_BASE_URL = "http://localhost"
const MAX_PASSWORD_LENGTH = 4096
const SECRET_BYTES = 32

async function loadOrCreateSecret(filePath: string): Promise<string> {
  try {
    const existing = (await readFile(filePath, "utf8")).trim()
    if (existing) return existing
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") throw error
  }
  const secret = randomBytes(SECRET_BYTES).toString("base64url")
  await writeFile(filePath, secret, { mode: 0o600 })
  return secret
}

async function removeLegacySessions(dataDir: string) {
  await rm(path.join(dataDir, LEGACY_SESSIONS_FILE), { force: true })
}

function authOptions(database: Database, secret: string, sessionMaxAgeDays: number) {
  return {
    secret,
    database,
    baseURL: INTERNAL_BASE_URL,
    basePath: AUTH_BASE_PATH,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 1,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
    },
    session: {
      expiresIn: Math.round(sessionMaxAgeDays * SECONDS_PER_DAY),
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    advanced: {
      cookies: { session_token: { name: SESSION_COOKIE_NAME } },
      defaultCookieAttributes: { sameSite: "strict" },
      useSecureCookies: false,
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    rateLimit: { enabled: true, storage: "database" },
    trustedOrigins: (request) => (request ? [new URL(request.url).origin] : []),
    logger: {
      level: "warn",
      log: (level, message, ...args) => log[level](`[auth] ${message}`, ...args),
    },
  } satisfies BetterAuthOptions
}

function buildAuth(database: Database, secret: string, sessionMaxAgeDays: number) {
  return betterAuth(authOptions(database, secret, sessionMaxAgeDays))
}

type KannaAuthInstance = ReturnType<typeof buildAuth>

async function ensureOwner(instance: KannaAuthInstance, password: string) {
  const context = await instance.$context
  const found = await context.internalAdapter.findUserByEmail(OWNER_EMAIL, { includeAccounts: true })
  if (!found) {
    const hash = await context.password.hash(password)
    const user = await context.internalAdapter.createUser(
      { email: OWNER_EMAIL, name: "Owner", emailVerified: true },
      { method: "email-password" },
    )
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: hash,
    })
    return
  }
  const credential = found.accounts.find((account) => account.providerId === "credential")
  const unchanged = credential?.password
    ? await context.password.verify({ hash: credential.password, password })
    : false
  if (unchanged) return
  const hash = await context.password.hash(password)
  if (credential) {
    await context.internalAdapter.updatePassword(found.user.id, hash)
  } else {
    await context.internalAdapter.linkAccount({
      userId: found.user.id,
      providerId: "credential",
      accountId: found.user.id,
      password: hash,
    })
  }
  await context.internalAdapter.deleteUserSessions(found.user.id)
}

export interface BetterAuthBackendOptions {
  dataDir: string
  password: string
  getSessionMaxAgeDays: () => number
}

export interface BetterAuthBackend extends AuthBackend {
  refreshSessionLifetime(): void
}

export async function createBetterAuthBackend(options: BetterAuthBackendOptions): Promise<BetterAuthBackend> {
  await mkdir(options.dataDir, { recursive: true })
  const secret = await loadOrCreateSecret(path.join(options.dataDir, SECRET_FILE))
  const databasePath = path.join(options.dataDir, DATABASE_FILE)
  const database = new Database(databasePath, { create: true })
  await chmod(databasePath, 0o600)
  let configuredDays = options.getSessionMaxAgeDays()
  let current: KannaAuthInstance

  try {
    const { runMigrations } = await getMigrations(authOptions(database, secret, configuredDays))
    await runMigrations()
    current = buildAuth(database, secret, configuredDays)
    await ensureOwner(current, options.password)
    await removeLegacySessions(options.dataDir)
  } catch (error) {
    database.close()
    throw toError(error)
  }

  return {
    refreshSessionLifetime() {
      const days = options.getSessionMaxAgeDays()
      if (days === configuredDays) return
      configuredDays = days
      current = buildAuth(database, secret, days)
    },
    async signIn(request) {
      return current.handler(request)
    },
    async getSession(headers) {
      const result = await current.api.getSession({ headers, returnHeaders: true })
      return {
        authenticated: result.response !== null,
        setCookies: result.headers.getSetCookie(),
      }
    },
    async signOut(headers) {
      try {
        const result = await current.api.signOut({ headers, returnHeaders: true })
        return result.headers.getSetCookie()
      } catch (error) {
        log.warn("[auth] sign-out failed", toError(error).message)
        return []
      }
    },
    async dispose() {
      database.close()
    },
  }
}

export interface PasswordAuthOptions {
  dataDir: string
  password: string
  trustProxy: boolean
  appSettings: AppSettingsManager
}

export async function createPasswordAuth(options: PasswordAuthOptions): Promise<AuthManager> {
  const { appSettings } = options
  const backend = await createBetterAuthBackend({
    dataDir: options.dataDir,
    password: options.password,
    getSessionMaxAgeDays: () => appSettings.getSnapshot().auth.sessionMaxAgeDays,
  })
  const unsubscribe = appSettings.onChange(() => backend.refreshSessionLifetime())
  const manager = createAuthManager(backend, { trustProxy: options.trustProxy })
  return {
    ...manager,
    async dispose() {
      unsubscribe()
      await manager.dispose()
    },
  }
}
