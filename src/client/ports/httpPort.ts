/**
 * HttpPort — typed interface for browser fetch operations.
 *
 * Wraps the browser Fetch API so callers (React Query queryFns, stores)
 * never import `fetch` directly. The concrete implementation is
 * src/client/adapters/http.adapter.ts.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

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
  /**
   * Perform a GET request and parse the response body as JSON.
   */
  getJson<T>(url: string, options?: Omit<HttpRequestOptions, "method" | "body">): Promise<HttpResponse<T>>

  /**
   * Perform a POST request with a JSON body and parse the response as JSON.
   */
  postJson<T>(url: string, body: Record<string, string | number | boolean | null | undefined>, options?: Omit<HttpRequestOptions, "method" | "body">): Promise<HttpResponse<T>>

  /**
   * Perform a HEAD request (probe — no body returned).
   */
  head(url: string, options?: Omit<HttpRequestOptions, "method" | "body">): Promise<Pick<HttpResponse<null>, "ok" | "status" | "headers">>

  /**
   * Perform a DELETE request.
   */
  del(url: string, options?: Omit<HttpRequestOptions, "method" | "body">): Promise<Pick<HttpResponse<null>, "ok" | "status">>

  /**
   * Stream a response body as raw bytes (for chunked text preview).
   */
  streamBytes(url: string, options?: Omit<HttpRequestOptions, "method" | "body">): Promise<{ body: ReadableStream<Uint8Array> | null; ok: boolean; status: number }>
}
