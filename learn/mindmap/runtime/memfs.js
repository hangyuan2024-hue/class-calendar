// 浏览器里的「硬盘」：导图服务原来用 Node 的同步 fs 读写 storage/ 文件夹，
// 网页版把这些文件放在内存里，每次改动随后写进本浏览器的 IndexedDB（mm-fs），下次打开再读回来。
"use strict";
const { Buffer } = require("./buffer.js");
const files = new Map();   // 路径 → { data: Buffer, mtime }
const dirs = new Set(["/"]);
const pending = new Map(); // 路径 → 要写的记录（null 表示删除）
let db = null, flushing = null, timer = null;

function err(code, msg, p) { const e = new Error(code + ": " + msg + ", '" + p + "'"); e.code = code; e.path = p; return e; }
function norm(p) { p = String(p).replace(/\\/g, "/").replace(/\/+/g, "/"); if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1); return p; }
function parent(p) { const i = p.lastIndexOf("/"); return i <= 0 ? "/" : p.slice(0, i); }
function touchDirs(p) { let d = parent(p); const add = []; while (!dirs.has(d)) { add.push(d); d = parent(d); } for (const x of add) { dirs.add(x); mark(x, { dir: 1 }); } }
function mark(p, rec) { pending.set(p, rec); if (!timer) timer = setTimeout(() => { timer = null; flush(); }, 0); }
function toBuf(data, opt) {
  const encoding = typeof opt === "string" ? opt : opt && opt.encoding;
  if (typeof data === "string") return Buffer.from(data, encoding || "utf8");
  if (data instanceof Uint8Array) return Buffer.from(data);
  return Buffer.from(String(data));
}

