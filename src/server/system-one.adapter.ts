import { toError } from "../shared/errors"
import { safeJsonParse } from "../shared/json"
import { log } from "../shared/log"
import {
  encodeSystemOneRequest,
  parseSystemOneResponse,
  type SystemOnePort,
  type SystemOneRequest,
} from "../shared/system-one"

export const SYSTEM_ONE_ENDPOINT = "https://api.typesafe.ai/v1/systemone"

const DEFAULT_TIMEOUT_MS = 2_500
const DEFAULT_RETRY_DELAY_MS = 300
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 529])

export type SystemOneFetch = (input: string, init: RequestInit) => Promise<Response>

export interface SystemOneClientOptions {
  apiKey: string
  endpoint?: string
  timeoutMs?: number
  retryDelayMs?: number
  fetchImpl?: SystemOneFetch
}

export function createSystemOneClient(options: SystemOneClientOptions): SystemOnePort {
  const endpoint = options.endpoint ?? SYSTEM_ONE_ENDPOINT
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const fetchImpl: SystemOneFetch = options.fetchImpl ?? ((input, init) => fetch(input, init))

  async function post(payload: string): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: payload,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  return async (request: SystemOneRequest) => {
    const payload = JSON.stringify(encodeSystemOneRequest(request))
    try {
      let response = await post(payload)
      if (RETRYABLE_STATUSES.has(response.status)) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
        response = await post(payload)
      }
      if (!response.ok) {
        log.warn("[kanna/system-one] request refused", { status: response.status })
        return null
      }
      const parsed = parseSystemOneResponse(safeJsonParse(await response.text()))
      if (parsed === null) log.warn("[kanna/system-one] response did not parse")
      return parsed
    } catch (error) {
      log.warn("[kanna/system-one] request failed", { message: toError(error).message })
      return null
    }
  }
}
