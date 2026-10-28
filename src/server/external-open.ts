import path from "node:path"
import process from "node:process"
import type { ClientCommand, EditorOpenSettings, EditorPreset } from "../shared/protocol"
import { DEFAULT_EDITOR_PRESET, getDefaultEditorCommandTemplate, normalizeEditorPreset } from "../shared/settings/editor"
import { resolveLocalPath } from "./paths"
import { canOpenMacApp, hasCommand, spawnDetached } from "./process-utils.adapter"
import { statPathOrNull } from "./fs-stat.adapter"
import { isWsl, resolveWindowsExecutable, toWindowsPath } from "./wsl.adapter"

const WIN_EXPLORER = "C:\\Windows\\explorer.exe"
const WIN_CMD = "C:\\Windows\\System32\\cmd.exe"

type OpenExternalCommand = Extract<ClientCommand, { type: "system.openExternal" }>

interface CommandSpec {
  command: string
  args: string[]
}

const DEFAULT_EDITOR_SETTINGS: EditorOpenSettings = {
  preset: DEFAULT_EDITOR_PRESET,
  commandTemplate: getDefaultEditorCommandTemplate(DEFAULT_EDITOR_PRESET),
}

type OpenAction = OpenExternalCommand["action"]
type ShellAction = Exclude<OpenAction, "open_editor">
type OpenPlatform = "darwin" | "win32" | "wsl" | "linux"

interface OpenTarget {
  path: string
  isDirectory: boolean
}

type ShellPlan = (target: OpenTarget) => CommandSpec

function openPlatformOf(platform: NodeJS.Platform): OpenPlatform {
  if (platform === "darwin" || platform === "win32") return platform
  return platform === "linux" && isWsl() ? "wsl" : "linux"
}

function previewUnavailable(): CommandSpec {
  throw new Error("Preview is only available on macOS")
}

function wslPlan(action: "open_finder" | "open_default" | "open_terminal"): ShellPlan {
  return (target) => {
    const windowsPath = toWindowsPath(target.path)
    if (!windowsPath) {
      throw new Error(`Unable to resolve Windows path for: ${target.path}`)
    }
    return buildWslOpenCommand({
      action,
      windowsPath,
      isDirectory: target.isDirectory,
      explorerBinary: resolveWindowsExecutable(WIN_EXPLORER) ?? "explorer.exe",
      cmdBinary: action === "open_terminal" ? resolveWindowsExecutable(WIN_CMD) : null,
    })
  }
}

function darwinTerminalCommand(target: OpenTarget): CommandSpec {
  if (!canOpenMacApp("Terminal")) {
    throw new Error("Terminal is not installed")
  }
  return { command: "open", args: ["-a", "Terminal", target.path] }
}

function darwinPreviewCommand(target: OpenTarget): CommandSpec {
  if (!canOpenMacApp("Preview")) {
    throw new Error("Preview is not installed")
  }
  return buildPreviewCommand({ localPath: target.path, isDirectory: target.isDirectory, platform: "darwin" })
}

function windowsTerminalCommand(target: OpenTarget): CommandSpec {
  if (hasCommand("wt")) return { command: "wt", args: ["-d", target.path] }
  return { command: "cmd", args: ["/c", "start", "", "cmd", "/K", `cd /d ${target.path}`] }
}

function linuxTerminalCommand(target: OpenTarget): CommandSpec {
  for (const terminal of ["x-terminal-emulator", "gnome-terminal", "konsole"]) {
    if (!hasCommand(terminal)) continue
    return { command: terminal, args: [terminal === "konsole" ? "--workdir" : "--working-directory", target.path] }
  }
  return { command: "xdg-open", args: [target.path] }
}

