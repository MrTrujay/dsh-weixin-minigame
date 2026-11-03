// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  inject,
  MinigameLauncher,
  type MinigameClientContext,
  type SidebarRightFace,
  type SlotRegistryFace,
} from '../src/client/index.ts'
import type { MinigameLauncherProps } from '../src/client/MinigameLauncher.tsx'
import { createPreviewStore, type PreviewSnapshot, type PreviewStore } from '../src/client/preview-store.ts'
import { STATUS_ROUTE, type MinigameStatus } from '../src/minigame/wire.ts'

/** One captured slot registration. */
interface CapturedRegistration {
  options: { name: string; id: string; order?: number; inject?: () => Record<string, unknown> }
  component: (props: Record<string, unknown>) => unknown
}

/** One recorded call into dsh's built-in browser. */
interface OpenCall {
  kind: string
  url: string | undefined
}

/** The built-in browser face, with the knobs a test needs. */
interface FakeBrowser extends SidebarRightFace {
  hasSurface: boolean
  fail: boolean
  readonly calls: OpenCall[]
}

const registrations: CapturedRegistration[] = []
const injectedKeys: string[] = []
const requests: string[] = []

let statusBody: MinigameStatus = { preview: { running: false } }
let statusReachable = true

beforeEach(() => {
  registrations.length = 0
  injectedKeys.length = 0
  requests.length = 0
  statusReachable = true
  statusBody = { preview: { running: false } }
  vi.useFakeTimers()
  vi.stubGlobal('fetch', async (input: string) => {
    const url = String(input)
    requests.push(url)
    if (url !== STATUS_ROUTE) throw new Error(`unexpected request: ${url}`)
    if (!statusReachable) throw new Error('offline')
    return new Response(JSON.stringify(statusBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** Flush pending microtasks (including a poll tick). */
async function settle(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

/** Advance far enough for one poll interval to fire. */
async function poll(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(2600) })
}

/**
 * Stand in for the renderer's binding of a `hooks` member to a `use<Name>`
 * selector hook, so the trigger is driven exactly as the product drives it.
 * @param store - the shared preview store.
 * @returns the selector hook the registration would inject.
 */
function previewHook(store: PreviewStore): <T>(selector: (snapshot: PreviewSnapshot) => T) => T {
  return function usePreview<T>(selector: (snapshot: PreviewSnapshot) => T): T {
    return useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
  }
}

/**
 * Build a slot-registry face that records what `apply` registers.
 * @returns the face, writing into the module-level capture arrays.
 */
function fakeSlots(): SlotRegistryFace {
  return {
    inject(key: string, callback: () => (() => void) | Iterable<() => void>): () => void {
      injectedKeys.push(key)
      const result = callback()
      if (typeof result !== 'function') for (const disposer of result) void disposer
      return () => {}
    },
    register<P extends object>(
      options: CapturedRegistration['options'],
      component: (props: P) => unknown,
    ): () => void {
      registrations.push({ options, component: component as (props: Record<string, unknown>) => unknown })
      return () => {}
    },
  }
}

/**
 * Build a built-in-browser face that records open requests.
 * @param options - initial surface availability.
 * @returns the fake, usable as `ctx.sidebarRight`.
 */
function fakeBrowser(options: { hasSurface?: boolean } = {}): FakeBrowser {
  const state = {
    hasSurface: options.hasSurface ?? true,
    fail: false,
    calls: [] as OpenCall[],
  }
  return {
    get hasSurface() { return state.hasSurface },
    set hasSurface(value: boolean) { state.hasSurface = value },
    get fail() { return state.fail },
    set fail(value: boolean) { state.fail = value },
    get calls() { return state.calls },
    active: () => (state.hasSurface ? {} : undefined),
    openTab: (kind, optional) => {
      if (state.fail) throw new Error('no tab type registered as "browser"')
      state.calls.push({ kind, url: optional?.params?.url })
    },
  }
}

/** Build a client context whose effect callbacks are captured for disposal. */
function fakeContext(browser: FakeBrowser = fakeBrowser()): {
  ctx: MinigameClientContext
  browser: FakeBrowser
  disposers: (() => void)[]
} {
  const disposers: (() => void)[] = []
  return {
    browser,
    disposers,
    ctx: {
      slots: fakeSlots(),
      sidebarRight: browser,
      effect: (callback) => {
        const result = callback()
        if (typeof result === 'function') disposers.push(result)
        return () => {}
      },
    },
  }
}

/** A running preview of a packaged game: the helper's own pack directory. */
const RUNNING: MinigameStatus = {
  preview: {
    running: true,
    url: 'http://localhost:3847',
    port: 3847,
    gameDir: 'C:\\Temp\\ai-minigame-engine\\pack-bf2e2d0a2395',
  },
}

/** The helper serving its own onboarding page: answering, but no game yet. */
const ONBOARDING: MinigameStatus = {
  preview: {
    running: true,
    url: 'http://localhost:3847',
    gameDir: 'C:\\Temp\\ai-minigame-engine\\onboarding-fallback',
  },
}

/** Build trigger props bound to a store. */
function launcherProps(store: PreviewStore, open: () => void = vi.fn()): MinigameLauncherProps {
  return { usePreview: previewHook(store), open }
}

describe('client plugin registration', () => {
  it('requires the slot registry and the built-in browser service', () => {
    expect(inject).toEqual(['slots', 'sidebarRight'])
  })

  it('registers only the session-header trigger, with no overlay window', () => {
    apply(fakeContext().ctx)

    expect(injectedKeys).toEqual(['conversation.session.header.utilities'])
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.options.id).toBe('weixin-minigame')
    expect(registrations[0]?.component).toBe(MinigameLauncher)
  })

  it('hands the trigger the shared preview source and an open action', () => {
    apply(fakeContext().ctx)

    const injected = registrations[0]?.options.inject?.() as {
      hooks?: { preview?: unknown }
      open?: unknown
    }
    expect(injected.hooks?.preview).toBeDefined()
    expect(typeof injected.open).toBe('function')
  })

  it('polls the host route once and stops on disposal', async () => {
    const { ctx, disposers } = fakeContext()
    apply(ctx)
    await settle()

    expect(requests).toEqual([STATUS_ROUTE])
    await poll()
    expect(requests.length).toBe(2)

    expect(disposers).toHaveLength(1)
    disposers[0]?.()
    await poll()
    expect(requests.length).toBe(2)
  })
})

describe('automatic browser opening', () => {
  it('opens the preview tab once a packaged game appears', async () => {
    statusBody = RUNNING
    const { ctx, browser } = fakeContext()
    apply(ctx)
    await settle()

    expect(browser.calls).toEqual([{ kind: 'browser', url: 'http://localhost:3847' }])

    // The same running game on a later poll must not pile up tabs.
    await poll()
    expect(browser.calls).toHaveLength(1)
  })

  it('does not open the onboarding page the helper serves before a game exists', async () => {
    statusBody = ONBOARDING
    const { ctx, browser } = fakeContext()
    apply(ctx)
    await settle()

    expect(browser.calls).toEqual([])
  })

  it('does not open a preview that is recorded but not running', async () => {
    statusBody = { preview: { running: false, url: 'http://localhost:3847' } }
    const { ctx, browser } = fakeContext()
    apply(ctx)
    await settle()

    expect(browser.calls).toEqual([])
  })

  it('waits for an on-screen session surface, then opens on the next poll', async () => {
    statusBody = RUNNING
    const { ctx, browser } = fakeContext(fakeBrowser({ hasSurface: false }))
    apply(ctx)
    await settle()

    // The Plugins page or another main panel is showing: no sidebar to open into.
    expect(browser.calls).toEqual([])

    browser.hasSurface = true
    await poll()
    expect(browser.calls).toEqual([{ kind: 'browser', url: 'http://localhost:3847' }])
  })

  it('opens a new tab when the preview moves to another URL', async () => {
    statusBody = RUNNING
    const { ctx, browser } = fakeContext()
    apply(ctx)
    await settle()

    statusBody = {
      preview: {
        running: true,
        url: 'http://localhost:4001',
        port: 4001,
        gameDir: 'C:\\Temp\\ai-minigame-engine\\pack-bf2e2d0a2395',
      },
    }
    await poll()

    expect(browser.calls.map(call => call.url)).toEqual([
      'http://localhost:3847',
      'http://localhost:4001',
    ])
  })

  it('retries quietly while the browser tab type is unavailable', async () => {
    statusBody = RUNNING
    const browser = fakeBrowser()
    browser.fail = true
    apply(fakeContext(browser).ctx)
    await settle()

    expect(browser.calls).toEqual([])

    browser.fail = false
    await poll()
    expect(browser.calls).toEqual([{ kind: 'browser', url: 'http://localhost:3847' }])
  })
})

describe('preview store', () => {
  it('keeps the snapshot reference stable until the fact moves', () => {
    const store = createPreviewStore()
    const before = store.getSnapshot()
    expect(store.getSnapshot()).toBe(before)
    store.observe(RUNNING.preview)
    expect(store.getSnapshot()).not.toBe(before)
  })

  it('does not republish an unchanged poll', () => {
    const store = createPreviewStore()
    store.observe(RUNNING.preview)
    const settled = store.getSnapshot()
    const listener = vi.fn()
    store.subscribe(listener)

    // A fresh response object with identical content: no new snapshot, so a
    // selector on `preview` keeps its identity.
    store.observe({ ...RUNNING.preview })
    expect(listener).not.toHaveBeenCalled()
    expect(store.getSnapshot()).toBe(settled)
  })

  it('treats the helper onboarding page as not a game', () => {
    const store = createPreviewStore()
    store.observe(ONBOARDING.preview)
    expect(store.getSnapshot().servingGame).toBe(false)
  })

  it('treats a record without a game directory as not a game', () => {
    const store = createPreviewStore()
    store.observe({ running: true, url: 'http://localhost:3847' })
    expect(store.getSnapshot().servingGame).toBe(false)
  })

  it('records an unreachable host route', () => {
    const store = createPreviewStore()
    store.markUnreachable()
    expect(store.getSnapshot().reachable).toBe(false)
  })

  it('notifies subscribers once per real change', () => {
    const store = createPreviewStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.observe(RUNNING.preview)
    expect(listener).toHaveBeenCalledTimes(1)
    store.observe({ ...RUNNING.preview })
    expect(listener).toHaveBeenCalledTimes(1)
    store.observe(ONBOARDING.preview)
    expect(listener).toHaveBeenCalledTimes(2)
    store.subscribe(listener)()
    store.markUnreachable()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('MinigameLauncher', () => {
  it('shows a quiet lamp and disables the button before any preview', () => {
    const { container } = render(<MinigameLauncher {...launcherProps(createPreviewStore())} />)

    expect(screen.getByRole('button', { name: '小游戏预览' })).toBeDefined()
    expect(container.querySelector('[data-state="idle"]')).not.toBeNull()
    expect(container.querySelector('[data-state="live"]')).toBeNull()
    expect(screen.getByRole('button', { name: '小游戏预览' }).hasAttribute('disabled')).toBe(true)
  })

  it('lights up and opens the built-in browser while a packaged game is served', async () => {
    const store = createPreviewStore()
    const open = vi.fn()
    const { container, rerender } = render(<MinigameLauncher {...launcherProps(store, open)} />)

    await act(async () => { store.observe(RUNNING.preview) })
    rerender(<MinigameLauncher {...launcherProps(store, open)} />)

    expect(container.querySelector('[data-state="live"]')).not.toBeNull()
    const button = screen.getByRole('button', { name: '小游戏预览' })
    expect(button.hasAttribute('disabled')).toBe(false)

    fireEvent.click(button)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('stays clickable for a recorded preview that is not answering', () => {
    const store = createPreviewStore()
    store.observe({ running: false, url: 'http://localhost:3847' })
    render(<MinigameLauncher {...launcherProps(store)} />)

    const button = screen.getByRole('button', { name: '小游戏预览' })
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(button.getAttribute('title')).toContain('预览服务无响应')
  })

  it('shows a hollow lamp when the plugin route does not answer', async () => {
    const store = createPreviewStore()
    const { container, rerender } = render(<MinigameLauncher {...launcherProps(store)} />)

    await act(async () => { store.markUnreachable() })
    rerender(<MinigameLauncher {...launcherProps(store)} />)

    expect(container.querySelector('[data-state="unknown"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: '小游戏预览' }).hasAttribute('disabled')).toBe(true)
  })
})
