/**
 * WeChat Mini Game plugin, browser half.
 *
 * Two additive slot entries over one piece of shared state, plus the single
 * poll that feeds both:
 *
 * - the trigger, in the session header's utilities cluster beside the Session
 *   log button, so the plugin adds no chrome of its own and nothing floats over
 *   the conversation while idle;
 * - the preview window, in the frame-wide `shell.overlay` layer, which embeds
 *   the local preview server and opens itself the first time a packaged game
 *   appears.
 *
 * The poll runs here rather than inside the window so the trigger can show the
 * same state the window does. `panel-store.ts` carries it to both.
 */
import { MinigameLauncher } from './MinigameLauncher.tsx'
import { MinigamePreview } from './MinigamePreview.tsx'
import { createPanelStore } from './panel-store.ts'
import { STATUS_ROUTE, type MinigameStatus } from '../minigame/wire.ts'

/** How often the plugin re-reads the preview state. */
const POLL_INTERVAL_MS = 2500

/** Poll deadline, kept below the interval so a stalled request cannot pile up. */
const POLL_TIMEOUT_MS = 2000

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

/** What an effect callback may return. */
export type EffectResult = void | (() => void)

/** The client cordis context: the injected services this plugin uses. */
export interface MinigameClientContext {
  slots: SlotRegistryFace
  effect(callback: () => EffectResult, label?: string): () => void
}

/** Required services: the slot registry only. */
export const inject = ['slots']

/**
 * Client plugin body: create the shared panel state, start the one poll, then
 * register the window and the trigger that drives it.
 * @param ctx - client root context.
 */
export function apply(ctx: MinigameClientContext): void {
  const panel = createPanelStore()
  let disposed = false

  const tick = async (): Promise<void> => {
    try {
      const response = await fetch(STATUS_ROUTE, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`status ${response.status}`)
      const body = await response.json() as MinigameStatus
      if (disposed) return
      panel.observe(body.preview)
    } catch {
      // The host route is unreachable — the plugin is not composed into this
      // server, or the page is talking to a different origin. Both surfaces say
      // so instead of presenting a stale preview as if it were live.
      if (!disposed) panel.markUnreachable()
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

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'weixin-minigame',
    order: 40,
    inject: () => ({
      hooks: { panel },
      hide: () => { panel.hide() },
      end: () => { panel.end() },
    }),
  }, MinigamePreview))

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'weixin-minigame',
    // After the Session log capsule, which registers without an order.
    order: 20,
    inject: () => ({
      hooks: { panel },
      open: () => { panel.open() },
      hide: () => { panel.hide() },
    }),
  }, MinigameLauncher))
}

export { MinigameLauncher } from './MinigameLauncher.tsx'
export { MinigamePreview } from './MinigamePreview.tsx'
export { createPanelStore } from './panel-store.ts'
export type { PanelPhase, PanelSnapshot, PanelStore } from './panel-store.ts'
