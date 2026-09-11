/**
 * Session-header trigger, sitting beside the Session log button.
 *
 * It is the plugin's only always-present control, and it mirrors that button's
 * capsule so the two read as one row. The lamp on the left reports what the
 * window would show: green once a packaged game is being served, quiet
 * otherwise, and hollow when the plugin's own route does not answer.
 */
import type { ReactNode } from 'react'
import type { PanelSnapshot } from './panel-store.ts'
import css from './minigame-panel.module.css'

/** Props the registration injects. */
export interface MinigameLauncherProps {
  /** Bound from the registration's `hooks` compartment. */
  usePanel: <T>(selector: (snapshot: PanelSnapshot) => T) => T
  /** Show the window. */
  open: () => void
  /** Collapse the window, leaving the preview page running. */
  hide: () => void
}

/**
 * Render the header trigger.
 * @param props - panel snapshot hook and the two transitions it may request.
 * @returns the header button.
 */
export function MinigameLauncher({ usePanel, open, hide }: MinigameLauncherProps): ReactNode {
  const phase = usePanel(snapshot => snapshot.phase)
  const servingGame = usePanel(snapshot => snapshot.servingGame)
  const reachable = usePanel(snapshot => snapshot.reachable)
  const shown = phase === 'open'

  const title = !reachable
    ? '小游戏预览插件未在这个界面上挂载'
    : servingGame
      ? '小游戏正在运行 — 点击收起或展开预览窗口'
      : '打开小游戏预览窗口'

  return (
    <button
      type="button"
      className={css.trigger}
      data-active={shown || undefined}
      aria-pressed={shown}
      title={title}
      onClick={() => { if (shown) hide(); else open() }}
    >
      <span className={css.triggerLamp} data-state={!reachable ? 'unknown' : servingGame ? 'live' : 'idle'} />
      <span>小游戏预览</span>
      <svg
        className={css.triggerIcon}
        width="12"
        height="12"
        viewBox="0 0 16 16"
        aria-hidden="true"
        data-active={shown || undefined}
      >
        <path
          d="M2.5 5.5 8 11l5.5-5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
