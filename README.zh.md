# @trujaycc/dsh-weixin-minigame

[English](README.md) | 中文

在 dsh Web 中预览、开发、调试（通过日志、截图）微信小游戏，参考自[微信小游戏助手](https://gamemp.weixin.qq.com/doc/minigame-helper/guide/vscode-plugin.html)。

![小游戏预览窗口](docs/screenshot.png)

## 提供什么

| 能力                               | 说明                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **预览面板**                       | 界面内悬浮、可独立打开的预览窗口；预览与凭据均由官方小游戏助手服务管理，本插件不会保存和上传任何信息。 |
| **`weixin-minigame-helper` SKILL** | 指引 MCP、插件的使用，以及游戏开发流程。                                                               |
| **MCP 桥接**                       | 打通 dsh 和小游戏助手的服务。                                                                          |

## 能做什么

### 用户视角

自然语言触发。

| 你想做的事             | 示例提示词                                         |
| ---------------------- | -------------------------------------------------- |
| 看看游戏跑起来什么样   | 「把当前工作区的小游戏项目跑起来看看」             |
| 修崩溃或白屏           | 「预览一下当前工作区的小游戏，有报错就修到干净」   |
| 确认画面实际渲染成什么 | 「改完之后截个图给我看」                           |
| 在真机上试             | 「对当前工作区的小游戏做一次真机测试」             |
| 发一个版本             | 「把当前工作区的小游戏发个 1.0.1，说明写修复得分」 |

### 功能视角

| 能完成的功能                                           | 背后的 MCP 工具                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| 启动或热重载预览                                       | `run_game`                                                                |
| 读控制台输出与报错                                     | `get_logs`                                                                |
| 截取当前画面（单帧或连拍）                             | `capture_screenshot`、`capture_screenshot_burst`、`stop_screenshot_burst` |
| 真机预览二维码                                         | `real_device_preview`                                                     |
| 上传版本到微信平台                                     | `publish`                                                                 |
| 平台上线流程 —— 填写游戏信息、备案、资质审核、提交版本 | `open_onboarding` 及 `mp_*` 系列                                          |

## 安装

- 前置依赖：dsh Web、Node `^22.19.0` 或 `>=24.0.0`（与 dsh 自身要求一致）、npx
- 不强依赖：微信开发者工具（如果需要自行调试代码，建议安装）

### 从 npm 安装本插件

```sh
dsh plugin --profile web add @trujaycc/dsh-weixin-minigame
```

然后**重启 `dsh web`**：客户端模块注册表会把包元数据缓存到进程结束，新增的行只有下次启动时才会被发现。之后对 `lib/client.js` 的修改会通过常驻的客户端 HMR 链路自动重载。

### 从本地检出安装（开发本插件）

```sh
pnpm install
pnpm run build
dsh plugin --profile web add <本插件的绝对路径>
```

以**目录**形式安装建立的是指向检出的链接，之后 `pnpm run build` 会直接生效、不必重装。首次启用同样需要重启 `dsh web`。

若要验证 npm 打包后的结果，再改用 tarball：

```sh
pnpm pack
dsh plugin --profile web add ./trujaycc-dsh-weixin-minigame-0.1.0.tgz
```

tarball 是解包出来的副本，之后改代码需要重新 `pnpm pack` 并重装。

### 卸载

```sh
dsh plugin --profile web remove @trujaycc/dsh-weixin-minigame
```

## 游戏工程自身

- 一个包含 `game.js` 的微信小游戏目录。
- 真机预览和发布还需要微信 **AppID** 与**代码上传密钥**，可通过预览页的 ⚙️ 按钮配置，参考[官方文档](https://gamemp.weixin.qq.com/doc/minigame-helper/guide/vscode-plugin.html)。

## 对 dsh 的影响

### 技能注入

会话目录里增加一条 `weixin-minigame-helper` 技能，描述为微信小游戏代码的预览/修复闭环。技能正文只在模型调用 `skill` 工具时才加载；目录本身只携带名称与描述，受 harness 的目录长度上限约束。

### 无其他提示词注入

没有注册任何 system-prompt 段落，所以无关的轮次不产生开销。MCP 工具 schema 由上游服务提供，且只在握手成功后注册；桥接起不来只是少了这些工具，不会影响 dsh 启动。

### 界面

会话标题栏右上角增加「小游戏预览」触发按钮（左侧圆点：绿色表示项目运行中，灰色表示未运行，空心表示插件未挂载），以及一个嵌入官方小游戏助手预览服务的悬浮窗口。

## 已知限制与待办

- **上游 MCP 服务是第三方依赖。** 由 `npx` 在启动时拉取，版本钉在 `cordis.patch.yml`（当前 `0.1.35`）。上游发布新版本时工具名、参数和行为都可能变化，升级该钉版本前请先跑一遍本插件的测试。
- **官方小游戏助手服务会在游戏工程目录留下文件**（如截图等），请自行将其加入 `.gitignore`。
- **一台机器只有一个预览服务，跨 dsh 实例共享。** helper 把监听地址记录在用户主目录下的单个文件里，先绑定者占用默认端口，因此第二个运行本插件的 dsh 进程会覆写该记录并改用下一个空闲端口。
- **预览状态对回环接口上的任何调用方都可读。** 它暴露的内容只是一个本地地址，所以这样的约束是相称的；除此之外没有认证。
- **首次启用需要重启。** 客户端模块注册表的包元数据缓存永不过期，所以新装的插件在 `dsh web` 重启前不可见。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build    # 产出 lib/index.js 与 lib/client.js（ModuleLoader 交接格式）
```

客户端 bundle 从 dsh Web loader 的平台模块表解析 `react`，不声明其他运行时依赖。

`pnpm run watch` 在文件变化时重建 `lib/client.js`；客户端 HMR 链路会在浏览器里重载插件，无需刷新页面。

## 引用说明

本插件所引导 agent 遵循的工作流，以及它驱动 MCP 服务的方式，参考官方[微信小游戏助手](https://gamemp.weixin.qq.com/doc/minigame-helper/guide/vscode-plugin.html)。

MCP 服务为 `@weadmin/weixin-minigame-helper-mcp`，在运行时通过 `npx` 拉取，不随本包分发。
