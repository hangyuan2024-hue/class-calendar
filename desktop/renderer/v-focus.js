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
          <div class="card fc-tips"><div class="card-h">小提示</div><ul><li>托盘图标右键也能开始 / 停止专注</li><li>在事项上右键「专注做这件事」，会自动填好名字</li><li>专注时长和休息时长可以在「设置」里改</li></ul></div>
        </div>
      </div>`;
    $("#fcGo", el).onclick = () => call("pomo:start", this.min || App.S.settings.pomoFocus, $("#fcTaskIn", el).value.trim());
    $("#fcStop", el).onclick = () => call("pomo:stop");
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
    const days = Array.from({ length: 14 }, (_, i) => M.addDays(now, i - 13));
    const vals = days.map((d) => Number(pomo[M.dayKey(d)]) || 0), max = Math.max(30, ...vals);
    const mon = M.dayKey(M.addDays(now, -M.weekday0(now)));
    const week = Object.keys(pomo).filter((k) => k >= mon && k <= t).reduce((a, k) => a + (Number(pomo[k]) || 0), 0);
    const total = Object.values(pomo).reduce((a, v) => a + (Number(v) || 0), 0);
    $("#fcStats", el).innerHTML = [["今天", pomo[t] || 0, "分钟"], ["本周", week, "分钟"], ["一共", total >= 120 ? (total / 60).toFixed(1) : total, total >= 120 ? "小时" : "分钟"]].map(([a, b, c]) => `<div class="stat"><span>${a}</span><b>${b}<small>${c}</small></b></div>`).join("");
    $("#fcChart", el).innerHTML = days.map((d, i) => `<div class="bar${M.dayKey(d) === t ? " today" : ""}" title="${dateCN(M.dayKey(d))}：${vals[i]} 分钟"><i style="height:${Math.round((vals[i] / max) * 100)}%">${vals[i] ? `<em>${vals[i]}</em>` : ""}</i><span>${d.getDate()}</span></div>`).join("");
    this.pomo(App.pomo);
  },
  pomo(p) {
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
