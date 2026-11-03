/**
 * Session-header trigger, sitting beside the Session log button.
 *
 * It is the plugin's only always-present control, and it mirrors that button's
 * capsule so the two read as one row. The lamp on the left reports the state of
 * the preview: green once a packaged game is being served, quiet otherwise, and
 * hollow when the plugin's own route does not answer.
 *
 * A click opens — or reopens — the preview page in dsh's built-in right-sidebar
 * browser. The plugin renders no preview surface of its own, so nothing floats
 * over the conversation and the browser supplies history, reload and the
 * address bar.
 */
import type { ReactNode } from 'react'
import type { PreviewSnapshot } from './preview-store.ts'
import css from './minigame-launcher.module.css'

/** Props the registration injects. */
export interface MinigameLauncherProps {
  /** Bound from the registration's `hooks` compartment. */
  usePreview: <T>(selector: (snapshot: PreviewSnapshot) => T) => T
  /** Open the preview in dsh's built-in browser tab. */
  open: () => void
}

/**
 * Render the header trigger.
 * @param props - preview snapshot hook and the browser-open action.
 * @returns the header button.
 */
export function MinigameLauncher({ usePreview, open }: MinigameLauncherProps): ReactNode {
  const reachable = usePreview(snapshot => snapshot.reachable)
  const servingGame = usePreview(snapshot => snapshot.servingGame)
  const url = usePreview(snapshot => snapshot.preview.url)
  const canOpen = url !== undefined

  const title = !reachable
    ? '小游戏预览插件未在这个界面上挂载'
    : servingGame
      ? '小游戏正在运行 — 在 DSH 内置浏览器中打开预览'
      : canOpen
        ? '预览服务无响应 — 在 DSH 内置浏览器中打开'
        : '预览未启动 — 让 agent 先启动小游戏预览'

  return (
    <button
      type="button"
      className={css.trigger}
      title={title}
      aria-label="小游戏预览"
      disabled={!canOpen}
      onClick={open}
    >
      <span className={css.triggerLamp} data-state={!reachable ? 'unknown' : servingGame ? 'live' : 'idle'} />
      <span>小游戏预览</span>
      <svg className={css.triggerIcon} width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M4.5 11.5 11.5 4.5M6 4.5h5.5V10"
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
