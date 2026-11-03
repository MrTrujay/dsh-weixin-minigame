/**
 * Preview state shared by the header trigger and the auto-open side effect.
 *
 * The poll lives in the plugin body rather than in a component, so there is one
 * reader of the host route: the trigger's lamp and the decision to open dsh's
 * built-in browser tab both read this store and therefore always agree.
 *
 * Note what is deliberately absent: nothing about the helper's conventions
 * travels over the wire. The two halves load at different times — the node half
 * only on `dsh web` boot, this one on every page load — so a field added to the
 * route's payload is missing for every browser that reloaded before a restart.
 * The packaged-game decision is therefore derived here from `gameDir`, which
 * both halves have always carried.
 */
import type { PreviewStatus } from '../minigame/wire.ts'

/** Directory name the helper serves from before any game has been packaged. */
const ONBOARDING_PLACEHOLDER = 'onboarding-fallback'

/** Nothing known yet: the first poll has not answered. */
const UNKNOWN_PREVIEW: PreviewStatus = { running: false }

/** Snapshot the trigger and the auto-open decision both read. */
export interface PreviewSnapshot {
  /** Latest preview state the host route reported. */
  readonly preview: PreviewStatus
  /** Whether that state is a packaged game rather than the helper's own page. */
  readonly servingGame: boolean
  /** Whether the host route answered on the last poll. */
  readonly reachable: boolean
}

/** The shared source; the plugin body is its only writer. */
export interface PreviewStore {
  getSnapshot(): PreviewSnapshot
  subscribe(listener: () => void): () => void
  /** Publish the latest preview state. */
  observe(preview: PreviewStatus): void
  /** Record that the host route did not answer. */
  markUnreachable(): void
}

/**
 * Whether a preview read describes a packaged game.
 *
 * The helper answers from boot to serve its own onboarding page, so an
 * answering server is not yet a game the user asked to look at.
 * @param preview - latest host read.
 * @returns whether the helper is serving a packaged game.
 */
export function isServedGame(preview: PreviewStatus): boolean {
  return preview.running
    && preview.gameDir !== undefined
    && !preview.gameDir.endsWith(ONBOARDING_PLACEHOLDER)
}

/**
 * Whether two preview reads describe the same fact.
 *
 * Field-wise, so a repeated poll does not republish: the renderer's hooks need
 * a selector result to keep its identity while the underlying fact is unchanged,
 * and the auto-open path must not treat a poll as news.
 * @param a - previous read.
 * @param b - latest read.
 * @returns whether nothing observable moved.
 */
function samePreview(a: PreviewStatus, b: PreviewStatus): boolean {
  return a.running === b.running && a.url === b.url && a.gameDir === b.gameDir && a.port === b.port
}

/**
 * Create the shared preview state.
 * @returns a fresh store; one per plugin mount.
 */
export function createPreviewStore(): PreviewStore {
  let snapshot: PreviewSnapshot = {
    preview: UNKNOWN_PREVIEW,
    servingGame: false,
    reachable: true,
  }
  const listeners = new Set<() => void>()
  const publish = (next: PreviewSnapshot): void => {
    const previous = snapshot
    if (
      next.servingGame === previous.servingGame
      && next.reachable === previous.reachable
      && samePreview(next.preview, previous.preview)
    ) return
    snapshot = next
    for (const listener of listeners) listener()
  }
  return {
    // The same reference is returned until the fact moves, which is what the
    // renderer's hook cache requires of a snapshot source.
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    observe: (preview) => {
      publish({ preview, servingGame: isServedGame(preview), reachable: true })
    },
    markUnreachable: () => { publish({ ...snapshot, reachable: false }) },
  }
}
