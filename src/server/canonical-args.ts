import { createHash } from "node:crypto"
import { isRecord } from "../shared/errors"

function canonicalJson<T>(value: T): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`
  }
  if (!isRecord(value)) return JSON.stringify(value)
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`
}

export function canonicalArgsHash<T>(args: T): string {
  return createHash("sha256").update(canonicalJson(args)).digest("hex")
}
