import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import webpush from "web-push"
import { isRecord } from "../../shared/errors"
import { DEFAULT_VAPID_SUBJECT, isValidVapidSubject } from "../../shared/vapid-subject"

export interface VapidKeypair {
  publicKey: string
  privateKey: string
  subject: string
}

/**
 * Load the persisted VAPID keypair, generating one on first run.
 *
 * The `subject` is the JWT `sub` claim used to sign push messages. A stored
 * subject that fails validation (e.g. the legacy `mailto:kanna@localhost`,
 * which makes Apple return `403 BadJwtToken` and silently breaks delivery) is
 * **self-healed** to the neutral default and re-persisted — the keypair is
 * never regenerated for a bad subject (that would invalidate every existing
 * subscription). The effective subject is normally overridden at delivery time
 * by the user-configurable `push.contactSubject` setting; this stored value is
 * only the fallback (see `resolveVapidSubject`).
 */
export async function loadOrGenerateVapidKeys(dataDir: string): Promise<VapidKeypair> {
  await mkdir(dataDir, { recursive: true })
  const path = join(dataDir, "vapid.json")
  try {
    const text = await readFile(path, "utf8")
    const parsed: Partial<VapidKeypair> = JSON.parse(text)
    if (typeof parsed.publicKey === "string" && typeof parsed.privateKey === "string") {
      const storedSubject = typeof parsed.subject === "string" ? parsed.subject : ""
      if (isValidVapidSubject(storedSubject)) {
        return { publicKey: parsed.publicKey, privateKey: parsed.privateKey, subject: storedSubject.trim() }
      }
      // Invalid/missing subject → heal in place, keep the keypair.
      const healed: VapidKeypair = {
        publicKey: parsed.publicKey,
        privateKey: parsed.privateKey,
        subject: DEFAULT_VAPID_SUBJECT,
      }
      await writeFile(path, JSON.stringify(healed, null, 2), { mode: 0o600 })
      return healed
    }
  } catch (err) {
    const code = isRecord(err) && typeof err.code === "string" ? err.code : undefined
    if (code !== "ENOENT") {
      // Corrupt JSON, permission error, or other readable-but-unparseable file
      // → fall through to regenerate. Don't crash startup.
    }
  }
  const generated = webpush.generateVAPIDKeys()
  const keypair: VapidKeypair = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: DEFAULT_VAPID_SUBJECT,
  }
  await writeFile(path, JSON.stringify(keypair, null, 2), { mode: 0o600 })
  return keypair
}
