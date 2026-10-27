/**
 * 集成自测：用假 ctx 挂上真实插件，拿 examples/todo.md 的副本当数据文件，
 * 验证勾选、打标签、换标签、清标签、删除、撤销都只动该动的那一行，
 * 并且原文或行数对不上时一律拒绝。
 *
 * 跑法：node --test test/
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.join(HERE, '..', 'lib', 'index.js');
const SAMPLE = path.join(HERE, '..', 'examples', 'todo.md');
const PREFIX = '/dsh-plugin-todo-panel/api';
const HEADER = { 'x-dsh-plugin-todo-panel': '1' };

const plugin = await import(PLUGIN);

/** 造一个假请求。 */
function make_req(body, headers) {
  const req = new EventEmitter();
  req.method = body === undefined ? 'GET' : 'POST';
  req.headers = headers;
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(body, 'utf8'));
    req.emit('end');
  });
  return req;
}

/** 造一个假响应，拿回状态码与正文。 */
function make_res() {
  const res = {
    status: 0,
    body: '',
    writeHead(status) {
      res.status = status;
    },
    end(chunk) {
      res.body = chunk === undefined ? '' : Buffer.from(chunk).toString('utf8');
    },
  };
  return res;
}

/** 挂一份独立的清单副本，返回调用入口。用完自动清理。 */
function make_panel(t) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-todo-test-'));
  const file = path.join(workdir, 'todo.md');
  fs.copyFileSync(SAMPLE, file);
  const original = fs.readFileSync(file, 'utf8');
  const routes = new Map();
  plugin.apply(
    {
      effect(fn) {
        fn();
      },
      webServer: {
        register(route) {
          routes.set(route.path, route.handler);
          return () => routes.delete(route.path);
        },
      },
      logger: { info() {} },
    },
    { todoFile: file },
  );
  t.after(() => fs.rmSync(workdir, { recursive: true, force: true }));
  /** 调一个路由并等它结束。 */
  async function call(route, payload, headers = HEADER) {
    assert.ok(routes.has(`${PREFIX}/${route}`), `缺少路由 ${route}`);
    const res = make_res();
    routes.get(`${PREFIX}/${route}`)(make_req(payload === undefined ? undefined : JSON.stringify(payload), headers), res);
    for (let i = 0; i < 200 && res.status === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.notEqual(res.status, 0, `${route} 没有响应`);
    return { status: res.status, json: res.body === '' ? null : JSON.parse(res.body) };
  }
  return { file, original, call, read: () => fs.readFileSync(file, 'utf8') };
}

/** 逐行比较，返回改动过的行数。 */
function changed_lines(left, right) {
  const a = left.split('\n');
  const b = right.split('\n');
  let touched = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) if (a[i] !== b[i]) touched += 1;
  return touched;
}

/** 从状态里按正文找到某一条。 */
function find_item(state, prefix_text) {
  const items = state.groups.flatMap((group) => group.items);
  const found = items.find((item) => item.text.startsWith(prefix_text));
  assert.ok(found, `清单里应有一条以「${prefix_text}」开头的待办`);
  return found;
}

test('读取：件数、标签、等待件数都对得上', async (t) => {
  const panel = make_panel(t);
  const state = await panel.call('state');
  assert.equal(state.status, 200, 'state 应返回 200');
  assert.equal(state.json.tags.length, 5, '默认 5 个标签');
  assert.equal(state.json.open_count, 3, '示例里有 3 条未完成');
  assert.equal(state.json.waiting_count, 1, '「待确认」开头的那条算等回话');
  assert.equal(state.json.untagged_count, 1, '只有一条没有标签');
  assert.equal(state.json.tag_counts['工作'], 1);
  assert.equal(state.json.tag_counts['生活'], 1);
  assert.equal(state.json.done.length, 1, '近期完成里有一条');
});

test('勾选：只改目标行，取消后与原文件逐字相同', async (t) => {
  const panel = make_panel(t);
  const state = await panel.call('state');
  const item = find_item(state.json, '把这周的会议记录');
  assert.equal(item.tag, '工作');

  const done = await panel.call('toggle', { line: item.line, raw: item.raw, done: true });
  assert.equal(done.status, 200, '勾选应成功');
  assert.equal(done.json.open_count, 2, '勾掉一件后应少一件');
  assert.equal(panel.read().split('\n')[item.line], `- [x] ${item.raw}`, '该行应变成已完成');
  assert.equal(changed_lines(panel.original, panel.read()), 1, '只应改动一行');

  const undone = await panel.call('toggle', { line: item.line, raw: item.raw, done: false });
  assert.equal(undone.json.open_count, 3, '取消后应回到原来的件数');
  assert.equal(panel.read(), panel.original, '取消勾选后应与原文件逐字相同');
});