const fs = {
  existsSync(p) { p = norm(p); return files.has(p) || dirs.has(p); },
  mkdirSync(p, opt) {
    p = norm(p);
    if (dirs.has(p)) { if (opt && opt.recursive) return; throw err("EEXIST", "file already exists", p); }
    if (files.has(p)) throw err("EEXIST", "file already exists", p);
    if (!(opt && opt.recursive) && !dirs.has(parent(p))) throw err("ENOENT", "no such file or directory", p);
    touchDirs(p + "/x"); dirs.add(p); mark(p, { dir: 1 });
  },
  writeFileSync(p, data, opt) {
    p = norm(p);
    if (opt && typeof opt === "object" && /x/.test(opt.flag || "") && (files.has(p) || dirs.has(p))) throw err("EEXIST", "file already exists", p);
    if (dirs.has(p)) throw err("EISDIR", "illegal operation on a directory", p);
    if (!dirs.has(parent(p))) throw err("ENOENT", "no such file or directory", p);
    const rec = { data: toBuf(data, opt), mtime: Date.now() }; files.set(p, rec); mark(p, rec);
  },
  readFileSync(p, opt) {
    p = norm(p); const f = files.get(p);
    if (!f) throw err(dirs.has(p) ? "EISDIR" : "ENOENT", "no such file or directory", p);
    const encoding = typeof opt === "string" ? opt : opt && opt.encoding;
    return encoding ? f.data.toString(encoding) : Buffer.from(f.data);
  },
  statSync(p, opt) {
    p = norm(p); const f = files.get(p);
    if (f) return { size: f.data.length, mtimeMs: f.mtime, mtime: new Date(f.mtime), isFile: () => true, isDirectory: () => false };
    if (dirs.has(p)) return { size: 0, mtimeMs: 0, mtime: new Date(0), isFile: () => false, isDirectory: () => true };
    if (opt && opt.throwIfNoEntry === false) return undefined;
    throw err("ENOENT", "no such file or directory", p);
  },
  readdirSync(p, opt) {
    p = norm(p); if (!dirs.has(p)) throw err("ENOENT", "no such file or directory", p);
    const pre = p === "/" ? "/" : p + "/", out = new Map();
    for (const f of files.keys()) if (f.startsWith(pre) && !f.slice(pre.length).includes("/")) out.set(f.slice(pre.length), true);
    for (const d of dirs) if (d !== p && d.startsWith(pre) && !d.slice(pre.length).includes("/")) out.set(d.slice(pre.length), false);
    const names = [...out.keys()].sort();
    return opt && opt.withFileTypes ? names.map((name) => ({ name, isFile: () => out.get(name), isDirectory: () => !out.get(name) })) : names;
  },
  unlinkSync(p) { p = norm(p); if (!files.has(p)) throw err("ENOENT", "no such file or directory", p); files.delete(p); mark(p, null); },
  rmSync(p, opt) {
    p = norm(p);
    if (files.has(p)) { files.delete(p); mark(p, null); return; }
    if (!dirs.has(p)) { if (opt && opt.force) return; throw err("ENOENT", "no such file or directory", p); }
    if (!(opt && opt.recursive)) throw err("EISDIR", "is a directory", p);
    const pre = p + "/";
    for (const f of [...files.keys()]) if (f.startsWith(pre)) { files.delete(f); mark(f, null); }
    for (const d of [...dirs]) if (d === p || d.startsWith(pre)) { dirs.delete(d); mark(d, null); }
  },
  renameSync(a, b) {
    a = norm(a); b = norm(b);
    if (files.has(a)) {
      if (dirs.has(b)) throw err("EISDIR", "is a directory", b);
      if (!dirs.has(parent(b))) throw err("ENOENT", "no such file or directory", b);
      const rec = files.get(a); files.delete(a); mark(a, null); files.set(b, rec); mark(b, rec); return;
    }
    if (!dirs.has(a)) throw err("ENOENT", "no such file or directory", a);
    if (!dirs.has(parent(b))) throw err("ENOENT", "no such file or directory", b);
    const pre = a + "/";
    for (const f of [...files.keys()]) if (f.startsWith(pre)) { const rec = files.get(f), to = b + f.slice(a.length); files.delete(f); mark(f, null); files.set(to, rec); mark(to, rec); }
    for (const d of [...dirs]) if (d === a || d.startsWith(pre)) { const to = b + d.slice(a.length); dirs.delete(d); mark(d, null); dirs.add(to); mark(to, { dir: 1 }); }
  },
  copyFileSync(a, b) { a = norm(a); b = norm(b); const f = files.get(a); if (!f) throw err("ENOENT", "no such file or directory", a); if (!dirs.has(parent(b))) throw err("ENOENT", "no such file or directory", b); const rec = { data: Buffer.from(f.data), mtime: Date.now() }; files.set(b, rec); mark(b, rec); },
  openSync(p) { p = norm(p); if (!files.has(p)) throw err("ENOENT", "no such file or directory", p); return { p }; },
  readSync(fd, buf, off, len, pos) { const f = files.get(fd.p); if (!f) return 0; const part = f.data.subarray(pos || 0, (pos || 0) + len); buf.set(part, off); return part.length; },
  closeSync() {},
  createReadStream(p, opt) {
    p = norm(p); const handlers = {};
    const st = { on(ev, fn) { handlers[ev] = fn; return st; }, pipe(res) {
      setTimeout(() => {
        const f = files.get(p);
        if (!f) { if (handlers.error) handlers.error(err("ENOENT", "no such file or directory", p)); return; }
        const s = opt && opt.start || 0, e = opt && opt.end != null ? opt.end + 1 : f.data.length;
        res.write(f.data.subarray(s, e)); res.end();
      }, 0);
      return res;
    } };
    return st;
  },
};
fs.promises = {};

// ---------- IndexedDB ----------
function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("mm-fs", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
// 读回所有文件（服务开始处理请求之前调用一次）
async function load() {
  db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readonly"), req = tx.objectStore("files").openCursor();
    req.onsuccess = () => {
      const c = req.result; if (!c) return;
      const v = c.value;
      if (v && v.dir) dirs.add(c.key); else if (v && v.data) files.set(c.key, { data: Buffer.from(new Uint8Array(v.data)), mtime: v.mtime || 0 });
      c.continue();
    };
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
// 把改动写进 IndexedDB；回复页面之前等它写完，保证「保存成功」时数据真的落盘了
function flush() {
  if (flushing) return flushing.then(() => (pending.size ? flush() : undefined));
  if (!pending.size || !db) return Promise.resolve();
  const batch = [...pending]; pending.clear();
  flushing = new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite"), store = tx.objectStore("files");
    for (const [p, rec] of batch) {
      if (rec === null) store.delete(p);
      else if (rec.dir) store.put({ dir: 1 }, p);
      else store.put({ data: rec.data.buffer.slice(rec.data.byteOffset, rec.data.byteOffset + rec.data.length), mtime: rec.mtime }, p);
    }
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error("浏览器存储空间不足"));
  }).finally(() => { flushing = null; });
  return flushing.then(() => (pending.size ? flush() : undefined));
}
fs.__load = load; fs.__flush = flush; fs.__files = files; fs.__dirs = dirs;
module.exports = fs;
