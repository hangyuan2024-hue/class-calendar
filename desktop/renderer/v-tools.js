// 工具箱：网页版插件商店里的工具，电脑上也能添加、移除、更新、看更新日志、打开使用。
// 安全：工具一律在「隔离间」sandbox.html 里运行（iframe sandbox，不同源），拿不到登录信息、读不到软件的数据；
// 和这里只通过 postMessage 交换数据，这里逐项检查。工具自己的数据存在这台电脑上（每个工具一份）。
// 加了哪些工具和网页版同步（plugins_enabled_v1）；工具往日历里加的事项会显示在「月历」里。
"use strict";
const SANDBOX_FLAGS = "allow-scripts allow-forms allow-popups allow-modals allow-downloads";   // 绝不加 allow-same-origin
const SAFE_CSS = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([\d\s.,%/]+\)|[a-z]{3,20})$/i;
// 工具用的是网页版的颜色名，换成电脑版的
const THEME_MAP = { bg: "--bg", bg2: "--bg2", card: "--panel", line: "--line", text: "--text", sub: "--text2", accent: "--brand", red: "--bad", green: "--ok", "muted-text": "--muted", hover: "--bg2" };
const verNewer = (a, b) => { const x = String(a || "0").split(".").map((n) => parseInt(n, 10) || 0), y = String(b || "0").split(".").map((n) => parseInt(n, 10) || 0); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

// ---------- 本机存储：工具代码 + 工具自己的数据（IndexedDB） ----------
const IDB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res) => {
    try { const r = indexedDB.open("cc_desktop_plugins", 1); r.onupgradeneeded = () => { r.result.createObjectStore("code"); r.result.createObjectStore("kv"); }; r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (e) { res(null); }
  }));
  const req = (store, mode, fn) => open().then((db) => new Promise((res) => { if (!db) return res(undefined); try { const q = fn(db.transaction(store, mode).objectStore(store)); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch (e) { res(undefined); } }));
  return {
    code: { get: (id) => req("code", "readonly", (s) => s.get(id)), put: (id, v) => req("code", "readwrite", (s) => s.put(v, id)), del: (id) => req("code", "readwrite", (s) => s.delete(id)) },
    kvAll: (ns) => open().then((db) => new Promise((res) => {
      const out = {}; if (!db) return res(out);
      const rq = db.transaction("kv", "readonly").objectStore("kv").openCursor(IDBKeyRange.bound(ns + "\u0000", ns + "\u0000￿"));
      rq.onsuccess = () => { const c = rq.result; if (c) { out[String(c.key).slice(ns.length + 1)] = c.value; c.continue(); } else res(out); };
      rq.onerror = () => res(out);
    })),
    kvPut: (ns, k, v) => req("kv", "readwrite", (s) => (v == null ? s.delete(ns + "\u0000" + k) : s.put(v, ns + "\u0000" + k))),
    kvClear: (ns) => req("kv", "readwrite", (s) => s.delete(IDBKeyRange.bound(ns + "\u0000", ns + "\u0000￿"))),
  };
})();

