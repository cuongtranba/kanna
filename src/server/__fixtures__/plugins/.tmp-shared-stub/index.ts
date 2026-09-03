import { defineRpc } from "@kanna/plugin/server"

export const contract = defineRpc({ name: "x" })

export default function contribute() {
  return () => {}
}
