/**
 * The mini game preview window, registered as an additive entry in the
 * frame-wide `shell.overlay` layer.
 *
 * The window embeds the local preview server in an iframe, so the mini game
 * runs inside this page and the panel needs no rendering code of its own. It is
 * always mounted while the shell is up, and its visibility follows the shared
 * panel phase:
 *
 * - `open` — shown and interactive;
 * - `hidden` — collapsed with the preview page still mounted, so the game keeps
 *   running in the background rather than being reloaded on the next look;
 * - `ended` — the preview page is unmounted, which is the only state that
 *   stops the game.
 *
 * Only the grip starts a drag. Capturing the pointer anywhere else in the
 * header would retarget the following pointer events to the header, and a click
 * is derived from that pair — which is how the header's own controls silently
 * stopped firing before the grip existed.
 */
import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PanelSnapshot } from './panel-store.ts'
import css from './minigame-panel.module.css'

/** Panel geometry once the user has dragged it. */
interface Position {
  left: number
  top: number
}

/** Keep the window inside the viewport with a small margin. */
const VIEWPORT_MARGIN = 12

/**
 * Clamp a candidate position so the window stays grabbable.
 * @param position - candidate top-left corner.
 * @param width - window width.
 * @param height - window height.
 * @returns the clamped position.
 */
function clampToViewport(position: Position, width: number, height: number): Position {
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
  const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)
  return {
    left: Math.min(Math.max(VIEWPORT_MARGIN, position.left), maxLeft),
    top: Math.min(Math.max(VIEWPORT_MARGIN, position.top), maxTop),
  }
}

/** Props the registration injects. */
export interface MinigamePreviewProps {
  /** Bound from the registration's `hooks` compartment. */
  usePanel: <T>(selector: (snapshot: PanelSnapshot) => T) => T
  /** Collapse the window, leaving the preview page running. */
  hide: () => void
  /** Collapse the window and unmount the preview page. */
  end: () => void
}

/**
 * Render the preview window.
 * @param props - panel snapshot hook and the two closes the header offers.
 * @returns the overlay entry's element tree.
 */
export function MinigamePreview({ usePanel, hide, end }: MinigamePreviewProps): ReactNode {
  const phase = usePanel(snapshot => snapshot.phase)
  const preview = usePanel(snapshot => snapshot.preview)
  const servingGame = usePanel(snapshot => snapshot.servingGame)
  const reachable = usePanel(snapshot => snapshot.reachable)
  const [reloadToken, setReloadToken] = useState(0)
  const [position, setPosition] = useState<Position | undefined>(undefined)
  const windowRef = useRef<HTMLElement | null>(null)
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)

  const onGripPointerDown = useCallback((event: React.PointerEvent<HTMLSpanElement>): void => {
    const node = windowRef.current
    /* v8 ignore next -- the grip only exists while the window is rendered. */
    if (node === null) return
    const rect = node.getBoundingClientRect()
    drag.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setPosition(clampToViewport({ left: rect.left, top: rect.top }, rect.width, rect.height))
  }, [])

  const onGripPointerMove = useCallback((event: React.PointerEvent<HTMLSpanElement>): void => {
    const active = drag.current
    const node = windowRef.current
    if (active === null || active.pointerId !== event.pointerId || node === null) return
    const rect = node.getBoundingClientRect()
    setPosition(clampToViewport(
      { left: event.clientX - active.offsetX, top: event.clientY - active.offsetY },
      rect.width,
      rect.height,
    ))
  }, [])

  const onGripPointerUp = useCallback((event: React.PointerEvent<HTMLSpanElement>): void => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  const running = preview.running && preview.url !== undefined

  // `hidden` only means something while there is a packaged game worth keeping
  // alive. With nothing to preserve — no preview, the helper's own onboarding
  // page, or a preview the user ended — the window leaves the tree entirely
  // rather than sitting there invisible.
  if (phase === 'ended') return null
  if (phase === 'hidden' && !servingGame) return null

  return (
    <section
      ref={windowRef}
      className={css.panel}
      data-hidden={phase === 'hidden' || undefined}
      style={position === undefined
        ? undefined
        : { left: position.left, top: position.top, right: 'auto', bottom: 'auto' }}
      aria-label="微信小游戏预览"
      aria-hidden={phase === 'hidden' || undefined}
    >
      <div className={css.header}>
        <span
          className={css.grip}
          title="拖动窗口"
          onPointerDown={onGripPointerDown}
          onPointerMove={onGripPointerMove}
          onPointerUp={onGripPointerUp}
          onPointerCancel={onGripPointerUp}
        >
          <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
            <g fill="currentColor">
              <circle cx="2" cy="3" r="1.15" />
              <circle cx="8" cy="3" r="1.15" />
              <circle cx="2" cy="7" r="1.15" />
              <circle cx="8" cy="7" r="1.15" />
              <circle cx="2" cy="11" r="1.15" />
              <circle cx="8" cy="11" r="1.15" />
            </g>
          </svg>
        </span>
        <span className={css.title}>微信小游戏预览</span>
        <span className={css.meta}>
          {!reachable
            ? '插件未挂载'
            : running
              ? preview.url ?? ''
              : preview.url !== undefined
                ? '预览服务无响应'
                : '预览未启动'}
        </span>
        <div className={css.actions}>
          <button
            type="button"
            className={css.action}
            title="重新加载预览页面"
            disabled={!running}
            onClick={() => { setReloadToken(token => token + 1) }}
          >
            刷新
          </button>
          <button
            type="button"
            className={css.action}
            title="在新标签页打开预览"
            disabled={preview.url === undefined}
            onClick={() => {
              if (preview.url !== undefined) window.open(preview.url, '_blank', 'noopener')
            }}
          >
            新标签页
          </button>
          <button
            type="button"
            className={css.action}
            title="收起窗口，预览继续在后台运行"
            onClick={hide}
          >
            隐藏
          </button>
          <button
            type="button"
            className={css.action}
            title="结束预览：卸载游戏页面，停止游戏"
            onClick={end}
          >
            结束预览
          </button>
        </div>
      </div>

      {running
        ? (
            <iframe
              key={`${preview.url ?? ''}#${reloadToken}`}
              className={css.frame}
              src={preview.url}
              title="微信小游戏预览"
            />
          )
        : (
            <div className={css.empty}>
              <p className={css.emptyTitle}>
                {reachable ? '预览尚未启动' : '预览插件未在这个界面上挂载'}
              </p>
              {reachable && (
                <>
                  <p className={css.emptyBody}>
                    让 agent 启动预览，它会把画面直接呈现在这里：
                  </p>
                  <pre className={css.hint}>{'用 mcp__minigame__run_game 启动当前小游戏工程的预览，\n然后用 mcp__minigame__get_logs 检查报错。'}</pre>
                </>
              )}
            </div>
          )}
    </section>
  )
}
