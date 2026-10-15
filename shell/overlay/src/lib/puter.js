/**
 * 本地文件版的 Puter 适配层（整文件替换上游 `src/lib/puter.js`）。
 * ------------------------------------------------------------------
 * 上游把「应用向 Puter 要的每一样东西」收敛在这一个模块里，其余代码一律
 * `import * as P from './lib/puter.js'`。所以整个移植只需要换掉这一个文件：
 * 导出签名与上游**逐一保持**，实现全部改走 `shell/src/otools/local.js`
 * （宿主桥 → 本机磁盘；宿主不在时浏览器兜底）。
 *
 * 与上游的差别，按上游自己的分节来说：
 *
 *   env      恒为 'app'（插件总在宿主里跑），`hasSDK()` 恒为 true——「有没有
 *            Puter SDK」这个问题在本地文件模型下由本模块自己回答。
 *   auth     `isSignedIn()` 恒 true、`signIn()/signOut()` 空操作、`getUser()`
 *            给本机身份。需要 Puter 账号的入口由 `shell/edits.mjs` 摘掉，
 *            不在这里假装它们能用。
 *   settings 上游放 puter.kv（跟着账号走）；这里放**本机 localStorage**。
 *   kv       `kvGet/kvSet/kvDel` 落到 localStorage，键带 `spreadsheet:kv:v1:`
 *            前缀，避免和上游那些自己管 localStorage 的记录（drafts、
 *            recents、versions、account-storage）撞车。
 *   files    表格就是本机库目录（`<文档>/Spreadsheets`）里的普通 .xlsx 文件。
 *            地址沿用上游的「相对拼写」`Spreadsheets/<name>.xlsx`，库外的文件
 *            用宿主给的绝对路径——路径判断函数因此一行未改。
 *   pickers  宿主的打开/另存对话框（宿主不在时 `<input type=file>` / 下载）。
 *   sharing  共享、邀请、云端链接一律停用（`canShare()` 为 false，入口随之
 *            消失）。
 *   AI       一律停用（`canAI()` 为 false）。
 *   fetch    不再经过 Puter 的 CORS 代理，直接用浏览器的 fetch（Data ▸ 从 Web
 *            取数因此受同源策略限制，这是插件版诚实的边界）。
 *
 * 为什么是**懒加载** `local.js`：上游 200 多个测试文件在 node 环境里 import
 * 到本模块（经 `lib/doc.js`、`lib/session.js`…）。`local.js` 一进来就要摸
 * `window`，静态 import 会让那批测试在**导入阶段**就炸。改成在真正要读写
 * 文件时才 import，node 下只是那些调用失败，别的逻辑照旧。
 */

import { trackExport } from './analytics.js';
import { APP } from '../otools/app.js';

export const FOLDER = 'Spreadsheets';
export const SETTINGS_KEY = 'spreadsheet:settings:v1';

/* ------------------------------------------------------------ 本地后端 */

let ioPromise = null;

/** `local.js`（本机文件）+ `host.js`（宿主桥），第一次用到时才加载。 */
async function io() {
  if (!ioPromise) {
    ioPromise = Promise.all([import('../otools/local.js'), import('../otools/host.js')])
      .then(([local, host]) => ({ local, host }))
      // 加载失败（比如 node 下没有 window）不缓存，下一次还能再试。
      .catch((error) => { ioPromise = null; throw error; });
  }
  return ioPromise;
}

/* --------------------------------------------------------------- 环境 */

/** 本模块自己就是存储层，所以「有没有 SDK」恒为是。 */
export function hasSDK() {
  return true;
}

/** 插件总在 OTools 宿主里跑：'app' 让上游按桌面实例的方式画界面（不显示登录）。 */
export function env() {
  return 'app';
}

export function isApp() {
  return env() === 'app';
}

/* --------------------------------------------------------------- 身份 */

export async function isSignedIn() {
  return true;
}

export async function signIn() {
  return true;
}

export function signOut() {
  /* 本地文件模型下没有「登出」这回事 */
}

export async function getUser() {
  try {
    const { local } = await io();
    return local.localUser();
  } catch {
    return { username: 'Local' };
  }
}

