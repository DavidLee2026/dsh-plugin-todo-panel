/**
 * 待办面板 · 宿主侧
 *
 * 读一份 markdown 待办清单，向浏览器面板提供同源路由：
 *   GET  /state    结构化读取
 *   POST /toggle   勾选／取消勾选
 *   POST /tag      改标签（行首 #工作 这类）
 *   POST /delete   删掉一条（返回原文，供面板 8 秒内撤销）
 *   POST /restore  撤销删除，把原文插回原位
 *
 * 原则：格式只多一个可选的标签前缀，其余一个字符不动；写入一律读全文、改目标行、
 * 原子替换，动手前核对行号与原文，对不上就拒绝，绝不写错行。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 包名，同时用作路由前缀。 */
const PACKAGE = 'dsh-plugin-todo-panel';
/** 本插件占用的路由前缀。 */
const API_PREFIX = `/${PACKAGE}/api`;
/** 清单条目行：`- [ ] 内容` 或 `- [x] 内容`。 */
const ITEM_RE = /^- \[([ xX])\] (.*)$/;
/** 行首标签：`#工作 内容`。 */
const TAG_RE = /^#([^\s#]+)[\s\u3000]+/;
/** 条目尾注：`（记于 MM-DD · 来源：…）`。 */
const NOTE_RE = /（记于 (\d{2})-(\d{2})/;
/** 一天的毫秒数。 */
const DAY_MS = 86400000;
/** 请求体上限。 */
const MAX_BODY_BYTES = 64 * 1024;
/** 超过多少天算「放很久了」。 */
const STALE_DAYS = 30;
/** 默认标签；颜色只用主题变量，跟着明暗主题走。 */
const DEFAULT_TAGS = [
  { id: '工作', color: 'var(--dsw-static-blue-500)' },
  { id: '生活', color: 'var(--dsw-static-green-500)' },
  // 开发刻意不用 deepseek 蓝：和「工作」的蓝几乎同色，6px 的色点上分不出来
  { id: '开发', color: 'color-mix(in srgb, var(--dsw-static-blue-500) 45%, var(--dsw-static-green-500) 55%)' },
  { id: '学习', color: 'var(--dsw-static-amber-500)' },
  { id: '其他', color: 'var(--dsw-static-neutral-500)' },
];
/** 默认认作「等别人回话」的正文开头，可用 config.waitingPattern 改。 */
const DEFAULT_WAITING_RE = /^待/;
/** 没配 todoFile 时的落点：DSH 家目录下的 todo/todo.md。 */
function default_file() {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
  return path.join(home, 'todo', 'todo.md');
}
/** 跨请求串行化的写入队列，避免两个操作互相覆盖。 */
let write_chain = Promise.resolve();

export const name = PACKAGE;
export const inject = ['webServer'];

/** 供本地自测使用；DSH 侧只读 apply / inject / name。 */
export { build_state, parse_todo, toggle_line, set_tag_line, delete_line, restore_line, move_line };

/** 去掉行内元信息与加粗标记，只留给人看的正文。 */
function display_text(raw) {
  const cut = raw.indexOf('（记于');
  const head = cut >= 0 ? raw.slice(0, cut) : raw;
  return head.replace(/\*\*/g, '').trim();
}

/** 拆出行首标签：认得才算标签，认不得原样留在正文里。 */
function split_tag(body, tag_ids) {
  const match = TAG_RE.exec(body);
  if (match === null) return { tag: null, rest: body };
  if (!tag_ids.has(match[1])) return { tag: null, rest: body };
  return { tag: match[1], rest: body.slice(match[0].length) };
}

/** 由「记于 MM-DD」推断年份，跨年时回退一年。 */
function infer_date(month, day, now) {
  let year = now.getFullYear();
  if (month > now.getMonth() + 1) year -= 1;
  const date = new Date(year, month - 1, day);
  if (date.getTime() > now.getTime()) date.setFullYear(year - 1);
  return date;
}