const Plugins = {
  registry: [], state: {}, frames: new Map(), tabs: [], itemsCache: {}, regAt: 0, regErr: "", loading: null, started: false, clog: {},
  staff() { return (App.S.perms || []).includes("try_testing"); },
  enabled() { const v = KV("plugins_enabled_v1"); if (Array.isArray(v)) return new Set(v); return new Set(this.registry.filter((p) => p.default_on && p.channel === "published").map((p) => p.key)); },
  setEnabled(set) { return kvSet("plugins_enabled_v1", "_", [...set]); },
  cache() { return lsGet("cc_plugin_cache", {}); },
  pub(rows) { return (rows || []).filter((p) => p.published_at).map((p) => ({ ...p, key: p.id, ns: p.id, channel: "published" })); },
  // 打开软件时：用顺带拿到的列表，装过的工具直接从本机运行
  async start() {
    if (this.started || !App.S.loggedIn) return; this.started = true;
    this.registry = this.pub(App.S.plugins || lsGet("cc_plugin_reg", []));
    if (App.S.plugins) lsSet("cc_plugin_reg", App.S.plugins);
    for (const m of this.registry) this.state[m.key] = this.state[m.key] || { meta: m, error: "" };
    const on = this.enabled();
    if (this.staff() && [...on].some((k) => k.endsWith("@test"))) await this.refresh(true);
    for (const meta of this.registry) {
      if (!on.has(meta.key)) continue;
      try { const r = (meta.channel === "published" && this.cache()[meta.id] && await IDB.code.get(meta.id)) || await this.fetchCode(meta); await this.run(meta, r.code, r.app_html); }
      catch (e) { this.state[meta.key].error = cleanErr(e); }
    }
    App.views.tools.draw();
  },
  async refresh(force) {
    if (this.loading) return this.loading;
    if (!force && Date.now() - this.regAt < 300000) return;
    this.loading = (async () => {
      this.regErr = ""; App.views.tools.draw();
      try {
        const rows = await apiGet("plugins?select=id,name,icon,description,version,author_name,default_on,published_at&order=created_at.asc");
        const list = this.pub(rows);
        if (this.staff()) {
          const drafts = await apiGet("plugin_drafts?select=plugin_id,name,icon,description,version,status&status=eq.testing").catch(() => []);
          for (const d of drafts) { const base = rows.find((p) => p.id === d.plugin_id) || {}; list.push({ id: d.plugin_id, key: d.plugin_id + "@test", ns: d.plugin_id + "@test", name: d.name, icon: d.icon, description: d.description, version: d.version, author_name: base.author_name, channel: "testing", liveVersion: base.published_at ? base.version : null }); }
        }
        this.registry = list; this.regAt = Date.now(); lsSet("cc_plugin_reg", rows);
        for (const m of list) { const st = this.state[m.key]; if (st) st.meta = m; else this.state[m.key] = { meta: m, error: "" }; }
        // 已经下架的：删掉本机存的代码
        const cache = this.cache(), live = new Set(list.filter((p) => p.channel === "published").map((p) => p.id));
        for (const id of Object.keys(cache)) if (!live.has(id)) { delete cache[id]; IDB.code.del(id); }
        lsSet("cc_plugin_cache", cache);
      } catch (e) { this.regErr = cleanErr(e); }
      finally { this.loading = null; App.views.tools.draw(); }
    })();
    return this.loading;
  },
  async fetchCode(meta) {
    if (meta.channel === "published") {
      const r = (await apiGet(`plugins?select=code,app_html,version&id=eq.${meta.id}`))[0]; if (!r) throw new Error("工具内容读取失败");
      const body = { code: r.code, app_html: r.app_html, version: r.version || meta.version };
      await IDB.code.put(meta.id, body);
      const cache = this.cache(); cache[meta.id] = { version: body.version, at: Date.now() }; lsSet("cc_plugin_cache", cache);
      return body;
    }
    const r = (await apiGet(`plugin_drafts?select=code,app_html&plugin_id=eq.${meta.id}`))[0]; if (!r) throw new Error("测试版读取失败");
    return r;
  },
  async run(meta, code, html) {
    const st = this.state[meta.key]; st.code = code || ""; st.html = html || "";
    if (code) await this.open(meta.key, "bg", document.body);
    else if (html) this.addTab({ key: meta.key, meta, appOnly: true }, "main", meta.name);
    st.running = true;
  },
  classItems() { return (App.S.items || []).map(({ id, msg_type, subject, summary, event_time, location, prepare, need_confirm, publish_date }) => ({ id, msg_type, subject, summary, event_time, location, prepare, need_confirm, publish_date })); },
  theme() { const cs = getComputedStyle(document.documentElement), o = {}; for (const [k, v] of Object.entries(THEME_MAP)) { const x = cs.getPropertyValue(v).trim(); if (x) o[k] = x; } o.ink = o.text; o["ink-text"] = o.card; return o; },
  async open(key, mode, holder, opts = {}) {
    const st = this.state[key]; if (!st) return null;
    const token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", SANDBOX_FLAGS); frame.setAttribute("referrerpolicy", "no-referrer"); frame.title = st.meta.name; frame.className = "plugin-frame";
    frame.style.cssText = mode === "bg" ? "display:none" : `width:100%;border:0;display:block;min-height:${mode === "app" ? opts.minHeight || "70vh" : "60px"}`;
    const rec = { key, meta: st.meta, mode, frame, tabId: opts.tabId, post: (m) => { try { frame.contentWindow && frame.contentWindow.postMessage(m, "*"); } catch (e) {} } };
    for (const [t, f] of this.frames) if (f.attached && !f.frame.isConnected && f.mode !== "bg") this.frames.delete(t);
    this.frames.set(token, rec);
    holder.appendChild(frame); rec.attached = true;
    const store = await IDB.kvAll(st.meta.ns);
    rec.init = () => rec.post({ cc: "init", token, mode, tabId: opts.tabId || "", plugin: { ...st.meta }, code: st.code || "", html: st.html || "", store, items: this.classItems(), date: todayKey(), theme: this.theme() });
    rec.wantInit = true;
    frame.addEventListener("load", () => { if (frame.getAttribute("src")) rec.init(); });
    frame.src = "sandbox.html";
    return frame;
  },
  // 标题自己带了表情（比如「📝 日记」）就拆出来当图标，避免显示两个
  splitTitle(t) { const m = /^(\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}]*)\s*(.+)$/u.exec(t.title); return m ? [m[1], m[2]] : [t.icon, t.title]; },
  addTab(f, id, title) {
    const tid = `${f.meta.id}:${String(id).replace(/[^\w-]/g, "").slice(0, 40)}`;
    if (this.tabs.some((t) => t.id === tid) || this.tabs.filter((t) => t.plugin === f.key).length >= 5) return;
    this.tabs.push({ id: tid, title: String(title || f.meta.name).slice(0, 40), icon: f.meta.icon || "🧩", plugin: f.key, tabId: String(id), appOnly: !!f.appOnly });
    App.views.tools.draw();
  },
  // 工具往日历里加的事项（月历用）
  items(start, end) {
    const range = start + "|" + end, out = [];
    for (const f of this.frames.values()) {
      if (f.mode !== "bg" || !f.hasSource) continue;
      const c = this.itemsCache[f.key];
      if ((!c || c.range !== range) && f.pending !== range) { f.pending = range; f.post({ cc: "items-req", reqId: range, start, end }); }
      if (c && c.range === range) out.push(...c.list);
    }
    return out;
  },
  accept(f, reqId, list) {
    if (!Array.isArray(list)) return;
    const clean = [];
    list.slice(0, 3000).forEach((it, i) => {
      if (!it || !/^\d{4}-\d{2}-\d{2}$/.test(String(it.date || ""))) return;
      clean.push({ key: `x_${f.key}_${String(it.id ?? i).slice(0, 80)}`, plugin: f.meta.name, title: String(it.title || "").slice(0, 100), detail: String(it.detail || "").slice(0, 500), location: String(it.location || "").slice(0, 100),
        day: it.date, time: /^\d{2}:\d{2}$/.test(String(it.time || "")) ? it.time : "", color: SAFE_CSS.test(String(it.color || "")) ? it.color : "" });
    });
    const old = this.itemsCache[f.key]; f.pending = null;
    this.itemsCache[f.key] = { range: reqId, list: clean };
    if (!old || JSON.stringify(old.list) !== JSON.stringify(clean)) { if (App.views.month.el) App.views.month.update(); }
  },
};
window.addEventListener("message", (e) => {
  const d = e.data;
  if (d && d.cc === "ready") { for (const f of Plugins.frames.values()) if (f.wantInit && f.frame.contentWindow === e.source) { f.init(); break; } return; }
  if (!d || typeof d !== "object" || typeof d.token !== "string") return;
  const f = Plugins.frames.get(d.token);
  if (!f || !f.frame.contentWindow || e.source !== f.frame.contentWindow) return;   // 只认我们自己开的隔离间
  const st = Plugins.state[f.key];
  switch (d.cc) {
    case "set": case "del": {
      const k = String(d.key || "").slice(0, 200), v = d.cc === "set" ? String(d.value ?? "") : null;
      if (v != null && v.length > 5_000_000) return;
      IDB.kvPut(f.meta.ns, k, v);
      for (const o of Plugins.frames.values()) if (o !== f && o.meta.ns === f.meta.ns) o.post({ cc: "store", key: k, value: v });
      if (f.mode !== "bg") { delete Plugins.itemsCache[f.key]; clearTimeout(Plugins._rt); Plugins._rt = setTimeout(() => App.views.month.el && App.views.month.update(), 300); }
      break;
    }
    case "clear": IDB.kvClear(f.meta.ns); break;
    case "h": if (f.mode !== "bg") f.frame.style.height = Math.max(60, Math.min(20000, Number(d.h) || 0)) + "px"; break;
    case "tab": if (f.mode === "bg") Plugins.addTab(f, String(d.id || "").slice(0, 40), d.title); break;
    case "source": if (f.mode === "bg") { f.hasSource = true; if (App.views.month.el) App.views.month.update(); } break;
    case "items": if (f.mode === "bg") Plugins.accept(f, String(d.reqId), d.list); break;
    case "theme":
      if (f.mode === "app" || !d.vars || typeof d.vars !== "object") break;
      for (const [k, v] of Object.entries(d.vars)) if (THEME_MAP[k] && SAFE_CSS.test(String(v))) document.documentElement.style.setProperty(THEME_MAP[k], String(v));
      break;
    case "resetTheme": if (f.mode !== "app") for (const v of Object.values(THEME_MAP)) document.documentElement.style.removeProperty(v); break;
    case "refresh": Plugins.itemsCache = {}; if (App.views.month.el) App.views.month.update(); break;
    case "goto": if (/^\d{4}-\d{2}-\d{2}$/.test(String(d.date))) App.go("month", { day: d.date }); break;
    case "mountApp":
      if (f.mode === "tab" && st && st.html && !f.mounted) {
        f.mounted = true; f.frame.style.display = "none";   // 标签页只是个壳，换成工具自己的页面
        const mh = String(d.minHeight || ""); Plugins.open(f.key, "app", f.frame.parentElement, { minHeight: /^\d{1,4}(px|vh)$/.test(mh) ? mh : "" });
      }
      break;
    case "loaded": if (st) { st.loaded = true; App.views.tools.draw(); } break;
    case "error": if (st) { st.error = String(d.msg || "").slice(0, 200); App.views.tools.draw(); } break;
  }
});

