# 待办面板（dsh-plugin-todo-panel）

> A todo panel for the DeepSeek Harness sidebar. It renders a markdown todo list, and every toggle, tag change or deletion is written back to that file, one line at a time. MIT.

把一份 markdown 待办清单，在 DSH（DeepSeek Harness）右侧栏里显示成面板：还剩几件、每件放了多少天、按标签筛，勾选和删除都直接改回那个文件。

为什么用文件当数据库：清单可以进 git、任何编辑器能改、别的工具和 agent 也能直接读写，不会被锁进某个 app 的数据库里。

## 它做什么

- 右侧栏「＋」面板里一张入口卡片，点开就是「待办」标签页
- 顶部一个大数字：还有几件事没做；超过 30 天没动的排在前面，左侧细竖线标警示色
- 每条可打一个标签，标签写在行首：`- [ ] #工作 内容（记于 09-22 · 来源：周会）`
- 顶部一排标签筛选，点一个只看那一类，带件数
- 悬停出现 ✕ 删除，删完 8 秒内可撤销；撤销靠行数核对，清单被别人改过就拒绝
- 勾选／改标签／删除都只动目标那一行，其余字符原样保留
- 底部显示清单最后改动时间，每分钟自动重读一次
- 色值全部取自主题变量，跟着 DSH 的明暗主题走

## 它不做什么

- 不做多清单，一次只挂一份文件
- 不问优先级，只把「放了多少天」摆出来
- 删除不弹二次确认，靠 8 秒撤销兜底

## 安装

需要 DSH 0.2.x（实测于 0.2.0-rc.2）。

方式一，走 `dsh plugin`：

```bash
dsh plugin --profile web add github:DavidLee2026/dsh-plugin-todo-panel
```

然后在 `~/.dsh/profiles/web/cordis.patch.yml` 里给它配上数据文件。同 id 的覆盖会整段替换 `config`，所以这里只写要改的字段：

```yaml
- id: dsh-plugin-todo-panel
  config:
    todoFile: /path/to/todo.md
```

安装后如果右侧栏里没有「待办」，重启一次 DSH。宿主侧代码必须重启才生效。

方式二，手动装（适合要改代码的人）：

```bash
ln -sfn "$PWD" ~/.dsh/profiles/web/node_modules/dsh-plugin-todo-panel
```

```yaml
- insert:
    - id: dsh-plugin-todo-panel
      name: 'dsh-plugin-todo-panel'
      config:
        todoFile: /path/to/todo.md
```

## 配置

| 键 | 默认 | 作用 |
|:---|:---|:---|
| `todoFile` | `<DSH_HOME>/todo/todo.md` | 清单文件路径；文件缺失时面板会直接告诉你该配哪个键 |
| `tags` | 工作／生活／开发／学习／其他 | 标签集合与颜色，形如 `[{ id: 工作, color: 'var(--dsw-static-blue-500)' }]` |
| `waitingPattern` | `^待` | 正文以它开头就标成「待确认」，表示在等别人回话 |

## 清单格式

完整示例见 [`examples/todo.md`](examples/todo.md)。

```markdown
## 进行中

- [ ] #工作 把这周的会议记录整理成三条结论（记于 09-22 · 来源：周会）
- [ ] 预约体检（记于 08-01 · 来源：提醒）

## 已完成（近期）

- [x] #生活 交房租（记于 09-01 · 来源：提醒）
```

- 只有 `- [ ]` 与 `- [x]` 开头的行会被当成待办
- `## 已完成…` 这类二级标题下的条目算历史，不进未完成计数
- 行首 `#标签 ` 可省；标签必须是配置集合里的，认不得就原样留在正文里
- 尾注 `（记于 MM-DD` 可省；省了就不算天数，归到「没标日期的」
- 其余字符一律原样保留，包括加粗、来源、你自己加的备注

## 数据接口

| 方法 | 路径 | 作用 |
|:---|:---|:---|
| GET | `/dsh-plugin-todo-panel/api/state` | 未完成件数、分组条目、标签计数、最近完成 |
| POST | `/dsh-plugin-todo-panel/api/toggle` | `{ line, raw, done }` 勾选状态 |
| POST | `/dsh-plugin-todo-panel/api/tag` | `{ line, raw, tag }` 改标签，`tag: null` 清空 |
| POST | `/dsh-plugin-todo-panel/api/delete` | `{ line, raw }` 删一条，返回原文与位置 |
| POST | `/dsh-plugin-todo-panel/api/restore` | `{ index, text, expected_lines }` 撤销删除 |

写接口都要带 `x-dsh-plugin-todo-panel: 1` 请求头（跨站请求带自定义头要先过预检，过不了就写不进来），并且核对行号与原文，对不上返回 409，界面自动重读，不会写错行。

## 几个设计取舍

- 写文件是「读全文、改一行、写临时文件、改名替换」，没有文件锁；多个写入排成队列串行做
- 不做二次确认，用 8 秒撤销加行数核对兜底
- 撤销窗口内文件被别人改过，宁可拒绝也不猜位置

## 开发与测试

```bash
npm test
```

7 个用例，全部在临时目录里的副本上跑，不碰真实清单。改完按这张表让它生效：

| 改了哪 | 怎么生效 |
|:---|:---|
| `lib/client.js` | 碰一下 `cordis.patch.yml`（加一行注释即可）触发重新组合，再刷新页面 |
| `lib/index.js` | 必须重启 DSH：宿主侧代码受 Node 模块缓存保护，热重载拿到的是旧模块 |
| 清单文件本身 | 面板每分钟自动重读，也可点「刷新」 |

插件接口细节、主题变量与升级时要复核的字段，见 [`docs/plugin-internals.md`](docs/plugin-internals.md)。

## 与同类插件的区别

生态里已有的 todo 类插件，多数是「点条目把文字填进输入框」，或者维护自己的 JSON 文件。这个只做一件事：把你已经在用的那份 markdown 清单当唯一数据源，改动写回文件本身，所以清单可以进 git、可以被别的工具和 agent 直接读写。

## 已知边界

- 对着 DSH 0.2.0-rc.2 写的，用的是内部的 slot 与 tab 注册接口；DSH 升级后接口若变，这里要跟着改
- 面板读本地文件，单机单清单，没有同步
- 清单同时被手工编辑时，写操作返回 409 让界面重读

## 许可

MIT。
