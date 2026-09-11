import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  HELPER_STATE_DIR, PREVIEW_STATE_FILE, parsePreviewRecord, previewStatePath, probePreview, readPreviewRecord,
  readPreviewStatus,
} from '../src/minigame/status.ts'

const servers: Server[] = []
const scratchDirs: string[] = []
const savedHome = { HOME: process.env['HOME'], USERPROFILE: process.env['USERPROFILE'] }

/**
 * Redirect the home directory so the real preview state file on the machine
 * running the tests can never leak into an assertion.
 * @returns the scratch home directory.
 */
function useScratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'minigame-home-'))
  scratchDirs.push(home)
  process.env['HOME'] = home
  process.env['USERPROFILE'] = home
  return home
}

/** Write a preview state file under the scratch home. */
function writeState(home: string, body: string): void {
  const dir = join(home, HELPER_STATE_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, PREVIEW_STATE_FILE), body)
}

beforeEach(() => {
  useScratchHome()
})

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

afterAll(() => {
  if (savedHome.HOME === undefined) delete process.env['HOME']
  else process.env['HOME'] = savedHome.HOME
  if (savedHome.USERPROFILE === undefined) delete process.env['USERPROFILE']
  else process.env['USERPROFILE'] = savedHome.USERPROFILE
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true })
})

describe('previewStatePath', () => {
  it('points at the helper state file under the home directory', () => {
    expect(previewStatePath()).toBe(join(process.env['USERPROFILE'] ?? '', HELPER_STATE_DIR, PREVIEW_STATE_FILE))
  })
})

describe('parsePreviewRecord', () => {
  it('preserves the recorded host instead of rewriting it to a loopback literal', () => {
    // The helper answers on IPv6 loopback for the `localhost` origin it
    // records, so rewriting the host would target nothing.
    const record = parsePreviewRecord(JSON.stringify({
      url: 'http://localhost:3847',
      port: 3847,
      gameDir: 'D:\\game',
      pid: 3924,
      platform: 'workbuddy',
      updatedAt: 1788886993069,
    }))
    expect(record).toEqual({
      url: 'http://localhost:3847',
      port: 3847,
      gameDir: 'D:\\game',
      pid: 3924,
    })
  })

  it('drops a path and query, keeping only the origin the panel embeds', () => {
    expect(parsePreviewRecord('{"url":"http://127.0.0.1:3847/game?x=1"}')?.url)
      .toBe('http://127.0.0.1:3847')
  })

  it('keeps only the fields it understands', () => {
    expect(parsePreviewRecord('{"url":"http://localhost:3847","port":"3847"}')).toEqual({
      url: 'http://localhost:3847',
    })
  })

  it('rejects a record without a usable url', () => {
    expect(parsePreviewRecord('{}')).toBeUndefined()
    expect(parsePreviewRecord('{"url":42}')).toBeUndefined()
    expect(parsePreviewRecord('{"url":"not a url"}')).toBeUndefined()
  })

  it('rejects input that is not an object of the expected shape', () => {
    expect(parsePreviewRecord('null')).toBeUndefined()
    expect(parsePreviewRecord('[]')).toBeUndefined()
    expect(parsePreviewRecord('{ torn')).toBeUndefined()
  })
})

describe('readPreviewRecord', () => {
  it('returns nothing before a preview has ever run', () => {
    expect(readPreviewRecord()).toBeUndefined()
  })

  it('reads the state file the helper writes', () => {
    writeState(process.env['USERPROFILE'] ?? '', '{"url":"http://localhost:3847","port":3847}')
    expect(readPreviewRecord()).toEqual({ url: 'http://localhost:3847', port: 3847 })
  })
})

/** Probe budget for these tests: wide enough that a loaded machine cannot
 * expire it against a server that is answering. */
const PROBE_BUDGET_MS = 10_000

describe('probePreview', () => {
  /**
   * Start a server answering every request with the given status.
   *
   * Bound without a host so it accepts both address families, which is what
   * lets the recorded `localhost` origin resolve.
   */
  async function serve(status: number): Promise<string> {
    const server = createServer((_req, res) => { res.writeHead(status); res.end('ok') })
    servers.push(server)
    await new Promise<void>((done) => { server.listen(0, done) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('expected a bound port')
    return `http://localhost:${address.port}`
  }

  it('reports a serving preview as alive', async () => {
    expect(await probePreview(await serve(200), PROBE_BUDGET_MS)).toBe(true)
  })

  it('still reports a 4xx preview as alive, because the page exists', async () => {
    expect(await probePreview(await serve(404), PROBE_BUDGET_MS)).toBe(true)
  })

  it('reports a server error as not alive', async () => {
    expect(await probePreview(await serve(503), PROBE_BUDGET_MS)).toBe(false)
  })

  it('reports a refused connection as not alive', async () => {
    const server = createServer()
    await new Promise<void>((done) => { server.listen(0, done) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('expected a bound port')
    const url = `http://localhost:${address.port}`
    await new Promise<void>((done) => { server.close(() => { done() }) })
    expect(await probePreview(url, PROBE_BUDGET_MS)).toBe(false)
  })
})

describe('readPreviewStatus', () => {
  it('reports not running when no preview was ever recorded', async () => {
    expect(await readPreviewStatus()).toEqual({ running: false })
  })

  it('confirms a recorded preview that is still serving', async () => {
    const server = createServer((_req, res) => { res.writeHead(200); res.end('game') })
    servers.push(server)
    await new Promise<void>((done) => { server.listen(0, done) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('expected a bound port')
    writeState(process.env['USERPROFILE'] ?? '', JSON.stringify({
      url: `http://localhost:${address.port}`,
      port: address.port,
      gameDir: 'D:\\game',
    }))

    expect(await readPreviewStatus()).toEqual({
      running: true,
      url: `http://localhost:${address.port}`,
      port: address.port,
      gameDir: 'D:\\game',
    })
  })

  it('reports a recorded preview whose server is gone as not running', async () => {
    const server = createServer()
    await new Promise<void>((done) => { server.listen(0, done) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('expected a bound port')
    await new Promise<void>((done) => { server.close(() => { done() }) })
    writeState(process.env['USERPROFILE'] ?? '', JSON.stringify({ url: `http://localhost:${address.port}` }))

    const status = await readPreviewStatus()
    expect(status.running).toBe(false)
    expect(status.url).toBe(`http://localhost:${address.port}`)
  })
})
