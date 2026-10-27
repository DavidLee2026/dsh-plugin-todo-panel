# DSH 插件接口笔记（实测于 0.2.0-rc.2）

写给以后要加插件或升级 DSH 的人看。下面所有结论都是从本机安装包里读出来、跑出来验证过的，不是猜的。

安装位置（用 `npm root -g` 定位，不要照抄版本号目录）：

```
$(npm root -g)/@deepseek-ai/dsh/
```

## 一个插件包长什么样

- 包在 `package.json` 里声明 `dsh.bundle.patch`，指向包自带的 `cordis.patch.yml`；`dsh plugin add` 装好后，这个补丁文件会把插件条目插进 profile 的配置树。
- 浏览器端由 `dsh.client` 声明：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-sidebar-right"] }
}
```

- 宿主侧入口是 `lib/index.js`，导出 `apply(ctx, config)`、`inject`、可选 `name`。
- 插件管理器卡片上的标题与描述从 `locale/<lang>.json` 的 `meta` 读，图标是 `package.json` 里的 `icon`（相对路径，SVG／PNG／JPEG／WebP，上限 256 KiB）。

## 浏览器端不必须编译

编译产物就是一个自注册的 ESM 外壳，手写完全一样能跑：

```js
window.__ModuleLoader__.load({
  id: '<包名>',
  factory: (require) => { /* 返回 module.exports */ },
});
```

`id` 必须等于包名。`require` 能拿到平台静态表里的模块：`react`、`react/jsx-runtime`、
`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-store`。
非静态表里的模块要在 `dsh.client.external` 声明。
宿主按 mtime 起 revision，改文件后浏览器重新拉一份，不用重启。

## 右侧栏加一个标签页（两步）

```js
// 第一步：类型（静态）
ctx.sidebarRightTabs.register({
  id: '我的包名',          // 唯一，同时是第二步 body 的 key
  kind: 'todo',            // openTab 用这个名字
  priority: 'extension',   // extension 最高，可顶替 builtin
  title: () => '待办',
  guide: [{ id: 'todo', order: 20, title: () => '待办', description: () => '…', icon: 组件 }],
});

// 第二步：面板本体
ctx.slots.inject('sidebar.right.pane.tab', () =>
  ctx.slots.register({ name: 'sidebar.right.pane.tab', key: '我的包名' }, 组件));
```

两个注册都套在 `ctx.effect(() => …, '标签')` 里，插件卸载时自动撤掉。

## 宿主侧加一个 HTTP 路由

`ctx.webServer.register({ kind: 'exact' | 'prefix', path, handler })`，
handler 是原生 `(req, res)`，自己写响应。需要 `inject: ['webServer']`。
浏览器端直接 `fetch('/前缀/...')`，同源，不用配 CORS。

写接口自带的防跨站办法：要求一个自定义请求头（本插件用 `x-dsh-plugin-todo-panel: 1`），
跨站请求带自定义头必须先过预检，预检过不了就写不进来。

## 主题

色值全部走 `--dsw-*` 变量，别写死。常用的：

| 用途 | 变量 |
|:---|:---|
| 主文字 | `--dsw-alias-label-primary` |
| 次文字 | `--dsw-alias-label-secondary` |
| 弱文字 | `--dsw-alias-label-tertiary` |
| 分隔线 | `--dsw-alias-border-l3` |
| 悬停底色 | `--dsw-alias-interactive-bg-hover` |
| 品牌色 | `--dsw-alias-brand-primary` |
| 警示色 | `--dsw-alias-state-warn-primary` |
| 成功色 | `--dsw-alias-state-success-primary` |
| 圆角 | `--dsw-radius-sm` / `-md` / `-lg` |
| 焦点环 | `--dsw-focus-ring-width` / `-color` |

标签色用的是静态色板 `--dsw-static-*-500`，同样跟着明暗主题走。

## 改完之后怎么生效（踩过的坑）

- `cordis.patch.yml` 是热更新的：加一条 `insert` 就生效，不用重启 GUI。
- 但**宿主侧代码（lib/index.js）不会热更**。改完再碰 patch 触发重载，拿到的仍是旧模块，
  因为 Node 的 ESM 缓存以模块 URL 为键，重载不会换 URL。实测：路由还在，返回的仍是旧字段。
  结论：宿主侧改动必须重启 GUI。
- 浏览器侧（lib/client.js）跟着组合重载走，碰一下 patch 再刷新页面就有新版本。
- 验证客户端 bundle 是否真的发出去，看这个地址是不是 200：
  `/plugins/??<包名>/client.js&rev=<rev>`。单独路径 `/plugins/<包名>/client.js` 一定 404。
- rev 由 `mtimeMs + ctimeMs + size` 算 sha1 前 12 位，算法在 `dsh-client-modules` 的 `artifactRevision`。

## 升级时要重新核对的点

1. `sidebarRightTabs.register` 的字段有没有变（读 `lib/types/client/tab-registry.d.ts`）
2. 插槽名是否还叫 `sidebar.right.pane.tab`
3. `window.__ModuleLoader__.load` 的协议有没有变（读 `dsh-client-modules` 的 README）
4. 平台静态表里还有没有 `react` 与 `dsh-client-ui-primitives`

核对命令：

```bash
grep -n "SidebarRightTabDefinition" -A 40 \
  "$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/types/client/tab-registry.d.ts"
```
