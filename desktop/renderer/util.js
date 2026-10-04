// 捞捞课程表 电脑版 · 界面通用小工具（弹窗、菜单、提示、图标、事项编辑框）
"use strict";
const M = window.CCModel, P = window.CCParse;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function h(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
const tc = (type) => `var(--t-${M.TYPES.includes(type) ? type : "通知"})`;
const tagHtml = (type) => `<span class="tag" style="--c:${tc(type)}">${esc(type)}</span>`;

// 全局状态（主进程推过来的一份数据）
const App = {
  S: null, view: "today", views: {}, _items: null, _itemsOf: null,
  items() { if (this._itemsOf !== this.S) { this._items = M.allItems(this.S || {}); this._itemsOf = this.S; } return this._items; },
  find(key) { return this.items().find((x) => x.key === key); },
  className() { const c = (this.S.classes || []).find((x) => x.id === this.S.cid); return c ? c.name : ""; },
  isTeacher() { const c = (this.S.classes || []).find((x) => x.id === this.S.cid); return !!(c && c.is_teacher); },
  now: () => new Date(),
};

// 调用主进程；出错就弹红色提示
async function call(ch, ...args) {
  try { return await window.cc.call(ch, ...args); }
  catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), { bad: true }); throw e; }
}

// ---------- 图标 ----------
const ICON = {
  today: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v11h14V9"/><path d="M10 20v-5h4v5"/>',
  week: '<rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M3 9h18M8 2.5v3M16 2.5v3M9 9v12M15 9v12M3 15h18"/>',
  tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5"/>',
  month: '<rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M3 9h18M8 2.5v3M16 2.5v3"/><circle cx="8" cy="13.5" r=".6"/><circle cx="12" cy="13.5" r=".6"/><circle cx="16" cy="13.5" r=".6"/><circle cx="8" cy="17" r=".6"/><circle cx="12" cy="17" r=".6"/>',
  wall: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v9a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 3 14.5z"/><path d="M8 8.5h8M8 12h5"/>',
  focus: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5M12 2.5V5"/>',
  ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  homework: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h5"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.8"/><path d="M16.5 14.2c2.9.3 5 2.4 5 5.8"/>',
  rank: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  classes: '<path d="M2.5 9 12 4l9.5 5-9.5 5z"/><path d="M6.5 11.2V16c0 1.6 2.5 3 5.5 3s5.5-1.4 5.5-3v-4.8"/>',
  plan: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M12 3.5v17M3.5 12h17"/>',
  growth: '<path d="M12 21c-4 0-7-2.6-7-6.5 0-4 3.5-6 4-10 2.5 1.5 4 4 4 6 1-1 1.5-2.5 1.5-4 3 2 4.5 5.2 4.5 8 0 3.9-3 6.5-7 6.5z"/>',
  countdown: '<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/>',
  meta: '<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.8" ry="8.5"/><path d="M3.5 12h17"/>',
  ingest: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7"/><path d="M4 5.5v9A2.5 2.5 0 0 0 6.5 17H11"/><path d="m17 14 1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z"/>',
  tools: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><circle cx="17" cy="17" r="3.6"/>',
  report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  clip: '<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m3 17 5-5 4 4 3-3 6 6"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2"/><rect x="6" y="14" width="12" height="7" rx="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', left: '<path d="m15 6-6 6 6 6"/>', right: '<path d="m9 6 6 6-6 6"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  pin: '<path d="M9 4h6l-1 5 4 3v2H6v-2l4-3z"/><path d="M12 14v7"/>', send: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>', eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  mini: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><rect x="12" y="11" width="7" height="7" rx="1.5"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  export: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>', ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', place: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
};
const icon = (n, cls) => `<svg class="${cls || "ico"}" viewBox="0 0 24 24">${ICON[n] || ""}</svg>`;