test('打标签：加、换、清都只动行首前缀', async (t) => {
  const panel = make_panel(t);
  const state = await panel.call('state');
  const item = find_item(state.json, '待确认：报价单要不要');
  const bare = item.raw;

  const tagged = await panel.call('tag', { line: item.line, raw: bare, tag: '开发' });
  assert.equal(tagged.status, 200, '打标签应成功');
  assert.equal(panel.read().split('\n')[item.line], `- [ ] #开发 ${bare}`, '该行应带上行首标签');
  assert.equal(tagged.json.tag_counts['开发'], 1, '开发 应计 1 件');
  assert.equal(tagged.json.untagged_count, 0, '未分类应清零');
  assert.equal(changed_lines(panel.original, panel.read()), 1, '只应改动一行');

  const retagged = await panel.call('tag', { line: item.line, raw: `#开发 ${bare}`, tag: '工作' });
  assert.equal(panel.read().split('\n')[item.line], `- [ ] #工作 ${bare}`, '换标签应替换而不是叠加');
  assert.equal(retagged.json.tag_counts['开发'], 0, '开发 应清零');

  const bad_tag = await panel.call('tag', { line: item.line, raw: `#工作 ${bare}`, tag: '不存在的标签' });
  assert.equal(bad_tag.status, 400, '未知标签应返回 400');

  const cleared = await panel.call('tag', { line: item.line, raw: `#工作 ${bare}`, tag: null });
  assert.equal(cleared.status, 200, '清标签应成功');
  assert.equal(panel.read(), panel.original, '清掉标签后应与原文件逐字相同');
});

test('删除与撤销：撤销靠行数核对，对不上就拒绝', async (t) => {
  const panel = make_panel(t);
  const state = await panel.call('state');
  const item = find_item(state.json, '预约体检');
  const before_lines = panel.read().split('\n').length;

  const removed = await panel.call('delete', { line: item.line, raw: item.raw });
  assert.equal(removed.status, 200, '删除应成功');
  assert.equal(removed.json.open_count, 2, '删除后应少一件');
  assert.equal(removed.json.removed.index, item.line, '应回报删除位置');
  assert.equal(removed.json.removed.text, `- [ ] ${item.raw}`, '应回报被删原文');
  assert.equal(panel.read().split('\n').length, before_lines - 1, '应少一行');

  const restored = await panel.call('restore', {
    index: removed.json.removed.index,
    text: removed.json.removed.text,
    expected_lines: removed.json.removed.expected_lines,
  });
  assert.equal(restored.status, 200, '撤销应成功');
  assert.equal(restored.json.open_count, 3, '撤销后件数应回到原值');
  assert.equal(panel.read(), panel.original, '撤销后应与原文件逐字相同');

  const refused = await panel.call('restore', { index: 0, text: `- [ ] ${item.raw}`, expected_lines: 999 });
  assert.equal(refused.status, 409, '行数不符时应拒绝撤销');
});

test('守卫：原文不符 409，缺同源校验头 403，文件缺失 404', async (t) => {
  const panel = make_panel(t);
  const state = await panel.call('state');
  const item = find_item(state.json, '把这周的会议记录');

  const stale = await panel.call('toggle', { line: item.line, raw: '对不上的内容', done: true });
  assert.equal(stale.status, 409, '原文不符应返回 409');

  const forbidden = await panel.call('toggle', { line: item.line, raw: item.raw, done: true }, {});
  assert.equal(forbidden.status, 403, '缺校验头应返回 403');

  fs.rmSync(panel.file);
  const missing = await panel.call('state');
  assert.equal(missing.status, 404, '文件缺失应返回 404');
  assert.match(missing.json.error, /todoFile/, '报错要说清楚怎么配路径');
});

test('配置：标签集合与等待规则可以由 config 覆盖', async (t) => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-todo-cfg-'));
  const file = path.join(workdir, 'todo.md');
  fs.copyFileSync(SAMPLE, file);
  const routes = new Map();
  plugin.apply(
    {
      effect(fn) {
        fn();
      },
      webServer: {
        register(route) {
          routes.set(route.path, route.handler);
          return () => routes.delete(route.path);
        },
      },
      logger: { info() {} },
    },
    {
      todoFile: file,
      waitingPattern: '^待确认',
      tags: [
        { id: '甲', color: 'var(--dsw-static-blue-500)' },
        { id: '乙', color: 'var(--dsw-static-green-500)' },
      ],
    },
  );
  t.after(() => fs.rmSync(workdir, { recursive: true, force: true }));

  const res = make_res();
  routes.get(`${PREFIX}/state`)(make_req(undefined, HEADER), res);
  for (let i = 0; i < 200 && res.status === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  const json = JSON.parse(res.body);
  assert.deepEqual(json.tags.map((tag) => tag.id), ['甲', '乙'], '标签应改用配置里的集合');
  assert.equal(json.waiting_count, 1, '自定义等待规则也应生效');
});

test('默认落点：没配 todoFile 时落在 DSH 家目录的 todo/todo.md', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-todo-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const routes = new Map();
  plugin.apply(
    {
      effect(fn) {
        fn();
      },
      webServer: {
        register(route) {
          routes.set(route.path, route.handler);
          return () => routes.delete(route.path);
        },
      },
      logger: { info() {} },
    },
    {},
  );
  const res = make_res();
  routes.get(`${PREFIX}/state`)(make_req(undefined, HEADER), res);
  for (let i = 0; i < 200 && res.status === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  if (previous === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previous;
  assert.equal(res.status, 404, '默认文件不存在时应返回 404');
  assert.ok(
    JSON.parse(res.body).file.endsWith(path.join('todo', 'todo.md')),
    '默认路径应是 <DSH_HOME>/todo/todo.md',
  );
});