/** 把清单正文解析成条目数组。 */
function parse_todo(markdown, tags = DEFAULT_TAGS, waiting_re = DEFAULT_WAITING_RE) {
  const tag_ids = new Set(tags.map((tag) => tag.id));
  const now = new Date();
  const lines = markdown.split('\n');
  const items = [];
  let section = '';
  let archived = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading !== null) {
      section = heading[1].trim();
      archived = section.includes('已完成');
      continue;
    }
    const match = ITEM_RE.exec(line);
    if (match === null) continue;
    const raw = match[2];
    const { tag, rest } = split_tag(raw, tag_ids);
    const note = NOTE_RE.exec(raw);
    const month = note === null ? null : Number(note[1]);
    const day = note === null ? null : Number(note[2]);
    const date = month === null ? null : infer_date(month, day, now);
    const text = display_text(rest);
    items.push({
      line: index,
      raw,
      tag,
      done: match[1].toLowerCase() === 'x',
      archived,
      section,
      text,
      month,
      day,
      iso: date === null ? null : date.toISOString(),
      age_days: date === null ? null : Math.floor((now.getTime() - date.getTime()) / DAY_MS),
      waiting: waiting_re.test(text),
    });
  }
  return items;
}

/** 读出磁盘上的清单并组装成面板要的完整状态。 */
function build_state(file, tags = DEFAULT_TAGS, waiting_re = DEFAULT_WAITING_RE) {
  const stat = fs.statSync(file);
  const items = parse_todo(fs.readFileSync(file, 'utf8'), tags, waiting_re);
  const open = items.filter((item) => !item.done && !item.archived);
  const finished = items.filter((item) => item.done || item.archived);
  const dated = open.filter((item) => item.age_days !== null);
  const tag_counts = {};
  for (const tag of tags) tag_counts[tag.id] = open.filter((item) => item.tag === tag.id).length;
  return {
    ok: true,
    file,
    updated_at: stat.mtime.toISOString(),
    open_count: open.length,
    done_count: finished.length,
    total_count: open.length + finished.length,
    stale_count: dated.filter((item) => item.age_days > STALE_DAYS).length,
    waiting_count: open.filter((item) => item.waiting).length,
    untagged_count: open.filter((item) => item.tag === null).length,
    tags,
    tag_counts,
    // 未完成条目按文件顺序给出，面板照这个顺序画，拖动改的就是这个顺序
    open_items: open,
    done: finished.slice(-8).reverse().map((item) => ({
      line: item.line,
      text: item.text,
      tag: item.tag,
      month: item.month,
      day: item.day,
    })),
  };
}

/** 先写临时文件再改名，避免写一半断电留下半截清单。 */
function write_atomic(file, content) {
  const dir = path.dirname(file);
  const temp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(temp, content, 'utf8');
  fs.renameSync(temp, file);
}