// ---------- 提示 ----------
function toast(msg, opt = {}) {
  const el = h(`<div class="toast${opt.bad ? " bad" : ""}"><span>${esc(msg)}</span>${opt.action ? `<button>${esc(opt.action.label)}</button>` : ""}</div>`);
  if (opt.action) el.querySelector("button").onclick = () => { el.remove(); opt.action.fn(); };
  $("#toasts").append(el);
  setTimeout(() => el.remove(), opt.ms || (opt.action ? 6000 : 2600));
}

// ---------- 弹窗 ----------
let overlayClose = null;
function openOverlay(node, onClose) {
  const ov = $("#overlay"); closeOverlay();
  ov.innerHTML = '<div class="scrim"></div>'; ov.append(node); ov.classList.add("show");
  ov.firstChild.onclick = () => closeOverlay();
  overlayClose = onClose || null;
}
function closeOverlay() { const ov = $("#overlay"); if (!ov.classList.contains("show")) return; ov.classList.remove("show"); ov.innerHTML = ""; const f = overlayClose; overlayClose = null; if (f) f(); }
const overlayOpen = () => $("#overlay").classList.contains("show");

// 确认框：返回 true/false
function confirmBox(title, text, okText = "确定", danger) {
  return new Promise((res) => {
    let done = false;
    const d = h(`<div class="dialog" role="dialog"><h3>${esc(title)}</h3><div class="dbody">${text ? `<div class="muted">${esc(text)}</div>` : ""}</div><div class="dfoot"><button class="btn" data-a="no">取消</button><button class="btn ${danger ? "danger" : "primary"}" data-a="ok">${esc(okText)}</button></div></div>`);
    d.onclick = (e) => { const a = e.target.closest("[data-a]"); if (!a) return; done = true; res(a.dataset.a === "ok"); closeOverlay(); };
    openOverlay(d, () => { if (!done) res(false); });
    d.querySelector('[data-a="ok"]').focus();
  });
}

// ---------- 右键菜单 ----------
function menu(x, y, items) {
  $$(".menu").forEach((m) => m.remove());
  const el = h(`<div class="menu"></div>`);
  for (const it of items) {
    if (it === "-") { el.append(h("<hr>")); continue; }
    if (!it) continue;
    const b = h(`<button class="${it.danger ? "danger" : ""}">${it.icon ? icon(it.icon) : ""}<span>${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ""}</button>`);
    b.onclick = () => { el.remove(); it.fn(); };
    el.append(b);
  }
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
  el.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
  setTimeout(() => document.addEventListener("mousedown", function off(e) { if (!el.contains(e.target)) { el.remove(); document.removeEventListener("mousedown", off); } }), 0);
}

// ---------- 日期小工具 ----------
function greet(d) { const hh = d.getHours(); return hh < 5 ? "夜深了" : hh < 11 ? "早上好" : hh < 13 ? "中午好" : hh < 18 ? "下午好" : "晚上好"; }
const dateCN = (k) => { const d = M.fromKey(k); return `${d.getMonth() + 1}月${d.getDate()}日 周${M.WEEK[d.getDay()]}`; };
function whenText(x, now) {
  if (!x.day) return "没定日子";
  return M.relDay(x.day, now) + (x.time ? " " + x.time : "");
}
function overdue(x, now) {
  if (!x.day || x.done) return false;
  const n = M.dayDiff(x.day, now);
  if (n < 0) return true;
  if (n === 0 && x.time) return M.toMin(x.time) < now.getHours() * 60 + now.getMinutes();
  return false;
}
function untilText(min) { if (min < 60) return `${min} 分钟`; const hh = Math.floor(min / 60), mm = min % 60; return `${hh} 小时${mm ? " " + mm + " 分" : ""}`; }

// ---------- 完成 / 删除（带撤销） ----------
async function toggleDone(key, done) {
  await call("done", key, done);
  if (done) { const x = App.find(key); toast(`已完成：${x ? x.title : ""}`, { action: { label: "撤销", fn: () => call("done", key, false) } }); cheerFor(key); }
}
async function deleteMine(key) {
  const x = App.find(key); if (!x || !x.mine) return;
  const backup = (App.S.mine || []).find((r) => r.id === key);
  await call("mine:delete", key);
  toast(`已删除：${x.title}`, { action: { label: "撤销", fn: () => call("mine:upsert", backup) } });
}
async function hideItem(key, hidden) {
  await call("mark", key, { hidden });
  if (hidden) toast("已隐藏，在「事项 → 已隐藏」里能找回", { action: { label: "撤销", fn: () => call("mark", key, { hidden: false }) } });
}

