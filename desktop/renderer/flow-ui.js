/* 5.9.4 刷任务 · 随机掉落 · 班级同步自习（网页和电脑版共用这一份界面；规则在 coach-core.js）
 *   全屏一张张小卡，上划下一张。每张卡要真的计时走完才算数、才有机会掉东西：
 *     · 离开页面 30 分钟以内（手机放下做题）算到这张卡剩下的时间为止，离开太久这张重来
 *     · 一天最多掉 10 个；乱点「做完了」不会掉任何东西
 *   每轮 50 分钟就停：刷完了就去玩。
 *   用法：FlowUI.init(适配器)，适配器见下面 A 的说明；FlowUI.open() 打开，FlowUI.book() 看图鉴 */
(function () {
  "use strict";
  if (typeof CoachCore === "undefined") return;
  const C = CoachCore;
  // A：{ ctx() → { now, ranked, skip }, record(ev), bag() → 背包, saveBag(b), otherBags() → [], rpc(名字, 参数) → Promise,
  //      cid() → 班级 id 或 null, done(key), skip(key), wear(表情或""), toast(文字), after() }
  let A = null, st = null, root = null, timer = 0, wake = null, roomT = 0;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const RC = ["#94a3b8", "#3b82f6", "#a855f7", "#f59e0b"];
  const KIND = { start: "🚀 开头", work: "⏱ 专注", review: "📖 复习", check: "✅ 确认", break: "🍵 休息", end: "🎉 收工" };

  // ---------- 样式（只加一次） ----------
  function css() {
    if (document.getElementById("flowCss")) return;
    const s = document.createElement("style"); s.id = "flowCss";
    s.textContent = `
.fl-root{position:fixed;inset:0;z-index:2147483000;background:radial-gradient(120% 90% at 50% 0%,#1e1b4b 0%,#0b1020 60%,#05070f 100%);color:#fff;display:flex;flex-direction:column;font-family:inherit;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}
.fl-top{display:flex;align-items:center;gap:10px;padding:max(14px,env(safe-area-inset-top)) 16px 6px}
.fl-x{background:rgba(255,255,255,.1);border:0;color:#fff;width:36px;height:36px;border-radius:50%;font-size:18px;cursor:pointer}
.fl-prog{flex:1;display:flex;gap:4px}.fl-prog i{flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.15);overflow:hidden}.fl-prog i.d{background:#a78bfa}.fl-prog i.c{background:linear-gradient(90deg,#a78bfa,#f472b6)}
.fl-bagb{background:rgba(255,255,255,.1);border:0;color:#fff;border-radius:18px;padding:7px 12px;font-size:13px;cursor:pointer}
.fl-room{text-align:center;font-size:12.5px;color:#c4b5fd;min-height:18px;padding:0 16px}
.fl-room b{display:inline-block;width:7px;height:7px;border-radius:50%;background:#34d399;margin-right:6px;box-shadow:0 0 0 0 #34d39988;animation:flPulse 1.6s infinite}
@keyframes flPulse{70%{box-shadow:0 0 0 8px #34d39900}100%{box-shadow:0 0 0 0 #34d39900}}
.fl-stage{flex:1;position:relative;perspective:1200px}
.fl-card{position:absolute;left:50%;top:50%;width:min(420px,calc(100vw - 32px));transform:translate(-50%,-50%);background:linear-gradient(160deg,rgba(255,255,255,.14),rgba(255,255,255,.04));border:1px solid rgba(255,255,255,.18);border-radius:28px;padding:26px 22px 22px;box-shadow:0 30px 80px -20px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.25);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);text-align:center;transition:transform .45s cubic-bezier(.2,.9,.25,1.2),opacity .35s}
.fl-card.out{transform:translate(-50%,-160%) rotateX(25deg) scale(.9);opacity:0}
.fl-card.in{transform:translate(-50%,40%) rotateX(-20deg) scale(.92);opacity:0}
.fl-k{display:inline-block;font-size:12px;padding:4px 10px;border-radius:12px;background:rgba(255,255,255,.12);color:#e9d5ff;letter-spacing:.5px}
.fl-t{font-size:22px;font-weight:800;margin:12px 0 6px;line-height:1.3;word-break:break-word}
.fl-s{font-size:15px;color:#cbd5e1;line-height:1.6;min-height:24px}
.fl-ring{position:relative;width:190px;height:190px;margin:18px auto 8px}
.fl-ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.fl-ring .bg{stroke:rgba(255,255,255,.1)}.fl-ring .fg{stroke:url(#flG);transition:stroke-dashoffset .25s linear;filter:drop-shadow(0 0 8px #a78bfa)}
.fl-ring .n{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.fl-ring .n b{font-size:42px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:1px}.fl-ring .n small{color:#94a3b8;font-size:12px}
.fl-btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px}
.fl-btn{border:0;border-radius:16px;padding:12px 18px;font-size:15px;font-weight:700;cursor:pointer;color:#fff;background:rgba(255,255,255,.12)}
.fl-btn.go{background:linear-gradient(135deg,#8b5cf6,#ec4899);box-shadow:0 10px 24px -8px #ec4899aa}
.fl-btn.ok{background:linear-gradient(135deg,#10b981,#06b6d4)}
.fl-btn.sm{font-size:13px;padding:9px 14px;font-weight:600;background:transparent;color:#94a3b8}
.fl-note{font-size:12.5px;color:#fbbf24;margin-top:8px;min-height:16px}
.fl-hint{text-align:center;color:#64748b;font-size:12px;padding:6px 0 max(16px,env(safe-area-inset-bottom))}
.fl-drop{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(5,7,15,.88);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:5;animation:flFade .2s}
.fl-drop .bx{text-align:center;transform:scale(.3);animation:flPop .6s cubic-bezier(.2,1.6,.4,1) forwards}
.fl-drop .em{font-size:96px;line-height:1.1;display:inline-block;filter:drop-shadow(0 0 24px var(--rc));animation:flSpin 1.2s ease-out}
.fl-drop .nm{font-size:22px;font-weight:800;margin-top:8px}.fl-drop .rr{display:inline-block;margin-top:6px;padding:3px 12px;border-radius:12px;font-size:13px;background:var(--rc);color:#0b1020;font-weight:700}
.fl-drop .sub{color:#cbd5e1;font-size:13px;margin-top:10px}
.fl-drop .rays{position:absolute;width:420px;height:420px;background:conic-gradient(from 0deg,transparent 0 10deg,var(--rc) 10deg 14deg,transparent 14deg 30deg);border-radius:50%;opacity:.25;animation:flRot 8s linear infinite;-webkit-mask:radial-gradient(circle,#000 20%,transparent 70%);mask:radial-gradient(circle,#000 20%,transparent 70%)}
@keyframes flPop{to{transform:scale(1)}}@keyframes flFade{from{opacity:0}}@keyframes flRot{to{transform:rotate(360deg)}}@keyframes flSpin{from{transform:rotateY(540deg) scale(.4)}to{transform:rotateY(0) scale(1)}}
.fl-spark{position:absolute;width:8px;height:8px;border-radius:2px;pointer-events:none;z-index:6}
.fl-book{position:fixed;inset:0;z-index:2147483001;background:rgba(5,7,15,.7);display:flex;align-items:flex-end;justify-content:center}
.fl-bk{width:min(560px,100vw);max-height:86vh;overflow:auto;background:#111827;color:#fff;border-radius:24px 24px 0 0;padding:18px 16px max(18px,env(safe-area-inset-bottom))}
.fl-bk h3{margin:0 0 4px;font-size:18px;display:flex;align-items:center;gap:8px}.fl-bk h3 button{margin-left:auto}
.fl-bk p{margin:0 0 12px;color:#94a3b8;font-size:12.5px;line-height:1.6}
.fl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(74px,1fr));gap:8px}
.fl-it{position:relative;border-radius:16px;padding:10px 4px 8px;text-align:center;background:rgba(255,255,255,.05);border:1.5px solid color-mix(in srgb,var(--rc) 55%,transparent);cursor:pointer;color:#fff}
.fl-it .e{font-size:30px;display:block}.fl-it small{display:block;font-size:11px;color:#cbd5e1;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fl-it.no .e{filter:grayscale(1) brightness(.25)}.fl-it.no small{color:#64748b}
.fl-it .c{position:absolute;top:4px;right:6px;font-size:10px;color:#94a3b8}.fl-it.on{box-shadow:0 0 0 2px #f472b6}
`;
    document.head.appendChild(s);
  }

  // ---------- 声音、震动、撒花 ----------
  let ac = null;
  function chime(n) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523, 659, 784, 1047, 1319].slice(0, 2 + (n || 0));
      notes.forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.09;
        o.type = "triangle"; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.4);
      });
    } catch (e) {}
  }
  const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };
  function sparks(n, colors) {
    if (!root) return;
    for (let i = 0; i < n; i++) {
      const d = document.createElement("i"); d.className = "fl-spark";
      d.style.background = colors[i % colors.length]; d.style.left = "50%"; d.style.top = "45%";
      root.appendChild(d);
      const a = Math.random() * Math.PI * 2, r = 120 + Math.random() * 220;
      d.animate([{ transform: "translate(0,0) rotate(0)", opacity: 1 }, { transform: `translate(${Math.cos(a) * r}px,${Math.sin(a) * r + 120}px) rotate(${Math.random() * 720}deg)`, opacity: 0 }], { duration: 900 + Math.random() * 600, easing: "cubic-bezier(.2,.8,.3,1)" }).onfinish = () => d.remove();
    }
  }

  // ---------- 班级同步自习 ----------
  async function room(until, add) {
    const cid = A.cid && A.cid(); if (!cid || !A.rpc) return;
    try {
      const r = until == null ? await A.rpc("study_room", { p_cid: cid }) : await A.rpc("study_ping", { p_cid: cid, p_until_min: until, p_add: add || 0 });
      if (st) { st.room = r; paintRoom(); }
    } catch (e) { if (st) { st.room = null; paintRoom(); } }     // 数据库还没升级：不显示
  }
  function paintRoom() {
    const el = root && root.querySelector(".fl-room"); if (!el) return;
    el.innerHTML = st.room ? `<b></b>${esc(C.roomLine(st.room))}` : "";
  }

  // ---------- 打开 ----------
  function open() {
    if (!A) return;
    css();
    const c = A.ctx(), d = C.deck({ now: c.now, ranked: c.ranked, skip: c.skip });
    if (!d.cards.length) { A.toast(d.say); return; }
    st = { cards: d.cards, i: 0, acc: 0, last: 0, hiddenAt: 0, done: false, room: null, work: 0, got: 0, note: "" };
    root = document.createElement("div"); root.className = "fl-root";
    root.innerHTML = `<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="flG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#f472b6"/></linearGradient></defs></svg>
      <div class="fl-top"><button class="fl-x" data-fl="x" aria-label="关闭">✕</button><div class="fl-prog"></div><button class="fl-bagb" data-fl="book">🎁 <span class="fl-bn"></span></button></div>
      <div class="fl-room"></div><div class="fl-stage"></div><div class="fl-hint">上划或按空格：下一张 · 每张都要真的计时走完才算</div>`;
    document.body.appendChild(root);
    root.addEventListener("click", onClick);
    let y0 = null;
    root.addEventListener("touchstart", (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    root.addEventListener("touchend", (e) => { if (y0 != null && y0 - e.changedTouches[0].clientY > 70) swipe(); y0 = null; });
    root.addEventListener("wheel", (e) => { if (e.deltaY > 40) swipe(); }, { passive: true });
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVis);
    try { navigator.wakeLock && navigator.wakeLock.request("screen").then((w) => (wake = w)).catch(() => {}); } catch (e) {}
    paint(true);
    room(null);
    roomT = setInterval(() => room(null), 60000);
    timer = setInterval(tick, 250);
  }
  function close() {
    if (!root) return;
    clearInterval(timer); clearInterval(roomT);
    document.removeEventListener("keydown", onKey); document.removeEventListener("visibilitychange", onVis);
    try { wake && wake.release(); } catch (e) {} wake = null;
    const cid = A.cid && A.cid(); if (cid && A.rpc) A.rpc("study_leave", { p_cid: cid }).catch(() => {});
    root.remove(); root = null;
    if (st && st.work) A.toast(`这次专注了 ${st.work} 分钟${st.got ? `，掉了 ${st.got} 样东西` : ""} 👏`);
    st = null; A.after && A.after();
  }
  const card = () => st.cards[st.i];
  const timed = (c) => c && c.min > 0;

  // ---------- 计时：页面在前台时走；离开回来按规则补 ----------
  function tick() {
    if (!st || st.done || document.hidden) return;
    const c = card(); if (!timed(c)) return;
    const now = Date.now();
    if (st.last) st.acc += Math.min(2000, now - st.last);
    st.last = now;
    if (st.acc >= c.min * 60000) finish(); else paintRing();
  }
  function onVis() {
    if (!st) return;
    if (document.hidden) { st.hiddenAt = Date.now(); st.last = 0; return; }
    const c = card(); if (!st.hiddenAt || !timed(c) || st.done) { st.hiddenAt = 0; return; }
    const cr = C.awayCredit(Date.now() - st.hiddenAt, c.min * 60000 - st.acc); st.hiddenAt = 0;
    if (cr < 0) { st.acc = 0; st.note = "刚才离开太久了，这张从头开始"; } else st.acc += cr;
    paint("same");
  }
  function paintRing() {
    const c = card(), el = root && root.querySelector(".fl-ring"); if (!el) return;
    const tot = c.min * 60000, left = Math.max(0, tot - st.acc), p = Math.min(1, st.acc / tot), L = 2 * Math.PI * 84;
    el.querySelector(".fg").style.strokeDashoffset = String(L * (1 - p));
    const s = Math.ceil(left / 1000);
    el.querySelector("b").textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  // ---------- 画一张卡 ----------
  function paint(first) {
    if (!root) return;
    const prog = root.querySelector(".fl-prog");
    prog.innerHTML = st.cards.map((_, j) => `<i class="${j < st.i ? "d" : j === st.i ? "c" : ""}"></i>`).join("");
    const b = C.mergeBag(A.bag(), A.otherBags(), new Date());
    root.querySelector(".fl-bn").textContent = C.owned(b) + "/" + C.LOOT.length;
    const c = card(), L = 2 * Math.PI * 84;
    let body = "";
    if (timed(c)) {
      body = `<div class="fl-ring"><svg viewBox="0 0 190 190"><circle class="bg" cx="95" cy="95" r="84" fill="none" stroke-width="12"/><circle class="fg" cx="95" cy="95" r="84" fill="none" stroke-width="12" stroke-linecap="round" stroke-dasharray="${L}" stroke-dashoffset="${L}"/></svg>
        <div class="n"><b>${c.min}:00</b><small>${st.done ? "完成 ✓" : c.kind === "break" ? "休息" : "计时中"}</small></div></div>
        <div class="fl-btns">${st.done ? `<button class="fl-btn go" data-fl="next">继续 ↑</button>` : `<button class="fl-btn sm" data-fl="skipc">跳过这张（不计时）</button>`}</div>`;
    } else if (c.kind === "check") {
      body = `<div class="fl-btns"><button class="fl-btn ok" data-fl="yes">✓ 做完了</button><button class="fl-btn go" data-fl="more">还没，再来 10 分钟</button></div><div class="fl-btns"><button class="fl-btn sm" data-fl="nextitem">先放一放，换下一件</button></div>`;
    } else if (c.kind === "end") {
      body = `<div style="font-size:64px;margin:12px 0">🎉</div><div class="fl-btns"><button class="fl-btn ok" data-fl="x">收工，去玩！</button><button class="fl-btn" data-fl="again">再来一轮</button></div>`;
    }
    const step = c.kind === "end" ? `这一轮专注了 ${st.work} 分钟${st.got ? `，掉了 ${st.got} 样东西` : ""} 🎉 去玩吧，想继续可以再来一轮` : c.step;
    const html = `<div class="fl-card ${first === "same" ? "" : "in"}"><span class="fl-k">${KIND[c.kind] || ""}${c.min ? " · " + c.min + " 分钟" : ""}</span>
      <div class="fl-t">${esc(c.title)}</div><div class="fl-s">${esc(step)}</div>${body}<div class="fl-note">${esc(st.note || "")}</div></div>`;
    const stage = root.querySelector(".fl-stage"), old = stage.querySelector(".fl-card");
    if (old && !first) { old.classList.add("out"); setTimeout(() => old.remove(), 450); } else if (old) old.remove();
    stage.insertAdjacentHTML("beforeend", html);
    const nw = stage.lastElementChild; requestAnimationFrame(() => requestAnimationFrame(() => nw.classList.remove("in")));
    if (timed(c)) paintRing();
  }

  // ---------- 一张卡走完 ----------
  function finish() {
    const c = card(); st.done = true; st.note = "";
    paint("same");
    if (c.kind === "break") { chime(0); buzz(60); return; }
    st.work += c.min;
    A.record({ t: Date.now(), e: "flow", k: c.key === "review" ? "" : c.key, m: c.min });
    const nx = st.cards[st.i + 1];
    room(nx && nx.min ? nx.min : 0, c.min);
    const r = C.roll(A.bag(), c.min, new Date());
    A.saveBag(r.bag);
    if (r.got) { st.got++; reveal(r); } else { chime(0); buzz(80); sparks(14, ["#a78bfa", "#f472b6", "#fbbf24"]); if (r.cap) { st.note = "今天的掉落已经满了，明天再来；专注照样算数"; paint("same"); } }
  }
  function reveal(r) {
    const g = r.got, rc = RC[g.r];
    chime(g.r + 1); buzz(g.r >= 2 ? [60, 40, 60, 40, 160] : [60, 40, 100]);
    const d = document.createElement("div"); d.className = "fl-drop"; d.style.setProperty("--rc", rc);
    d.innerHTML = `${g.r >= 2 ? '<div class="rays"></div>' : ""}<div class="bx"><div class="em">${g.e}</div><div class="nm">${esc(g.name)}</div><span class="rr">${C.RARITY[g.r]}</span>
      <div class="sub">${r.first ? "今天第一张，必掉！" : ""}${r.dup ? `已经有了 → 碎片 +${r.shard}` : "新收藏！"}${g.wear && !r.dup ? " · 捞捞可以戴上它" : ""}</div>
      <div class="fl-btns">${g.wear && !r.dup ? `<button class="fl-btn" data-fl="wear" data-id="${g.id}">给捞捞戴上</button>` : ""}<button class="fl-btn go" data-fl="dropok">好耶 ↑</button></div></div>`;
    root.appendChild(d);
    sparks(g.r >= 2 ? 60 : 30, [rc, "#fff", "#f472b6", "#fbbf24"]);
  }

  // ---------- 操作 ----------
  function next() {
    const dr = root.querySelector(".fl-drop"); if (dr) { dr.remove(); }
    if (st.i >= st.cards.length - 1) return;
    st.i++; st.acc = 0; st.last = 0; st.done = false; st.note = "";
    const c = card();
    if (timed(c) && c.kind !== "break") room(c.min, 0);
    paint();
  }
  function swipe() {
    if (!st || root.querySelector(".fl-book")) return;
    if (root.querySelector(".fl-drop")) return next();
    const c = card();
    if (st.done || c.kind === "break") return next();
    if (timed(c)) { st.note = "这张还没走完；不想做可以点「跳过这张」"; paint("same"); }
  }
  function onKey(e) { if (!st) return; if (e.key === "Escape") close(); else if (e.key === " " || e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); swipe(); } }
  function onClick(e) {
    const b = e.target.closest("[data-fl]"); if (!b) return;
    const a = b.dataset.fl, c = st && card();
    if (a === "x") close();
    else if (a === "next" || a === "dropok") next();
    else if (a === "skipc") { st.note = ""; next(); }
    else if (a === "yes") { try { A.done(c.key); } catch (er) {} chime(2); buzz([40, 30, 80]); sparks(40, ["#10b981", "#06b6d4", "#fbbf24", "#f472b6"]); st.cards = st.cards.filter((x, j) => j <= st.i || x.key !== c.key); next(); }
    else if (a === "more") { st.cards.splice(st.i + 1, 0, C.more(c)); next(); }
    else if (a === "nextitem") { A.skip && A.skip(c.key); st.cards = st.cards.filter((x, j) => j <= st.i || x.key !== c.key); next(); }
    else if (a === "again") {
      const k = A.ctx(), d = C.deck({ now: k.now, ranked: k.ranked, skip: k.skip });
      if (!d.cards.length) { A.toast(d.say); close(); return; }
      st.cards = d.cards; st.i = 0; st.acc = 0; st.last = 0; st.done = false; st.work = 0; st.got = 0; paint();
    } else if (a === "wear") { const b2 = C.bag(A.bag(), new Date()); b2.wear = b.dataset.id; A.saveBag(b2); A.wear(C.loot(b.dataset.id).e); next(); }
    else if (a === "book") book();
  }

  // ---------- 图鉴 ----------
  function book() {
    css();
    const now = new Date(), b = C.mergeBag(A.bag(), A.otherBags(), now);
    const host = root || document.body;
    let d = host.querySelector(".fl-book"); if (d) d.remove();
    d = document.createElement("div"); d.className = "fl-book";
    d.innerHTML = `<div class="fl-bk"><h3>🎁 捞捞的收藏 <small style="color:#94a3b8;font-weight:400">${C.owned(b)}/${C.LOOT.length}</small><button class="fl-btn sm" data-bk="x">关闭</button></h3>
      <p>在「刷任务」里每走完一张卡都有机会掉一样（今天已掉 ${b.dn}/${C.DAY_CAP}）。重复的变成碎片 🧩 ${b.sh}，攒够了点灰色的格子就能换。带 👕 的可以给捞捞戴上。</p>
      <div class="fl-grid">${C.LOOT.map((l) => { const n = b.own[l.id] || 0; return `<button class="fl-it ${n ? "" : "no"} ${b.wear === l.id ? "on" : ""}" style="--rc:${RC[l.r]}" data-bk="${l.id}"><span class="e">${l.e}</span><small>${n ? esc(l.name) : C.RARITY[l.r] + " · " + C.COST[l.r] + "🧩"}</small>${n > 1 ? `<span class="c">×${n}</span>` : l.wear ? '<span class="c">👕</span>' : ""}</button>`; }).join("")}</div></div>`;
    host.appendChild(d);
    d.addEventListener("click", (e) => {
      if (e.target === d) return d.remove();
      const x = e.target.closest("[data-bk]"); if (!x) return;
      const id = x.dataset.bk; if (id === "x") return d.remove();
      const l = C.loot(id), mine = C.mergeBag(A.bag(), A.otherBags(), new Date());
      if ((mine.own[id] || 0) > 0) {
        if (!l.wear) { A.toast(l.e + " " + l.name + "（" + C.RARITY[l.r] + "）"); return; }
        mine.wear = mine.wear === id ? "" : id; A.saveBag(mine); A.wear(mine.wear ? l.e : ""); A.toast(mine.wear ? "捞捞戴上了 " + l.e : "摘下来了"); book();
      } else {
        const r = C.redeem(mine, id, new Date());
        if (!r.ok) { A.toast(`还差 ${C.COST[l.r] - mine.sh} 片碎片才能换「${l.name}」`); return; }
        A.saveBag(r.bag); chime(l.r + 1); A.toast("换到了 " + l.e + " " + l.name); book();
      }
    });
  }

  window.FlowUI = {
    init(a) { A = a; try { const b = C.bag(A.bag(), new Date()); if (b.wear && C.loot(b.wear)) A.wear(C.loot(b.wear).e); } catch (e) {} },
    open, book, isOpen: () => !!root,
  };
})();
