// 捞小智 · 本机文件夹：选一个文件夹给捞小智，文件留在原地，用到哪个它自己去找、去读（不用一个个传上来）
//   · folder_find：按文件名、按内容找（Word、PPT、PDF、Excel、网页、代码、纯文本都能搜里面的字）
//   · folder_list：看某个子文件夹里有什么
//   · folder_read：读一个文件（长的分段读，from 从第几个字开始）
//   读出来的文字按「路径 + 大小 + 修改时间」缓存在本机，文件没变就不重读；第一次搜内容慢一点，之后很快。
//   只在选的那个文件夹里面转：路径出不去（.. 和快捷方式都挡住），隐藏文件夹、node_modules、.git 这些不进
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const FILES = require("./files");

const SKIP_DIR = /^(\.|node_modules$|__pycache__$|\$RECYCLE\.BIN$|System Volume Information$|venv$|\.venv$|dist$|build$|target$)/i;
const MAX_FILES = 20000, MAX_DEPTH = 8, MAX_TEXT_MB = 30;

function create(o = {}) {
  const cfgFile = o.file, cacheDir = o.cacheDir;
  let cfg = { root: "" };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgFile, "utf8")) }; } catch (e) {}
  let listCache = null;   // { at, root, files: [{ rel, size, mtime }] }
  const save = () => { if (!cfgFile) return; fs.mkdirSync(path.dirname(cfgFile), { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(cfg)); };
  const root = () => { if (!cfg.root) return ""; try { return fs.statSync(cfg.root).isDirectory() ? cfg.root : ""; } catch (e) { return ""; } };

  function set(dir) {
    if (!dir) { cfg.root = ""; listCache = null; save(); return info(); }
    const real = fs.realpathSync(String(dir));
    if (!fs.statSync(real).isDirectory()) throw new Error("选的不是文件夹");
    const home = require("os").homedir();
    if (real === path.parse(real).root || real === home) throw new Error("范围太大了：选一个具体的文件夹（比如「课程资料」「作业」），不要选整个盘或者整个用户目录");
    cfg.root = real; listCache = null; save();
    return info();
  }
  function info() { const r = root(); return { root: r, name: r ? path.basename(r) : "", count: listCache && listCache.root === r ? listCache.files.length : null }; }

  // 路径只能在选的文件夹里面
  function inside(rel) {
    const r = root(); if (!r) throw new Error("还没选文件夹：先在对话框下面点「文件夹」选一个");
    const f = path.resolve(r, String(rel || "."));
    const ok = (p) => p === r || p.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
    if (!ok(f)) throw new Error("只能看选的那个文件夹里面的东西");
    let real; try { real = fs.realpathSync(f); } catch (e) { throw new Error("没有这个文件或文件夹：" + rel); }
    if (!ok(real)) throw new Error("只能看选的那个文件夹里面的东西");
    return real;
  }
  // 走一遍文件夹（30 秒内再问直接用上次的）
  function walk() {
    const r = root(); if (!r) throw new Error("还没选文件夹：先在对话框下面点「文件夹」选一个");
    if (listCache && listCache.root === r && Date.now() - listCache.at < 30e3) return listCache.files;
    const out = [];
    const go = (d, depth) => {
      if (out.length >= MAX_FILES || depth > MAX_DEPTH) return;
      let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        if (out.length >= MAX_FILES) return;
        const f = path.join(d, e.name);
        if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) go(f, depth + 1); continue; }
        if (!e.isFile() || e.name.startsWith("~$") || e.name.startsWith(".")) continue;
        let st; try { st = fs.statSync(f); } catch (x) { continue; }
        out.push({ rel: path.relative(r, f).split(path.sep).join("/"), size: st.size, mtime: st.mtimeMs });
      }
    };
    go(r, 0);
    listCache = { at: Date.now(), root: r, files: out };
    return out;
  }
  // 一个文件的文字（有缓存）
  async function textOf(rel) {
    const f = inside(rel), st = fs.statSync(f);
    if (!FILES.canRead(f) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f)) return null;
    if (st.size > MAX_TEXT_MB * 1048576) return null;
    const key = crypto.createHash("sha1").update(f + "|" + st.size + "|" + st.mtimeMs).digest("hex");
    const cf = cacheDir ? path.join(cacheDir, key.slice(0, 2), key + ".txt") : null;
    if (cf) { try { return fs.readFileSync(cf, "utf8"); } catch (e) {} }
    const r = await FILES.read(f);
    const t = r.text || "";
    if (cf) { try { fs.mkdirSync(path.dirname(cf), { recursive: true }); fs.writeFileSync(cf, t); } catch (e) {} }
    return t;
  }
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + "M" : Math.max(1, Math.round(n / 1024)) + "K");
  const day = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  // 找：文件名里有的排前面；再搜内容（最多读 400 个文件、20 秒），给一小段上下文
  async function find(a = {}) {
    const words = String(a.query || "").trim().split(/[\s,，、]+/).filter(Boolean).slice(0, 6);
    if (!words.length) throw new Error("要找什么（query）");
    const ext = String(a.ext || "").replace(/^\./, "").toLowerCase();
    const files = walk().filter((x) => !ext || x.rel.toLowerCase().endsWith("." + ext));
    const lw = words.map((w) => w.toLowerCase());
    const hits = new Map();
    for (const x of files) { const n = x.rel.toLowerCase(), k = lw.filter((w) => n.includes(w)).length; if (k) hits.set(x.rel, { ...x, score: 10 * k, where: "文件名" }); }
    if (a.content !== false) {
      const t0 = Date.now(); let readN = 0;
      const cands = files.filter((x) => FILES.canRead(x.rel) && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(x.rel)).sort((p, q) => q.mtime - p.mtime);
      for (const x of cands) {
        if (readN >= (o.maxRead || 400) || Date.now() - t0 > (o.maxMs || 20000)) break;
        let t; try { t = await textOf(x.rel); readN++; } catch (e) { continue; }
        if (!t) continue;
        const lt = t.toLowerCase(), k = lw.filter((w) => lt.includes(w)).length;
        if (!k) continue;
        const i = lt.indexOf(lw.find((w) => lt.includes(w)));
        const snip = t.slice(Math.max(0, i - 60), i + 120).replace(/\s+/g, " ");
        const h = hits.get(x.rel) || { ...x, score: 0, where: "内容" };
        h.score += 3 * k + Math.min(3, lt.split(lw[0]).length - 1); h.snippet = snip; if (h.where === "文件名") h.where = "文件名和内容";
        hits.set(x.rel, h);
      }
    }
    const list = [...hits.values()].sort((p, q) => q.score - p.score || q.mtime - p.mtime).slice(0, Math.max(1, Math.min(20, +a.n || 10)));
    return { folder: path.basename(root()), total: files.length, results: list.map((x) => ({ path: x.rel, size: kb(x.size), changed: day(x.mtime), where: x.where, ...(x.snippet ? { snippet: x.snippet } : {}) })) };
  }
  function list(a = {}) {
    const d = inside(a.path || ".");
    if (!fs.statSync(d).isDirectory()) throw new Error("这是文件，不是文件夹：用 folder_read 读");
    const r = root(), ents = fs.readdirSync(d, { withFileTypes: true }).filter((e) => !e.name.startsWith(".") && !e.name.startsWith("~$"));
    const out = ents.slice(0, 300).map((e) => { const f = path.join(d, e.name); let st = null; try { st = fs.statSync(f); } catch (x) {} return { name: e.name + (e.isDirectory() ? "/" : ""), ...(st && !e.isDirectory() ? { size: kb(st.size), changed: day(st.mtimeMs) } : {}) }; });
    out.sort((p, q) => (q.name.endsWith("/") - p.name.endsWith("/")) || p.name.localeCompare(q.name, "zh"));
    return { folder: path.relative(r, d).split(path.sep).join("/") || "（最外层）", items: out, more: Math.max(0, ents.length - 300) };
  }
  async function readOne(a = {}) {
    const f = inside(a.path);
    if (fs.statSync(f).isDirectory()) return list({ path: a.path });
    if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(f)) return { path: a.path, note: "这是图片：要看图片的话请对方把它拖进对话框（图片要用能看图的模型）" };
    const t = await textOf(a.path);
    if (t == null) throw new Error("这种文件读不了（能读 Word、PPT、PDF、Excel、网页、代码和纯文本，最大 30M）");
    const from = Math.max(0, +a.from || 0), n = 6000, part = t.slice(from, from + n);
    return { path: a.path, chars: t.length, from, text: part, ...(from + n < t.length ? { more: `后面还有 ${t.length - from - n} 字：要接着读就用 from=${from + n}` } : {}) };
  }
  function tools() {
    return [
      { name: "folder_find", desc: "在对方连上的本机文件夹里找文件：按文件名和文件内容找（Word、PPT、PDF、Excel、代码、纯文本里的字都能搜）。对方提到「我的资料 / 文件夹里的 / 上次那份 / 找一下××文件」时先用它，不要让对方上传。query 几个关键词；ext 只要某种文件（docx / pdf / py…）",
        params: { query: { type: "string" }, ext: { type: "string" } }, req: ["query"], say: (a) => `在文件夹里找「${String(a.query || "").slice(0, 20)}」`, run: (a) => find(a) },
      { name: "folder_list", desc: "看连上的本机文件夹里某个子文件夹有什么（path 是相对路径，不写就是最外层）", params: { path: { type: "string" } }, say: (a) => `看文件夹「${a.path || "最外层"}」`, run: async (a) => list(a) },
      { name: "folder_read", desc: "读连上的本机文件夹里的一个文件（path 用 folder_find / folder_list 给的相对路径）。一次给 6000 字，长的用 from 接着读", params: { path: { type: "string" }, from: { type: "integer" } }, req: ["path"],
        say: (a) => `读「${String(a.path || "").split("/").pop()}」`, run: (a) => readOne(a) },
    ];
  }
  return { set, info, root, tools, find, list, read: readOne, walk, inside };
}
module.exports = { create };
