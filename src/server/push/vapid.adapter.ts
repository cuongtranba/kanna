import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import webpush from "web-push"
import { DEFAULT_VAPID_SUBJECT, isValidVapidSubject } from "../../shared/vapid-subject"

export interface VapidKeypair {
  publicKey: string
  privateKey: string
  subject: string
}

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
      const healed: VapidKeypair = {
        publicKey: parsed.publicKey,
        privateKey: parsed.privateKey,
        subject: DEFAULT_VAPID_SUBJECT,
      }
      await writeFile(path, JSON.stringify(healed, null, 2), { mode: 0o600 })
      return healed
    }
  } catch {}
  const generated = webpush.generateVAPIDKeys()
  const keypair: VapidKeypair = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: DEFAULT_VAPID_SUBJECT,
  }
  await writeFile(path, JSON.stringify(keypair, null, 2), { mode: 0o600 })
  return keypair
}