App.views.tools = {
  title: "工具箱", icon: "tools", cur: null,
  mount(el) {
    el.innerHTML = `<div class="vhead"><button class="btn ghost iconbtn hidden" id="tlBack" title="返回工具箱">${icon("left")}</button><div><h1 id="tlTitle">工具箱</h1><div class="sub" id="tlSub">同学们做的小工具，和网页版同一个商店；在隔离环境里运行，拿不到你的登录信息</div></div><span class="grow"></span>
        <button class="btn" id="tlRe">${icon("sync")}检查更新</button></div>
      <div class="vbody"><div id="tlHome"><div class="tl-grid" id="tlGrid"></div><div class="sec-h"><b>添加工具</b><span id="tlSt"></span></div><div id="tlStore"></div></div><div id="tlPage" class="hidden tl-page"></div></div>`;
    $("#tlBack", el).onclick = () => this.openTab(null);
    $("#tlRe", el).onclick = () => Plugins.refresh(true);
    el.addEventListener("click", (e) => this.click(e));
    el.addEventListener("toggle", (e) => { const d = e.target; if (d.matches && d.matches("details[data-clog]") && d.open) this.loadClog(d.dataset.clog); }, true);
  },
  show() { Plugins.start().then(() => Plugins.refresh()); },
  update() { this.draw(); },
  draw() {
    const el = this.el; if (!el) return;
    const on = Plugins.enabled(), cache = Plugins.cache();
    $("#tlGrid", el).innerHTML = Plugins.tabs.map((t) => { const [ic, ti] = Plugins.splitTitle(t); return `<button class="card tl-tool" data-tab="${esc(t.id)}"><span>${esc(ic)}</span><b>${esc(ti)}</b></button>`; }).join("")
      || `<div class="muted" style="padding:8px 0">${Plugins.started ? "还没有添加工具。在下面挑一个吧。" : "正在启动工具…"}</div>`;
    const t = Plugins.regAt ? new Date(Plugins.regAt) : null;
    $("#tlSt", el).textContent = Plugins.loading ? "正在看看有没有新工具和更新…" : Plugins.regErr ? "连不上服务器，下面是上次看到的列表" : t ? `${M.pad(t.getHours())}:${M.pad(t.getMinutes())} 检查过` : "";
    $("#tlStore", el).innerHTML = Plugins.registry.map((p) => {
      const st = Plugins.state[p.key] || {}, isOn = on.has(p.key), testing = p.channel === "testing", local = p.channel === "published" ? cache[p.id] : null;
      const upd = isOn && local && verNewer(p.version, local.version);
      const btn = st.busy ? `<button class="btn sm" disabled>${esc(st.busy)}</button>` : upd ? `<button class="btn primary sm" data-upd="${esc(p.key)}">更新到 v${esc(p.version)}</button><button class="btn sm" data-tog="${esc(p.key)}">移除</button>` : `<button class="btn sm ${isOn ? "" : "primary"}" data-tog="${esc(p.key)}">${isOn ? "移除" : "添加"}</button>`;
      return `<div class="card tl-item"><span class="tl-ic">${esc(p.icon || "🧩")}</span><div class="tl-m"><b>${esc(p.name)} <span class="tag">v${esc((local && isOn ? local.version : p.version) || "1")}</span>${isOn && !testing ? `<span class="tag" style="--c:var(--ok)">已添加</span>` : ""}${testing ? `<span class="tag" style="--c:var(--warn)">测试中${p.liveVersion ? "（线上 v" + esc(p.liveVersion) + "）" : "（未上线）"}</span>` : ""}</b>
          <div class="muted">${esc(p.description || "")}</div><small class="muted">作者：${esc(p.author_name || "未知")}</small>${st.error ? `<div class="tl-err">出错：${esc(st.error)}</div>` : ""}
          ${p.channel === "published" ? `<details data-clog="${esc(p.id)}"><summary>更新日志</summary><div class="tl-clog">${this.clogHtml(p.id)}</div></details>` : ""}</div><div class="tl-b">${btn}</div></div>`;
    }).join("") || `<div class="empty">${Plugins.loading ? "正在读取…" : "暂时没有可以添加的工具"}</div>`;
  },
  clogHtml(id) {
    const c = Plugins.clog[id]; if (!c) return "正在读取…"; if (c.error) return "暂时看不到更新日志"; if (!c.length) return "还没有更新日志";
    return c.map((x) => `<div><b>v${esc(x.version || "")}</b> <small class="muted">${x.at ? new Date(x.at).toLocaleDateString("zh-CN") : ""}</small><p>${esc(x.notes || "（作者没写说明）")}</p></div>`).join("");
  },
  async loadClog(id) { if (Plugins.clog[id]) return; try { const r = await api("plugin_changelog", { pid: id }, true); Plugins.clog[id] = Array.isArray(r) ? r : []; } catch (e) { Plugins.clog[id] = { error: true }; } const d = $(`details[data-clog="${CSS.escape(id)}"] .tl-clog`, this.el); if (d) d.innerHTML = this.clogHtml(id); },
  openTab(id) {
    const el = this.el, t = Plugins.tabs.find((x) => x.id === id);
    this.cur = t ? id : null;
    $("#tlHome", el).classList.toggle("hidden", !!t); $("#tlPage", el).classList.toggle("hidden", !t); $("#tlBack", el).classList.toggle("hidden", !t); $("#tlRe", el).classList.toggle("hidden", !!t);
    $("#tlTitle", el).textContent = t ? Plugins.splitTitle(t).join(" ") : "工具箱";
    $("#tlSub", el).textContent = t ? "这个工具运行在隔离环境里，它的数据只存在这台电脑上" : "同学们做的小工具，和网页版同一个商店；在隔离环境里运行，拿不到你的登录信息";
    if (!t) return;
    const page = $("#tlPage", el); page.innerHTML = "";
    Plugins.open(t.plugin, t.appOnly ? "app" : "tab", page, { tabId: t.tabId });
  },
  async click(e) {
    const tb = e.target.closest("[data-tab]"); if (tb) return this.openTab(tb.dataset.tab);
    const ub = e.target.closest("[data-upd]");
    if (ub) { const meta = Plugins.registry.find((p) => p.key === ub.dataset.upd), st = Plugins.state[meta.key]; st.busy = "下载中…"; this.draw(); try { await Plugins.fetchCode(meta); toast("已更新，重新打开软件后生效"); } catch (err) { st.error = "更新失败：" + cleanErr(err); } st.busy = ""; this.draw(); return; }
    const b = e.target.closest("[data-tog]"); if (!b) return;
    const on = Plugins.enabled(), meta = Plugins.registry.find((p) => p.key === b.dataset.tog); if (!meta) return;
    if (on.has(meta.key)) {
      if (!(await confirmBox(`移除「${meta.name}」？`, "它保存的数据会留在这台电脑上，以后再添加还能看到。网页版和手机上也会一起移除。", "移除", true))) return;
      on.delete(meta.key); await Plugins.setEnabled(on);
      Plugins.tabs = Plugins.tabs.filter((t) => t.plugin !== meta.key);
      for (const [t, f] of Plugins.frames) if (f.key === meta.key) { f.frame.remove(); Plugins.frames.delete(t); }
      delete Plugins.itemsCache[meta.key]; Plugins.state[meta.key].running = false;
      if (meta.channel === "published") { const c = Plugins.cache(); delete c[meta.id]; lsSet("cc_plugin_cache", c); IDB.code.del(meta.id); }
      this.draw(); return;
    }
    if (meta.channel === "testing" && !(await confirmBox(`「${meta.name}」还在测试中`, "它没有经过审核，在隔离环境里运行，拿不到你的登录信息，但可能有 bug。确定开启吗？", "开启"))) return;
    const st = Plugins.state[meta.key] || (Plugins.state[meta.key] = { meta, error: "" });
    st.busy = "下载中…"; st.error = ""; this.draw();
    try { const r = await Plugins.fetchCode(meta); on.add(meta.key); await Plugins.setEnabled(on); st.busy = ""; if (!st.running) await Plugins.run(meta, r.code, r.app_html); toast(`已添加「${meta.name}」`); }
    catch (err) { st.busy = ""; st.error = "下载失败：" + cleanErr(err); }
    this.draw();
  },
};
