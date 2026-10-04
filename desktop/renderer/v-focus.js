// 专注（番茄钟）：大圆环倒计时，计时在后台跑，关掉窗口也不停；下面是最近两周的专注记录
"use strict";
App.views.focus = {
  title: "专注", icon: "focus", min: null,
  count() { return App.pomo && App.pomo.running ? { n: Math.ceil(App.pomo.left / 60) } : null; },
  mount(el) {
    el.innerHTML = `
      <div class="vhead"><div><h1>专注</h1><div class="sub">计时在后台跑，关掉窗口也不停，到点右下角提醒</div></div></div>
      <div class="vbody fc-body">
        <div class="card fc-main">
          <div class="fc-ring"><svg viewBox="0 0 220 220"><circle cx="110" cy="110" r="96" class="bg"/><circle cx="110" cy="110" r="96" class="fg" id="fcArc"/></svg>
            <div class="fc-mid"><span id="fcPhase">准备好了</span><b id="fcTime" class="mono">25:00</b><small id="fcTask"></small></div></div>
          <div class="fc-ctl" id="fcCtl">
            <input class="input" id="fcTaskIn" list="fcTodos" maxlength="60" placeholder="这次专注做什么？（可不填）">
            <datalist id="fcTodos"></datalist>
            <div class="seg" id="fcMins"></div>
            <button class="btn primary big" id="fcGo">▶ 开始专注</button>
          </div>
          <div class="fc-ctl hidden" id="fcRun"><button class="btn big" id="fcStop">■ 停止</button></div>
        </div>
        <div class="fc-side">
          <div class="stats" id="fcStats"></div>
          <div class="card"><div class="card-h">最近 14 天<span class="grow"></span><small>分钟</small></div><div id="fcChart" class="fc-chart"></div></div>
          <div class="card fc-noise"><div class="card-h">白噪音<span class="grow"></span><small>专注时自动播放，休息时停</small></div>
            <div class="fc-nz" id="fcNoise">${NOISES.map(([k, ic, n]) => `<button data-nz="${k}"><span>${ic}</span>${n}</button>`).join("")}</div>
            <div class="row" style="padding:0 16px 14px;gap:10px"><span class="muted">音量</span><input type="range" min="0" max="1" step="0.05" id="fcVol" style="flex:1"><button class="btn sm" id="fcTry">试听</button></div></div>
          <div class="card fc-tips"><div class="card-h">小提示</div><ul><li>任务栏图标右键、托盘图标右键都能开始 / 停止专注</li><li>专注时任务栏图标上有进度条；默认不弹事项提醒，结束后一起告诉你</li><li>在事项上右键「专注做这件事」，会自动填好名字</li><li>完成一个番茄 +2 成长值，和网页版的番茄钟算在一起</li></ul></div>
        </div>
      </div>`;
    $("#fcGo", el).onclick = () => call("pomo:start", this.min || App.S.settings.pomoFocus, $("#fcTaskIn", el).value.trim());
    $("#fcStop", el).onclick = () => call("pomo:stop");
    $("#fcNoise", el).onclick = (e) => { const b = e.target.closest("[data-nz]"); if (!b) return; call("settings", { noise: b.dataset.nz }).then(() => { Noise.sync(); if (b.dataset.nz !== "off" && !(App.pomo && App.pomo.running)) Noise.preview(); }); };
    $("#fcVol", el).oninput = (e) => { Noise.setVol(+e.target.value); clearTimeout(this._vt); this._vt = setTimeout(() => call("settings", { noiseVol: +e.target.value }), 400); };
    $("#fcTry", el).onclick = () => Noise.preview();
    $("#fcMins", el).onclick = (e) => { const b = e.target.closest("button"); if (!b) return; this.min = +b.dataset.m; this.drawMins(); this.pomo(App.pomo); };
  },
  show(arg) {
    if (arg.task) $("#fcTaskIn", this.el).value = arg.task;
    if (arg.start && !(App.pomo && App.pomo.running)) $("#fcGo", this.el).click();
  },
  drawMins() {
    const cur = this.min || App.S.settings.pomoFocus;
    const opts = [...new Set([15, 25, 45, 60, App.S.settings.pomoFocus])].sort((a, b) => a - b);
    $("#fcMins", this.el).innerHTML = opts.map((m) => `<button data-m="${m}" class="${m === cur ? "on" : ""}">${m} 分钟</button>`).join("");
  },
  update() {
    const el = this.el, S = App.S, pomo = S.pomo || {}, now = App.now(), t = M.dayKey(now);
    this.drawMins();
    $("#fcTodos", el).innerHTML = M.sortItems(App.items().filter((x) => !x.done && !x.hidden)).slice(0, 30).map((x) => `<option value="${esc(x.title)}">`).join("");
    const fm = S.focusMin || {}, mins = (k) => Number(fm[k]) || (Number(pomo[k]) || 0) * 25;
    const days = Array.from({ length: 14 }, (_, i) => M.addDays(now, i - 13));
    const vals = days.map((d) => mins(M.dayKey(d))), max = Math.max(30, ...vals);
    const mon = M.dayKey(M.addDays(now, -M.weekday0(now)));
    const keys = [...new Set(Object.keys(fm).concat(Object.keys(pomo)))];
    const week = keys.filter((k) => k >= mon && k <= t).reduce((a, k) => a + mins(k), 0), total = keys.reduce((a, k) => a + mins(k), 0);
    const cnt = Object.values(pomo).reduce((a, v) => a + (Number(v) || 0), 0);
    $("#fcStats", el).innerHTML = [["今天", mins(t), "分钟"], ["今天的番茄", Number(pomo[t]) || 0, "个"], ["本周", week >= 120 ? (week / 60).toFixed(1) : week, week >= 120 ? "小时" : "分钟"], ["一共", total >= 120 ? (total / 60).toFixed(1) : total, total >= 120 ? "小时" : "分钟"], ["一共番茄", cnt, "个"], ["最长连续", this.streak(keys, mins), "天"]].map(([a, b, c]) => `<div class="stat"><span>${a}</span><b>${b}<small>${c}</small></b></div>`).join("");
    $("#fcChart", el).innerHTML = days.map((d, i) => `<div class="bar${M.dayKey(d) === t ? " today" : ""}" title="${dateCN(M.dayKey(d))}：${vals[i]} 分钟"><i style="height:${Math.round((vals[i] / max) * 100)}%">${vals[i] ? `<em>${vals[i]}</em>` : ""}</i><span>${d.getDate()}</span></div>`).join("");
    const nz = S.settings.noise || "off";
    $$("#fcNoise [data-nz]", el).forEach((b) => b.classList.toggle("on", b.dataset.nz === nz));
    if (document.activeElement !== $("#fcVol", el)) $("#fcVol", el).value = S.settings.noiseVol ?? 0.4;
    this.pomo(App.pomo);
  },
  streak(keys, mins) { const set = new Set(keys.filter((k) => mins(k) > 0)); let best = 0, cur = 0, prev = null; for (const k of [...set].sort()) { cur = prev && shiftDay(prev, 1) === k ? cur + 1 : 1; best = Math.max(best, cur); prev = k; } return best; },
  pomo(p) {
    Noise.sync(p);
    const el = this.el; if (!el) return;
    p = p || {};
    const C = 2 * Math.PI * 96, arc = $("#fcArc", el);
    arc.style.strokeDasharray = C;
    $("#fcCtl", el).classList.toggle("hidden", !!p.running);
    $("#fcRun", el).classList.toggle("hidden", !p.running);
    el.classList.toggle("fc-break", p.running && p.phase === "break");
    if (p.running) {
      $("#fcPhase", el).textContent = p.phase === "focus" ? "专注中" : "休息一下";
      $("#fcTime", el).textContent = `${M.pad(Math.floor(p.left / 60))}:${M.pad(p.left % 60)}`;
      $("#fcTask", el).textContent = p.task || "";
      arc.style.strokeDashoffset = C * (1 - p.left / (p.total || 1));
    } else {
      const m = this.min || App.S.settings.pomoFocus;
      $("#fcPhase", el).textContent = "准备好了"; $("#fcTime", el).textContent = `${M.pad(m)}:00`; $("#fcTask", el).textContent = "";
      arc.style.strokeDashoffset = 0;
    }
    if (!p.running && this._was) this.update();
    this._was = !!p.running;
  },
};

