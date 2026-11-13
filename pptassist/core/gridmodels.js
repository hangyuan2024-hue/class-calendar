// 捞捞自己训练的模型（捞捞算力每天训练、评测通过才发布）：老师端自动更新，老师感觉不到。
//   · 每隔几个小时看一眼发布清单（/pub/models/manifest.json）
//   · 有新版就后台下载到 userData/grid-models/<名字>/<版本>/，核对大小和 sha256
//   · 不在用的时候才换：下一次生成形象时（use()）才换成新版，正在生成的不受影响
//   · 新版加载出问题可以退回上一版（留着上一版）；更早的删掉省硬盘
//   · 清单里没有了（管理员撤回）→ 退回清单里那一版
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SOURCES = [
  "http://43.129.244.29:8787/pub/models/manifest.json",
];

function create(o) {
  const dir = o.dir;
  fs.mkdirSync(dir, { recursive: true });
  const STATE = path.join(dir, "state.json");
  let st = { current: {}, pending: {}, checked: 0 };
  try { st = { ...st, ...JSON.parse(fs.readFileSync(STATE, "utf8")) }; } catch (e) {}
  const save = () => fs.writeFileSync(STATE, JSON.stringify(st, null, 1));
  const want = o.want || ["qversion-lora"];
  const doFetch = o.fetch || fetch;
  let busy = false, timer = null;
  const log = (m) => { try { o.onEvent && o.onEvent(m); } catch (e) {} };

  async function manifest() {
    let out = null;
    for (const u of o.sources || SOURCES) {
      try { const r = await doFetch(u + "?t=" + Date.now(), { signal: AbortSignal.timeout(15000) }); if (r.ok) { const m = await r.json(); if (m && m.models) { out = m; break; } } } catch (e) {}
    }
    // 不公开的模型（老师自己的声音）：凭声音码拿
    for (const code of (o.codes ? o.codes() : []).filter(Boolean)) {
      for (const u of o.sources || SOURCES) {
        try {
          const r = await doFetch(privateUrl(u, code) + "?t=" + Date.now(), { signal: AbortSignal.timeout(15000) });
          if (r.ok) { const m = await r.json(); if (m && m.models) { out = out || { models: {} }; Object.assign(out.models, m.models); privateNames = Object.keys(m.models); break; } }
        } catch (e) {}
      }
    }
    return out;
  }
  let privateNames = [];
  // 声音码对不对（老师在「我的声音」里填的时候先查一下）：对的话返回模型名
  async function tryCode(code) {
    for (const u of o.sources || SOURCES) {
      try { const r = await doFetch(privateUrl(u, code) + "?t=" + Date.now(), { signal: AbortSignal.timeout(15000) }); if (r.status === 404) return null; if (r.ok) { const m = await r.json(); return Object.keys(m.models || {})[0] || ""; } } catch (e) {}
    }
    throw new Error("连不上捞捞算力的服务器，等会儿再试");
  }
  async function download(url, file, size, onProg) {
    const r = await doFetch(url, { signal: AbortSignal.timeout(6 * 3600e3) });
    if (!r.ok || !r.body) throw new Error("下载失败 " + r.status);
    const tmp = file + ".part", ws = fs.createWriteStream(tmp);
    const h = crypto.createHash("sha256");
    let got = 0;
    for await (const c of r.body) { h.update(c); got += c.length; if (!ws.write(c)) await new Promise((ok) => ws.once("drain", ok)); onProg && onProg(got, size); }
    await new Promise((ok, bad) => ws.end((e) => (e ? bad(e) : ok())));
    fs.renameSync(tmp, file);
    return { size: got, sha256: h.digest("hex") };
  }

  async function check() {
    if (busy) return status();
    busy = true;
    try {
      const m = await manifest();
      st.checked = Date.now();
      if (!m) { save(); return status(); }
      for (const name of [...want, ...privateNames.filter((n) => !want.includes(n))]) {
        const rel = m.models[name];
        const cur = st.current[name];
        if (!rel) continue;
        // 管理员撤回了：清单里的版本比现在用的旧，也要换回去
        if (cur && cur.version === rel.version) { delete st.pending[name]; continue; }
        if (st.pending[name] && st.pending[name].version === rel.version) continue;
        const vd = path.join(dir, name.replace(/[^\w.\-]/g, (ch) => "_" + ch.charCodeAt(0).toString(16)), String(rel.version));
        fs.mkdirSync(vd, { recursive: true });
        const files = {};
        try {   // 一个模型下不好，不耽误别的
        for (const f of rel.files) {
          const p = path.join(vd, f.name + path.extname(new URL(f.url).pathname || ""));
          let ok = false;
          try { ok = fs.statSync(p).size === f.size; } catch (e) {}
          if (!ok) {
            log({ name, version: rel.version, stage: "download", file: f.name });
            const r = await download(f.url, p, f.size, (a, b) => log({ name, version: rel.version, stage: "progress", p: b ? a / b : 0 }));
            if ((f.size && r.size !== f.size) || (f.sha256 && r.sha256 !== f.sha256)) { fs.rmSync(p, { force: true }); throw new Error(`${name} 第 ${rel.version} 版下载不完整，下次再下`); }
          }
          files[f.name] = p;
        }
        } catch (e) { log({ name, stage: "error", error: e.message }); continue; }
        st.pending[name] = { version: rel.version, files, metrics: rel.metrics || {}, at: Date.now() };
        log({ name, version: rel.version, stage: "ready" });
      }
      save();
      return status();
    } catch (e) { log({ stage: "error", error: e.message }); return status(); }
    finally { busy = false; }
  }
  // 要用的时候才换：返回现在该用的那一版 { version, files: { 名字: 本机路径 } }，没有就是 null
  function use(name) {
    const p = st.pending[name];
    if (p) {
      const prev = st.current[name];
      st.current[name] = p; delete st.pending[name];
      st.prev = st.prev || {}; if (prev) st.prev[name] = prev;
      save();
      cleanup(name);
      log({ name, version: p.version, stage: "switched" });
    }
    const c = st.current[name];
    return c && Object.values(c.files).every((f) => fs.existsSync(f)) ? c : null;
  }
  // 新版用起来出问题：退回上一版
  function rollback(name) {
    const prev = st.prev && st.prev[name];
    if (!prev) return false;
    st.current[name] = prev; delete st.prev[name]; save();
    log({ name, version: prev.version, stage: "rollback" });
    return true;
  }
  // 只留现在的、上一版、等着换的
  function cleanup(name) {
    const keep = new Set([st.current[name], st.prev && st.prev[name], st.pending[name]].filter(Boolean).map((x) => String(x.version)));
    const d = path.join(dir, name.replace(/[^\w.\-]/g, (ch) => "_" + ch.charCodeAt(0).toString(16)));
    for (const v of fs.existsSync(d) ? fs.readdirSync(d) : []) if (!keep.has(v)) fs.rmSync(path.join(d, v), { recursive: true, force: true });
  }
  function status() { return { current: Object.fromEntries(Object.entries(st.current).map(([k, v]) => [k, { version: v.version, metrics: v.metrics }])), pending: Object.fromEntries(Object.entries(st.pending).map(([k, v]) => [k, v.version])), checked: st.checked }; }
  function start() {
    if (timer) return;
    const t0 = setTimeout(() => check().catch(() => {}), o.firstDelayMs != null ? o.firstDelayMs : 90e3);
    timer = setInterval(() => check().catch(() => {}), o.everyMs || 3 * 3600e3);
    t0.unref && t0.unref(); timer.unref && timer.unref();   // 不拖住程序退出
  }
  function stop() { clearInterval(timer); timer = null; }
  return { check, use, rollback, status, start, stop, tryCode, privateNames: () => privateNames.slice() };
}
// 公开清单的地址 → 凭码的清单地址（同一台服务器）
const privateUrl = (u, code) => u.replace(/\/pub\/models\/manifest\.json$/, "") + "/pub/private/" + encodeURIComponent(code) + "/manifest.json";

module.exports = { create, SOURCES, privateUrl };