// ---------- 新建 / 编辑我的事项 ----------
function editItem(x, preset) {
  const isNew = !x; preset = preset || {};
  const v = x ? { subject: x.title, day: x.day, time: x.time, location: x.location, note: x.note } : { subject: "", day: preset.day || "", time: preset.time || "", location: "", note: "" };
  const d = h(`<form class="dialog" role="dialog">
    <h3>${isNew ? "记一件事" : "编辑事项"}</h3>
    <div class="dbody">
      <label class="field">要做什么<input name="subject" maxlength="200" placeholder="比如：交实验报告　（可以直接写「明天下午3点交实验报告 @B302」）" value="${esc(v.subject)}" required></label>
      <div class="row"><label class="field" style="flex:1.3">日期<input name="day" type="date" value="${esc(v.day)}"></label><label class="field" style="flex:1">时间<input name="time" type="time" value="${esc(v.time)}"></label><label class="field" style="flex:1.4">地点<input name="location" maxlength="200" value="${esc(v.location)}" placeholder="可不填"></label></div>
      <label class="field">备注<textarea name="note" rows="3" maxlength="2000" placeholder="可不填">${esc(v.note)}</textarea></label>
    </div>
    <div class="dfoot">${isNew ? '<span class="muted grow" style="font-size:12px">Enter 保存 · Esc 取消</span>' : '<button type="button" class="btn danger" data-a="del">' + icon("trash") + '删除</button><span class="grow"></span>'}<button type="button" class="btn" data-a="cancel">取消</button><button class="btn primary">保存</button></div>
  </form>`);
  const f = d.elements;
  // 新建时：标题里写了日期时间，就自动填到下面
  if (isNew) f.subject.addEventListener("input", () => {
    const p = P.parse(f.subject.value, App.now());
    f.subject.dataset.parsed = JSON.stringify(p);
    if (p.date && !f.day.dataset.touched) f.day.value = p.date;
    if (p.time && !f.time.dataset.touched) f.time.value = p.time;
    if (p.location && !f.location.dataset.touched) f.location.value = p.location;
  });
  for (const n of ["day", "time", "location"]) f[n].addEventListener("input", () => (f[n].dataset.touched = 1));
  d.onsubmit = async (e) => {
    e.preventDefault();
    let subject = f.subject.value.trim();
    if (isNew && f.subject.dataset.parsed) { const p = JSON.parse(f.subject.dataset.parsed); if (p.subject && (p.date || p.time || p.location)) subject = p.subject; }
    if (!subject) return f.subject.focus();
    const rec = { subject, event_time: f.day.value ? f.day.value + (f.time.value ? " " + f.time.value : "") : "", location: f.location.value.trim(), note: f.note.value.trim() };
    if (x) rec.id = x.key;
    await call("mine:upsert", rec);
    closeOverlay(); toast(isNew ? "已记下" : "已保存");
  };
  d.onclick = async (e) => {
    const a = e.target.closest("[data-a]"); if (!a) return;
    if (a.dataset.a === "cancel") closeOverlay();
    if (a.dataset.a === "del") { closeOverlay(); deleteMine(x.key); }
  };
  openOverlay(d);
  f.subject.focus(); if (!isNew) f.subject.select();
}

// 菜单：一件事能做的操作
function itemMenu(e, x) {
  e.preventDefault();
  menu(e.clientX, e.clientY, [
    { label: x.done ? "标记为没完成" : "标记完成", icon: "tasks", fn: () => toggleDone(x.key, !x.done) },
    x.mine ? { label: "编辑", icon: "edit", fn: () => editItem(x) } : null,
    { label: "在事项里查看", icon: "eye", fn: () => App.go("tasks", { key: x.key }) },
    { label: "专注做这件事", icon: "focus", fn: () => App.go("focus", { task: x.title }) },
    "-",
    x.mine ? { label: "删除", icon: "trash", danger: true, fn: () => deleteMine(x.key) } : { label: x.hidden ? "取消隐藏" : "隐藏这条", icon: "eye", fn: () => hideItem(x.key, !x.hidden) },
  ]);
}

