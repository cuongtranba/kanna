/**
 * http.adapter.ts — Browser fetch implementation of HttpPort.
 *
 * This is the ONLY file in src/client/** allowed to call the raw browser
 * `fetch` global once the ESLint client-adapter seal is in place.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

import type { HttpPort, HttpRequestOptions, HttpResponse } from "../ports/httpPort"

function extractHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

// JSON.parse returns `any`; assigning to a typed variable is the idiomatic
// narrowing path without a banned `as T` cast.
async function parseJsonText(response: Response): Promise<ReturnType<typeof JSON.parse>> {
  const text = await response.text()
  if (!text) return null
  return JSON.parse(text)
}

export const httpAdapter: HttpPort = {
  async getJson<T>(url: string, options: Omit<HttpRequestOptions, "method" | "body"> = {}): Promise<HttpResponse<T>> {
    const response = await fetch(url, {
      method: "GET",
      signal: options.signal,
      cache: options.cache,
      headers: {
        Accept: "application/json",
        ...options.headers,
      },
    })
    const data: T = await parseJsonText(response)
    return {
      ok: response.ok,
      status: response.status,
      data,
      headers: extractHeaders(response.headers),
    }
  },

  async postJson<T>(
    url: string,
    body: Record<string, string | number | boolean | null | undefined>,
    options: Omit<HttpRequestOptions, "method" | "body"> = {},
  ): Promise<HttpResponse<T>> {
    const response = await fetch(url, {
      method: "POST",
      signal: options.signal,
      cache: options.cache,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
      body: JSON.stringify(body),
    })
    const data: T = await parseJsonText(response)
    return {
      ok: response.ok,
      status: response.status,
      data,
      headers: extractHeaders(response.headers),
    }
  },

  async head(url: string, options: Omit<HttpRequestOptions, "method" | "body"> = {}) {
    const response = await fetch(url, {
      method: "HEAD",
      signal: options.signal,
      headers: options.headers,
    })
    return {
      ok: response.ok,
      status: response.status,
      headers: extractHeaders(response.headers),
    }
  },

  async del(url: string, options: Omit<HttpRequestOptions, "method" | "body"> = {}) {
    const response = await fetch(url, {
      method: "DELETE",
      signal: options.signal,
      headers: options.headers,
    })
    return {
      ok: response.ok,
      status: response.status,
    }
  },

  async streamBytes(url: string, options: Omit<HttpRequestOptions, "method" | "body"> = {}) {
    const response = await fetch(url, {
      method: "GET",
      signal: options.signal,
      headers: options.headers,
    })
    return {
      body: response.body,
      ok: response.ok,
      status: response.status,
    }
  },
}
