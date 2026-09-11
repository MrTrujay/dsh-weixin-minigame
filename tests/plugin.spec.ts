import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SKILL_NAME, apply, inject, type MinigameHostContext } from '../src/index.ts'
import { STATUS_ROUTE, type MinigameStatus } from '../src/minigame/wire.ts'

interface CapturedRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

interface CapturedResponse {
  status: number
  headers: Record<string, string>
  body: string
}

const scratchDirs: string[] = []
const savedHome = { HOME: process.env['HOME'], USERPROFILE: process.env['USERPROFILE'] }

beforeAll(() => {
  // Keep the machine's real preview state file out of these assertions.
  const home = mkdtempSync(join(tmpdir(), 'minigame-plugin-home-'))
  scratchDirs.push(home)
  process.env['HOME'] = home
  process.env['USERPROFILE'] = home
})

afterAll(() => {
  if (savedHome.HOME === undefined) delete process.env['HOME']
  else process.env['HOME'] = savedHome.HOME
  if (savedHome.USERPROFILE === undefined) delete process.env['USERPROFILE']
  else process.env['USERPROFILE'] = savedHome.USERPROFILE
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true })
})

/** What a run of `apply` captured. */
interface Host {
  ctx: MinigameHostContext
  skills: Record<string, unknown>[]
  routes: CapturedRoute[]
  disposers: (() => void)[]
  labels: string[]
  /** Await every contribution whose callback was asynchronous. */
  settle: () => Promise<void>
}

/**
 * Build a host context that records every registration, and that resolves a
 * dynamic injection only when the host actually provides that service.
 * @param services - which optional services this host provides.
 * @returns the captured host.
 */
function fakeHost(services: { skills?: boolean; webServer?: boolean } = {}): Host {
  const skills: Record<string, unknown>[] = []
  const routes: CapturedRoute[] = []
  const disposers: (() => void)[] = []
  const labels: string[] = []
  const pending: Promise<unknown>[] = []

  /** Apply a contribution the way the real runtime does, through `effect`. */
  const effect = (callback: () => unknown, label?: string): (() => void) => {
    if (label !== undefined) labels.push(label)
    const result = callback()
    if (typeof result === 'function') disposers.push(result as () => void)
    return () => {}
  }

  const scopes: Record<string, unknown> = {}
  if (services.skills !== false) {
    scopes['skills'] = {
      skills: { register: (skill: Record<string, unknown>) => { skills.push(skill); return () => {} } },
      effect,
    }
  }
  if (services.webServer !== false) {
    scopes['webServer'] = {
      webServer: { register: (route: CapturedRoute) => { routes.push(route); return () => {} } },
      effect,
    }
  }

  const ctx = {
    inject(names: readonly string[], callback: (scope: never) => unknown) {
      const scope = scopes[names[0] ?? '']
      // An absent service means the injection never resolves, exactly as the
      // real runtime parks the callback until that service appears.
      if (scope === undefined) return undefined
      const result = callback(scope as never)
      if (result instanceof Promise) pending.push(result)
      return result
    },
  } as unknown as MinigameHostContext

  return {
    ctx,
    skills,
    routes,
    disposers,
    labels,
    settle: async () => { await Promise.all(pending) },
  }
}

/** Build a request the handler can consume. */
function fakeRequest(options: { method?: string; remoteAddress?: string } = {}): IncomingMessage {
  return {
    method: options.method ?? 'GET',
    url: '/',
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
  } as unknown as IncomingMessage
}

/** Build a response that captures what the handler wrote. */
function fakeResponse(): { response: ServerResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { status: 0, headers: {}, body: '' }
  const response = {
    writeHead(status: number, headers?: Record<string, string>) {
      captured.status = status
      if (headers !== undefined) Object.assign(captured.headers, headers)
    },
    end(text?: string) { captured.body = text ?? '' },
  }
  return { response: response as unknown as ServerResponse, captured }
}

/** Find a captured route by path. */
function route(host: Host, path: string): CapturedRoute {
  const found = host.routes.find(candidate => candidate.path === path)
  if (found === undefined) throw new Error(`route ${path} was not registered`)
  return found
}

/** Apply the plugin and wait for its asynchronous contributions. */
async function activate(host: Host): Promise<void> {
  apply(host.ctx)
  await host.settle()
}

