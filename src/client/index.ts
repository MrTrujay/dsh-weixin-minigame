/**
 * WeChat Mini Game plugin, browser half.
 *
 * One additive slot entry over one poll, plus the side effect that makes the
 * preview visible:
 *
 * - the trigger, in the session header's utilities cluster beside the Session
 *   log button, opens — or reopens — the preview in dsh's built-in browser tab,
 *   so nothing floats over the conversation;
 * - the poll watches the host route and opens that tab by itself the first time
 *   a packaged game is served, so the game appears without a click.
 *
 * The plugin renders no preview surface of its own. dsh's right-sidebar browser
 * supplies the page, history, reload and address controls, and the helper's
 * preview page supplies its own configuration and QR dialogs. `preview-store.ts`
 * carries the poll's answer to the trigger.
 */
import { MinigameLauncher } from './MinigameLauncher.tsx'
import { createPreviewStore } from './preview-store.ts'
import { STATUS_ROUTE, type MinigameStatus } from '../minigame/wire.ts'

/** How often the plugin re-reads the preview state. */
const POLL_INTERVAL_MS = 2500

/** Poll deadline, kept below the interval so a stalled request cannot pile up. */
const POLL_TIMEOUT_MS = 2000

/** The page kind dsh's built-in browser registers with the right sidebar. */
const BROWSER_TAB_KIND = 'browser'

/** Structural face of the host slot registry this plugin consumes (runtime-provided). */
export interface SlotRegistryFace {
  inject(key: string, callback: () => (() => void) | Iterable<() => void>): () => void
  register<P extends object>(
    options: {
      name: string
      id: string
      order?: number
      /** Inject face; a `hooks` member becomes a `use<Name>` selector prop. */
      inject?: () => Record<string, unknown>
    },
    component: (props: P) => unknown,
  ): () => void
}

/**
 * Structural face of dsh's built-in right-sidebar browser (`ctx.sidebarRight`).
 *
 * Only the two reads/calls this plugin makes are declared, so the bundle carries
 * no dependency on the Client package that provides the service: a page the
 * browser can open is named by kind, and the browser kind is `browser`.
 */
export interface SidebarRightFace {
  /** Open a page type in the right sidebar; the preview page is HTTP(S). */
  openTab(kind: string, options?: { params?: { url?: string } }): void
  /** The active tab of the active pane, or undefined without an on-screen surface. */
  active(): unknown
}

/** What an effect callback may return. */
export type EffectResult = void | (() => void)

/** The client cordis context: the injected services this plugin uses. */
export interface MinigameClientContext {
  slots: SlotRegistryFace
  sidebarRight: SidebarRightFace
  effect(callback: () => EffectResult, label?: string): () => void
}

/** Required services: the slot registry and the built-in browser surface. */
export const inject = ['slots', 'sidebarRight']

/**
 * Client plugin body: create the shared preview state, start the one poll, then
 * register the trigger that opens the preview in the built-in browser.
 * @param ctx - client root context.
 */
export function apply(ctx: MinigameClientContext): void {
  const preview = createPreviewStore()
  /** Preview URLs that already have a tab from this page load. */
  const opened = new Set<string>()
  let disposed = false

  /**
   * Ask the right sidebar to open one browser page.
   * @param url - preview page address.
   * @returns whether a tab was requested; a missing service or browser kind
   * never breaks the poll.
   */
  const openInBrowser = (url: string): boolean => {
    try {
      ctx.sidebarRight.openTab(BROWSER_TAB_KIND, { params: { url } })
      return true
    } catch {
      // The browser kind can be absent in a surface that does not ship it.
      // Auto-open stays quiet and retries; the explicit click reports it.
      return false
    }
  }

  /**
   * Open the preview once per served URL.
   *
   * Repeated polls of the same running game must not pile up tabs, and a tab the
   * user closed stays closed: the trigger is how another one is asked for. A new
   * URL — the helper moving to another port, for instance — is a new page and
   * opens on its own.
   */
  const autoOpen = (): void => {
    const snapshot = preview.getSnapshot()
    const url = snapshot.preview.url
    if (!snapshot.servingGame || url === undefined || opened.has(url)) return
    try {
      // With no Conversation on screen the right sidebar has no surface yet;
      // the next poll retries after the user returns to one.
      if (ctx.sidebarRight.active() === undefined) return
    } catch {
      return
    }
    if (openInBrowser(url)) opened.add(url)
  }

  const tick = async (): Promise<void> => {
    try {
      const response = await fetch(STATUS_ROUTE, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`status ${response.status}`)
      const body = await response.json() as MinigameStatus
      if (disposed) return
      preview.observe(body.preview)
      autoOpen()
    } catch {
      // The host route is unreachable — the plugin is not composed into this
      // server, or the page is talking to a different origin. The trigger says
      // so instead of presenting a stale preview as if it were live.
      if (!disposed) preview.markUnreachable()
    }
  }

  ctx.effect(() => {
    const timer = window.setInterval(() => { void tick() }, POLL_INTERVAL_MS)
    void tick()
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, 'weixin-minigame: preview poll')

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'weixin-minigame',
    // After the Session log capsule, which registers without an order.
    order: 20,
    inject: () => ({
      hooks: { preview },
      open: () => {
        const url = preview.getSnapshot().preview.url
        if (url === undefined) return
        if (!openInBrowser(url)) {
          console.warn('weixin-minigame: the DSH built-in browser tab could not be opened')
          return
        }
        opened.add(url)
      },
    }),
  }, MinigameLauncher))
}

export { MinigameLauncher } from './MinigameLauncher.tsx'
export { createPreviewStore, isServedGame } from './preview-store.ts'
export type { PreviewSnapshot, PreviewStore } from './preview-store.ts'
