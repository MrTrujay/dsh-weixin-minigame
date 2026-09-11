/**
 * The wire between the node half (route owner) and the browser half (panel).
 *
 * Types only: the browser half imports these with `import type`, so nothing
 * here reaches the client bundle at runtime.
 */
import type { PreviewStatus } from './status.ts'

export type { PreviewStatus } from './status.ts'

/** Route the panel polls for the current preview address. */
export const STATUS_ROUTE = '/minigame/status'

/** Body of a `GET /minigame/status` response. */
export interface MinigameStatus {
  /** Recorded and probed preview server, when one is running. */
  readonly preview: PreviewStatus
}