/** Invoke the status route and return what it wrote. */
async function callStatus(
  host: Host,
  options: Parameters<typeof fakeRequest>[0] = {},
): Promise<CapturedResponse> {
  const { response, captured } = fakeResponse()
  await route(host, STATUS_ROUTE).handler(fakeRequest(options), response)
  return captured
}

describe('plugin activation', () => {
  it('declares no required services, so a partial profile still loads it', () => {
    // A required injection would leave the plugin pending in a profile that
    // lacks the service, contributing neither the skill nor the route.
    expect(inject).toEqual([])
  })

  it('registers the minigame skill with its shipped body', async () => {
    const host = fakeHost()
    await activate(host)

    expect(host.skills).toHaveLength(1)
    const skill = host.skills[0]
    expect(skill?.['name']).toBe(SKILL_NAME)
    expect(skill?.['source']).toBe('bundled')
    expect(String(skill?.['description'])).toContain('微信小游戏')
    expect(String(skill?.['whenToUse'])).toContain('小游戏')
    const body = String(skill?.['content'])
    expect(body).toContain('mcp__minigame__run_game')
    expect(body).toContain('mcp__minigame__get_logs')
    expect(body).toContain('禁止再调用 `run_game`')
  })

  it('registers no slash commands, because the skill and the MCP tools cover them', async () => {
    const host = fakeHost()
    await activate(host)

    // The context the plugin is handed has no command registry at all, so a
    // reintroduced registration would throw rather than pass silently.
    expect('commands' in host.ctx).toBe(false)
    expect(host.skills).toHaveLength(1)
  })

  it('registers the status route when a web surface exists', async () => {
    const host = fakeHost()
    await activate(host)

    expect(host.routes.map(entry => entry.path)).toEqual([STATUS_ROUTE])
    expect(host.routes[0]?.kind).toBe('exact')
  })

  it('still registers the route when no skill registry exists', async () => {
    const host = fakeHost({ skills: false })
    await activate(host)

    expect(host.skills).toEqual([])
    expect(host.routes.map(entry => entry.path)).toEqual([STATUS_ROUTE])
  })

  it('still registers the skill when no web surface exists', async () => {
    const host = fakeHost({ webServer: false })
    await activate(host)

    expect(host.routes).toEqual([])
    expect(host.skills).toHaveLength(1)
  })

  it('returns a disposer for every registration it made', async () => {
    const both = fakeHost()
    await activate(both)
    expect(both.disposers).toHaveLength(2)
    expect(both.disposers.every(disposer => typeof disposer === 'function')).toBe(true)

    const skillOnly = fakeHost({ webServer: false })
    await activate(skillOnly)
    expect(skillOnly.disposers).toHaveLength(1)

    const routeOnly = fakeHost({ skills: false })
    await activate(routeOnly)
    expect(routeOnly.disposers).toHaveLength(1)
  })
})

describe('GET /minigame/status', () => {
  it('answers with the preview state and no caching', async () => {
    const host = fakeHost()
    await activate(host)
    const captured = await callStatus(host)

    expect(captured.status).toBe(200)
    expect(captured.headers['cache-control']).toBe('no-store')
    expect(captured.headers['content-type']).toContain('application/json')
    expect(JSON.parse(captured.body)).toEqual({ preview: { running: false } })
  })

  it('carries the recorded origin when a preview was recorded', async () => {
    const host = fakeHost()
    await activate(host)
    const home = process.env['USERPROFILE'] ?? ''
    mkdirSync(join(home, '.weixin-minigame-helper'), { recursive: true })
    writeFileSync(
      join(home, '.weixin-minigame-helper', 'preview-server.json'),
      JSON.stringify({ url: 'http://localhost:3847', port: 3847 }),
    )

    const body = JSON.parse((await callStatus(host)).body) as MinigameStatus
    // Only the origin is asserted: whether that address answers depends on the
    // machine, and the probe itself is covered in status.spec.ts.
    expect(body.preview.url).toBe('http://localhost:3847')
  })

  it('rejects a non-read method', async () => {
    const host = fakeHost()
    await activate(host)
    expect((await callStatus(host, { method: 'POST' })).status).toBe(405)
  })

  it('accepts a HEAD probe', async () => {
    const host = fakeHost()
    await activate(host)
    expect((await callStatus(host, { method: 'HEAD' })).status).toBe(200)
  })

  it('refuses a caller that is not on loopback', async () => {
    const host = fakeHost()
    await activate(host)
    expect((await callStatus(host, { remoteAddress: '10.0.0.7' })).status).toBe(403)
  })
})
