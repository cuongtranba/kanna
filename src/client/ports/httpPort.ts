
import type { JsonValue } from "../../shared/json"

export interface HttpRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD"
  headers?: Record<string, string>
  body?: string | FormData | URLSearchParams
  signal?: AbortSignal
  cache?: RequestCache
}

export interface HttpResponse<T> {
  ok: boolean
  status: number
  data: T
  headers: Record<string, string>
}

export interface HttpPort {
  getJson<T>(url: string, options?: Omit<HttpRequestOptions, "method" | "body">): Promise<HttpResponse<T>>

  postJson<T>(url: string, body: Record<string, string | number | boolean | null | undefined>, options?: Omit<HttpRequestOptions, "method" | "body">): Promise<HttpResponse<T>>

  postJsonBody<T>(url: string, body: JsonValue, options?: Omit<HttpRequestOptions, "method" | "body">): Promise<HttpResponse<T>>

  head(url: string, options?: Omit<HttpRequestOptions, "method" | "body">): Promise<Pick<HttpResponse<null>, "ok" | "status" | "headers">>

  del(url: string, options?: Omit<HttpRequestOptions, "method" | "body">): Promise<Pick<HttpResponse<null>, "ok" | "status">>

  streamBytes(url: string, options?: Omit<HttpRequestOptions, "method" | "body">): Promise<{ body: ReadableStream<Uint8Array> | null; ok: boolean; status: number }>
}