const SHELL_PLANS: Record<OpenPlatform, Record<ShellAction, ShellPlan>> = {
  darwin: {
    open_default: (target) => buildDefaultOpenCommand({ localPath: target.path, platform: "darwin" }),
    open_preview: darwinPreviewCommand,
    open_finder: (target) => ({ command: "open", args: target.isDirectory ? [target.path] : ["-R", target.path] }),
    open_terminal: darwinTerminalCommand,
  },
  win32: {
    open_default: (target) => buildDefaultOpenCommand({ localPath: target.path, platform: "win32" }),
    open_preview: previewUnavailable,
    open_finder: (target) => ({ command: "explorer", args: target.isDirectory ? [target.path] : ["/select,", target.path] }),
    open_terminal: windowsTerminalCommand,
  },
  wsl: {
    open_default: wslPlan("open_default"),
    open_preview: previewUnavailable,
    open_finder: wslPlan("open_finder"),
    open_terminal: wslPlan("open_terminal"),
  },
  linux: {
    open_default: (target) => buildDefaultOpenCommand({ localPath: target.path, platform: "linux" }),
    open_preview: previewUnavailable,
    open_finder: (target) => ({ command: "xdg-open", args: [target.isDirectory ? target.path : path.dirname(target.path)] }),
    open_terminal: linuxTerminalCommand,
  },
}

function requiresExistingPath(action: OpenAction, platform: OpenPlatform): boolean {
  return action === "open_editor" || action === "open_default" || (action === "open_preview" && platform === "darwin")
}

export async function openExternal(command: OpenExternalCommand) {
  const resolvedPath = resolveLocalPath(command.localPath)
  const platform = openPlatformOf(process.platform)
  const info = command.action === "open_terminal" ? null : await statPathOrNull(resolvedPath)
  if (!info && requiresExistingPath(command.action, platform)) {
    throw new Error(`Path not found: ${resolvedPath}`)
  }

  if (command.action === "open_editor") {
    const editorCommand = buildEditorCommand({
      localPath: resolvedPath,
      isDirectory: info?.isDirectory() ?? false,
      line: command.line,
      column: command.column,
      editor: command.editor ?? DEFAULT_EDITOR_SETTINGS,
      platform: process.platform,
    })
    await spawnDetached(editorCommand.command, editorCommand.args)
    return
  }

  const shellCommand = SHELL_PLANS[platform][command.action]({
    path: resolvedPath,
    isDirectory: info?.isDirectory() ?? false,
  })
  await spawnDetached(shellCommand.command, shellCommand.args)
}

export function buildEditorCommand(args: {
  localPath: string
  isDirectory: boolean
  line?: number
  column?: number
  editor: EditorOpenSettings
  platform: NodeJS.Platform
}): CommandSpec {
  const editor = normalizeEditorSettings(args.editor)
  if (editor.preset === "custom") {
    return buildCustomEditorCommand({
      commandTemplate: editor.commandTemplate,
      localPath: args.localPath,
      line: args.line,
      column: args.column,
    })
  }
  return buildPresetEditorCommand(args, editor.preset)
}

export function buildPreviewCommand(args: {
  localPath: string
  isDirectory: boolean
  platform: NodeJS.Platform
}): CommandSpec {
  if (args.platform !== "darwin") {
    throw new Error("Preview is only available on macOS")
  }
  if (args.isDirectory) {
    throw new Error("Preview cannot open directories")
  }
  return { command: "open", args: ["-a", "Preview", args.localPath] }
}

export function buildWslOpenCommand(args: {
  action: "open_finder" | "open_default" | "open_terminal"
  windowsPath: string
  isDirectory: boolean
  explorerBinary: string
  cmdBinary: string | null
}): CommandSpec {
  if (args.action === "open_terminal") {
    if (!args.cmdBinary) {
      throw new Error("Unable to locate cmd.exe to launch a Windows terminal")
    }
    return { command: args.cmdBinary, args: ["/c", "start", "", "wt.exe", "-d", args.windowsPath] }
  }
  if (args.action === "open_default") {
    return { command: args.explorerBinary, args: [args.windowsPath] }
  }
  if (args.isDirectory) {
    return { command: args.explorerBinary, args: [args.windowsPath] }
  }
  return { command: args.explorerBinary, args: [`/select,${args.windowsPath}`] }
}

