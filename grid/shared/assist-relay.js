// 捞捞 · 远程协助的中转（调度中心用它；同局域网时，发起协助的那台电脑自己也开一个，画面直连更快）
//
//   一次协助 = 一个会话：
//     发起（管理员 / 同局域网的同学）→ 对方电脑弹窗问「允许吗」→ 允许（查看和操控 / 只查看）或拒绝
//     → 对方电脑一直往这里送屏幕画面（JPEG），发起的人取最新一帧看；发起的人的鼠标键盘放进队列，对方电脑取走去执行
//     → 任何一边点「结束」、对方断开、发起的人关了窗口、超过 2 小时：结束
//   这里只转发，不存画面；结束了马上丢掉。是否允许、能不能操控，以对方电脑上的选择为准（它自己也会再挡一次）。
"use strict";
const crypto = require("crypto");

function create(o = {}) {
  const now = o.now || Date.now;
  const log = o.log || (() => {});
  const S = new Map();
  const LIM = { ask: o.askMs || 90e3, viewer: o.viewerMs || 60e3, device: o.deviceMs || 30e3, max: o.maxMs || 2 * 3600e3, wait: o.waitMs || 10e3 };

  function wake(list) { const l = list.splice(0); for (const f of l) { try { f(); } catch (e) {} } }
  function waitFor(list, ms) { return new Promise((ok) => { const t = setTimeout(ok, ms); list.push(() => { clearTimeout(t); ok(); }); }); }
  const pub = (s) => ({ id: s.id, device: s.device, name: s.name, by: s.by, mode: s.mode, state: s.state, created: s.created, started: s.started || null, ended: s.ended || null, why: s.why || "", frames: s.n });

  // 发起：返回会话（设备那边凭 token 往这里送画面、取操作）
  function start({ device = null, name = "", by = "管理员", mode = "control" } = {}) {
    sweep();
    for (const s of S.values()) if (s.device != null && s.device === device && ["asking", "live"].includes(s.state)) end(s.id, "又发起了一次新的协助");
    const s = { id: crypto.randomBytes(9).toString("base64url"), token: crypto.randomBytes(18).toString("base64url"), device, name, by, mode: mode === "view" ? "view" : "control", state: "asking",
      created: now(), seenViewer: now(), seenDevice: now(), n: 0, frame: null, input: [], fw: [], iw: [], sw: [] };
    S.set(s.id, s);
    log(`${by} 请求远程协助「${name || device}」（${s.mode === "view" ? "只看" : "查看和操控"}），等对方同意`);
    return s;
  }
  const get = (id) => S.get(String(id || ""));
  function devSession(id, token) {
    const s = get(id);
    if (!s || !token || s.token !== String(token)) throw new Error("协助会话不对");
    s.seenDevice = now();
    return s;
  }

  // 对方电脑回话：ok=false 拒绝；mode 可以比请求的少（请求操控、只允许查看）
  function answer({ s: id, token, ok, mode }) {
    const s = devSession(id, token);
    if (s.state !== "asking") return { state: s.state };
    if (!ok) { s.state = "rejected"; s.ended = now(); s.why = "对方拒绝了"; log(`「${s.name || s.device}」拒绝了远程协助`); wake(s.sw); wake(s.fw); return { state: s.state }; }
    if (mode === "view") s.mode = "view";
    s.state = "live"; s.started = now(); s.seenViewer = now();
    log(`「${s.name || s.device}」同意了远程协助（${s.mode === "view" ? "只看" : "查看和操控"}）`);
    wake(s.sw); wake(s.fw);
    return { state: s.state, mode: s.mode };
  }

  // 对方电脑送一帧画面（JPEG 的 base64）；回话里带上「还要不要接着送」
  function frame({ s: id, token, jpeg, w, h }) {
    const s = devSession(id, token);
    if (s.state !== "live") return { state: s.state };
    if (typeof jpeg !== "string" || jpeg.length > 3e6) throw new Error("画面不对");
    s.n++; s.frame = { n: s.n, jpeg, w: +w || 0, h: +h || 0, t: now() };
    wake(s.fw);
    return { state: s.state, viewer: now() - s.seenViewer < 5000 };
  }

  // 发起的人取画面：有比 after 新的马上给，没有就等一会儿（长轮询）
  async function view(id, after = 0) {
    const s = get(id);
    if (!s) return { state: "gone" };
    s.seenViewer = now();
    if ((s.state === "live" && (!s.frame || s.frame.n <= +after)) || s.state === "asking") await waitFor(s.fw, LIM.wait);
    s.seenViewer = now();
    const f = s.frame && s.frame.n > +after ? s.frame : null;
    return { ...pub(s), frame: f ? { n: f.n, jpeg: f.jpeg, w: f.w, h: f.h, t: f.t } : null };
  }

  // 发起的人的鼠标键盘（只看模式不收）
  const OK_EV = new Set(["move", "down", "up", "wheel", "key", "text"]);
  function input(id, evs) {
    const s = get(id);
    if (!s || s.state !== "live") return { state: s ? s.state : "gone" };
    s.seenViewer = now();
    if (s.mode !== "control") return { state: s.state, mode: s.mode, dropped: true };
    for (const e of (Array.isArray(evs) ? evs : []).slice(0, 200)) if (e && OK_EV.has(e.t)) s.input.push(e);
    if (s.input.length > 1000) s.input.splice(0, s.input.length - 1000);
    wake(s.iw);
    return { state: s.state };
  }
  // 对方电脑取操作（长轮询）
  async function take({ s: id, token }) {
    const s = devSession(id, token);
    if (s.state === "live" && !s.input.length) await waitFor(s.iw, LIM.wait);
    if (S.get(s.id)) s.seenDevice = now();
    return { state: s.state, mode: s.mode, ev: s.state === "live" && s.mode === "control" ? s.input.splice(0) : [] };
  }
  // 等对方回话（发起的那一边用）
  async function status(id) {
    const s = get(id);
    if (!s) return { state: "gone" };
    s.seenViewer = now();
    if (s.state === "asking") await waitFor(s.sw, LIM.wait);
    return pub(s);
  }

  function end(id, why = "结束了", byDevice = null) {
    const s = get(id);
    if (!s) return { state: "gone" };
    if (byDevice != null) devSession(id, byDevice);
    if (["asking", "live"].includes(s.state)) {
      s.state = "ended"; s.ended = now(); s.why = why; s.frame = null; s.input = [];
      const mins = s.started ? Math.max(1, Math.round((s.ended - s.started) / 60e3)) : 0;
      log(`远程协助「${s.name || s.device}」结束：${why}${mins ? `（${mins} 分钟）` : ""}`);
    }
    wake(s.fw); wake(s.iw); wake(s.sw);
    return { state: s.state };
  }
  function sweep() {
    const t = now();
    for (const s of S.values()) {
      if (s.state === "asking" && t - s.created > LIM.ask) { s.state = "expired"; s.ended = t; s.why = "对方一直没回应"; log(`远程协助「${s.name || s.device}」：对方一直没回应`); wake(s.sw); wake(s.fw); }
      else if (s.state === "live" && t - s.seenViewer > LIM.viewer) end(s.id, "发起的人关掉了窗口");
      else if (s.state === "live" && t - s.seenDevice > LIM.device) end(s.id, "对方电脑断开了");
      else if (s.state === "live" && t - s.started > LIM.max) end(s.id, "超过 2 小时，自动结束");
      if (!["asking", "live"].includes(s.state) && t - (s.ended || t) > 600e3) S.delete(s.id);
    }
  }
  const timer = o.noTimer ? null : setInterval(sweep, 5000);
  if (timer && timer.unref) timer.unref();

  return { start, answer, frame, view, input, take, status, end, sweep, get: (id) => { const s = get(id); return s ? pub(s) : null; }, list: () => [...S.values()].map(pub), close: () => { clearInterval(timer); for (const s of S.values()) end(s.id, "中转关了"); } };
}

module.exports = { create };
