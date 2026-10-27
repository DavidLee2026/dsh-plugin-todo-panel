/**
 * 待办面板 · 浏览器侧
 *
 * 手写的 DSH 客户端插件包：注册右侧栏的一个页面型标签页（kind = "todo"），
 * 外加一个「＋」面板里的入口卡片。数据全部走宿主侧的同源路由。
 *
 * 这个文件不是编译产物，改完直接生效（宿主会按 mtime 重新发一份给浏览器）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-todo-panel',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');
    const { useCallback, useEffect, useRef, useState } = React;
    const h = React.createElement;

    /** 与宿主侧保持一致的路由前缀。 */
    const API = '/dsh-plugin-todo-panel/api';
    /** 标签页与插槽用的标识。 */
    const TAB_ID = 'dsh-plugin-todo-panel';
    const TAB_KIND = 'todo';
    /** 超过这个天数算压了很久。 */
    const STALE_DAYS = 30;
    /** 撤销窗口。 */
    const UNDO_MS = 8000;
    /** 「未分类」筛选用的伪标签。 */
    const NO_TAG = '__none__';

    const CSS = `
.dsh-todo-root {
  box-sizing: border-box;
  height: 100%;
  overflow-y: auto;
  padding: 18px 16px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--dsw-alias-label-primary);
  font-size: var(--dsh-content-font-size, 14px);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.dsh-todo-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dsh-todo-headline { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.dsh-todo-num {
  font-size: 38px; line-height: 1; font-weight: 600;
  letter-spacing: -0.03em; font-variant-numeric: tabular-nums;
}
.dsh-todo-num.is-zero { color: var(--dsw-alias-state-success-primary); }
.dsh-todo-unit { font-size: 13px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dsh-todo-sub { margin-top: 6px; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.dsh-todo-sub b { font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dsh-todo-refresh {
  flex: 0 0 auto; border: none; background: transparent;
  color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 20px;
  padding: 2px 6px; border-radius: var(--dsw-radius-sm); cursor: pointer; font-family: inherit;
}
.dsh-todo-refresh:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-todo-refresh:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dsh-todo-filters { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh-todo-filter {
  display: inline-flex; align-items: center; gap: 5px;
  height: 22px; padding: 0 8px; border-radius: 11px;
  border: 1px solid var(--dsw-alias-border-l3);
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 11px; line-height: 1; font-family: inherit; cursor: pointer;
}
.dsh-todo-filter:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-todo-filter.is-active {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
  color: var(--dsw-alias-label-primary);
}
.dsh-todo-filter:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dsh-todo-filter-count { font-variant-numeric: tabular-nums; opacity: 0.7; }
.dsh-todo-group { display: flex; flex-direction: column; gap: 2px; }
.dsh-todo-group-head {
  display: flex; align-items: center; gap: 6px; padding: 0 6px; margin-bottom: 4px;
  font-size: 11px; line-height: 16px; letter-spacing: 0.04em; color: var(--dsw-alias-label-tertiary);
}
.dsh-todo-group-head.is-stale { color: var(--dsw-alias-state-warn-primary); }
.dsh-todo-count { font-variant-numeric: tabular-nums; opacity: 0.75; }
.dsh-todo-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.dsh-todo-item {
  display: flex; align-items: stretch; gap: 10px;
  padding: 7px 4px 7px 6px; border-radius: var(--dsw-radius-md);
}
.dsh-todo-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-todo-rail { flex: 0 0 auto; width: 2px; border-radius: 1px; background: var(--dsw-alias-border-l3); }
.dsh-todo-rail.is-stale { background: var(--dsw-alias-state-warn-primary); }
.dsh-todo-box {
  flex: 0 0 auto; width: 16px; height: 16px; margin: 3px 0 0; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1.5px solid var(--dsw-alias-border-l3); border-radius: 4px;
  background: transparent; color: var(--dsw-alias-label-primary-foreground); cursor: pointer;
}
.dsh-todo-box:hover { border-color: var(--dsw-alias-brand-primary); }
.dsh-todo-box.is-checked { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.dsh-todo-box:disabled { opacity: 0.5; cursor: default; }
.dsh-todo-box:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.dsh-todo-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 4px; }
.dsh-todo-text { font-size: 13px; line-height: 1.55; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.dsh-todo-item.is-done .dsh-todo-text {
  color: var(--dsw-alias-label-tertiary);
  text-decoration: line-through; text-decoration-thickness: 1px;
}
.dsh-todo-meta {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}
.dsh-todo-flag { color: var(--dsw-alias-state-warn-primary); }
.dsh-todo-wait {
  padding: 0 5px; border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-state-warn-label);
}
.dsh-todo-tag {
  display: inline-flex; align-items: center; gap: 4px;
  height: 18px; padding: 0 6px; border-radius: 9px;
  border: 1px solid color-mix(in srgb, var(--tag-color) 34%, transparent);
  background: color-mix(in srgb, var(--tag-color) 13%, transparent);
  color: color-mix(in srgb, var(--tag-color) 60%, var(--dsw-alias-label-primary));
  font-size: 11px; line-height: 1; font-family: inherit; cursor: pointer;
}
.dsh-todo-tag:hover { border-color: color-mix(in srgb, var(--tag-color) 62%, transparent); }
.dsh-todo-tag.is-empty {
  border-style: dashed; border-color: var(--dsw-alias-border-l3);
  background: transparent; color: var(--dsw-alias-label-tertiary);
  opacity: 0; transition: opacity 120ms ease;
}
.dsh-todo-item:hover .dsh-todo-tag.is-empty,
.dsh-todo-item:focus-within .dsh-todo-tag.is-empty { opacity: 1; }
.dsh-todo-tag:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dsh-todo-picker {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  margin-top: 2px; padding: 8px; border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l3);
}
.dsh-todo-picker-label { font-size: 11px; color: var(--dsw-alias-label-tertiary); margin-right: 2px; }
.dsh-todo-del {
  flex: 0 0 auto; align-self: flex-start; margin-top: 1px;
  width: 20px; height: 20px; padding: 0; border: none; border-radius: var(--dsw-radius-sm);
  background: transparent; color: var(--dsw-alias-label-tertiary);
  font-size: 13px; line-height: 1; cursor: pointer; opacity: 0;
  transition: opacity 120ms ease; font-family: inherit;
}
.dsh-todo-item:hover .dsh-todo-del, .dsh-todo-item:focus-within .dsh-todo-del { opacity: 1; }
.dsh-todo-del:hover { background: var(--dsw-alias-interactive-bg-hover-danger); color: var(--dsw-alias-state-error-primary); }
.dsh-todo-del:focus-visible {
  opacity: 1;
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dsh-todo-empty {
  padding: 28px 8px; text-align: center; display: flex; flex-direction: column; gap: 6px;
}
.dsh-todo-empty-title { font-size: 15px; }
.dsh-todo-empty-note { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dsh-todo-notice {
  padding: 10px 12px; border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l3);
  font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary);
}
.dsh-todo-notice.is-error { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.dsh-todo-notice.is-undo { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.dsh-todo-undo {
  flex: 0 0 auto; border: 1px solid var(--dsw-alias-border-l3); background: transparent;
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 11px;
  height: 24px; padding: 0 10px; border-radius: var(--dsw-radius-sm); cursor: pointer;
}
.dsh-todo-undo:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-todo-notice button.dsh-todo-link {
  margin-top: 8px; border: none; background: transparent; color: var(--dsw-alias-link);
  font: inherit; padding: 0; cursor: pointer; text-decoration: underline;
}
.dsh-todo-skeleton { display: flex; flex-direction: column; gap: 10px; padding: 4px 6px; }
.dsh-todo-bar { height: 12px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); }
.dsh-todo-foot {
  margin-top: auto; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l3);
  font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere;
}
.dsh-todo-done-toggle {
  border: none; background: transparent; padding: 0; font: inherit; font-size: 11px;
  color: var(--dsw-alias-label-tertiary); cursor: pointer; text-align: left;
}
.dsh-todo-done-toggle:hover { color: var(--dsw-alias-label-primary); }
.dsh-todo-done-toggle:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
`;

    /** 只在第一次挂载时注入样式表。 */
    function ensure_style() {
      if (document.getElementById('dsh-plugin-todo-panel-style') !== null) return;
      const style = document.createElement('style');
      style.id = 'dsh-plugin-todo-panel-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    /** 调宿主侧路由，非 2xx 直接抛出可读错误。 */
    async function request(path, init) {
      const headers = { 'x-dsh-plugin-todo-panel': '1' };
      if (init !== undefined && init.body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(API + path, { ...init, headers, cache: 'no-store' });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok || payload === null || payload.ok === false) {
        const error = new Error((payload && payload.error) || `请求失败：HTTP ${response.status}`);
        error.stale = payload !== null && payload.code === 'stale';
        throw error;
      }
      return payload;
    }

    /** MM 或 DD 补零。 */
    function pad2(value) {
      return String(value).padStart(2, '0');
    }

    /** mtime 的 ISO 串 → 本地「MM-DD HH:mm」。 */
    function format_time(iso) {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '未知';
      return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    }

    /** 勾选方块里的对勾。 */
    function CheckMark() {
      return h(
        'svg',
        { viewBox: '0 0 12 12', width: 10, height: 10, fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M1.8 6.2 L4.5 8.9 L10.2 3.2',
          stroke: 'currentColor',
          strokeWidth: 1.9,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    /** 「＋」面板里的入口图标。 */
    function ChecklistIcon(props) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 16,
          height: 16,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          ...props,
        },
        h('path', { d: 'M2.6 4.4 l1.3 1.3 2.3-2.4' }),
        h('path', { d: 'M9 4.6 h4.4' }),
        h('path', { d: 'M2.6 10.4 l1.3 1.3 2.3-2.4' }),
        h('path', { d: 'M9 10.6 h4.4' }),
      );
    }

    /** 骨架屏。 */
    function Skeleton() {
      return h(
        'div',
        { className: 'dsh-todo-skeleton' },
        [92, 78, 86, 62].map((width, index) => h('div', { key: index, className: 'dsh-todo-bar', style: { width: `${width}%` } })),
      );
    }

    /** 标签小胶囊。 */
    function TagChip({ tag, color, on_click }) {
      return h(
        'button',
        {
          type: 'button',
          className: `dsh-todo-tag${tag === null ? ' is-empty' : ''}`,
          style: { '--tag-color': color },
          title: tag === null ? '加标签' : '改标签',
          onClick: on_click,
        },
        tag === null ? '+ 标签' : tag,
      );
    }

    /** 展开的标签选择条。 */
    function TagPicker({ tags, current, on_pick, on_clear }) {
      return h(
        'div',
        { className: 'dsh-todo-picker' },
        h('span', { className: 'dsh-todo-picker-label' }, '归类到'),
        tags.map((tag) =>
          h(
            'button',
            {
              key: tag.id,
              type: 'button',
              className: `dsh-todo-tag${current === tag.id ? '' : ''}`,
              style: { '--tag-color': tag.color, opacity: current === tag.id ? 1 : 0.82 },
              onClick: () => on_pick(tag.id),
            },
            tag.id,
          ),
        ),
        current === null
          ? null
          : h('button', { type: 'button', className: 'dsh-todo-filter', onClick: on_clear }, '清除标签'),
      );
    }

    /** 一条待办。 */
    function TodoRow({ item, tags, pending, picker_open, on_toggle, on_tag, on_delete, on_picker }) {
      const stale = item.age_days !== null && item.age_days > STALE_DAYS;
      const tag_color = item.tag === null ? 'transparent' : tags.find((tag) => tag.id === item.tag)?.color ?? 'transparent';
      return h(
        'li',
        { className: `dsh-todo-item${item.done ? ' is-done' : ''}` },
        h('span', { className: `dsh-todo-rail${stale ? ' is-stale' : ''}`, 'aria-hidden': true }),
        h(
          'button',
          {
            type: 'button',
            role: 'checkbox',
            'aria-checked': item.done,
            'aria-label': item.text,
            title: item.done ? '标记为未完成' : '标记为完成',
            className: `dsh-todo-box${item.done ? ' is-checked' : ''}`,
            disabled: pending,
            onClick: () => on_toggle(item, !item.done),
          },
          item.done ? h(CheckMark) : null,
        ),
        h(
          'div',
          { className: 'dsh-todo-main' },
          h('div', { className: 'dsh-todo-text' }, item.text),
          h(
            'div',
            { className: 'dsh-todo-meta' },
            h(TagChip, { tag: item.tag, color: tag_color, on_click: () => on_picker(item.line) }),
            item.month === null ? null : h('span', null, `记于 ${pad2(item.month)}-${pad2(item.day)}`),
            stale ? h('span', { className: 'dsh-todo-flag' }, `放了 ${item.age_days} 天`) : null,
            item.waiting ? h('span', { className: 'dsh-todo-wait' }, '待确认') : null,
          ),
          picker_open
            ? h(TagPicker, {
                tags,
                current: item.tag,
                on_pick: (tag) => on_tag(item, tag),
                on_clear: () => on_tag(item, null),
              })
            : null,
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-todo-del',
            title: '删除这条',
            'aria-label': `删除：${item.text}`,
            disabled: pending,
            onClick: () => on_delete(item),
          },
          '✕',
        ),
      );
    }

    /** 整块面板。 */
    function TodoPanel() {
      const [state, set_state] = useState({ status: 'loading', data: null, error: null });
      const [pending_lines, set_pending] = useState(() => []);
      const [error_note, set_error_note] = useState(null);
      const [show_done, set_show_done] = useState(false);
      const [filter, set_filter] = useState(null);
      const [picker_line, set_picker_line] = useState(null);
      const [undo, set_undo] = useState(null);
      const alive = useRef(true);
      const undoTimer = useRef(null);

      useEffect(
        () => () => {
          alive.current = false;
          if (undoTimer.current !== null) clearTimeout(undoTimer.current);
        },
        [],
      );

      const load = useCallback(async (quiet) => {
        if (quiet !== true) {
          set_state((previous) => ({ ...previous, status: previous.data === null ? 'loading' : 'ready' }));
        }
        try {
          const data = await request('/state');
          if (!alive.current) return;
          set_state({ status: 'ready', data, error: null });
        } catch (error) {
          if (!alive.current) return;
          set_state((previous) => ({ status: previous.data === null ? 'error' : 'ready', data: previous.data, error: error.message }));
        }
      }, []);

      useEffect(() => {
        load(false);
      }, [load]);

      useEffect(() => {
        const timer = setInterval(() => load(true), 60000);
        return () => clearInterval(timer);
      }, [load]);

      /** 统一的写操作：乐观展示 → 请求 → 用服务端返回值覆盖。 */
      const mutate = useCallback(
        async (item, path, body, fallback) => {
          set_pending((previous) => [...previous, item.line]);
          set_error_note(null);
          try {
            const data = await request(path, { method: 'POST', body: JSON.stringify(body) });
            if (!alive.current) return null;
            set_state({ status: 'ready', data, error: null });
            return data;
          } catch (error) {
            if (!alive.current) return null;
            set_error_note(error.stale ? '清单刚被改过，已经重新读取。' : error.message);
            if (error.stale) await load(true);
            if (fallback !== undefined) fallback();
            return null;
          } finally {
            if (alive.current) set_pending((previous) => previous.filter((line) => line !== item.line));
          }
        },
        [load],
      );

      const toggle = useCallback(
        (item, next) => mutate(item, '/toggle', { line: item.line, raw: item.raw, done: next }),
        [mutate],
      );

      const set_tag = useCallback(
        async (item, tag) => {
          set_picker_line(null);
          await mutate(item, '/tag', { line: item.line, raw: item.raw, tag });
        },
        [mutate],
      );

      const remove = useCallback(
        async (item) => {
          set_picker_line(null);
          const data = await mutate(item, '/delete', { line: item.line, raw: item.raw });
          if (data === null || data.removed === undefined || !alive.current) return;
          if (undoTimer.current !== null) clearTimeout(undoTimer.current);
          set_undo({ removed: data.removed, text: item.text });
          undoTimer.current = setTimeout(() => {
            if (alive.current) set_undo(null);
          }, UNDO_MS);
        },
        [mutate],
      );

      const undo_delete = useCallback(async () => {
        if (undo === null) return;
        const removed = undo.removed;
        set_undo(null);
        if (undoTimer.current !== null) clearTimeout(undoTimer.current);
        set_pending((previous) => [...previous, removed.index]);
        try {
          const data = await request('/restore', {
            method: 'POST',
            body: JSON.stringify({ index: removed.index, text: removed.text, expected_lines: removed.expected_lines }),
          });
          if (alive.current) set_state({ status: 'ready', data, error: null });
        } catch (error) {
          if (!alive.current) return;
          set_error_note(error.stale ? '清单刚被改过，撤销没做，已重新读取。' : error.message);
          await load(true);
        } finally {
          if (alive.current) set_pending((previous) => previous.filter((line) => line !== removed.index));
        }
      }, [undo, load]);

      const data = state.data;
      const tags = data === null ? [] : data.tags;
      const open_count = data === null ? 0 : data.open_count;

      /** 是否被当前筛选命中。 */
      const matches = (item) => {
        if (filter === null) return true;
        if (filter === NO_TAG) return item.tag === null;
        return item.tag === filter;
      };

      const filtered_count =
        data === null
          ? 0
          : data.groups.reduce((total, group) => total + group.items.filter(matches).length, 0);

      const head = h(
        'div',
        { className: 'dsh-todo-head' },
        h(
          'div',
          { style: { minWidth: 0 } },
          h(
            'div',
            { className: 'dsh-todo-headline' },
            h('span', { className: `dsh-todo-num${open_count === 0 && data !== null ? ' is-zero' : ''}` }, String(open_count)),
            h('span', { className: 'dsh-todo-unit' }, '件事没做'),
          ),
          h(
            'div',
            { className: 'dsh-todo-sub' },
            data === null
              ? '正在读取清单'
              : filter !== null
                ? `正在只看「${filter === NO_TAG ? '未分类' : filter}」，${filtered_count} 件`
                : data.stale_count > 0
                  ? h('span', null, '其中 ', h('b', null, String(data.stale_count)), ` 件放了超过 ${STALE_DAYS} 天`)
                  : '没有压很久的事',
          ),
        ),
        h('button', { type: 'button', className: 'dsh-todo-refresh', onClick: () => load(false) }, '刷新'),
      );

      const filters =
        data === null
          ? null
          : h(
              'div',
              { className: 'dsh-todo-filters' },
              h(
                'button',
                { type: 'button', className: `dsh-todo-filter${filter === null ? ' is-active' : ''}`, onClick: () => set_filter(null) },
                '全部',
                h('span', { className: 'dsh-todo-filter-count' }, String(open_count)),
              ),
              tags
                .filter((tag) => (data.tag_counts[tag.id] ?? 0) > 0)
                .map((tag) =>
                  h(
                    'button',
                    {
                      key: tag.id,
                      type: 'button',
                      className: `dsh-todo-filter${filter === tag.id ? ' is-active' : ''}`,
                      onClick: () => set_filter(filter === tag.id ? null : tag.id),
                    },
                    tag.id,
                    h('span', { className: 'dsh-todo-filter-count' }, String(data.tag_counts[tag.id] ?? 0)),
                  ),
                ),
              data.untagged_count > 0
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: `dsh-todo-filter${filter === NO_TAG ? ' is-active' : ''}`,
                      onClick: () => set_filter(filter === NO_TAG ? null : NO_TAG),
                    },
                    '未分类',
                    h('span', { className: 'dsh-todo-filter-count' }, String(data.untagged_count)),
                  )
                : null,
            );

      let body = null;
      if (state.status === 'loading') {
        body = h(Skeleton);
      } else if (state.status === 'error') {
        body = h(
          'div',
          { className: 'dsh-todo-notice is-error' },
          state.error || '读取失败',
          h('br'),
          h('button', { type: 'button', className: 'dsh-todo-link', onClick: () => load(false) }, '重试'),
        );
      } else if (data !== null && data.open_count === 0) {
        body = h(
          'div',
          { className: 'dsh-todo-empty' },
          h('div', { className: 'dsh-todo-empty-title' }, '清单清空了'),
          h('div', { className: 'dsh-todo-empty-note' }, '今天没有压着的事。'),
        );
      } else if (data !== null && filtered_count === 0) {
        body = h(
          'div',
          { className: 'dsh-todo-empty' },
          h('div', { className: 'dsh-todo-empty-title' }, '这一类里没有事'),
          h('div', { className: 'dsh-todo-empty-note' }, '换个标签，或者点「全部」看回去。'),
        );
      } else if (data !== null) {
        body = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
          data.groups
            .filter((group) => group.items.some(matches))
            .map((group) =>
              h(
                'section',
                { className: 'dsh-todo-group', key: group.key },
                h(
                  'div',
                  { className: `dsh-todo-group-head${group.key === 'stale' ? ' is-stale' : ''}` },
                  h('span', null, group.label),
                  h('span', { className: 'dsh-todo-count' }, String(group.items.filter(matches).length)),
                ),
                h(
                  'ul',
                  { className: 'dsh-todo-list' },
                  group.items.filter(matches).map((item) =>
                    h(TodoRow, {
                      key: item.line,
                      item,
                      tags,
                      pending: pending_lines.includes(item.line),
                      picker_open: picker_line === item.line,
                      on_toggle: toggle,
                      on_tag: set_tag,
                      on_delete: remove,
                      on_picker: (line) => set_picker_line(picker_line === line ? null : line),
                    }),
                  ),
                ),
              ),
            ),
          data.done.length === 0
            ? null
            : h(
                'div',
                { className: 'dsh-todo-group' },
                h(
                  'button',
                  { type: 'button', className: 'dsh-todo-done-toggle', onClick: () => set_show_done((value) => !value) },
                  `${show_done ? '收起' : '展开'}最近完成（${data.done.length}）`,
                ),
                show_done
                  ? h(
                      'ul',
                      { className: 'dsh-todo-list', style: { marginTop: 6 } },
                      data.done.map((item) =>
                        h(
                          'li',
                          { className: 'dsh-todo-item is-done', key: item.line },
                          h('span', { className: 'dsh-todo-rail', 'aria-hidden': true }),
                          h('span', { className: 'dsh-todo-box is-checked', 'aria-hidden': true }, h(CheckMark)),
                          h('div', { className: 'dsh-todo-main' }, h('div', { className: 'dsh-todo-text' }, item.text)),
                        ),
                      ),
                    )
                  : null,
              ),
        );
      }

      return h(
        'div',
        { className: 'dsh-todo-root' },
        head,
        filters,
        undo === null
          ? null
          : h(
              'div',
              { className: 'dsh-todo-notice is-undo' },
              h('span', null, `已删除：${undo.text.length > 22 ? `${undo.text.slice(0, 22)}…` : undo.text}`),
              h('button', { type: 'button', className: 'dsh-todo-undo', onClick: undo_delete }, '撤销'),
            ),
        error_note === null ? null : h('div', { className: 'dsh-todo-notice' }, error_note),
        body,
        data === null
          ? null
          : h(
              'div',
              { className: 'dsh-todo-foot', title: data.file },
              `数据来自 ${String(data.file ?? '').split(/[\\/]/).pop()}　最后改动 ${format_time(data.updated_at)}`,
            ),
      );
    }

    /** 标签页类型定义。 */
    function tab_definition() {
      return {
        id: TAB_ID,
        kind: TAB_KIND,
        priority: 'extension',
        title: () => '待办',
        guide: [
          {
            id: 'todo',
            order: 20,
            title: () => '待办',
            description: () => '还有几件事没做，一眼看清',
            icon: ChecklistIcon,
          },
        ],
      };
    }

    /** 客户端插件主体。 */
    function apply(ctx) {
      ensure_style();
      ctx.effect(() => ctx.sidebarRightTabs.register(tab_definition()), 'dsh-plugin-todo-panel: tab type');
      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, TodoPanel),
          ),
        'dsh-plugin-todo-panel: tab body',
      );
    }

    exports.apply = apply;
    exports.inject = ['slots', 'sidebarRightTabs'];
    return module.exports;
  },
});
