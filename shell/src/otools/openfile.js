/**
 * 宿主投递的「打开文件」：SDK 契约（`otools-file-open`）的 shell 侧最小实现。
 * ------------------------------------------------------------------
 * 链路（宿主侧 `platform/file_open.rs`）：用户在系统里双击已绑定扩展名的文件 →
 * 宿主把路径排进按插件分桶的投递队列 → 对本 webview `emit_to("otools-open-file")`
 * 敲门。事件只做敲门，载荷一律用 `otools_consume_open_files` 取走，所以「宿主先投、
 * 插件后启动」与「插件先启、宿主后投」两种时序都不丢件。
 *
 * 新开标签时宿主还会把 `?otoolsOpenFile=["…"]` 拼进插件 URL（webview 事件早于
 * JS listener 就绪的兜底），这里与队列内容按 3 秒窗口去重合并。
 *
 * 与 `host.js` 同一套通道哲学：Tauri 原生 IPC（`__TAURI_INTERNALS__`，含
 * parent/top 兜底）为准；两条都不通（dist 拖进普通浏览器）时静默不订阅——
 * 浏览器里本来就没有宿主投递这回事。
 */

import { APP } from './app.js';
import { diag } from './host.js';

const DELIVER_EVENT = 'otools-open-file';
const DEDUPE_WINDOW_MS = 3000;

/** 找得到 transformCallback + invoke 的窗口（window → parent → top）。 */
function tauriInternals() {
  if (typeof window === 'undefined') return null;
  const candidates = [window];
  try { if (window.parent && window.parent !== window) candidates.push(window.parent); } catch { /* 跨域 */ }
  try { if (window.top && window.top !== window) candidates.push(window.top); } catch { /* 跨域 */ }
  for (const candidate of candidates) {
    const internals = candidate && candidate.__TAURI_INTERNALS__;
    if (internals && typeof internals.invoke === 'function' && typeof internals.transformCallback === 'function') {
      return internals;
    }
  }
  return null;
}

/** Tauri 事件监听（与插件 SDK 的 listenTauri 同形）；通道不在时返回 null。 */
async function tauriListen(event, handler) {
  const internals = tauriInternals();
  if (!internals) return null;
  const handlerId = internals.transformCallback((payload) => {
    // Tauri 的回调形状是 { event, id, payload }，剥一层拿真载荷。
    const inner = payload && typeof payload === 'object' && 'payload' in payload
      ? payload.payload
      : payload;
    handler(inner);
  }, false);
  const eventId = await internals.invoke('plugin:event|listen', {
    event,
    target: { kind: 'Any' },
    handler: handlerId,
  });
  return async () => {
    try {
      await window.__TAURI_EVENT_PLUGIN_INTERNALS__?.unregisterListener?.(event, eventId);
    } catch { /* 后端 unlisten 仍会清掉服务端监听 */ }
    internals.unregisterCallback?.(handlerId);
    try {
      await internals.invoke('plugin:event|unlisten', { event, eventId });
    } catch { /* 已注销时忽略 */ }
  };
}

function parseLaunchPaths(search) {
  if (!search) return [];
  try {
    const raw = new URLSearchParams(search).get('otoolsOpenFile');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 订阅宿主投递的文件。返回 unlisten（通道不可用时返回 null，handler 不会触发）。
 * 回调参数是 `[{ path, name, ext }]`。
 */
export async function onHostOpenFile(handler) {
  if (typeof window === 'undefined') return null;
  const recent = new Map();
  const deliver = (paths) => {
    const now = Date.now();
    const fresh = [];
    for (const path of paths) {
      const normalized = String(path || '').trim();
      if (!normalized) continue;
      const seenAt = recent.get(normalized);
      if (typeof seenAt === 'number' && now - seenAt < DEDUPE_WINDOW_MS) continue;
      recent.set(normalized, now);
      fresh.push(normalized);
    }
    if (recent.size > 256) {
      for (const [path, seenAt] of recent) {
        if (now - seenAt >= DEDUPE_WINDOW_MS) recent.delete(path);
      }
    }
    if (fresh.length) {
      handler(fresh.map((path) => {
        const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
        const name = i >= 0 ? path.slice(i + 1) : path;
        const dot = name.lastIndexOf('.');
        return { path, name, ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : '' };
      }));
    }
  };

  const consume = async () => {
    try {
      const internals = tauriInternals();
      if (!internals) return;
      const result = await internals.invoke('otools_consume_open_files', { pluginUuid: APP.id });
      deliver(Array.isArray(result) ? result.map(String) : []);
    } catch (error) {
      diag({ openFileConsumeError: String(error) });
    }
  };

  // 与 SDK 相同的顺序：先注册 listener 再 consume，保证「取空后宿主才投递」
  // 的窗口里敲门一定命中。
  const unlisten = await tauriListen(DELIVER_EVENT, () => { void consume(); });
  const launchPaths = parseLaunchPaths(window.location?.search || '');
  if (launchPaths.length) deliver(launchPaths);
  void consume();
  diag({ openFileHook: unlisten ? 'on' : 'off' });
  return unlisten;
}