export function buildDefaultOpenCommand(args: {
  localPath: string
  platform: NodeJS.Platform
}): CommandSpec {
  if (args.platform === "darwin") {
    return { command: "open", args: [args.localPath] }
  }
  if (args.platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", args.localPath] }
  }
  return { command: "xdg-open", args: [args.localPath] }
}

function buildPresetEditorCommand(
  args: {
    localPath: string
    isDirectory: boolean
    line?: number
    column?: number
    platform: NodeJS.Platform
  },
  preset: Exclude<EditorPreset, "custom">
): CommandSpec {
  const gotoTarget = `${args.localPath}:${args.line ?? 1}:${args.column ?? 1}`
  const opener = resolveEditorExecutable(preset, args.platform)
  if (preset === "xcode") {
    if (args.isDirectory || !args.line) {
      return { command: opener.command, args: [...opener.args, args.localPath] }
    }
    if (opener.command !== "xed") {
      return { command: opener.command, args: [...opener.args, args.localPath] }
    }
    return { command: opener.command, args: [...opener.args, "-l", String(args.line), args.localPath] }
  }
  if (args.isDirectory || !args.line) {
    return { command: opener.command, args: [...opener.args, args.localPath] }
  }
  return { command: opener.command, args: [...opener.args, "--goto", gotoTarget] }
}

const EDITOR_PRESETS: Record<Exclude<EditorPreset, "custom">, { cli: string; macApp: string; label: string }> = {
  cursor: { cli: "cursor", macApp: "Cursor", label: "Cursor" },
  vscode: { cli: "code", macApp: "Visual Studio Code", label: "Visual Studio Code" },
  windsurf: { cli: "windsurf", macApp: "Windsurf", label: "Windsurf" },
  xcode: { cli: "xed", macApp: "Xcode", label: "Xcode" },
}

function resolveEditorExecutable(preset: Exclude<EditorPreset, "custom">, platform: NodeJS.Platform): CommandSpec {
  const { cli, macApp, label } = EDITOR_PRESETS[preset]
  if (hasCommand(cli)) return { command: cli, args: [] }
  if (platform !== "darwin") return { command: cli, args: [] }
  if (canOpenMacApp(macApp)) return { command: "open", args: ["-a", macApp] }
  throw new Error(`${label} is not installed`)
}

function buildCustomEditorCommand(args: {
  commandTemplate: string
  localPath: string
  line?: number
  column?: number
}): CommandSpec {
  const template = args.commandTemplate.trim()
  if (!template.includes("{path}")) {
    throw new Error("Custom editor command must include {path}")
  }

  const line = String(args.line ?? 1)
  const column = String(args.column ?? 1)
  const replaced = template
    .replaceAll("{path}", args.localPath)
    .replaceAll("{line}", line)
    .replaceAll("{column}", column)

  const tokens = tokenizeCommandTemplate(replaced)
  const [command, ...commandArgs] = tokens
  if (!command) {
    throw new Error("Custom editor command is empty")
  }
  return { command, args: commandArgs }
}

export function tokenizeCommandTemplate(template: string) {
  const tokens: string[] = []
  let current = ""
  let quote: "'" | "\"" | null = null

  for (let index = 0; index < template.length; index += 1) {
    const char = template[index]

    if (char === "\\" && index + 1 < template.length) {
      current += template[index + 1]
      index += 1
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === "'" || char === "\"") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ""
      }
      continue
    }

    current += char
  }

  if (quote) {
    throw new Error("Custom editor command has an unclosed quote")
  }
  if (current.length > 0) {
    tokens.push(current)
  }
  return tokens
}

function normalizeEditorSettings(editor: EditorOpenSettings): EditorOpenSettings {
  const preset = normalizeEditorPreset(editor.preset)
  return {
    preset,
    commandTemplate: editor.commandTemplate.trim() || DEFAULT_EDITOR_SETTINGS.commandTemplate,
  }
}
