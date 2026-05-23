import http from "node:http"
import type { AddressInfo } from "node:net"

export type HttpRequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void

export interface HttpServerHandle {
  port: number
  close: () => Promise<void>
}

export function createHttpServer(handler: HttpRequestHandler) {
  return http.createServer(handler)
}

export function listen(server: http.Server, port: number, host: string): Promise<AddressInfo> {
  return new Promise<AddressInfo>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => {
      server.off("error", reject)
      resolve(server.address() as AddressInfo)
    })
  })
}

export function closeHttpServer(server: http.Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
}

export type HttpServer = http.Server
export type HttpIncomingMessage = http.IncomingMessage
export type HttpServerResponse = http.ServerResponse