// 简单的 Markdown：加粗、列表、代码、换行（AI 回复用）
function miniMd(s) {
  const lines = esc(s).split("\n"); let out = "", list = null;
  const inline = (t) => t.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  for (const ln of lines) {
    const m = /^\s*(?:[-*•]|(\d+)[.、)])\s+(.*)$/.exec(ln);
    if (m) { const tag = m[1] ? "ol" : "ul"; if (list !== tag) { if (list) out += `</${list}>`; out += `<${tag}>`; list = tag; } out += `<li>${inline(m[2])}</li>`; continue; }
    if (list) { out += `</${list}>`; list = null; }
    const hd = /^#{1,4}\s+(.*)$/.exec(ln);
    out += hd ? `<p><b>${inline(hd[1])}</b></p>` : ln.trim() ? `<p>${inline(ln)}</p>` : "";
  }
  if (list) out += `</${list}>`;
  return out;
}

// ====================== 电脑版 2.0 新增的通用工具 ======================
// 调服务器接口（令牌在主进程里，界面只能调白名单里的）
async function api(fn, args, quiet) {
  try { return await window.cc.call("api:rpc", fn, args || {}); }
  catch (e) { if (!quiet) toast(cleanErr(e), { bad: true }); throw e; }
}
const apiGet = (p) => window.cc.call("api:get", p);
const cleanErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const notFound = (e) => e && (e.status === 404 || /Could not find the function|PGRST202/.test(e.message || ""));
const kvSet = (ns, k, v) => call("kv:set", ns, k, v);
const LIST_NS = new Set(["personal_events_v1", "habits_v1", "countdown_v1"]), ONE_NS = new Set(["profile_v1", "fun_opts_v1", "plugins_enabled_v1"]);
const KV = (ns) => { const v = App.S && App.S.kv ? App.S.kv[ns] : undefined; if (v !== undefined && v !== null) return v; return LIST_NS.has(ns) ? [] : ONE_NS.has(ns) ? null : {}; };
const todayKey = () => M.dayKey(App.now());
const shiftDay = (k, n) => M.dayKey(M.addDays(M.fromKey(k), n));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function ago(t) {
  const s = (Date.now() - Date.parse(t)) / 1000; if (!(s >= 0)) return "";
  if (s < 60) return "刚刚"; if (s < 3600) return Math.floor(s / 60) + " 分钟前"; if (s < 86400) return Math.floor(s / 3600) + " 小时前";
  const d = new Date(t); return s < 86400 * 7 ? Math.floor(s / 86400) + " 天前" : `${d.getMonth() + 1}月${d.getDate()}日`;
}
function whenStr(t) {
  const d = new Date(t); if (isNaN(d)) return "";
  const hm = `${M.pad(d.getHours())}:${M.pad(d.getMinutes())}`;
  return d.toDateString() === new Date().toDateString() ? "今天 " + hm : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}
const AV_COLORS = ["#ff8a5b", "#4f9dff", "#34c38f", "#a66cff", "#ff5d8f", "#f5a623", "#22b8cf", "#7c8cff"];
const avColor = (name) => AV_COLORS[[...String(name || "?")].reduce((a, c) => a + c.codePointAt(0), 0) % AV_COLORS.length];
const avHtml = (name, cls, uidv) => `<span class="av ${cls || ""}" style="background:${avColor(name)}"${uidv ? ` data-user="${esc(uidv)}"` : ""}>${esc([...(name || "?")][0])}</span>`;
const ROLE_CN = { teacher: "老师", monitor: "班委", admin: "管理员", student: "同学" };

