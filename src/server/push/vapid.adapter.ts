import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import webpush from "web-push"

export interface VapidKeypair {
  publicKey: string
  privateKey: string
  subject: string
}

const DEFAULT_SUBJECT = "mailto:bacuongtr@gmail.com"

export async function loadOrGenerateVapidKeys(dataDir: string): Promise<VapidKeypair> {
  await mkdir(dataDir, { recursive: true })
  const path = join(dataDir, "vapid.json")
  try {
    const text = await readFile(path, "utf8")
    const parsed = JSON.parse(text) as Partial<VapidKeypair>
    if (typeof parsed.publicKey === "string" && typeof parsed.privateKey === "string") {
      return {
        publicKey: parsed.publicKey,
        privateKey: parsed.privateKey,
        subject: typeof parsed.subject === "string" ? parsed.subject : DEFAULT_SUBJECT,
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== "ENOENT") {
      // Corrupt JSON, permission error, or other readable-but-unparseable file
      // → fall through to regenerate. Don't crash startup.
    }
  }
  const generated = webpush.generateVAPIDKeys()
  const keypair: VapidKeypair = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: DEFAULT_SUBJECT,
  }
  await writeFile(path, JSON.stringify(keypair, null, 2), { mode: 0o600 })
  return keypair
}
