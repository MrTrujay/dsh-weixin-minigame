/**
 * Preview-panel state shared by the plugin's two registrations.
 *
 * The trigger button lives in the session header and the preview window lives
 * in the frame-wide overlay, so they are separate components in separate slot
 * trees. The slot API's `hooks` compartment is how one plugin hands a private
 * observable to several of its own entries: the value below satisfies the
 * renderer's `HostObservable` (a `getSnapshot`/`subscribe` pair), and each
 * inject face passes it through so the renderer binds it to a `usePanel`
 * selector hook.
 *
 * The poll itself lives in the plugin body rather than in a component, so there
 * is one reader of the host route and both surfaces see the same answer.
 *
 * Note what is deliberately absent: nothing about the helper's conventions
 * travels over the wire. The two halves load at different times — the node half
 * only on `dsh web` boot, this one on every page load — so a field added to the
 * route's payload is missing for every browser that reloaded before a restart.
 * The packaged-game decision is therefore derived here from `gameDir`, which
 * both halves have always carried.
 */
import type { PreviewStatus } from '../minigame/wire.ts'

/** What the preview window is doing. */
export type PanelPhase = 'open' | 'hidden' | 'ended'

/** Directory name the helper serves from before any game has been packaged. */
const ONBOARDING_PLACEHOLDER = 'onboarding-fallback'

/** Nothing known yet: the first poll has not answered. */
const UNKNOWN_PREVIEW: PreviewStatus = { running: false }

/** Snapshot the trigger button and the window both read. */
export interface PanelSnapshot {
  /** Whether the window is shown, collapsed-but-alive, or torn down. */
  readonly phase: PanelPhase
  /** Whether a packaged game has already opened the window on its own. */
  readonly autoOpened: boolean
  /** Latest preview state the host route reported. */
  readonly preview: PreviewStatus
  /** Whether that state is a packaged game rather than the helper's own page. */
  readonly servingGame: boolean
  /** Whether the host route answered on the last poll. */
  readonly reachable: boolean
}

/** The shared source plus the transitions its consumers may request. */
export interface PanelStore {
  getSnapshot(): PanelSnapshot
  subscribe(listener: () => void): () => void
  /** Show the window, mounting the preview page when it had been ended. */
  open(): void
  /** Collapse the window, leaving the preview page mounted and running. */
  hide(): void
  /** Collapse the window and unmount the preview page. */
  end(): void
  /** Publish the latest preview state; a first packaged game opens the window. */
  observe(preview: PreviewStatus): void
  /** Record that the host route did not answer. */
  markUnreachable(): void
}

/**
 * Whether two preview reads describe the same fact.
 *
 * Field-wise, so a repeated poll does not republish: the renderer's hooks need
 * a selector result to keep its identity while the underlying fact is unchanged.
 * @param a - previous read.
 * @param b - latest read.
 * @returns whether nothing observable moved.
 */
function samePreview(a: PreviewStatus, b: PreviewStatus): boolean {
  return a.running === b.running && a.url === b.url && a.gameDir === b.gameDir && a.port === b.port
}

/**
 * Create the shared preview-panel state.
 * @returns a fresh store; one per plugin mount.
 */
export function createPanelStore(): PanelStore {
  let snapshot: PanelSnapshot = {
    phase: 'hidden',
    autoOpened: false,
    preview: UNKNOWN_PREVIEW,
    servingGame: false,
    reachable: true,
  }
  const listeners = new Set<() => void>()
  const publish = (next: PanelSnapshot): void => {
    const previous = snapshot
    if (
      next.phase === previous.phase
      && next.autoOpened === previous.autoOpened
      && next.servingGame === previous.servingGame
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
    open: () => { publish({ ...snapshot, phase: 'open' }) },
    hide: () => { publish({ ...snapshot, phase: 'hidden' }) },
    end: () => { publish({ ...snapshot, phase: 'ended' }) },
    observe: (preview) => {
      // The helper answers from boot to serve its own onboarding page, so an
      // answering server is not yet a game the user asked to look at.
      const servingGame = preview.running
        && preview.gameDir !== undefined
        && !preview.gameDir.endsWith(ONBOARDING_PLACEHOLDER)
      // Once only: a later game must not reopen a window the user closed.
      const autoOpen = servingGame && !snapshot.autoOpened
      publish({
        phase: autoOpen ? 'open' : snapshot.phase,
        autoOpened: snapshot.autoOpened || autoOpen,
        preview,
        servingGame,
        reachable: true,
      })
    },
    markUnreachable: () => { publish({ ...snapshot, reachable: false }) },
  }
}