// ---------- 白噪音：用电脑现场生成（雨声、海浪、风扇……），不用下载，也不联网 ----------
const NOISES = [["off", "🔇", "关闭"], ["rain", "🌧", "雨声"], ["wave", "🌊", "海浪"], ["brown", "🌬", "低沉风声"], ["pink", "🍃", "沙沙声"], ["white", "📻", "白噪音"], ["fire", "🔥", "篝火"]];
const Noise = {
  ctx: null, nodes: [], kind: "off", gain: null, timer: 0,
  setVol(v) { if (this.gain) this.gain.gain.setTargetAtTime(v * 0.6, this.ctx.currentTime, 0.1); },
  sync(p) {
    p = p || App.pomo || {};
    const want = App.S && p.running && p.phase === "focus" ? App.S.settings.noise || "off" : "off";
    if (want !== this.kind) this.play(want);
  },
  preview() { const k = App.S.settings.noise; if (!k || k === "off") return toast("先选一种声音"); this.play(k); clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), 5000); },
  buffer(kind) {
    const ctx = this.ctx, len = ctx.sampleRate * 4, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === "white") d[i] = w * 0.35;
        else if (kind === "pink" || kind === "rain") { b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + w * 0.5362) * 0.11; }
        else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }   // brown / wave / fire
        if (kind === "rain" && Math.random() < 0.0009) d[i] += (Math.random() - 0.5) * 0.9;          // 雨点
        if (kind === "fire" && Math.random() < 0.0004) { for (let k = 0; k < 60 && i + k < len; k++) d[i + k] += (Math.random() - 0.5) * 0.7 * (1 - k / 60); }   // 噼啪声
      }
      for (let i = 0; i < 2000; i++) { const f = i / 2000; d[i] *= f; d[len - 1 - i] *= f; }   // 接缝处淡入淡出，循环听不出断点
    }
    return buf;
  },
  play(kind) {
    this.stop(); this.kind = kind; if (kind === "off") return;
    try {
      this.ctx = this.ctx || new AudioContext();
      const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = this.buffer(kind); src.loop = true; this.gain = g;
      g.gain.value = 0; g.gain.setTargetAtTime((App.S.settings.noiseVol ?? 0.4) * 0.6, ctx.currentTime, 0.8);
      let tail = src;
      if (kind === "rain" || kind === "pink") { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = kind === "rain" ? 7000 : 3200; tail.connect(f); tail = f; }
      if (kind === "wave") { const lfo = ctx.createOscillator(), lg = ctx.createGain(), wg = ctx.createGain(); lfo.frequency.value = 0.11; lg.gain.value = 0.45; wg.gain.value = 0.55; lfo.connect(lg).connect(wg.gain); lfo.start(); tail.connect(wg); tail = wg; this.nodes.push(lfo); }
      tail.connect(g).connect(ctx.destination); src.start();
      this.nodes.push(src);
    } catch (e) { this.kind = "off"; }
  },
  stop() { for (const n of this.nodes) { try { n.stop(); } catch (e) {} } this.nodes = []; if (this.gain) { try { this.gain.disconnect(); } catch (e) {} this.gain = null; } this.kind = "off"; },
};
