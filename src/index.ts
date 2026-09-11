/**
 * WeChat Mini Game plugin, node half.
 *
 * Two host-plane contributions, each registered under its own dynamic
 * injection:
 *
 * - the `weixin-minigame-helper` skill, whose body carries the preview/repair
 *   loop the model follows after it writes game code;
 * - the `GET /minigame/status` route the browser half polls for the preview
 *   address.
 *
 * Neither is a required `inject`. A required injection holds the whole plugin
 * pending, so a profile missing either registry would silently contribute
 * nothing at all — and reading the service with `ctx.get` instead would sample
 * the global store at activation time and could miss a provider that mounts
 * later. The dynamic form waits for the service without either problem: the
 * plugin is always loaded, and each half appears exactly when the profile can
 * host it.
 *
 * No slash commands are registered. Resolving the game directory, judging
 * whether credentials are configured, and agreeing a version number are all
 * things the agent already does from natural language under the skill's
 * guidance — and the upstream server reports its own `configMissing` state,
 * which is more accurate than this side reading `project.config.json`.
 *
 * The MCP tools are not registered here either: the bundle patch mounts
 * `@deepseek-ai/dsh-mcp-client` against the upstream mini game helper server.
 */
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readPreviewStatus } from './minigame/status.ts'
import { STATUS_ROUTE, type MinigameStatus } from './minigame/wire.ts'

/** Skill name the model loads; kebab-case is the registry's grammar. */
export const SKILL_NAME = 'weixin-minigame-helper'

/** Catalog description: what the skill covers, kept short for the catalog. */
const SKILL_DESCRIPTION = '微信小游戏开发工具包：预览、热重载、真机测试、上传发布微信小游戏。'
  + '每当生成或修改了小游戏代码，用它跑「预览 → 读日志 → 修错 → 再预览」的闭环；'
  + '也用于真机扫码体验和版本上传。'

/** Catalog routing hint: when this skill applies. */
const SKILL_WHEN_TO_USE = '当用户正在开发微信小游戏，或提到「小游戏」「预览」「跑起来看看」'
  + '「真机测试」「扫码体验」「上传/发布到微信」时。'

/** Structural face of the skill registry this plugin registers into. */
export interface SkillRegistryFace {
  register(skill: {
    name: string
    description: string
    content: string
    whenToUse?: string
    source: string
  }): () => void
}

/** Structural face of one HTTP route registration. */
export interface WebServerFace {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** What an effect callback may return: nothing, one disposer, or many yielded ones. */
export type EffectResult = void | (() => void) | Iterable<() => void>

/** Scope handed to the skill contribution once a skill registry exists. */
export interface SkillScope {
  readonly skills: SkillRegistryFace
  effect(callback: () => EffectResult, label?: string): () => void
}

/** Scope handed to the route contribution once a web server exists. */
export interface WebServerScope {
  readonly webServer: WebServerFace
  effect(callback: () => EffectResult, label?: string): () => void
}

/** The host context this plugin needs; both services are optional. */
export interface MinigameHostContext {
  inject(services: readonly ['skills'], callback: (scope: SkillScope) => void | Promise<void>): unknown
  inject(services: readonly ['webServer'], callback: (scope: WebServerScope) => void | Promise<void>): unknown
}

/** Required services: deliberately none, so the plugin is never held pending. */
export const inject: readonly string[] = []

/**
 * Read the skill body shipped beside this module.
 * @returns the markdown instruction body.
 */
async function readSkillBody(): Promise<string> {
  return readFile(new URL('../assets/weixin-minigame-helper.md', import.meta.url), 'utf8')
}

/**
 * Whether a request reached us over the loopback interface.
 *
 * The route below only reads local state, but the webserver can be bound to all
 * interfaces, so an unauthenticated remote caller must not be able to read it.
 * @param req - the incoming request.
 * @returns whether the peer address is loopback.
 */
function isLoopback(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress
  if (address === undefined) return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * Write a JSON response.
 * @param res - response to write.
 * @param status - HTTP status code.
 * @param body - JSON-serializable payload.
 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

/**
 * `GET /minigame/status`: the preview server the panel should embed.
 * @param req - the incoming request.
 * @param res - response to write.
 */
async function handleStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  const body: MinigameStatus = { preview: await readPreviewStatus() }
  sendJson(res, 200, body)
}

/**
 * Contribute the skill and the status route to whichever registries this
 * profile hosts.
 * @param ctx - host context carrying the optional registries.
 */
export function apply(ctx: MinigameHostContext): void {
  ctx.inject(['skills'], async (scope) => {
    // Read here rather than in apply() so a missing asset fails this one
    // contribution instead of the plugin's activation.
    const content = await readSkillBody()
    scope.effect(() => scope.skills.register({
      name: SKILL_NAME,
      description: SKILL_DESCRIPTION,
      whenToUse: SKILL_WHEN_TO_USE,
      content,
      source: 'bundled',
    }), 'weixin-minigame: skill')
  })

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => scope.webServer.register({
      kind: 'exact',
      path: STATUS_ROUTE,
      handler: (req, res) => (isLoopback(req) ? handleStatus(req, res) : sendJson(res, 403, { error: 'loopback only' })),
    }), 'weixin-minigame: status route')
  })
}
