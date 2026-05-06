# Persistent Auth Sessions Design

## Problem

Auth sessions are stored in an in-memory `Set<string>` (`src/server/auth.ts:115`) and the session cookie is issued without `Max-Age`. Two consequences:

1. Every server restart or redeploy invalidates all sessions; users must re-enter the password.
2. Closing the browser drops the session cookie even when the server is still running.

## Goals

- Sessions survive server restart.
- Sessions survive browser close.
- Session lifetime is user-configurable through the existing `settings.json`.
- Session token never persisted in plaintext on disk.

## Non-goals

- Multi-user accounts. Auth is still a single shared password.
- Refresh tokens, OAuth, MFA.
- Per-device naming or revocation UI (a future addition; the store is shaped to allow it).

## Configuration

New block in `AppSettingsSnapshot`:

```ts
export interface AuthSettings {
  sessionMaxAgeDays: number // clamp [1, 365], default 30
}

export const AUTH_DEFAULTS: AuthSettings = {
  sessionMaxAgeDays: 30,
}
```

Edited in `settings.json` (or via in-app settings UI in a follow-up). Validation mirrors the existing `cloudflareTunnel` block (`src/server/app-settings.ts:223-246`).

`getMaxAgeMs` is read through a callback at login time, so changes take effect for new logins without a restart. Existing sessions keep their current `expiresAt` and adopt the new value on the next sliding bump.

## Storage

New file: `<dataDir>/sessions.json`. Atomic write (write tmp + rename), same pattern as `app-settings.ts`.

```ts
interface PersistedSession {
  tokenHash: string  // sha256 hex of the cookie value
  createdAt: number  // ms epoch
  lastSeenAt: number // ms epoch, bumped on each authed request
  expiresAt: number  // lastSeenAt + maxAgeMs
}

interface SessionsFile {
  version: 1
  sessions: PersistedSession[]
}
```

The cookie value is a `randomBytes(32).toString("base64url")` token. Only its SHA-256 hash is written to disk. A disk leak therefore does not yield session takeover.

## Token flow

1. **Login.** Generate token, hash it, persist `{tokenHash, createdAt, lastSeenAt, expiresAt}`. Send raw token in the `kanna_session` cookie with `Max-Age=<sessionMaxAgeDays * 86400>`.
2. **Validate request.** Hash the cookie value, look up the entry, check `expiresAt > Date.now()`. Missing or expired entry fails auth (and is pruned).
3. **Sliding window.** On each successful validation, bump `lastSeenAt = now` and `expiresAt = now + maxAgeMs`. Disk write is debounced (see throttle below).
4. **Logout.** Revoke the entry by `tokenHash`, persist, return `Set-Cookie: ...; Max-Age=0`.

## Cookie change

`buildCookie` (`src/server/auth.ts:67`) gains a required `maxAgeSeconds` parameter:

```ts
const parts = [
  `${name}=${encodeURIComponent(value)}`,
  "Path=/",
  "HttpOnly",
  "SameSite=Strict",
  `Max-Age=${maxAgeSeconds}`,
]
```

`Secure` and any `extras` (e.g. `Max-Age=0` for logout) are appended afterward; the logout case overrides by passing `0` and the existing `["Max-Age=0"]` extras tag is removed.

## New module: `auth-session-store.ts`

```ts
interface AuthSessionStore {
  create(token: string, maxAgeMs: number): PersistedSession
  validate(token: string): PersistedSession | null   // checks expiry, prunes if expired
  touch(token: string, maxAgeMs: number): void       // sliding bump
  revoke(token: string): void
  sweep(): void                                       // remove all expired entries
  dispose(): Promise<void>                            // flush pending writes, clear interval
}
```

In-memory `Map<tokenHash, PersistedSession>` for O(1) lookup. The map is hydrated from `sessions.json` on construction.

### Persist throttling

`touch` updates the in-memory entry every request but only schedules a disk write when `expiresAt` has shifted by more than 1 hour relative to the last persisted value. This avoids writing the file on every click while keeping disk drift bounded to one hour. A short debounce (e.g. 250 ms) coalesces concurrent updates.

### Background sweep

`setInterval(sweep, 60 * 60 * 1000)` removes expired entries and triggers a persist if anything changed. Cleared in `dispose()`.

## Wiring

`server.ts`:

```ts
const sessionStore = await createAuthSessionStore({
  filePath: path.join(store.dataDir, "sessions.json"),
})
const auth = createAuthManager(password, {
  trustProxy,
  sessionStore,
  getMaxAgeMs: () =>
    appSettings.getSnapshot().auth.sessionMaxAgeDays * 86_400_000,
})
```

`auth.dispose()` (new) is called next to `appSettings.dispose()` at `src/server/server.ts:375`. It flushes pending writes and clears the sweep interval.

## Tests

`auth.test.ts` additions:

- Login response sets `Max-Age=2592000` (30 days, default).
- Settings change to `sessionMaxAgeDays: 7` causes a subsequent login to issue `Max-Age=604800`.
- Existing session continues to validate after `createAuthManager` is recreated against the same `sessions.json` (restart simulation).
- Sliding: `validate` then `touch` shifts `expiresAt` forward.
- Expired entry returns 401 and is removed from the store.
- Logout deletes the entry and sets `Max-Age=0`.

New `auth-session-store.test.ts`:

- `tokenHash` on disk is sha256 of the input token, never the token itself.
- Round-trip persist + load preserves entries.
- `sweep` removes expired entries.
- `dispose` flushes pending writes.

## Migration

`sessions.json` is created lazily on first login. No migration required for existing installs; in-flight in-memory sessions are dropped once during the upgrade (the existing behavior on every restart today).
