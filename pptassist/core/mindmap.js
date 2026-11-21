// 捞小智 · 接入捞捞思维导图（学习捞捞队的模块，learn/mindmap/）
//   不改、不拷他们的代码：只走导图模块自己公开的本机接口（/api/maps：列表、读、存），和它存下来的 map.json 格式打交道。
//   · 找导图服务：捞捞课程表电脑版（127.0.0.1:18097 起，第一次打开思维导图时启动）、独立版（127.0.0.1:8796）
//     服务没开：直接读电脑版存导图的文件夹（%APPDATA%\捞捞课程表\mindmap\maps）；新建的导图也写到那里（只新建，不改别人的文件）
//   · 捞小智能：列出导图、读一张导图（变成缩进大纲）、照大纲新建一张导图、在某个节点下面接着加分支
//   · 导图也是「先核对再回答」的资料：按分支切段，回答里标「导图：xx › 分支」
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");

const PORTS = [18097, 18098, 18099, 18100, 18101, 8796, 8794];
const MAX_NODES = 1500;

function req(port, method, p, body, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({ host: "127.0.0.1", port, method, path: p, timeout, headers: { ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}) } }, (res) => {
      let s = ""; res.setEncoding("utf8"); res.on("data", (c) => (s += c));
      res.on("end", () => { let j = null; try { j = JSON.parse(s); } catch (e) {} if (res.statusCode >= 400) return reject(new Error((j && j.error) || "导图服务出错（" + res.statusCode + "）")); resolve(j); });
    });
    r.on("timeout", () => r.destroy(new Error("导图服务没响应")));
    r.on("error", reject);
    r.end(data);
  });
}

