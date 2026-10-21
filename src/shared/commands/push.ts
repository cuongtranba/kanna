import { z } from "zod"
import { defineCommand, defineCommands, noParams, noResult, remoteExcluded } from "./define"
import { pushSubscribeRequestPayloadSchema } from "../types.schema"

const BROWSER_SOCKET_REASON =
  "Web push state belongs to one browser: it keys on the service-worker device identity and the socket that is viewing a chat, and a remote MCP client has neither."

export const pushCommands = defineCommands(
  defineCommand("push.identifyDevice", {
    result: noResult,
    params: z.object({ pushDeviceId: z.string().nullable() }),
    summary: "Bind this socket to a browser push device.",
    risk: "write",
    remote: remoteExcluded(BROWSER_SOCKET_REASON),
  }),
  defineCommand("push.subscribe", {
    result: z.object({ id: z.string() }),
    params: z.object({ subscription: pushSubscribeRequestPayloadSchema, label: z.string(), userAgent: z.string() }),
    summary: "Register a browser for web push.",
    risk: "write",
    remote: remoteExcluded(BROWSER_SOCKET_REASON),
  }),
  defineCommand("push.unsubscribe", {
    result: noResult,
    params: z.object({ pushDeviceId: z.string() }),
    summary: "Unregister a browser from web push.",
    risk: "write",
    remote: remoteExcluded(BROWSER_SOCKET_REASON),
  }),
  defineCommand("push.test", {
    result: noResult,
    params: noParams,
    summary: "Send a test push notification to this browser.",
    risk: "write",
    remote: remoteExcluded(BROWSER_SOCKET_REASON),
  }),
  defineCommand("push.setProjectMute", {
    result: noResult,
    params: z.object({ localPath: z.string(), muted: z.boolean() }),
    summary: "Mute or unmute push notifications for a project.",
    risk: "write",
    remote: remoteExcluded(BROWSER_SOCKET_REASON),
  }),
  defineCommand("push.setChatMute", {
    result: noResult,
    params: z.object({ chatId: z.string(), muted: z.boolean() }),
    summary: "Mute or unmute push notifications for a chat.",
    risk: "write",
    remote: remoteExcluded(BROWSER_SOCKET_REASON),
  }),
  defineCommand("push.setFocusedChat", {
    result: noResult,
    params: z.object({ chatId: z.string().nullable() }),
    summary: "Tell the server which chat this browser is viewing.",
    risk: "write",
    remote: remoteExcluded(BROWSER_SOCKET_REASON),
  }),
)
