export function formatSlashCommand(command: string, arg?: string): string {
  const stripped = command.startsWith("/") ? command.slice(1) : command
  const cmd = `/${stripped}`
  return arg !== undefined ? `${cmd} ${arg}\r` : `${cmd}\r`
}

export interface SlashTarget {
  sendInput(data: string): Promise<void>
}

export async function writeSlashCommand(target: SlashTarget, command: string, arg?: string): Promise<void> {
  await target.sendInput(formatSlashCommand(command, arg))
}
