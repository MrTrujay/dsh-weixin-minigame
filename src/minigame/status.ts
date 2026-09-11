/**
 * Preview-server discovery.
 *
 * The MCP server from `@weadmin/weixin-minigame-helper-mcp` runs the game on a
 * local Express server and records where it listens in a state file under the
 * user's home directory. That file is the only stable handoff between the
 * helper process and this plugin, so this module reads it defensively and
 * confirms the port actually answers before reporting a preview as running.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Directory the helper keeps its per-user state in. */
export const HELPER_STATE_DIR = '.weixin-minigame-helper'

/** State file naming the running preview server. */
export const PREVIEW_STATE_FILE = 'preview-server.json'

/** How long a liveness probe waits before reporting the preview as down. */
const PROBE_TIMEOUT_MS = 1200

/** The subset of the helper's preview state this plugin relies on. */
export interface PreviewRecord {
  /** Origin the preview page is served from. */
  readonly url: string
  /** Listening port. */
  readonly port?: number
  /** Game directory the server has packaged. */
  readonly gameDir?: string
  /** Process id of the helper-owned server. */
  readonly pid?: number
}

/** What the browser panel needs to know about the preview. */
export interface PreviewStatus {
  /** Whether a preview server was recorded and answered a probe. */
  readonly running: boolean
  /** URL to embed, present whenever a record exists. */
  readonly url?: string
  /** Listening port, present whenever a record exists. */
  readonly port?: number
  /** Game directory the running server packaged. */
  readonly gameDir?: string
}

/** Absolute path of the helper's preview state file. */
export function previewStatePath(): string {
  return join(homedir(), HELPER_STATE_DIR, PREVIEW_STATE_FILE)
}

/**
 * Reduce a recorded url to a bare origin.
 *
 * The host is deliberately preserved rather than rewritten to a loopback
 * literal: the helper answers on IPv6 loopback for the `localhost` origin it
 * records, and it health-checks that exact address before reporting success.
 * Rewriting the host would target an interface nothing is listening on.
 * @param raw - the recorded url.
 * @returns the normalized absolute origin, or undefined when unparsable.
 */
function toOrigin(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    return url.origin
  } catch {
    // The url comes from another process's state file, so an unparsable value
    // is a boundary failure that degrades to "no preview" instead of throwing.
    return undefined
  }
}

/**
 * Parse the helper's preview state file contents.
 *
 * The file is written by another process, so every field is validated here
 * rather than trusted: a torn or hand-edited write degrades to "no preview".
 * @param text - raw file contents.
 * @returns the recorded preview, or undefined when no usable record is present.
 */
export function parsePreviewRecord(text: string): PreviewRecord | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // A torn or hand-edited state file is a boundary failure that degrades to
    // "no preview" rather than failing the caller.
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  const rawUrl = record['url']
  if (typeof rawUrl !== 'string') return undefined
  const url = toOrigin(rawUrl)
  if (url === undefined) return undefined
  const port = typeof record['port'] === 'number' && Number.isInteger(record['port']) ? record['port'] : undefined
  const gameDir = typeof record['gameDir'] === 'string' ? record['gameDir'] : undefined
  const pid = typeof record['pid'] === 'number' && Number.isInteger(record['pid']) ? record['pid'] : undefined
  return {
    url,
    ...(port !== undefined ? { port } : {}),
    ...(gameDir !== undefined ? { gameDir } : {}),
    ...(pid !== undefined ? { pid } : {}),
  }
}

/**
 * Read the helper's preview state file.
 * @returns the recorded preview, or undefined when the file is absent or unusable.
 */
export function readPreviewRecord(): PreviewRecord | undefined {
  let text: string
  try {
    text = readFileSync(previewStatePath(), 'utf8')
  } catch {
    // No state file is the normal case before the first preview has ever run.
    return undefined
  }
  return parsePreviewRecord(text)
}

/**
 * Ask a recorded preview origin whether it is still serving.
 * @param url - normalized preview origin.
 * @returns whether the server answered before the probe deadline.
 */
export async function probePreview(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    return response.status < 500
  } catch {
    // A refused connection or an expired probe is exactly the "not running"
    // answer this function exists to produce.
    return false
  }
}

/**
 * Resolve the current preview status: the recorded origin confirmed by a probe.
 * @returns the status the panel reports.
 *
 * Whether that server is serving a game or the helper's own onboarding page is
 * deliberately NOT answered here. The two halves load at different times — this
 * one only on `dsh web` boot, the browser half on every page load — so a field
 * added to this payload is missing for any browser that reloaded before a
 * restart. The browser half derives that answer from `gameDir`, which this
 * payload has always carried.
 */
export async function readPreviewStatus(): Promise<PreviewStatus> {
  const record = readPreviewRecord()
  if (record === undefined) return { running: false }
  const alive = await probePreview(record.url)
  return {
    running: alive,
    url: record.url,
    ...(record.port !== undefined ? { port: record.port } : {}),
    ...(record.gameDir !== undefined ? { gameDir: record.gameDir } : {}),
  }
}