/** 把任务排进串行队列。 */
function with_lock(task) {
  const run = write_chain.then(task, task);
  write_chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** 构造一个带状态码的业务错误。 */
function http_error(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

/** 读出某一行并核对它仍是客户端看到的那一条。 */
function checked_lines(file, line, raw) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const current = lines[line];
  if (current === undefined) throw http_error(409, 'stale', '清单已经变了，刷新一下');
  const match = ITEM_RE.exec(current);
  if (match === null || match[2] !== raw) throw http_error(409, 'stale', '清单已经变了，刷新一下');
  return { lines, match };
}

/** 勾选／取消勾选。 */
async function toggle_line(file, line, raw, done, tags, waiting_re) {
  return with_lock(async () => {
    const { lines, match } = checked_lines(file, line, raw);
    const is_done = match[1].toLowerCase() === 'x';
    if (is_done !== done) {
      lines[line] = `- [${done ? 'x' : ' '}] ${match[2]}`;
      write_atomic(file, lines.join('\n'));
    }
    return build_state(file, tags, waiting_re);
  });
}

/** 改标签；tag 传 null 表示清掉标签。 */
async function set_tag_line(file, line, raw, tag, tags, waiting_re) {
  const tag_ids = new Set(tags.map((item) => item.id));
  if (tag !== null && !tag_ids.has(tag)) throw http_error(400, 'bad-request', `没有这个标签：${tag}`);
  return with_lock(async () => {
    const { lines, match } = checked_lines(file, line, raw);
    const { rest } = split_tag(match[2], tag_ids);
    const body = tag === null ? rest : `#${tag} ${rest}`;
    const next = `- [${match[1].toLowerCase() === 'x' ? 'x' : ' '}] ${body}`;
    if (next !== lines[line]) {
      lines[line] = next;
      write_atomic(file, lines.join('\n'));
    }
    return build_state(file, tags, waiting_re);
  });
}

/** 删掉一条，返回被删的原文与位置供撤销。 */
async function delete_line(file, line, raw, tags, waiting_re) {
  return with_lock(async () => {
    const { lines } = checked_lines(file, line, raw);
    const removed = lines[line];
    const expected = lines.length - 1;
    lines.splice(line, 1);
    write_atomic(file, lines.join('\n'));
    return { ...build_state(file, tags, waiting_re), removed: { index: line, text: removed, expected_lines: expected } };
  });
}

/** 撤销删除：把原文插回原位。 */
async function restore_line(file, index, text, expected_lines, tags, waiting_re) {
  return with_lock(async () => {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    if (lines.length !== expected_lines) throw http_error(409, 'stale', '清单已经变了，撤销没做');
    if (ITEM_RE.exec(text) === null) throw http_error(400, 'bad-request', '撤销的内容不是一条待办');
    const at = Math.max(0, Math.min(index, lines.length));
    lines.splice(at, 0, text);
    write_atomic(file, lines.join('\n'));
    return build_state(file, tags, waiting_re);
  });
}

/**
 * 换位置：把这一行搬到目标条目前面；before 传 null 表示搬到本节末尾。
 * 只允许在同一节（同一个二级标题下）里搬，跨节会改变条目归属，宁可拒绝。
 */
async function move_line(file, line, raw, before, tags, waiting_re) {
  return with_lock(async () => {
    const { lines } = checked_lines(file, line, raw);
    const items = parse_todo(lines.join('\n'), tags, waiting_re);
    const source = items.find((item) => item.line === line);
    if (source === undefined) throw http_error(400, 'bad-request', '这条不是待办');
    const moved = lines[line];
    const rest = lines.slice(0, line).concat(lines.slice(line + 1));
    const parsed = parse_todo(rest.join('\n'), tags, waiting_re);
    const remaining = parsed.filter((item) => !item.done && !item.archived);
    let at;
    if (before === null) {
      const siblings = remaining.filter((item) => item.section === source.section);
      if (siblings.length === 0) return build_state(file, tags, waiting_re);
      at = siblings[siblings.length - 1].line + 1;
    } else {
      const index = before > line ? before - 1 : before;
      const target = parsed.find((item) => item.line === index);
      if (target === undefined) throw http_error(409, 'stale', '目标位置已经不在了，刷新一下');
      if (target.done || target.archived) throw http_error(400, 'bad-request', '只能拖到未完成条目之间');
      if (target.section !== source.section) throw http_error(400, 'bad-request', '只能在同一节里换位置');
      at = target.line;
    }
    // 搬回原位等于没动，不写文件
    if (at === line) return build_state(file, tags, waiting_re);
    rest.splice(at, 0, moved);
    write_atomic(file, rest.join('\n'));
    return build_state(file, tags, waiting_re);
  });
}

/** 读请求体，超限直接失败。 */
function read_body(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 统一的 JSON 回复。 */
function send_json(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  });
  res.end(body);
}