// ---------------- map.json ↔ 缩进大纲 ----------------
// 存下来的导图有两种：v3 平铺（nodes 都是一层，层级在 edges 里，kind 不是 relation 的是上下级）、老的嵌套（children 里套 children）
function tree(map) {
  const nodes = Array.isArray(map && map.nodes) ? map.nodes : [];
  const byId = new Map();
  const add = (n) => { if (!n || typeof n !== "object") return; byId.set(String(n.id), n); for (const c of n.children || []) add(c); };
  nodes.forEach(add);
  const kids = new Map([...byId.keys()].map((k) => [k, []])), has = new Set();
  const flat = map.flat || (Array.isArray(map.edges) && map.edges.length);
  if (flat) {
    for (const e of map.edges || []) {
      const a = e && e.from && String(e.from.node), b = e && e.to && String(e.to.node);
      if (!a || !b || a === b || e.kind === "relation" || !kids.has(a) || !kids.has(b) || has.has(b)) continue;
      kids.get(a).push(b); has.add(b);
    }
  }
  for (const n of byId.values()) for (const c of n.children || []) if (c && !has.has(String(c.id))) { kids.get(String(n.id)).push(String(c.id)); has.add(String(c.id)); }
  const roots = [...byId.keys()].filter((k) => !has.has(k));
  const pos = map.pos || {};
  const order = (ids) => ids.slice().sort((a, b) => ((pos[a] || {}).y || 0) - ((pos[b] || {}).y || 0));
  return { byId, kids, roots: order(roots), order };
}
const clean = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/\s*\n+\s*/g, " ").trim();
function toOutline(map, { notes = true, max = 12000 } = {}) {
  const { byId, kids, roots, order } = tree(map), seen = new Set(), lines = [];
  const walk = (id, d) => {
    if (seen.has(id)) return; seen.add(id);
    const n = byId.get(id), t = clean(n.text);
    if (t) lines.push("  ".repeat(d) + "- " + t);
    if (notes && n.note && clean(n.note)) lines.push("  ".repeat(d + 1) + "（备注：" + clean(n.note).slice(0, 300) + "）");
    for (const c of order(kids.get(id))) walk(c, d + 1);
  };
  roots.forEach((r) => walk(r, 0));
  const s = lines.join("\n");
  return s.length > max ? s.slice(0, max) + "\n……（后面还有，太长截掉了）" : s;
}
// 缩进大纲（「- 」开头，两个空格一层；也认 # 标题、1. / 1.1 编号）→ 树
function parseOutline(text, title) {
  const rows = String(text || "").split(/\r?\n/).filter((s) => s.trim());
  if (!rows.length) throw new Error("大纲是空的");
  const ind = (s) => (s.match(/^[ \t]*/)[0].replace(/\t/g, "  ").length);
  const margin = Math.min(...rows.map(ind));
  const root = { text: String(title || "思维导图").trim().slice(0, 80) || "思维导图", children: [] }, stack = [{ level: -1, node: root }];
  let n = 1;
  for (const raw of rows) {
    let label = raw.trim().replace(/^[-*+•]\s+/, "").trim(), level = Math.floor((ind(raw) - margin) / 2), m;
    if (!label) continue;
    if ((m = /^(#{1,6})\s+(.+)$/.exec(label))) { level = Math.max(level, m[1].length - 1); label = m[2]; }
    else if ((m = /^(\d+(?:\.\d+)+)\s*(.+)$/.exec(label))) { level = Math.max(level, m[1].split(".").length - 1); label = m[2]; }
    if (++n > MAX_NODES) throw new Error("节点太多（最多 " + MAX_NODES + " 个）：拆成几张导图");
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const node = { text: label.slice(0, 500), children: [] };
    stack[stack.length - 1].node.children.push(node); stack.push({ level, node });
  }
  if (!root.children.length) throw new Error("大纲里没有有效的条目");
  return root;
}
// 树 → v3 平铺的 map.json（导图模块自己存的样子：nodes 一层、上下级在 edges、pos / size 排好）
let seq = 0;
const newId = (p) => p + Date.now().toString(36) + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);
function place(map, rootId, x0, y0) {
  const { kids, order } = tree(map);
  let row = 0;
  const go = (id, d) => { const ys = order(kids.get(id) || []).map((c) => go(c, d + 1)); const y = ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : y0 + row++ * 155; map.pos[id] = { x: x0 + d * 350, y }; map.size[id] = map.size[id] || { w: 280, h: 100 }; return y; };
  go(rootId, 0);
}
function fromTree(root, { id, title } = {}) {
  const map = { id: id || newId("lx"), title: String(title || root.text).trim().slice(0, 80) || "思维导图", nodes: [], edges: [], pos: {}, size: {}, v: 3, flat: true, line: "curve", from: "捞小智" };
  const walk = (n, parent) => {
    const nid = newId("n");
    map.nodes.push({ id: nid, text: n.text, ...(n.note ? { note: n.note } : {}), children: [] });
    if (parent) map.edges.push({ id: "tree-" + nid, from: { node: parent, side: "e" }, to: { node: nid, side: "w" }, dir: "fwd", kind: "hierarchy" });
    for (const c of n.children || []) walk(c, nid);
    return nid;
  };
  place(map, walk(root, null), 0, 0);
  return map;
}
// 在 map 的某个节点下面接一棵树（id 不重复；新分支排在原来所有节点的下面）
function graft(map, parentId, nodes) {
  if (!map.flat) { map.nodes = flatten(map); map.flat = true; map.v = 3; }
  map.pos = map.pos || {}; map.size = map.size || {}; map.edges = map.edges || [];
  const count = (ns) => ns.reduce((a, n) => a + 1 + count(n.children || []), 0);
  if (map.nodes.length + count(nodes) > MAX_NODES) throw new Error("加上去节点就太多了（最多 " + MAX_NODES + " 个）");
  const maxY = Math.max(0, ...Object.values(map.pos).map((p) => (p && p.y) || 0));
  const px = (map.pos[parentId] || { x: 0 }).x;
  const added = [];
  const walk = (n, parent) => {
    const nid = newId("n");
    map.nodes.push({ id: nid, text: n.text, children: [] }); added.push(nid);
    map.edges.push({ id: "tree-" + nid, from: { node: parent, side: "e" }, to: { node: nid, side: "w" }, dir: "fwd", kind: "hierarchy" });
    for (const c of n.children || []) walk(c, nid);
    return nid;
  };
  const tops = nodes.map((n) => walk(n, parentId));
  const sub = { nodes: map.nodes, edges: map.edges, pos: {}, size: {}, flat: true };
  let y = maxY + 200;
  for (const t of tops) { place(sub, t, px + 350, y); y = Math.max(...Object.values(sub.pos).map((p) => p.y)) + 155; }
  for (const k of added) { map.pos[k] = sub.pos[k]; map.size[k] = sub.size[k]; }
  return added;
}
function flatten(map) {
  const out = [];
  const walk = (n, parent) => { const id = String(n.id); out.push({ ...n, id, children: [] }); if (parent) map.edges.push({ id: "tree-" + id, from: { node: parent, side: "e" }, to: { node: id, side: "w" }, dir: "fwd", kind: "hierarchy" }); for (const c of n.children || []) walk(c, id); };
  map.edges = map.edges || [];
  for (const n of map.nodes) walk(n, null);
  return out;
}

// ---------------- 连上导图 ----------------
// o.dirs：没开服务时直接读的文件夹（默认电脑版的 %APPDATA%\捞捞课程表\mindmap\maps）；o.ports
function create(o = {}) {
  const dirs = o.dirs || [path.join(process.env.APPDATA || path.join(os.homedir(), ".config"), "捞捞课程表", "mindmap", "maps")];
  const ports = o.ports || PORTS;
  let port = null, lastFind = 0;
  async function find() {
    if (port && Date.now() - lastFind < 15000) return port;
    lastFind = Date.now();
    for (const p of port ? [port, ...ports.filter((x) => x !== port)] : ports) {
      try { const j = await req(p, "GET", "/api/maps", null, 1200); if (j && Array.isArray(j.maps)) return (port = p); } catch (e) {}
    }
    port = null; return null;
  }
  const dirOf = () => dirs.find((d) => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } }) || null;
  const readFile = (d, id) => { try { return JSON.parse(fs.readFileSync(path.join(d, id, "map.json"), "utf8")); } catch (e) { return null; } };

  async function list() {
    const p = await find();
    if (p) { const j = await req(p, "GET", "/api/maps"); return { via: "service", port: p, maps: (j.maps || []).map((m) => ({ id: m.id, title: m.title || "", updated: m.updated || 0 })).sort((a, b) => b.updated - a.updated) }; }
    const d = dirOf();
    if (!d) return { via: "none", maps: [] };
    const maps = fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && /^[a-zA-Z0-9_-]{1,100}$/.test(e.name)).flatMap((e) => {
      const f = path.join(d, e.name, "map.json"); try { const m = JSON.parse(fs.readFileSync(f, "utf8")); return m && m.id === e.name ? [{ id: m.id, title: m.title || "", updated: fs.statSync(f).mtimeMs }] : []; } catch (x) { return []; }
    });
    return { via: "files", dir: d, maps: maps.sort((a, b) => b.updated - a.updated) };
  }
  async function get(id) {
    const p = await find();
    if (p) return req(p, "GET", "/api/maps/" + encodeURIComponent(id));
    const d = dirOf(), m = d && readFile(d, id);
    if (!m) throw new Error("找不到这张导图");
    return m;
  }
  // 按编号或名字找（名字：完全一样 > 包含）
  async function resolve(key) {
    const k = String(key || "").trim();
    if (!k) throw new Error("要哪一张导图（写名字）");
    const { maps } = await list();
    const m = maps.find((x) => x.id === k) || maps.find((x) => x.title === k) || maps.find((x) => x.title && (x.title.includes(k) || k.includes(x.title)));
    if (!m) throw new Error(`没找到叫「${k}」的导图${maps.length ? "（现在有：" + maps.slice(0, 8).map((x) => x.title).join("、") + "）" : "（还没有导图，或者思维导图没打开过）"}`);
    return m;
  }
  async function save(map) {
    const p = await find();
    if (p) { await req(p, "PUT", "/api/maps/" + encodeURIComponent(map.id), map, 10000); return { via: "service", port: p }; }
    const d = dirOf() || (fs.mkdirSync(dirs[0], { recursive: true }), dirs[0]);
    const dir = path.join(d, map.id);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, "map.json"), tmp = f + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2)); fs.renameSync(tmp, f);
    return { via: "files", dir };
  }
  async function make(title, outline) {
    const map = fromTree(parseOutline(outline, title), { title });
    const r = await save(map);
    return { id: map.id, title: map.title, nodes: map.nodes.length, ...r };
  }
  // 在 under（节点的文字）下面接着加；under 不写就接在中心主题下面
  async function add(key, under, outline) {
    const m = await resolve(key);
    const map = await get(m.id);
    const { byId, roots } = tree(map);
    let pid = roots[0];
    if (under) {
      const u = String(under).trim(), all = [...byId.values()];
      const hit = all.find((n) => clean(n.text) === u) || all.find((n) => clean(n.text).includes(u));
      if (!hit) throw new Error(`导图「${map.title}」里没有「${u}」这个节点`);
      pid = String(hit.id);
    }
    const before = (await list()).maps.find((x) => x.id === m.id);
    const sub = parseOutline(outline, "x").children;
    const added = graft(map, pid, sub);
    const now = (await list()).maps.find((x) => x.id === m.id);
    if (before && now && now.updated !== before.updated) throw new Error("这张导图刚被改过（可能正在编辑器里打开）：先在导图里保存，再让我加");
    const r = await save(map);
    return { id: map.id, title: map.title, added: added.length, under: clean(byId.get(pid).text), ...r };
  }

  // 给「先核对再回答」当资料：每张导图按一级分支切段（太长再切）
  let cache = { sig: "", chunks: [] };
  async function chunks() {
    const { maps } = await list();
    const sig = maps.map((m) => m.id + ":" + m.updated).join("|");
    if (sig === cache.sig) return cache.chunks;
    const out = [];
    for (const m of maps.slice(0, 60)) {
      let map; try { map = await get(m.id); } catch (e) { continue; }
      const { byId, kids, roots, order } = tree(map);
      for (const r of roots) {
        const head = clean(byId.get(r).text);
        const branches = order(kids.get(r));
        if (!branches.length) { out.push({ title: "导图：" + m.title, src: "思维导图：" + m.title, text: head }); continue; }
        for (const b of branches) {
          const sub = { ...map, nodes: map.nodes, edges: map.edges };
          const lines = toOutline(sub, { max: 1e9 }).split("\n");
          // 只要这一枝：从 b 开始的那段
          const bt = clean(byId.get(b).text), i = lines.findIndex((l) => l === "  - " + bt);
          let seg = [];
          if (i >= 0) { seg.push(lines[i]); for (let j = i + 1; j < lines.length && /^ {4}/.test(lines[j]); j++) seg.push(lines[j]); }
          else seg = ["- " + bt];
          const text = head + " › " + seg.map((l) => l.trim()).join("\n");
          for (let k = 0; k < text.length; k += 600) out.push({ title: "导图：" + m.title + " › " + bt, src: "思维导图：" + m.title, text: text.slice(k, k + 600) });
        }
      }
    }
    cache = { sig, chunks: out };
    return out;
  }

  function tools() {
    const where = (r) => (r.via === "service" ? "已经存进思维导图（打开思维导图的导图库就能看到）" : "思维导图现在没开：先存在电脑版的导图文件夹里，下次打开思维导图就在导图库里");
    return [
      { name: "mindmap_list", desc: "列出这台电脑上「捞捞思维导图」里的导图（名字、最近修改）", params: {}, req: [], say: () => "看看有哪些思维导图",
        run: async () => { const r = await list(); return { maps: r.maps.slice(0, 30).map((m) => ({ title: m.title, updated: m.updated ? new Date(m.updated).toLocaleString("zh-CN") : "" })), total: r.maps.length, ...(r.via === "none" ? { tip: "还没找到思维导图：在捞捞课程表电脑版里打开一次「思维导图」" } : {}) }; } },
      { name: "mindmap_read", desc: "读一张思维导图，变成缩进大纲（每个分支、备注都在）。照导图讲、照导图做 PPT、出题前先读", params: { map: { type: "string", description: "导图的名字" } }, req: ["map"],
        say: (a) => `读思维导图「${String(a.map || "").slice(0, 20)}」`, run: async (a) => { const m = await resolve(a.map); const map = await get(m.id); return { title: map.title, outline: toOutline(map) }; } },
      { name: "mindmap_make", desc: "新建一张思维导图：outline 是缩进大纲，每行「- 」开头，下一级多缩进两个空格；第一层就是中心主题下面的几大分支。把一节课、一份 PPT、一段资料整理成导图时用", changes: true,
        params: { title: { type: "string", description: "中心主题（导图名字）" }, outline: { type: "string", description: "缩进大纲" } }, req: ["title", "outline"],
        say: (a) => `做一张思维导图「${String(a.title || "").slice(0, 20)}」`, run: async (a) => { const r = await make(a.title, a.outline); return { ok: true, title: r.title, nodes: r.nodes, where: where(r) }; } },
      { name: "mindmap_add", desc: "在一张已有的思维导图里接着加分支：under 是挂在哪个节点下面（节点上的文字，不写就挂在中心主题下），outline 是要加的缩进大纲", changes: true,
        params: { map: { type: "string", description: "导图的名字" }, under: { type: "string" }, outline: { type: "string" } }, req: ["map", "outline"],
        say: (a) => `在思维导图「${String(a.map || "").slice(0, 16)}」里加分支`, run: async (a) => { const r = await add(a.map, a.under, a.outline); return { ok: true, title: r.title, under: r.under, added: r.added, where: where(r) }; } },
    ];
  }
  return { find, list, get, resolve, make, add, save, chunks, tools };
}

module.exports = { create, toOutline, parseOutline, fromTree, graft, tree, PORTS };
