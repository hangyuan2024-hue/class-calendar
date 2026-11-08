// 捞捞编程 · 拖出程序的「实时画面」小窗口（置顶，可以放在屏幕任何地方）
// 主界面追踪好了把每一步发过来（window.pop.on），这里自己播放；窗口拉大了就画全部变量，小的时候只画最重要的那个
"use strict";
(function () {
  const $ = (s) => document.querySelector(s);
  const I = window.ICON, B = window.VizBoard, SND = window.LaoSfx;
  const STAGE = window.LaoStage && window.LaoStage.webgl() ? window.LaoStage : null;
  let stage = null;
  const sndIcon = () => I(SND && SND.muted ? "mute" : "sound", 14);
  const sorted = (a) => a.every((x, i) => i === 0 || a[i - 1] <= x) || a.every((x, i) => i === 0 || a[i - 1] >= x);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const S = { steps: [], k: 0, pk: -5, timer: 0, interval: 400, focus: null, src: "", lang: "", tip: "", changed: false, userPlay: false };
  const big = () => innerWidth >= 560 && innerHeight >= 430;

  $('[data-f="play"]').innerHTML = I("play", 14);
  $('[data-f="max"]').innerHTML = I("maximize", 14);
  $('[data-f="dock"]').innerHTML = I("minimize", 14);
  $('[data-f="snd"]').innerHTML = sndIcon();
  if (SND) SND.onChange(() => { $('[data-f="snd"]').innerHTML = sndIcon(); });

  function status(kind, html) { $("#vfDot").className = "vf-dot " + (kind || ""); if (html != null) $("#vfNote").innerHTML = html; }
  function go(k) {
    if (!S.steps.length) return;
    S.k = Math.max(0, Math.min(S.steps.length - 1, k));
    const s = S.steps[S.k], prev = S.steps[S.k - 1], py = S.lang === "python";
    const full = big();
    $("#vfBoard").classList.toggle("mini", !full);
    const fa = S.focus ? B.focusArray(s, S.focus) : null;
    if (fa && !stage && STAGE) stage = STAGE.create($("#vfStage"), { mini: !full });
    $("#vfStage").hidden = !(fa && stage);
    document.body.classList.toggle("has-stage", !!(fa && stage));
    if (fa && stage) {
      const last = S.k === S.steps.length - 1;
      const stt = { a: fa.values, marks: fa.marks, done: last && S.changed && sorted(fa.values) };
      if (S.pk === S.k - 1) stage.step(stt, { dur: S.timer ? S.interval * 0.9 : 600, sound: S.userPlay }); else stage.set(stt);
    }
    S.pk = S.k;
    B.render($("#vfBoard"), s, prev, { mini: !full, focus: fa && stage && !full ? null : S.focus, py, n: S.k });
    const line = (S.src.split("\n")[s.l - 1] || "").trim();
    $("#vfLine").innerHTML = `<span class="hud-k">L${s.l}</span><code>${esc(line.slice(0, 120))}</code>`;
    $("#vfStep").textContent = `${S.k + 1}/${S.steps.length}`;
    $("#vfBar").style.width = ((S.k + 1) / S.steps.length) * 100 + "%";
    if (!S.tip) $("#vfNote").innerHTML = B.narrate(s, prev, { py });
    window.pop.send({ type: "k", k: S.k, line: s.l });
    if (S.k >= S.steps.length - 1) pause();
  }
  function play() {
    if (!S.steps.length) return;
    if (S.k >= S.steps.length - 1) go(0);
    clearInterval(S.timer);
    S.interval = stage || STAGE ? Math.max(220, Math.min(650, 20000 / S.steps.length)) : Math.max(60, Math.min(450, 7000 / S.steps.length));
    S.timer = setInterval(() => go(S.k + 1), S.interval);
    $('[data-f="play"]').innerHTML = I("pause", 14);
  }
  function pause() { clearInterval(S.timer); S.timer = 0; $('[data-f="play"]').innerHTML = I("play", 14); }

  window.pop.on((m) => {
    if (!m) return;
    if (m.type === "result") {
      pause();
      Object.assign(S, { steps: m.steps || [], focus: m.focus, src: m.src || "", lang: m.lang || "", tip: m.tip || "", k: 0, pk: -5, userPlay: false });
      S.changed = false;
      if (S.focus) { let first = null; for (const x of S.steps) { const fa = B.focusArray(x, S.focus); if (!fa) continue; const k = fa.values.join(); if (first == null) first = k; else if (k !== first) { S.changed = true; break; } } }
      $("#vfFile").textContent = m.name || "";
      $("#vfBoard").classList.remove("stale");
      status(m.kind || "ok", m.tip || "");
      go(m.k || 0); if (m.autoplay !== false) play();
    } else if (m.type === "status") {
      status(m.kind, m.html);
      if (m.stale) $("#vfBoard").classList.add("stale");
      if (m.kind === "wait" || m.kind === "run") pause();
    } else if (m.type === "clear") {
      pause(); S.steps = []; $("#vfBoard").innerHTML = ""; $("#vfLine").innerHTML = ""; $("#vfStep").textContent = ""; $("#vfFile").textContent = ""; $("#vfBar").style.width = "0";
      status("idle", esc(m.text || "在捞捞编程里打开一个 C / C++ / Python 文件，这里会跟着画"));
    } else if (m.type === "pause") pause();
  });

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-f]");
    if (b) { const a = b.dataset.f; if (a === "snd") { SND && SND.toggle(); return; } if (a === "play") { S.userPlay = true; S.timer ? pause() : play(); } else if (a === "max") { pause(); window.pop.send({ type: "expand", k: S.k }); } else if (a === "dock") window.pop.send({ type: "dock" }); return; }
    if (e.target.closest("#vfTrack") && S.steps.length) { const r = $("#vfTrack").getBoundingClientRect(); pause(); go(Math.round(((e.clientX - r.left) / r.width) * (S.steps.length - 1))); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === " ") { e.preventDefault(); S.userPlay = true; S.timer ? pause() : play(); }
    else if ((e.key === "m" || e.key === "M") && SND) SND.toggle();
    else if (e.key === "ArrowRight") { pause(); go(S.k + 1); } else if (e.key === "ArrowLeft") { pause(); go(S.k - 1); }
    else if (e.key === "Escape") window.pop.send({ type: "dock" });
  });
  // 窗口拉大 / 缩小：换画法
  let rz = 0; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (S.steps.length) go(S.k); }, 80); });
  window.pop.send({ type: "ready" });
})();