/** 包一层：校验同源头、解析 JSON、统一错误出口。 */
function post_route(handler) {
  return async (req, res, file, tags, waiting_re) => {
    if (req.headers[`x-${PACKAGE}`] !== '1') {
      send_json(res, 403, { ok: false, code: 'forbidden', error: '缺少同源校验头' });
      return;
    }
    try {
      const payload = JSON.parse(await read_body(req));
      send_json(res, 200, await handler(payload, file, tags, waiting_re));
    } catch (error) {
      const status = typeof error.status === 'number' ? error.status : 500;
      send_json(res, status, { ok: false, code: error.code ?? 'failed', error: error.message });
    }
  };
}

/** GET /state */
function handle_state(req, res, file, tags, waiting_re) {
  try {
    send_json(res, 200, build_state(file, tags, waiting_re));
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : 500;
    const message =
      error.code === 'ENOENT' ? `待办清单不见了：${file}（在 cordis.patch.yml 里配 todoFile 指向你那份清单）` : `读取失败：${error.message}`;
    send_json(res, status, { ok: false, code: error.code ?? 'read-failed', error: message, file });
  }
}

/** 取出并校验行号。 */
function need_line(payload) {
  const line = Number(payload.line);
  if (!Number.isInteger(line) || line < 0) throw http_error(400, 'bad-request', '行号不合法');
  return line;
}

/**
 * 插件入口。
 * @param ctx - 宿主 Cordis 上下文，取 `webServer` 注册路由。
 * @param config - `{ todoFile?: string, tags?: {id, color}[] }`。
 */
/** 读出配置里的等待规则；写错的正则退回默认值，不让整条插件起不来。 */
function waiting_pattern(config) {
  if (config?.waitingPattern === undefined) return DEFAULT_WAITING_RE;
  try {
    return new RegExp(String(config.waitingPattern));
  } catch {
    return DEFAULT_WAITING_RE;
  }
}

/**
 * 插件入口。
 * @param ctx - 宿主 Cordis 上下文，取 `webServer` 注册路由。
 * @param config - `{ todoFile?: string, tags?: {id, color}[], waitingPattern?: string }`。
 */
export function apply(ctx, config) {
  const file = config?.todoFile === undefined ? default_file() : String(config.todoFile);
  const tags = Array.isArray(config?.tags) && config.tags.length > 0 ? config.tags : DEFAULT_TAGS;
  const waiting_re = waiting_pattern(config);
  const routes = {
    state: (req, res) => handle_state(req, res, file, tags, waiting_re),
    toggle: post_route(async (payload, target, list, pattern) => toggle_line(target, need_line(payload), String(payload.raw ?? ''), Boolean(payload.done), list, pattern)),
    tag: post_route(async (payload, target, list, pattern) => set_tag_line(target, need_line(payload), String(payload.raw ?? ''), payload.tag === null || payload.tag === undefined ? null : String(payload.tag), list, pattern)),
    delete: post_route(async (payload, target, list, pattern) => delete_line(target, need_line(payload), String(payload.raw ?? ''), list, pattern)),
    restore: post_route(async (payload, target, list, pattern) => restore_line(target, Number(payload.index), String(payload.text ?? ''), Number(payload.expected_lines), list, pattern)),
    move: post_route(async (payload, target, list, pattern) =>
      move_line(target, need_line(payload), String(payload.raw ?? ''), payload.before === null || payload.before === undefined ? null : need_line({ line: payload.before }), list, pattern),
    ),
  };
  for (const [key, handler] of Object.entries(routes)) {
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path: `${API_PREFIX}/${key}`, handler: (req, res) => handler(req, res, file, tags, waiting_re) }),
      `${PACKAGE}: ${key} route`,
    );
  }
  ctx.logger?.info?.(`[${PACKAGE}] 待办面板已挂载，数据文件：${file}`);
}