/** 本机没有账号头像。 */
export function getProfilePicture() {
  return Promise.resolve(null);
}

/** 没有云会在别处替我们登录，所以没有可订阅的事件。 */
export function onAuth() {
  /* 空操作 */
}

/* ------------------------------------------------- 设置（本机 localStorage） */

const DEFAULT_SETTINGS = { theme: 'system' };
const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/** 这台机器上的设置（上游：无会话时浏览器里那一份；这里就是唯一的一份）。 */
export function loadLocalSettings() {
  try {
    const obj = JSON.parse(storage()?.getItem(SETTINGS_KEY) || 'null');
    return { ...DEFAULT_SETTINGS, ...(obj && typeof obj === 'object' ? obj : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveLocalSettings(next) {
  try { storage()?.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ...next })); } catch { /* storage unavailable */ }
}

/** 上游的「账号的设置（puter.kv）」；插件里就是本机那一份，因此总是读得到。 */
export async function loadSettings() {
  const raw = await kvGet(SETTINGS_KEY);
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { ...DEFAULT_SETTINGS, ...(obj && typeof obj === 'object' ? obj : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch, current = {}) {
  const next = { ...DEFAULT_SETTINGS, ...current, ...patch };
  await kvSet(SETTINGS_KEY, next);
  return next;
}

/* ----------------------------------------------------- 小记录（KV → 本机） */

// 上游把「某个文件能不能加载外部内容」「脚本信任记录」这类小记录放 puter.kv。
// 换成 localStorage 时加前缀：上游自己还有一批 localStorage 记录（drafts、
// recents、versions、account-storage、external decision…），没有前缀迟早撞键。
const KV_PREFIX = 'spreadsheet:kv:v1:';
const kvKeyOf = (key) => `${KV_PREFIX}${key}`;

/** 一条记录，没有则是 null；存储器不在（node、隐私模式）时给 `unreachable`。 */
export async function kvGet(key, unreachable = null) {
  const store = storage();
  if (!store) return unreachable;
  try {
    const raw = store.getItem(kvKeyOf(key));
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return unreachable;
  }
}

/** 写一条记录；写不进去返回 false。 */
export async function kvSet(key, value) {
  const store = storage();
  if (!store) return false;
  try { store.setItem(kvKeyOf(key), JSON.stringify(value)); return true; } catch { return false; }
}

export async function kvDel(key) {
  const store = storage();
  if (!store) return false;
  try { store.removeItem(kvKeyOf(key)); return true; } catch { return false; }
}

/* --------------------------------------------------------------- 文件 */

export function isNotFound(err) {
  const code = err?.code || err?.error?.code || '';
  const msg = String(err?.message || err?.error?.message || err || '').toLowerCase();
  return code === 'subject_does_not_exist' || code === 'ENOENT' || msg.includes('not found') || msg.includes('does not exist') || msg.includes('no such');
}

export function displayName(path) {
  return String(path || '').split('/').pop();
}

/**
 * 一个安全的文件名：去掉路径分隔符与控制字符，收尾的点和空格也去掉。
 * （与上游逐字相同：控制字符里混着能让后面的字反着显示的 bidi 控制符。）
 */
export function sanitizeName(name) {
  const clean = Array.from(String(name || '').replace(/[/\\]/g, ' ').replace(/[\p{Cc}​⁠﻿‪-‮⁦-⁩]/gu, '').replace(/^[\s\p{Cf}]+|[\s\p{Cf}]+$/gu, '')).slice(0, 200).join('');
  if (!/[^\s\p{Cf}]/u.test(clean)) return '';
  return clean.replace(/[.\s\p{Cf}]+$/u, '');
}

export function ensureXlsx(name) {
  const clean = sanitizeName(name);
  return /\.xlsx$/i.test(clean) ? clean : `${clean}.xlsx`;
}

/* ---------- 地址：一个文件，两套拼写 ---------- */

// 库目录里的文件用上游的相对拼写（Spreadsheets/Budget.xlsx），库外的用宿主给的
// 绝对路径。读写时才解析成本机路径：判断地址的那几个函数（inAppFolder、inTrash、
// samePath…）因此和上游一模一样，不必改。
const norm = (p) => String(p ?? '').replace(/\\/g, '/');
const nameOf = (p) => { const s = norm(p); const i = s.lastIndexOf('/'); return i >= 0 ? s.slice(i + 1) : s; };
const parentOf = (p) => { const s = norm(p); const i = s.lastIndexOf('/'); return i > 0 ? s.slice(0, i) : ''; };
const childOf = (dir, name) => (dir ? `${dir}/${name}` : name);
const seconds = (ms) => Math.floor((Number(ms) || Date.now()) / 1000);

/** 本机库目录的同步缓存：路径判断（resolvedAbsolutePath）要用，`local.js` 也写这个键。 */
let rootPath = '';
try { rootPath = String(globalThis.localStorage?.getItem(`${APP.id}.root`) || '').trim(); } catch { /* 没有存储 */ }
/** 上游 `appFolder` 的同名结构：`inAppFolder` 用它认绝对路径那一套拼写。 */
let appFolder = { owner: null, path: rootPath || null };

let rootPromise = null;
/** 库目录（`<文档>/Spreadsheets`），第一次用到时建出来并记住。 */
async function libraryRoot() {
  if (rootPromise) return rootPromise;
  rootPromise = (async () => {
    const { local } = await io();
    const dir = await local.libraryDir();
    if (dir) {
      rootPath = dir;
      appFolder = { owner: null, path: dir };
    }
    return dir;
  })().catch((error) => { rootPromise = null; throw error; });
  return rootPromise;
}

/** 应用里的地址 → 本机路径。 */
async function localPath(path) {
  const p = norm(path);
  if (p.startsWith('/')) return p;
  const root = await libraryRoot();
  if (!root) return p;
  if (p === FOLDER) return root;
  if (p.startsWith(`${FOLDER}/`)) return `${root}/${p.slice(FOLDER.length + 1)}`;
  return p;
}

/** 本机路径 → 应用里的地址（localPath 的反函数）。 */
function spelling(abs) {
  const p = norm(abs);
  const root = norm(rootPath);
  if (root && p === root) return FOLDER;
  if (root && p.startsWith(`${root}/`)) return `${FOLDER}/${p.slice(root.length + 1)}`;
  return p;
}

const notFound = (path) => Object.assign(new Error(`${path} does not exist`), { code: 'subject_does_not_exist' });

/** 一个目录的条目；目录不存在时是 []。 */
async function entriesAt(dir) {
  const { host } = await io();
  return host.listDir(dir).catch(() => []);
}

/** 本机没有 drive 的 uid：用地址派生一个，够 drafts / versions / 路由用。 */
const UID_PREFIX = 'local:';
const uidOf = (path) => (path ? `${UID_PREFIX}${path}` : null);

export function isAbsolutePath(path) {
  return typeof path === 'string' && /^[/~]/.test(path);
}

/** 这个文件在回收站里吗？本机没有回收站，语义与地址判断保持一致。 */
export function inTrash(path) {
  return typeof path === 'string' && /^(?:\/[^/]+|~)\/Trash(?:\/|$)/.test(path);
}

const inFolderRelative = (path) => path.startsWith(`${FOLDER}/`) && !path.slice(FOLDER.length + 1).includes('/');

/** 已知的应用目录的绝对拼写（即本机库目录），还不知道时是 null。 */
function knownAppFolder() {
  return appFolder.path || null;
}

/** 已知的库内文件解析成绝对路径（剪贴板事件要同步用）；库外的相对地址没有绝对 URI。 */
export function resolvedAbsolutePath(path) {
  if (typeof path !== 'string') return null;
  const p = norm(path);
  if (p.startsWith('/')) return p;
  const folder = knownAppFolder();
  if (inFolderRelative(p) && folder?.startsWith('/')) return `${folder}/${displayName(p)}`;
  return null;
}

/** 是应用目录的直接子项吗（两种拼写都算）？ */
export function inAppFolder(path) {
  const p = norm(path);
  if (typeof path !== 'string') return false;
  if (inFolderRelative(p)) return true;
  const abs = knownAppFolder();
  return !!abs && parentOf(p) === abs;
}

/** 两个地址指的是同一个文件吗？ */
export function samePath(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return inAppFolder(a) && inAppFolder(b) && displayName(a) === displayName(b);
}

/** 应用目录文件的相对拼写；已经是相对拼写则返回 null。 */
export function legacyAppPath(path) {
  if (!inAppFolder(path)) return null;
  const relative = `${FOLDER}/${displayName(path)}`;
  return relative === path ? null : relative;
}

/** 要记住的地址：写入结果报的那个（同一个文件时），否则用请求时的地址。 */
export function canonicalPath(path, item) {
  const reported = item?.path;
  if (!isAbsolutePath(reported) || displayName(reported) !== displayName(path)) return path;
  return reported;
}

/** 解析应用目录的绝对拼写：就是本机库目录。 */
export async function resolveAppFolder() {
  await libraryRoot();
  return knownAppFolder();
}

/* ---------- 读写 ---------- */

/** 库目录里的表格文件，新的在前。 */
export async function listFiles() {
  const abs = await localPath(FOLDER);
  if (!abs.startsWith('/')) return [];
  const list = await entriesAt(abs);
  return list
    .filter((it) => !it.isDir && /\.(xlsx|xlsm|xls|csv|tsv|ods)$/i.test(it.name))
    .map((it) => ({
      name: it.name,
      path: `${FOLDER}/${it.name}`,
      size: it.size || 0,
      modified: seconds(it.modified || 0),
      uid: uidOf(`${FOLDER}/${it.name}`),
    }))
    .sort((a, b) => (b.modified || 0) - (a.modified || 0));
}

/** 任一目录的条目（不存在时 []）。 */
export async function listDir(path) {
  const abs = await localPath(path);
  if (!abs.startsWith('/')) return [];
  const list = await entriesAt(abs);
  return list.map((it) => {
    const at = childOf(abs, it.name);
    return { name: it.name, path: spelling(at), size: it.size || 0, is_dir: !!it.isDir, modified: seconds(it.modified || 0) };
  });
}

/** 一个文件的字节。 */
export async function readFile(path) {
  const { local } = await io();
  const abs = await localPath(path);
  const blob = await local.readPath(abs).catch(() => null);
  if (!blob) throw notFound(path);
  return blob.arrayBuffer();
}

/**
 * 写一个 Blob。 `dedupe` 时让存储挑一个不撞的名字；`overwrite: false` 时撞名就失败。
 * 返回写入结果（FSItem 的形状）：地址用「应用里的拼写」，好让上游的
 * `canonicalPath` 认得出这是同一个文件。
 */
export async function writeFile(path, blob, { dedupe = false, overwrite = !dedupe } = {}) {
  const { local, host } = await io();
  let abs = await localPath(path);
  if (!abs.startsWith('/')) throw new Error(`Cannot write ${path}: this computer's document library is not available`);
  const dir = parentOf(abs);
  const taken = (await entriesAt(dir)).map((it) => it.name);
  if (dedupe && taken.includes(nameOf(abs))) abs = childOf(dir, local.dedupeName(nameOf(abs), taken));
  else if (!overwrite && taken.includes(nameOf(abs))) throw Object.assign(new Error(`${nameOf(abs)} already exists`), { code: 'file_exists' });
  await host.writeBlob(abs, blob);
  const at = seconds(Date.now());
  const where = spelling(abs);
  return { path: where, name: nameOf(abs), uid: uidOf(where), size: blob.size, modified: at, created: at, is_dir: false };
}

export async function deleteFile(path, { recursive = false } = {}) {
  const { host } = await io();
  await host.removeEntry(await localPath(path), { recursive: Boolean(recursive) });
}

/** 改名（新的只是名字，目录跟着原来的）。 */
export async function renameFile(path, newName) {
  const { host } = await io();
  const abs = await localPath(path);
  const to = childOf(parentOf(abs), newName);
  await host.renameEntry(abs, to);
  const at = seconds(Date.now());
  const where = spelling(to);
  return { path: where, name: newName, uid: uidOf(where), modified: at, created: at, is_dir: false };
}

/** 一个文件的条目；不在则 null。 */
export async function statFile(path) {
  const abs = await localPath(path);
  if (!abs.startsWith('/')) return null;
  const hit = (await entriesAt(parentOf(abs))).find((it) => it.name === nameOf(abs));
  if (!hit) return null;
  const at = seconds(hit.modified || Date.now());
  return { path, name: nameOf(abs), uid: uidOf(path), size: hit.size || 0, modified: at, created: at, is_dir: !!hit.isDir };
}

/** 按 id 找一个文件：本机没有 drive 的 uid，id 由地址派生，所以就是反解回来。 */
export async function statByUid(uid) {
  const path = typeof uid === 'string' && uid.startsWith(UID_PREFIX) ? uid.slice(UID_PREFIX.length) : null;
  if (!path) return null;
  return statFile(path);
}

export async function fileExists(path) {
  return !!(await statFile(path));
}

/** 目录里不撞车的一个名字：列一次目录，而不是每个候选查一次。 */
export async function uniqueName(base) {
  const stem = String(base || '').replace(/\.xlsx$/i, '');
  const taken = new Set((await listDir(FOLDER)).map((it) => it.name));
  let name = `${stem}.xlsx`;
  let n = 2;
  while (taken.has(name)) name = `${stem} ${n++}.xlsx`;
  return name;
}

/* ------------------------------------------------------------ 打开 / 另存 */

export function canPickFiles() {
  return true;
}

export function canSaveFiles() {
  return true;
}

/** 宿主的打开对话框 → { path, name }，取消时 null。 */
export async function pickFile({ accept } = {}) {
  const { local } = await io();
  const file = await local.openFile({ accept: Array.isArray(accept) ? accept.join(',') : accept || undefined });
  if (!file?.path) return null;
  return { path: file.path, name: file.name || displayName(file.path), item: file };
}

/** 宿主的另存对话框（宿主不在时退回浏览器下载）。取消时 null。 */
export async function saveFileAs(blob, suggestedName) {
  const { local } = await io();
  const saved = await local.saveFileAs(blob, suggestedName);
  if (!saved?.path) return null;
  trackExport(suggestedName, 'device');
  return { path: saved.path, name: saved.name || displayName(saved.path) };
}

/* -------------------------------------------------- 共享 / 协作 / AI（停用） */

// 这些都要 Puter 账号：插件里一律不提供。`canShare()` / `canAI()` 是假的开关，
// 上游正是靠它们决定要不要画那些菜单项、那个 Share 按钮、那个 AI 面板。

export function canShare() {
  return false;
}

const NO_SHARING = 'Sharing needs a Puter account, which this app does not use';

export async function shareFile() {
  throw new Error(NO_SHARING);
}

export async function unshareFile() {
  throw new Error(NO_SHARING);
}

export async function shareAccess() {
  throw new Error(NO_SHARING);
}

/** 别人共享给我的表格：没有账号，也就没有这样一份列表。 */
export async function listSharedWithMe() {
  return [];
}

/** 这一档权限能不能改动文件？ */
export const canWriteMode = (mode) => mode === 'write' || mode === 'manage';

/** 别人给我的权限（'read' / 'write'…）：本机没有共享，恒 null。 */
export async function sharedModeOf() {
  return null;
}

export async function leaveShare() {
  throw new Error(NO_SHARING);
}

/** Puter 的共享链接：没有。 */
export async function puterShareLink() {
  return null;
}

/** 被拒绝的共享在对话框里怎么说。 */
export function shareProblem(err) {
  return err?.message || err?.error?.message || NO_SHARING;
}

/** 云端 AI 在插件里不提供。 */
export function canAI() {
  return false;
}

const NO_AI = 'AI is not available here';

export async function aiChat() {
  throw new Error(NO_AI);
}

export async function* aiChatStream() {
  throw new Error(NO_AI);
}

/* ------------------------------------------------------------ 取 Web 数据 */

/** 一个公式或一张图片能从网址取多少：够任何一张表，不够撑爆内存。 */
export const MAX_FETCH_BYTES = 20 * 1024 * 1024;
const tooLarge = (url) => Object.assign(new Error(`The response from ${url} is too large (over ${MAX_FETCH_BYTES / (1024 * 1024)} MB)`), { code: 'too-large' });
const notPublic = (url) => Object.assign(new Error(`Cannot fetch ${url}: only addresses on the public internet can be fetched, not this computer's or a private network's`), { code: 'not-public' });

/**
 * `url` 是公网地址吗：http(s)，且主机不是本机、私网或链路本地（云元数据服务在那里
 * 应答）。没有 Puter 的 CORS 代理之后，这条检查更要做在这里。
 */
export function isPublicHttpUrl(url) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (host.startsWith('[')) return isPublicIPv6(host.slice(1, -1));
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPublicIPv4(host.split('.').map(Number));
  return !/^localhost$|\.(?:localhost|local|internal|home\.arpa)$/.test(host);
}

function isPublicIPv4([a, b]) {
  if (a === 0 || a === 10 || a === 127) return false; // 本机、私网、回环
  if (a === 169 && b === 254) return false; // 链路本地
  if (a === 172 && b >= 16 && b <= 31) return false; // 私网
  if (a === 192 && b === 168) return false; // 私网
  if (a === 100 && b >= 64 && b <= 127) return false; // 运营商级 NAT
  return a < 224; // 组播与保留地址
}

function isPublicIPv6(ip) {
  if (ip === '::1' || ip === '::') return false; // 回环、未指定
  if (/^(?:fe[89ab]|f[cd]|ff)/.test(ip)) return false; // 链路本地、唯一本地、组播
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip); // IPv4 穿着 IPv6 的衣服
  if (!mapped) return true;
  const [hi, lo] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)];
  return isPublicIPv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
}

