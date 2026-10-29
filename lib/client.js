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
.dsh-todo-hero { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.dsh-todo-stat { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.dsh-todo-stat.is-done { justify-content: flex-end; }
.dsh-todo-num {
  font-size: 38px; line-height: 1; font-weight: 600;
  letter-spacing: -0.03em; font-variant-numeric: tabular-nums;
}
.dsh-todo-num.is-zero { color: var(--dsw-alias-state-success-primary); }
.dsh-todo-num.is-done {
  color: var(--dsw-alias-state-success-primary);
  animation: dsh-todo-pop 260ms cubic-bezier(0.2, 0.9, 0.3, 1);
}
.dsh-todo-unit { font-size: 13px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dsh-todo-header { display: flex; flex-direction: column; gap: 6px; }
.dsh-todo-sub { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
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
/* 完成度：一张窄卡片，唯一一个用品牌蓝上色的块 */
.dsh-todo-progress {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px 12px 11px; border-radius: var(--dsw-radius-md);
  border: 1px solid var(--dsw-alias-border-l3);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-base));
}
.dsh-todo-progress-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.dsh-todo-progress-label {
  font-size: 11px; line-height: 16px; letter-spacing: 0.03em;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-todo-progress-pct {
  font-size: 13px; line-height: 1; font-weight: 600; letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-state-business-primary);
}
.dsh-todo-progress-track {
  position: relative; height: 6px; border-radius: 999px; overflow: hidden;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 11%, transparent);
}
.dsh-todo-progress-fill {
  height: 100%; width: var(--todo-fill, 0%); border-radius: 999px;
  background: linear-gradient(90deg, var(--dsw-alias-state-business-primary), var(--dsw-alias-state-success-primary));
  transition: width 420ms cubic-bezier(0.22, 0.61, 0.36, 1);
}
@keyframes dsh-todo-pop {
  from { transform: scale(1.22); opacity: 0.5; }
  to { transform: scale(1); opacity: 1; }
}
.dsh-todo-filters { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh-todo-filter {
  display: inline-flex; align-items: center; gap: 6px;
  height: 24px; padding: 0 9px; border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l3);
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 11px; line-height: 1; font-family: inherit; cursor: pointer;
}
.dsh-todo-filter:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-todo-filter.is-active {
  border-color: color-mix(in srgb, var(--dsw-alias-label-primary) 38%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}
.dsh-todo-filter.is-tagged {
  border-color: color-mix(in srgb, var(--tag-color) 34%, transparent);
  background: color-mix(in srgb, var(--tag-color) 8%, transparent);
  color: color-mix(in srgb, var(--tag-color) 38%, var(--dsw-alias-label-primary));
}
.dsh-todo-filter.is-tagged:hover {
  background: color-mix(in srgb, var(--tag-color) 14%, transparent);
  border-color: color-mix(in srgb, var(--tag-color) 52%, transparent);
  color: color-mix(in srgb, var(--tag-color) 28%, var(--dsw-alias-label-primary));
}
.dsh-todo-filter.is-tagged.is-active {
  border-color: color-mix(in srgb, var(--tag-color) 62%, transparent);
  background: color-mix(in srgb, var(--tag-color) 18%, transparent);
  color: color-mix(in srgb, var(--tag-color) 22%, var(--dsw-alias-label-primary));
}
.dsh-todo-filter:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dsh-todo-filter-count { font-variant-numeric: tabular-nums; opacity: 0.72; font-weight: 400; }
/* 标签色点：筛选条与胶囊共用，靠 --tag-color 上色 */
.dsh-todo-dot {
  flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%;
  background: var(--tag-color, currentColor);
}
.dsh-todo-dot.is-hollow {
  background: transparent;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tag-color, currentColor) 72%, transparent);
}
.dsh-todo-group { display: flex; flex-direction: column; gap: 2px; }
.dsh-todo-group + .dsh-todo-group {
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding-top: 12px;
}
.dsh-todo-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.dsh-todo-item {
  display: flex; align-items: stretch; gap: 10px;
  padding: 7px 4px 7px 6px; border-radius: var(--dsw-radius-md);
  cursor: grab;
}
.dsh-todo-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-todo-item.is-dragging {
  cursor: grabbing; opacity: 0.45;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent);
}
/* 拖动中：落点用一条内阴影线标出来，压在哪条上就画在哪条的上边
   放在最末尾时画在下边 */
