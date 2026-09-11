/**
 * The bundle patch is configuration, not code. Nothing in this package loads it
 * — only the dsh loader does, at `dsh web` boot — so a syntax error or a
 * duplicated key reaches the user's next restart instead of failing a build or
 * a test. These assertions are that missing check.
 */
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

/** One row of the patch's `insert` list, as far as these assertions reach. */
interface PatchRow {
  id: string
  name: string
  config?: {
    args?: string[]
    toolCallTimeoutMs?: number
    failOnStartupError?: boolean
  }
}

const text = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const rows = (parse(text) as { insert: PatchRow[] }[])[0]?.insert ?? []

describe('cordis.patch.yml', () => {
  it('parses, and inserts the rows the bundle promises, in order', () => {
    expect(rows.map(row => row.id)).toEqual(['weixin-minigame', 'minigame-mcp'])
  })

  it('mounts this package by its published name', () => {
    expect(rows[0]?.name).toBe('@trujaycc/dsh-weixin-minigame')
  })

  it('pins the upstream helper to an exact version', () => {
    const pin = rows[1]?.config?.args?.at(-1) ?? ''
    // A range or `@latest` would run whatever upstream published by then, in
    // every user's environment, with no review step here.
    expect(pin).toMatch(/^@weadmin\/weixin-minigame-helper-mcp@\d+\.\d+\.\d+$/)
  })

  it('gives MCP tool calls longer than the client default of 60s', () => {
    // Packaging a game, uploading a version, and a 60s burst screenshot capture
    // all outlive that default.
    expect(rows[1]?.config?.toolCallTimeoutMs).toBeGreaterThan(60_000)
  })

  it('keeps a failing MCP handshake from taking the Web session down with it', () => {
    expect(rows[1]?.config?.failOnStartupError).toBe(false)
  })
})