async function fetchResponse(url) {
  if (!isPublicHttpUrl(url)) throw notPublic(url);
  const res = await fetch(url);
  if (!res || (typeof res.ok === 'boolean' && !res.ok)) throw new Error(`Could not fetch ${url}`);
  return res;
}

/** 响应体的字节，带上限：先看声明的长度，再看实际到达的。 */
async function cappedBytes(res, url) {
  if (Number(res.headers?.get?.('content-length')) > MAX_FETCH_BYTES) throw tooLarge(url);
  if (typeof res.body?.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FETCH_BYTES) { Promise.resolve(reader.cancel?.()).catch(() => {}); throw tooLarge(url); }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
    return out;
  }
  const bytes = typeof res.arrayBuffer === 'function' ? new Uint8Array(await res.arrayBuffer()) : new TextEncoder().encode(await res.text());
  if (bytes.byteLength > MAX_FETCH_BYTES) throw tooLarge(url);
  return bytes;
}

/** 从一个网址取文本（按 UTF-8 解码）。 */
export async function fetchText(url) {
  return new TextDecoder().decode(await cappedBytes(await fetchResponse(url), url));
}

/** 从一个网址取字节（比如网上的 .xlsx）。 */
export async function fetchBytes(url) {
  return cappedBytes(await fetchResponse(url), url);
}

/* ------------------------------------------------------------ 桌面集成 */

export function setWindowTitle(title) {
  try { if (title && typeof document !== 'undefined') document.title = title; } catch { /* 没有 document */ }
}

/** 「用此应用打开」是 Puter 桌面的事，这里没有。 */
export function onLaunchedWithItems() {
  /* 空操作 */
}

/** 接管不了宿主窗口的关闭按钮：返回 false，上游就不会把关闭交给我们。 */
export function onWindowClose() {
  return false;
}

export function exitApp() {
  /* 宿主自己管窗口；不替它关 */
}

/** 驱动器描述的条目（启动项、拖放、列表）是个目录吗？ */
export function isDirItem(item) {
  return !!(item?.is_dir || item?.isDirectory || item?.isDir || item?.fsentry_is_dir);
}

/** 导出成文件：宿主在就落到本机（或弹另存对话框），不在就走浏览器下载。 */
export async function downloadBlob(blob, filename) {
  const { local } = await io();
  await local.exportFile(blob, filename).catch(() => {});
  trackExport(filename, 'device');
}
