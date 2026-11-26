// 捞捞模型仓库：这台电脑上所有捞捞软件（捞小智 / 捞捞算力、捞小智电脑版、捞捞PPT助手）共用一份模型
//   以前每个软件各下各的：同一个 Qwen3-VL-4B（2.5G）、视觉组件（0.8G）、Qwen3-8B（5G）能在一台电脑上躺三份；
//   GPT-SoVITS（8G）、3D 引擎这些整合包也各装各的。现在：
//   · 大模型文件（.gguf）都放进一个仓库文件夹；要用先看仓库里有没有（名字 + 大小对得上就直接用），没有才下载，下载也直接下进仓库
//   · 以前各自下好的：第一次打开时收进仓库（同一个盘直接挪过去，秒完；仓库里已经有一样的就把多的那份删掉，腾出硬盘）
//   · 整合包（声音组件、3D 引擎、AI 引擎）只记「装在哪」：一个软件装过，别的软件直接用，不再装第二遍
//   · 记着每个模型哪个软件什么时候用过：插件页「本地模型」里一目了然，很久没用的能一键清掉
//   仓库在哪：记在「用户目录/.laolao/store.json」（几个软件都看这个文件）；捞捞算力选了数据文件夹（比如 D 盘），仓库就在那里
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

function create(o = {}) {
  const pointer = o.pointer || path.join(os.homedir(), ".laolao", "store.json");
  const app = o.app || "捞捞";
  const readP = () => { try { return JSON.parse(fs.readFileSync(pointer, "utf8")) || {}; } catch (e) { return {}; } };
  const writeP = (v) => { fs.mkdirSync(path.dirname(pointer), { recursive: true }); const t = pointer + ".tmp" + process.pid; fs.writeFileSync(t, JSON.stringify(v, null, 1)); fs.renameSync(t, pointer); };
  const defDir = () => (typeof o.defaultDir === "function" ? o.defaultDir() : o.defaultDir) || path.join(os.homedir(), ".laolao", "models");
  const okDir = (d) => { try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return true; } catch (e) { return false; } };

  // 仓库文件夹：store.json 里记的（还能写）→ 否则默认的那个，并记下来
  function dir() {
    const p = readP();
    if (p.dir && okDir(p.dir)) return p.dir;
    const d = defDir(); okDir(d);
    writeP({ ...p, dir: d });
    return d;
  }
  // 捞捞算力选了数据文件夹：仓库搬过去（已经有别的软件在用的仓库就不动，免得来回搬）
  function claim(d) {
    const p = readP();
    if (p.dir && fs.existsSync(p.dir) && fs.readdirSync(p.dir).some((n) => /\.gguf$/i.test(n))) return p.dir;
    if (!okDir(d)) return dir();
    writeP({ ...p, dir: d });
    return d;
  }
  const sizeOf = (f) => { try { return fs.statSync(f).size; } catch (e) { return -1; } };
  const safe = (n) => path.basename(String(n || ""));

  // 仓库里有没有：名字一样、（给了大小就）大小也一样
  function find(name, size) {
    const f = path.join(dir(), safe(name)), s = sizeOf(f);
    if (s <= 0 || (size && s !== size)) return null;
    used(name);
    return f;
  }
  const target = (name) => path.join(dir(), safe(name));
  // 记一笔「谁什么时候用过」
  function used(name) {
    try { const p = readP(); p.used = p.used || {}; const k = safe(name); p.used[k] = { ...(p.used[k] || {}), [app]: Date.now() }; writeP(p); } catch (e) {}
  }
  // 收进仓库：仓库里已经有一样的 → 删掉这份（腾硬盘）；没有 → 挪过去（同一个盘秒完，不同盘就拷过去再删）
  function adopt(file) {
    const s = sizeOf(file); if (s <= 0) return null;
    const t = target(path.basename(file));
    if (path.resolve(t) === path.resolve(file)) return t;
    const ts = sizeOf(t);
    if (ts === s) { try { fs.rmSync(file, { force: true }); } catch (e) {} return { file: t, freed: s, how: "删掉了重复的" }; }
    try { fs.renameSync(file, t); }
    catch (e) { fs.copyFileSync(file, t + ".part"); fs.renameSync(t + ".part", t); fs.rmSync(file, { force: true }); }
    return { file: t, freed: 0, how: "收进仓库" };
  }
  // 把几个旧地方（各个软件自己的 llm 文件夹）里的 .gguf 都收进来 → { moved, deduped, freed }
  function sweep(dirs) {
    const r = { moved: 0, deduped: 0, freed: 0 };
    for (const d of dirs.filter(Boolean)) {
      let names = []; try { names = fs.readdirSync(d).filter((n) => /\.gguf$/i.test(n)); } catch (e) { continue; }
      for (const n of names) {
        try { const x = adopt(path.join(d, n)); if (!x || typeof x === "string") continue; if (x.freed) { r.deduped++; r.freed += x.freed; } else r.moved++; } catch (e) {}
      }
    }
    return r;
  }
  // 整合包（目录）：装在哪
  function pack(name) { const p = readP(), d = (p.packs || {})[name]; return d && fs.existsSync(d) ? d : null; }
  function setPack(name, d) { if (!d) return; const p = readP(); p.packs = { ...(p.packs || {}), [name]: d }; writeP(p); }
  // 仓库里有什么（插件页「本地模型」用）
  function list() {
    const p = readP(), d = dir(), out = [];
    let names = []; try { names = fs.readdirSync(d).filter((n) => !n.endsWith(".part") && !n.startsWith(".")); } catch (e) {}
    for (const n of names) { const s = sizeOf(path.join(d, n)); if (s > 0) out.push({ name: n, size: s, used: (p.used || {})[n] || {} }); }
    const packs = Object.entries(p.packs || {}).map(([k, v]) => ({ name: k, dir: v, ok: fs.existsSync(v) }));
    return { dir: d, files: out.sort((a, b) => b.size - a.size), packs };
  }
  // 删掉很久没用的（days 天里哪个软件都没用过）；正在用的（keep 里的）不删
  function prune(days = 60, keep = []) {
    const now = Date.now(), r = { removed: [], freed: 0 };
    for (const f of list().files) {
      if (keep.includes(f.name)) continue;
      const last = Math.max(0, ...Object.values(f.used || {}));
      if (last && now - last < days * 864e5) continue;
      if (!last) continue;   // 没有记录的（刚收进来、还没人用过）先不删
      try { fs.rmSync(path.join(dir(), f.name), { force: true }); r.removed.push(f.name); r.freed += f.size; } catch (e) {}
    }
    return r;
  }
  function remove(name) { const f = path.join(dir(), safe(name)), s = sizeOf(f); fs.rmSync(f, { force: true }); return { freed: Math.max(0, s) }; }
  return { dir, claim, find, target, used, adopt, sweep, pack, setPack, list, prune, remove, pointer };
}
module.exports = { create };
