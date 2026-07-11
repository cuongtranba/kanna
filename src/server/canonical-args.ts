import { createHash } from "node:crypto"
import type { AnyValue } from "../shared/errors"
import { isRecord } from "../shared/errors"

function canonicalJson(value: AnyValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) {
    const arr: AnyValue[] = value
    return `[${arr.map(canonicalJson).join(",")}]`
  }
  if (!isRecord(value)) return JSON.stringify(value)
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`
}

export function canonicalArgsHash(args: AnyValue): string {
  return createHash("sha256").update(canonicalJson(args)).digest("hex")
}