.dsh-todo-item.is-drop-before { box-shadow: inset 0 2px 0 var(--dsw-alias-state-business-primary); }
.dsh-todo-item.is-drop-after { box-shadow: inset 0 -2px 0 var(--dsw-alias-state-business-primary); }
.dsh-todo-root.is-dragging { user-select: none; -webkit-user-select: none; }
.dsh-todo-root.is-dragging .dsh-todo-item:hover { background: transparent; }
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
  display: inline-flex; align-items: center; gap: 5px;
  height: 19px; padding: 0 8px 0 6px; border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--tag-color) 36%, transparent);
  background: color-mix(in srgb, var(--tag-color) 15%, transparent);
  color: color-mix(in srgb, var(--tag-color) 54%, var(--dsw-alias-label-primary));
  font-size: 11px; line-height: 1; font-family: inherit; font-weight: 500; cursor: pointer;
}
.dsh-todo-tag:hover {
  border-color: color-mix(in srgb, var(--tag-color) 66%, transparent);
  background: color-mix(in srgb, var(--tag-color) 22%, transparent);
}
.dsh-todo-tag.is-current {
  border-color: color-mix(in srgb, var(--tag-color) 72%, transparent);
  background: color-mix(in srgb, var(--tag-color) 24%, transparent);
  color: color-mix(in srgb, var(--tag-color) 32%, var(--dsw-alias-label-primary));
  font-weight: 600;
}
.dsh-todo-tag.is-empty {
  border-style: dashed; border-color: var(--dsw-alias-border-l3);
  background: transparent; color: var(--dsw-alias-label-tertiary);
  font-weight: 400;
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
.dsh-todo-empty-mark {
  align-self: center; width: 30px; height: 30px; margin-bottom: 2px;
  display: inline-flex; align-items: center; justify-content: center; border-radius: 50%;
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 15%, transparent);
  color: var(--dsw-alias-state-success-primary);
}
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
  font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-tertiary);
  display: flex; flex-direction: column; gap: 2px;
}
.dsh-todo-foot-line { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.dsh-todo-foot-text { min-width: 0; overflow-wrap: anywhere; }
.dsh-todo-hint { opacity: 0.85; }
.dsh-todo-done-toggle {
  border: none; background: transparent; padding: 0; font: inherit; font-size: 11px;
  color: var(--dsw-alias-label-tertiary); cursor: pointer; text-align: left;
}
.dsh-todo-done-toggle:hover { color: var(--dsw-alias-label-primary); }
.dsh-todo-done-toggle:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
@keyframes dsh-todo-check-in {
  from { transform: scale(0.45); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
.dsh-todo-box.is-checked svg { animation: dsh-todo-check-in 180ms cubic-bezier(0.2, 0.9, 0.3, 1); }
@media (prefers-reduced-motion: reduce) {
  .dsh-todo-progress-fill { transition: none; }
  .dsh-todo-box.is-checked svg { animation: none; }
  .dsh-todo-num.is-done { animation: none; }
  .dsh-todo-tag.is-empty, .dsh-todo-del { transition: none; }
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
    function CheckMark({ size = 10 }) {
      return h(
        'svg',
        { viewBox: '0 0 12 12', width: size, height: size, fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M1.8 6.2 L4.5 8.9 L10.2 3.2',
          stroke: 'currentColor',
          strokeWidth: 1.9,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    /** 从配置里取标签色；认不得就退回弱文字色，不写死色值。 */
    function tag_color(tags, id) {
      if (id === null) return 'var(--dsw-alias-label-tertiary)';
      const found = tags.find((tag) => tag.id === id);
      return found === undefined ? 'var(--dsw-alias-label-tertiary)' : found.color;
    }

    /** 标签色点；空心的是「没有标签」。 */
    function ColorDot({ hollow }) {
      return h('span', { className: `dsh-todo-dot${hollow ? ' is-hollow' : ''}`, 'aria-hidden': true });
    }

    /** 完成度：全清单「已完成 / 总数」，唯一用品牌蓝上色的块。 */
    function Progress({ done_total, total }) {
      const percent = total > 0 ? Math.round((done_total / total) * 100) : 0;
      return h(
        'div',
        {
          className: 'dsh-todo-progress',
          role: 'progressbar',
          'aria-valuemin': 0,
          'aria-valuemax': 100,
          'aria-valuenow': percent,
          'aria-valuetext': `已完成 ${done_total} / 共 ${total} 件`,
          'aria-label': '清单完成度',
        },
        h(
          'div',
          { className: 'dsh-todo-progress-top' },
          h('span', { className: 'dsh-todo-progress-label' }, '清单完成度'),
          h('span', { className: 'dsh-todo-progress-pct' }, `${percent}%`),
        ),
        h(
          'div',
          { className: 'dsh-todo-progress-track' },
          h('div', { className: 'dsh-todo-progress-fill', style: { '--todo-fill': `${percent}%` } }),
        ),
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
      const empty = tag === null;
      return h(
        'button',
        {
          type: 'button',
          className: `dsh-todo-tag${empty ? ' is-empty' : ''}`,
          style: { '--tag-color': empty ? 'var(--dsw-alias-label-tertiary)' : color },
          title: empty ? '加标签' : '改标签',
          onClick: on_click,
        },
        h(ColorDot, { hollow: empty }),
        empty ? '标签' : tag,
      );
    }

    /** 展开的标签选择条。 */
    function TagPicker({ tags, current, on_pick, on_clear }) {
      return h(
        'div',
        { className: 'dsh-todo-picker' },
        h('span', { className: 'dsh-todo-picker-label' }, '归类到'),
        tags.map((tag) => {
          const active = current === tag.id;
          return h(
            'button',
            {
              key: tag.id,
              type: 'button',
              className: `dsh-todo-tag${active ? ' is-current' : ''}`,
              style: { '--tag-color': tag.color },
              onClick: () => on_pick(tag.id),
            },
            h(ColorDot, { hollow: false }),
            tag.id,
            active ? h(CheckMark, { size: 9 }) : null,
          );
        }),
        current === null
          ? null
          : h('button', { type: 'button', className: 'dsh-todo-filter', onClick: on_clear }, '清除标签'),
      );
    }

    /** 一条待办。 */
    function TodoRow({ item, tags, pending, picker_open, dragging, drop_before, drop_after, on_toggle, on_tag, on_delete, on_picker, on_grab }) {
      const stale = item.age_days !== null && item.age_days > STALE_DAYS;
      const color = tag_color(tags, item.tag);
      const drop_class = drop_before ? ' is-drop-before' : drop_after ? ' is-drop-after' : '';
      const grabbable = typeof on_grab === 'function';
      return h(
        'li',
        {
          className: `dsh-todo-item${item.done ? ' is-done' : ''}${dragging ? ' is-dragging' : ''}${drop_class}`,
          'data-todo-line': item.line,
          'data-todo-section': item.section,
          title: grabbable ? '按住拖动可以上下调位置' : undefined,
          onPointerDown: grabbable ? (event) => on_grab(event, item) : undefined,
        },
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
            h(TagChip, { tag: item.tag, color, on_click: () => on_picker(item.line) }),
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
      const root_ref = useRef(null);
      const drag_ref = useRef(null);
      const [dragging_line, set_dragging_line] = useState(null);
      const [drop_slot, set_drop_slot] = useState(null);

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

      /** 结束拖动：commit 为真才真的写回文件。 */
      const end_drag = useCallback(
        (commit) => {
          const drag = drag_ref.current;
          if (drag === null) return;
          drag_ref.current = null;
          if (drag.timer !== null) clearTimeout(drag.timer);
          if (drag.frame !== null) cancelAnimationFrame(drag.frame);
          window.removeEventListener('pointermove', drag.move);
          window.removeEventListener('pointerup', drag.up);
          window.removeEventListener('pointercancel', drag.cancel);
          window.removeEventListener('keydown', drag.key);
          set_dragging_line(null);
          set_drop_slot(null);
          if (!drag.active || !commit) return;
          const slot = drag.slot;
          if (slot === null) return;
          if (slot.before === drag.item.line) return;
          mutate(drag.item, '/move', { line: drag.item.line, raw: drag.item.raw, before: slot.before });
        },
        [mutate],
      );

      /** 按住一条：停住 180ms 或直接拖动都能进入排序。 */
      const grab = useCallback(
        (event, item) => {
          if (event.button !== 0) return;
          if (event.target instanceof Element && event.target.closest('button') !== null) return;
          if (drag_ref.current !== null) return;
          const drag = {
            item,
            start_y: event.clientY,
            last_y: event.clientY,
            pointer: event.pointerId,
            active: false,
            slot: null,
            timer: null,
            frame: null,
          };
          /** 在当前鼠标高度上算落点：压在哪条的上半截就插到那条前面。 */
          drag.recompute = () => {
            const box = root_ref.current;
            if (box === null) return;
            const rows = [];
            for (const el of box.querySelectorAll('[data-todo-line]')) {
              if (el.dataset.todoSection !== item.section) continue;
              rows.push({ line: Number(el.dataset.todoLine), rect: el.getBoundingClientRect() });
            }
            for (const row of rows) {
              if (row.line === item.line) continue;
              if (drag.last_y < row.rect.top + row.rect.height / 2) {
                drag.slot = { before: row.line };
                set_drop_slot({ before: row.line, end: false });
                return;
              }
            }
            drag.slot = { before: null };
            set_drop_slot({ before: null, end: true });
          };
          drag.activate = () => {
            if (drag.active) return;
            drag.active = true;
            set_dragging_line(item.line);
            const selection = window.getSelection();
            if (selection !== null) selection.removeAllRanges();
            /** 贴到上下边缘时自己滚，不然长清单拖不到头。 */
            const step = () => {
              if (drag_ref.current !== drag) return;
              const box = root_ref.current;
              if (box !== null) {
                const rect = box.getBoundingClientRect();
                const edge = 56;
                let delta = 0;
                if (drag.last_y < rect.top + edge) delta = Math.min(18, Math.ceil((rect.top + edge - drag.last_y) / 3));
                else if (drag.last_y > rect.bottom - edge) delta = -Math.min(18, Math.ceil((drag.last_y - (rect.bottom - edge)) / 3));
                if (delta !== 0) {
                  box.scrollTop -= delta;
                  drag.recompute();
                }
              }
              drag.frame = requestAnimationFrame(step);
            };
            drag.frame = requestAnimationFrame(step);
          };
          drag.move = (move_event) => {
            if (move_event.pointerId !== drag.pointer) return;
            drag.last_y = move_event.clientY;
            if (!drag.active) {
              if (Math.abs(move_event.clientY - drag.start_y) < 6) return;
              drag.activate();
            }
            if (move_event.cancelable) move_event.preventDefault();
            drag.recompute();
          };
          drag.up = (up_event) => {
            if (up_event.pointerId !== drag.pointer) return;
            end_drag(true);
          };
          drag.cancel = () => end_drag(false);
          drag.key = (key_event) => {
            if (key_event.key === 'Escape') end_drag(false);
          };
          drag_ref.current = drag;
          drag.timer = setTimeout(() => drag.activate(), 180);
          window.addEventListener('pointermove', drag.move, { passive: false });
          window.addEventListener('pointerup', drag.up);
          window.addEventListener('pointercancel', drag.cancel);
          window.addEventListener('keydown', drag.key);
        },
        [end_drag],
      );

      useEffect(
        () => () => {
          if (drag_ref.current !== null) end_drag(false);
        },
        [end_drag],
      );

      const data = state.data;
      const tags = data === null ? [] : data.tags;
      const open_count = data === null ? 0 : data.open_count;
      const done_count = data === null || !Number.isFinite(data.done_count) ? null : data.done_count;

      /** 是否被当前筛选命中。 */
      const matches = (item) => {
        if (filter === null) return true;
        if (filter === NO_TAG) return item.tag === null;
        return item.tag === filter;
      };

      const items = data === null ? [] : data.open_items ?? (data.groups ?? []).flatMap((group) => group.items);
      const can_move = data !== null && Array.isArray(data.open_items);
      const visible = items.filter(matches);
      const filtered_count = visible.length;

      /** 宿主侧还没重启时没有这两个字段：宁可不画，也不用近似值充数。 */
      const progress =
        data === null || !Number.isFinite(data.done_count) || !Number.isFinite(data.total_count)
          ? null
          : h(Progress, { done_total: data.done_count, total: data.total_count });

      const hero = h(
        'div',
        { className: 'dsh-todo-hero' },
        h(
          'div',
          { className: 'dsh-todo-stat' },
          h('span', { className: `dsh-todo-num${open_count === 0 && data !== null ? ' is-zero' : ''}` }, String(open_count)),
          h('span', { className: 'dsh-todo-unit' }, '件事没做'),
        ),
        done_count === null
          ? null
          : h(
              'div',
              { className: 'dsh-todo-stat is-done' },
              h('span', { key: done_count, className: 'dsh-todo-num is-done' }, String(done_count)),
              h('span', { className: 'dsh-todo-unit' }, '件已完成'),
            ),
      );

      const sub = h(
        'div',
        { className: 'dsh-todo-sub' },
        data === null
          ? '正在读取清单'
          : filter !== null
            ? `正在只看「${filter === NO_TAG ? '未分类' : filter}」，${filtered_count} 件`
            : data.stale_count > 0
              ? h('span', null, '其中 ', h('b', null, String(data.stale_count)), ` 件放了超过 ${STALE_DAYS} 天`)
              : '没有压很久的事',
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
                      className: `dsh-todo-filter is-tagged${filter === tag.id ? ' is-active' : ''}`,
                      style: { '--tag-color': tag.color },
                      onClick: () => set_filter(filter === tag.id ? null : tag.id),
                    },
                    h(ColorDot, { hollow: false }),
                    tag.id,
                    h('span', { className: 'dsh-todo-filter-count' }, String(data.tag_counts[tag.id] ?? 0)),
                  ),
                ),
              data.untagged_count > 0
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: `dsh-todo-filter is-tagged${filter === NO_TAG ? ' is-active' : ''}`,
                      style: { '--tag-color': 'var(--dsw-alias-label-tertiary)' },
                      onClick: () => set_filter(filter === NO_TAG ? null : NO_TAG),
                    },
                    h(ColorDot, { hollow: true }),
                    '未分类',
                    h('span', { className: 'dsh-todo-filter-count' }, String(data.untagged_count)),
                  )
                : null,
            );

      // 拖到本节末尾时，指示线画在本节最后一条的下边
      const drag_section = dragging_line === null ? null : items.find((item) => item.line === dragging_line)?.section ?? null;
      const tail = drag_section === null ? undefined : visible.filter((item) => item.section === drag_section).pop();
      const end_line = drop_slot !== null && drop_slot.end && tail !== undefined ? tail.line : undefined;

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
          h('span', { className: 'dsh-todo-empty-mark', 'aria-hidden': true }, h(CheckMark, { size: 13 })),
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
          React.Fragment,
          null,
          h(
            'ul',
            { className: 'dsh-todo-list' },
            visible.map((item) =>
              h(TodoRow, {
                key: item.line,
                item,
                tags,
                pending: pending_lines.includes(item.line),
                picker_open: picker_line === item.line,
                dragging: dragging_line === item.line,
                drop_before: drop_slot !== null && drop_slot.before === item.line,
                drop_after: drop_slot !== null && end_line === item.line,
                on_toggle: toggle,
                on_tag: set_tag,
                on_delete: remove,
                on_picker: (line) => set_picker_line(picker_line === line ? null : line),
                on_grab: can_move ? grab : null,
              }),
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

      const foot =
        data === null
          ? null
          : h(
              'div',
              { className: 'dsh-todo-foot', title: data.file },
              h(
                'div',
                { className: 'dsh-todo-foot-line' },
                h(
                  'span',
                  { className: 'dsh-todo-foot-text' },
                  `数据来自 ${String(data.file ?? '').split(/[\\/]/).pop()}　最后改动 ${format_time(data.updated_at)}`,
                ),
                h('button', { type: 'button', className: 'dsh-todo-refresh', onClick: () => load(false) }, '刷新'),
              ),
              can_move && data.open_count > 1 ? h('div', { className: 'dsh-todo-hint' }, '按住任意一条上下拖动，可以调位置') : null,
            );

      return h(
        'div',
        { className: `dsh-todo-root${dragging_line !== null ? ' is-dragging' : ''}`, ref: root_ref },
        h('div', { className: 'dsh-todo-header' }, hero, sub),
        progress,
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
        foot,
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
