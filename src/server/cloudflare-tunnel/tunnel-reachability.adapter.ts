import { isJsonArray, numberField, parseJsonObject, type JsonObject } from "../../shared/json"

export type WaitUntilReachable = (url: string, signal: AbortSignal) => Promise<void>

export interface ReachabilityProbeOptions {
  intervalMs?: number
  attemptTimeoutMs?: number
  deadlineMs?: number
  dnsOverHttpsUrl?: string
}

const DEFAULT_INTERVAL_MS = 1000
const DEFAULT_ATTEMPT_TIMEOUT_MS = 5000
const DEFAULT_DEADLINE_MS = 90_000
const DEFAULT_DNS_OVER_HTTPS_URL = "https://1.1.1.1/dns-query"
const DNS_STATUS_NOERROR = 0
const CLOUDFLARE_EDGE_ERROR_STATUS_FLOOR = 520

export function createReachabilityProbe(options: ReachabilityProbeOptions = {}): WaitUntilReachable {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS
  const dnsOverHttpsUrl = options.dnsOverHttpsUrl ?? DEFAULT_DNS_OVER_HTTPS_URL

  return async (url, signal) => {
    const deadline = Date.now() + deadlineMs
    const host = new URL(url).hostname
    const stages = [
      () => isPublishedInDns(dnsOverHttpsUrl, host, signal, attemptTimeoutMs),
      () => isAnsweredByOrigin(url, signal, attemptTimeoutMs),
    ]
    for (const isReady of stages) {
      while (!(await isReady())) {
        if (signal.aborted || Date.now() >= deadline) return
        await sleep(intervalMs, signal)
      }
    }
  }
}

async function isPublishedInDns(
  dnsOverHttpsUrl: string,
  host: string,
  signal: AbortSignal,
  attemptTimeoutMs: number,
): Promise<boolean> {
  try {
    const response = await fetch(`${dnsOverHttpsUrl}?name=${encodeURIComponent(host)}&type=A`, {
      headers: { accept: "application/dns-json" },
      signal: attemptSignal(signal, attemptTimeoutMs),
    })
    if (!response.ok) return true
    const body = parseJsonObject(await response.text())
    if (!body) return true
    return numberField(body, "Status") === DNS_STATUS_NOERROR && hasAnswer(body)
  } catch {
    return true
  }
}

function hasAnswer(body: JsonObject): boolean {
  const answer = body.Answer
  return answer !== undefined && isJsonArray(answer) && answer.length > 0
}

async function isAnsweredByOrigin(url: string, signal: AbortSignal, attemptTimeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: attemptSignal(signal, attemptTimeoutMs),
    })
    return response.status < CLOUDFLARE_EDGE_ERROR_STATUS_FLOOR
  } catch {
    return false
  }
}

function attemptSignal(signal: AbortSignal, attemptTimeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(attemptTimeoutMs)])
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener("abort", finish, { once: true })
  })
}