// 当前班级、权限、分组（和网页版同一套规则；服务器还会再检查）
Object.assign(App, {
  cls() { return (this.S.classes || []).find((x) => x.id === this.S.cid) || null; },
  can(p) { const c = this.cls(); return !!(c && c[p]); },
  isStaff() { const c = this.cls(); return !!c && (c.is_teacher || c.member_role === "monitor" || this.isAdmin()); },
  isAdmin() { return !!(this.S.me && this.S.me.role === "admin"); },
  group(gid) { return gid ? (this.S.groups || []).find((g) => String(g.id) === String(gid)) : null; },
  canEditIn(gid) {
    const c = this.cls(); if (!c) return false;
    if (c.is_teacher || c.can_edit) return true;
    if (!this.S.groupsOk) return false;
    const g = this.group(gid);
    if (gid && g && g.lead) return true;
    return !!(this.S.classOpts || {}).members_can_edit && (!gid || !!(g && g.mine));
  },
  canDelItem(x) {
    const c = this.cls(); if (!c || x.mine) return false;
    if (c.is_teacher || c.can_delete) return true;
    if (!this.S.groupsOk) return false;
    const g = this.group(x.gid);
    return !!(g && g.lead) || (!!x.by && !!this.S.me && x.by === this.S.me.id);
  },
  canAddItem() { return this.canEditIn(null) || (this.S.groups || []).some((g) => this.canEditIn(g.id)); },
  // 功能开关：管理员管全站、老师管本班；没读到时全部按开着处理
  feat(k) { const f = (this.S.features || {})[k]; return !f || f.on !== false; },
  featWhy(k) { const f = (this.S.features || {})[k]; return (f && f.why) || "已关闭"; },
  fun() { return { cheer: "mascot", confetti: true, rings: true, habits: true, plan: true, hideDone: false, ...(KV("fun_opts_v1") || {}) }; },
});

