// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, type MinigameClientContext, type SlotRegistryFace } from '../src/client/index.ts'
import { MinigameLauncher, type MinigameLauncherProps } from '../src/client/MinigameLauncher.tsx'
import { MinigamePreview, type MinigamePreviewProps } from '../src/client/MinigamePreview.tsx'
import { createPanelStore, type PanelSnapshot, type PanelStore } from '../src/client/panel-store.ts'
import { STATUS_ROUTE, type MinigameStatus } from '../src/minigame/wire.ts'

/** One captured slot registration. */
interface CapturedRegistration {
  options: { name: string; id: string; order?: number; inject?: () => Record<string, unknown> }
  component: (props: Record<string, unknown>) => unknown
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
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
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
 * selector hook, so the components are driven exactly as the product drives
 * them.
 * @param store - the shared panel store.
 * @returns the selector hook the registration would inject.
 */
function panelHook(store: PanelStore): <T>(selector: (snapshot: PanelSnapshot) => T) => T {
  return function usePanel<T>(selector: (snapshot: PanelSnapshot) => T): T {
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

/** Build a client context whose effect callbacks are captured for disposal. */
function fakeContext(): { ctx: MinigameClientContext; disposers: (() => void)[] } {
  const disposers: (() => void)[] = []
  return {
    disposers,
    ctx: {
      slots: fakeSlots(),
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

/** Build preview props bound to a store. */
function previewProps(store: PanelStore): MinigamePreviewProps {
  return {
    usePanel: panelHook(store),
    hide: () => { store.hide() },
    end: () => { store.end() },
  }
}

/** Build launcher props bound to a store. */
function launcherProps(store: PanelStore): MinigameLauncherProps {
  return {
    usePanel: panelHook(store),
    open: () => { store.open() },
    hide: () => { store.hide() },
  }
}

describe('client plugin registration', () => {
  it('registers the window in the overlay and the trigger in the session header', () => {
    apply(fakeContext().ctx)

    expect(injectedKeys).toEqual(['shell.overlay', 'conversation.session.header.utilities'])
    expect(registrations.every(entry => entry.options.id === 'weixin-minigame')).toBe(true)
    expect(registrations[0]?.component).toBe(MinigamePreview)
    expect(registrations[1]?.component).toBe(MinigameLauncher)
  })

  it('hands both entries the same panel source through the hooks compartment', () => {
    apply(fakeContext().ctx)

    const first = registrations[0]?.options.inject?.() as { hooks?: { panel?: unknown } }
    const second = registrations[1]?.options.inject?.() as { hooks?: { panel?: unknown } }
    expect(first.hooks?.panel).toBeDefined()
    expect(first.hooks?.panel).toBe(second.hooks?.panel)
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

describe('panel store', () => {
  it('keeps the snapshot reference stable until the fact moves', () => {
    const store = createPanelStore()
    const before = store.getSnapshot()
    expect(store.getSnapshot()).toBe(before)
    store.observe(RUNNING.preview)
    expect(store.getSnapshot()).not.toBe(before)
  })

  it('does not republish an unchanged poll', () => {
    const store = createPanelStore()
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
    const store = createPanelStore()
    store.observe(ONBOARDING.preview)
    expect(store.getSnapshot().servingGame).toBe(false)
    expect(store.getSnapshot().phase).toBe('hidden')
  })

  it('treats a record without a game directory as not a game', () => {
    const store = createPanelStore()
    store.observe({ running: true, url: 'http://localhost:3847' })
    expect(store.getSnapshot().servingGame).toBe(false)
  })

  it('opens itself on the first packaged game, then leaves the choice alone', () => {
    const store = createPanelStore()
    store.observe(RUNNING.preview)
    expect(store.getSnapshot()).toMatchObject({ phase: 'open', autoOpened: true, servingGame: true })

    store.hide()
    store.observe({ ...RUNNING.preview, port: 9999 })
    expect(store.getSnapshot().phase).toBe('hidden')
  })

  it('records an unreachable host route', () => {
    const store = createPanelStore()
    store.markUnreachable()
    expect(store.getSnapshot().reachable).toBe(false)
  })

  it('notifies subscribers once per real change', () => {
    const store = createPanelStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.open()
    expect(listener).toHaveBeenCalledTimes(1)
    store.open()
    expect(listener).toHaveBeenCalledTimes(1)
    store.hide()
    expect(listener).toHaveBeenCalledTimes(2)
    store.subscribe(listener)()
    store.end()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('MinigameLauncher', () => {
  it('shows a quiet lamp with nothing running', () => {
    const { container } = render(<MinigameLauncher {...launcherProps(createPanelStore())} />)

    expect(screen.getByRole('button', { name: /小游戏预览/ })).toBeDefined()
    expect(container.querySelector('[data-state="idle"]')).not.toBeNull()
    expect(container.querySelector('[data-state="live"]')).toBeNull()
  })

  it('lights up while a packaged game is being served', async () => {
    const store = createPanelStore()
    const { container, rerender } = render(<MinigameLauncher {...launcherProps(store)} />)

    await act(async () => { store.observe(RUNNING.preview) })
    rerender(<MinigameLauncher {...launcherProps(store)} />)

    expect(container.querySelector('[data-state="live"]')).not.toBeNull()
  })

  it('shows a hollow lamp when the plugin route does not answer', async () => {
    const store = createPanelStore()
    const { container, rerender } = render(<MinigameLauncher {...launcherProps(store)} />)

    await act(async () => { store.markUnreachable() })
    rerender(<MinigameLauncher {...launcherProps(store)} />)

    expect(container.querySelector('[data-state="unknown"]')).not.toBeNull()
  })

  it('opens the window, then collapses it instead of ending the preview', () => {
    const store = createPanelStore()
    render(<MinigameLauncher {...launcherProps(store)} />)
    const button = screen.getByRole('button', { name: /小游戏预览/ })

    fireEvent.click(button)
    expect(store.getSnapshot().phase).toBe('open')
    expect(button.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(button)
    expect(store.getSnapshot().phase).toBe('hidden')
  })
})

describe('MinigamePreview', () => {
  it('renders nothing while there is no preview to show', () => {
    const { container } = render(<MinigamePreview {...previewProps(createPanelStore())} />)
    expect(container.querySelector('section')).toBeNull()
  })

  it('renders nothing while the helper serves its own onboarding page', async () => {
    const store = createPanelStore()
    const { container } = render(<MinigamePreview {...previewProps(store)} />)
    await act(async () => { store.observe(ONBOARDING.preview) })

    expect(container.querySelector('section')).toBeNull()
  })

  it('opens itself the first time a packaged game appears', async () => {
    const store = createPanelStore()
    const { container } = render(<MinigamePreview {...previewProps(store)} />)

    await act(async () => { store.observe(RUNNING.preview) })

    expect(store.getSnapshot().phase).toBe('open')
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe('http://localhost:3847')
  })

  it('auto-opens against a host payload that predates this client', () => {
    // A `dsh web` that booted before this client existed sends no
    // `servingGame` at all and still carries the old `panel` field. The
    // packaged-game answer must therefore come from `gameDir`, which that
    // payload has always carried — depending on a newer field here is exactly
    // what kept the window from opening.
    const store = createPanelStore()
    store.observe({
      running: true,
      url: 'http://localhost:3847',
      port: 3847,
      gameDir: 'C:\\Temp\\ai-minigame-engine\\pack-bf2e2d0a2395',
    })

    expect(store.getSnapshot()).toMatchObject({ phase: 'open', servingGame: true, autoOpened: true })
  })

  it('hides without unmounting the preview page', async () => {
    const store = createPanelStore()
    const { container } = render(<MinigamePreview {...previewProps(store)} />)
    await act(async () => { store.observe(RUNNING.preview) })

    fireEvent.click(screen.getByRole('button', { name: '隐藏' }))

    const section = container.querySelector('section')
    expect(store.getSnapshot().phase).toBe('hidden')
    // Still mounted, just collapsed: the game keeps running.
    expect(section).not.toBeNull()
    expect(section?.hasAttribute('data-hidden')).toBe(true)
  })

  it('ends the preview by unmounting the page, and can reopen it', async () => {
    const store = createPanelStore()
    const { container } = render(<MinigamePreview {...previewProps(store)} />)
    await act(async () => { store.observe(RUNNING.preview) })

    fireEvent.click(screen.getByRole('button', { name: '结束预览' }))
    expect(store.getSnapshot().phase).toBe('ended')
    expect(container.querySelector('section')).toBeNull()

    await act(async () => { store.open() })
    expect(container.querySelector('iframe')).not.toBeNull()
  })

  it('reloads the frame under a new key when refresh is pressed', async () => {
    const store = createPanelStore()
    const { container } = render(<MinigamePreview {...previewProps(store)} />)
    await act(async () => { store.observe(RUNNING.preview) })

    const before = container.querySelector('iframe')
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(container.querySelector('iframe')).not.toBe(before)
  })

  it('disables the frame actions while no preview is running', async () => {
    const store = createPanelStore()
    store.open()
    render(<MinigamePreview {...previewProps(store)} />)

    expect(screen.getByRole('button', { name: '刷新' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '新标签页' }).hasAttribute('disabled')).toBe(true)
  })

  it('says the plugin is not mounted when its host route is unreachable', async () => {
    const store = createPanelStore()
    store.open()
    const { rerender, container } = render(<MinigamePreview {...previewProps(store)} />)

    await act(async () => { store.markUnreachable() })
    rerender(<MinigamePreview {...previewProps(store)} />)

    expect(container.textContent).toContain('预览插件未在这个界面上挂载')
    expect(container.textContent).toContain('插件未挂载')
  })

  it('drags only from the grip, leaving the header controls clickable', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 100, top: 100, width: 400, height: 300, right: 500, bottom: 400, x: 100, y: 100,
      toJSON: () => ({}),
    })
    const capture = vi.fn()
    Element.prototype.setPointerCapture = capture

    const store = createPanelStore()
    store.open()
    const { container } = render(<MinigamePreview {...previewProps(store)} />)

    const section = container.querySelector('section')
    const grip = container.querySelector('section > div > span')
    if (section === null || grip === null) throw new Error('expected the window and its grip')

    fireEvent.pointerDown(grip, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 300, clientY: 250 })
    fireEvent.pointerUp(grip, { pointerId: 1 })

    expect(capture).toHaveBeenCalledTimes(1)
    expect(section.getAttribute('style')).toContain('left: 300px')
    expect(section.getAttribute('style')).toContain('top: 250px')
  })

  it('does not start a drag from a press on a header control', () => {
    const capture = vi.fn()
    Element.prototype.setPointerCapture = capture

    const store = createPanelStore()
    store.open()
    render(<MinigamePreview {...previewProps(store)} />)

    fireEvent.pointerDown(screen.getByRole('button', { name: '隐藏' }), {
      pointerId: 1, clientX: 100, clientY: 100,
    })

    expect(capture).not.toHaveBeenCalled()
    expect(store.getSnapshot().phase).toBe('open')
  })
})