// ---------- 输入框弹窗：fields = [{ name, label, value, type, placeholder, max, options, rows }] ----------
function formBox(title, fields, okText = "保存", opts = {}) {
  return new Promise((res) => {
    let done = false;
    const f = (x) => {
      const v = esc(x.value ?? "");
      const inner = x.type === "textarea" ? `<textarea name="${x.name}" rows="${x.rows || 3}" maxlength="${x.max || 500}" placeholder="${esc(x.placeholder || "")}">${v}</textarea>`
        : x.type === "select" ? `<select name="${x.name}">${x.options.map(([k, t]) => `<option value="${esc(k)}"${String(k) === String(x.value ?? "") ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`
        : `<input name="${x.name}" type="${x.type || "text"}" value="${v}" maxlength="${x.max || 200}" placeholder="${esc(x.placeholder || "")}"${x.required ? " required" : ""} autocomplete="off">`;
      return `<label class="field">${esc(x.label)}${inner}${x.hint ? `<small class="muted">${esc(x.hint)}</small>` : ""}</label>`;
    };
    const d = h(`<form class="dialog" role="dialog"><h3>${esc(title)}</h3><div class="dbody">${opts.desc ? `<div class="muted" style="font-size:13px">${esc(opts.desc)}</div>` : ""}${fields.map(f).join("")}<div class="fb-err"></div></div>
      <div class="dfoot"><span class="grow"></span><button type="button" class="btn" data-a="no">取消</button><button class="btn ${opts.danger ? "danger" : "primary"}">${esc(okText)}</button></div></form>`);
    d.onsubmit = async (e) => {
      e.preventDefault();
      const out = {}; for (const x of fields) out[x.name] = d.elements[x.name].value.trim();
      if (opts.check) { const err = opts.check(out); if (err) { $(".fb-err", d).textContent = err; return; } }
      done = true; closeOverlay(); res(out);
    };
    d.querySelector('[data-a="no"]').onclick = () => closeOverlay();
    openOverlay(d, () => { if (!done) res(null); });
    const first = d.querySelector("input,textarea,select"); if (first) { first.focus(); if (first.select) first.select(); }
  });
}
function infoBox(title, html, wide) {
  const d = h(`<div class="dialog${wide ? " wide" : ""}" role="dialog"><h3>${esc(title)}</h3><div class="dbody selectable">${html}</div><div class="dfoot"><button class="btn primary" data-a="ok">好的</button></div></div>`);
  d.querySelector("[data-a]").onclick = () => closeOverlay();
  openOverlay(d);
  return d;
}

// ---------- 完成鼓励：小动画 + 彩纸（「我的 → 趣味」里可以关） ----------
const CHEER = {
  item: [["又搞定一件！", "保持这个节奏"], ["漂亮 ✨", "离清单清空又近了一步"], ["完成 +1", "给自己点个赞"], ["稳！", "今天的你很靠谱"]],
  homework: [["作业搞定！", "比截止时间早，就是赢"], ["交作业达人", "又少了一件心事"], ["这题难不倒你", "继续冲"]],
  allhw: [["本周作业全部完成！", "可以安心休息一下了 🎉"]],
  pomo: [["专注完成一个番茄 🍅", "起来走走，休息一下"], ["又一个番茄到手 🍅", "喝口水，眼睛看看远处"]],
  habit: [["打卡成功 🔥", "明天也来哦"]],
};
function cheer(kind, sub) {
  const o = App.fun(); if (o.cheer === "off") return;
  const pool = CHEER[kind] || CHEER.item, [t, s] = pool[Math.floor(Math.random() * pool.length)];
  $$(".cheer").forEach((x) => x.remove());
  const el = h(`<div class="cheer"><span class="ch-i">${o.cheer === "text" ? "" : ["🎉", "👏", "💪", "🌟", "🥳", "😎", "🙌", "🍀"][Math.floor(Math.random() * 8)]}</span><div><b>${esc(t)}</b><small>${esc(sub || s)}</small></div></div>`);
  document.body.append(el); setTimeout(() => el.classList.add("out"), 2300); setTimeout(() => el.remove(), 2700);
  if (o.confetti && !matchMedia("(prefers-reduced-motion: reduce)").matches) confetti(kind === "allhw" ? 70 : 30);
}
function confetti(n) {
  const cx = innerWidth / 2, cy = innerHeight / 2, R = Math.min(innerWidth, innerHeight), cols = ["#ff8a3d", "#3d6ff2", "#17c29a", "#ffd23f", "#ff6a8b", "#8c6bff"];
  for (let i = 0; i < n; i++) {
    const c = document.createElement("i"); c.className = "confetti";
    const a = Math.random() * Math.PI * 2, v = R * (0.2 + Math.random() * 0.3);
    c.style.cssText = `left:${cx}px;top:${cy}px;background:${cols[i % cols.length]};--dx:${Math.cos(a) * v}px;--dy:${Math.sin(a) * v + R * 0.18}px;--r:${Math.random() * 720 - 360}deg;animation-delay:${Math.random() * 120}ms`;
    document.body.appendChild(c); setTimeout(() => c.remove(), 1800);
  }
}
function cheerFor(key) {
  const x = App.find(key); if (!x) return;
  if (x.type === "作业") {
    const now = App.now(), mon = M.dayKey(M.addDays(now, -M.weekday0(now))), sun = M.dayKey(M.addDays(now, 6 - M.weekday0(now)));
    const hw = App.items().filter((y) => y.type === "作业" && y.day >= mon && y.day <= sun && !y.hidden);
    cheer(hw.length && hw.every((y) => y.done || y.key === key) ? "allhw" : "homework");
  } else cheer("item");
}

// 圆环
function ringSvg(done, total, size, color) {
  const r = 40, c = 2 * Math.PI * r, f = total ? done / total : 0;
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" class="ring"><circle cx="50" cy="50" r="${r}" fill="none" class="trk" stroke-width="10"/>
    ${f > 0 ? `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/>` : ""}
    <text x="50" y="50" text-anchor="middle" dominant-baseline="central" class="rv">${total ? Math.round(f * 100) + "%" : "–"}</text></svg>`;
}
// 简单的 Markdown（功能介绍用）：**加粗**、- 列表、1. 编号
const mdLite = (s) => miniMd(s || "");
