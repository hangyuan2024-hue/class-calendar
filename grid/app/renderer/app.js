// 捞捞算力 · 界面
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const call = (m, ...a) => window.lg.call(m, ...a);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (t, err) => { const el = $("#toast"); el.textContent = t; el.className = "toast" + (err ? " err" : ""); el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), err ? 5000 : 2500); };
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '\w+': (Error: )?/, ""), true); } };
  const hhmm = (t) => new Date(t).toTimeString().slice(0, 8);
  const pts = (p) => (p < 10 ? Math.round(p * 10) / 10 : Math.round(p));
  const dur = (s) => (s == null ? "—" : s < 90 ? Math.round(s) + " 秒" : s < 5400 ? Math.round(s / 60) + " 分钟" : (s / 3600).toFixed(1) + " 小时");

  let S = null, page = "home", ov = null, curTask = null, metricKey = null;
  const curve = [];
  window.LaoBg($("#bg"));
  const star = window.LaoStar($("#star"));

  // ---------- 页面切换 ----------
  function go(p) {
    page = p;
    document.querySelector("main").scrollTop = 0;
    $$(".side a").forEach((a) => a.classList.toggle("on", a.dataset.p === p || (p === "record" && a.dataset.p === "guide")));
    $$(".page").forEach((x) => x.classList.toggle("on", x.id === "p-" + p));
    if (p === "home") { star.resize(); refreshOverview(); }
    if (p === "review") loadReview();
    if (p === "board") loadBoard();
    if (p === "guide") paintGuide();
    if (p === "live") drawChart();
  }
  $$(".side a").forEach((a) => (a.onclick = () => go(a.dataset.p)));

  // ---------- 加入 ----------
  $("#jGo").onclick = async () => {
    $("#jErr").textContent = "";
    if (!$("#jConsent").checked) return ($("#jErr").textContent = "先勾上同意");
    $("#jGo").disabled = true; $("#jGo").textContent = "正在加入…";
    try {
      await call("consent", true);
      S = await call("join", $("#jInvite").value, $("#jName").value, $("#jDev").value);
      boot();
    } catch (e) { $("#jErr").textContent = String(e.message || e).replace(/^Error invoking remote method '\w+': (Error: )?/, ""); }
    $("#jGo").disabled = false; $("#jGo").textContent = "加入训练网";
  };

  // ---------- 状态 ----------
  const STATE = { busy: "正在算", idle: "在线 · 等任务", waiting: "等空闲", paused: "已暂停", offline: "连不上", starting: "启动中" };
  function paintState(st) {
    if (!st) return;
    const p = $("#statePill");
    p.className = "pill " + st.state;
    p.innerHTML = `<b>${STATE[st.state] || st.state}</b>${esc(st.why || "")}`;
    $("#pauseBtn").textContent = st.state === "paused" || (S && S.paused) ? "继续" : "暂停";
    $("#navBusy").hidden = st.state !== "busy"; $("#navBusy").className = "dot";
    if (st.state !== "busy") { $("#lvJob").textContent = st.state === "paused" ? "已暂停" : "等下一个任务"; $("#lvWhy").textContent = st.why || ""; $("#lvBar").style.width = "0%"; $("#lvPct").textContent = ""; }
  }
  $("#pauseBtn").onclick = guard(async () => { const v = await call("pause", !(S && S.paused)); S.paused = v; toast(v ? "暂停了：正在算的交给别人接着算" : "继续帮忙算"); paintState({ state: v ? "paused" : "idle", why: "" }); });

  // ---------- 星图 ----------
  async function refreshOverview() {
    try { ov = await call("overview"); } catch (e) { return; }
    const pct = Math.round((ov.total || 0) * 100);
    $("#totalPct").textContent = pct + "%";
    $("#ringBar").style.strokeDashoffset = 327 * (1 - (ov.total || 0));
    $("#kOnline").textContent = ov.online; $("#kBusy").textContent = ov.busy; $("#kReview").textContent = ov.reviewsOpen || 0;
    $("#navReview").hidden = !ov.reviewsOpen; $("#navReview").textContent = ov.reviewsOpen > 99 ? "99+" : ov.reviewsOpen;
    star.set(ov.devices, S && S.deviceId);
    $("#stages").innerHTML = ov.stages.map((s, i) => `<div class="stage glass"><b>${esc(s.name)}</b><small>${s.jobs} 个任务 · ${Math.round(s.pct * 100)}%</small><div class="bar"><i style="width:${s.pct * 100}%"></i></div></div>`).join("") || `<div class="stage glass"><b>还没有任务</b><small>管理员在控制中心发任务后，这里显示各个阶段的进度</small></div>`;
    const KIND = { map: "生成 / 评测", relay: "接力训练", diloco: "多台一起训", record: "录表情" };
    $("#jobList").innerHTML = ov.jobs.filter((j) => j.state !== "done").concat(ov.jobs.filter((j) => j.state === "done").slice(-3)).map((j) => `
      <div class="job ${j.state}"><div><b>${esc(j.name)}</b><small>${KIND[j.kind] || j.kind}${j.stage ? " · " + esc(j.stage) : ""} · ${j.kind === "relay" ? `第 ${j.done}/${j.total} 步` : j.kind === "diloco" ? `第 ${j.done}/${j.total} 轮` : `${j.done}/${j.total}`}${j.state === "paused" ? " · 暂停中" : j.eta ? " · 预计还要 " + dur(j.eta) : ""}</small></div>
      <div class="bar"><i style="width:${j.pct * 100}%"></i></div><div class="pct">${j.state === "done" ? "完成" : Math.round(j.pct * 100) + "%"}</div></div>`).join("") || `<div class="empty">现在没有任务</div>`;
    $("#feed").innerHTML = ov.events.map((e) => `<div class="${e.type}"><time>${hhmm(e.ts)}</time><span>${esc(e.msg)}</span></div>`).join("");
  }

  // ---------- 我的电脑：实时 ----------
  // 先按原文切成一段段（注释、字符串、关键字、数字、函数名），每段单独转义再上色
  const TOK = /(#.*$)|([rbfu]{0,2}(?:"""|'''|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?))|\b(import|from|def|return|for|in|if|elif|else|while|with|as|try|except|finally|raise|class|lambda|not|and|or|is|None|True|False|pass|break|continue|global|yield)\b|\b(\d+\.?\d*(?:e-?\d+)?)\b|\b([A-Za-z_]\w*)(?=\s*\()/g;
  function hl(line) {
    let out = "", last = 0, m;
    TOK.lastIndex = 0;
    while ((m = TOK.exec(line))) {
      if (!m[0]) { TOK.lastIndex++; continue; }
      out += esc(line.slice(last, m.index));
      out += `<span class="${m[1] ? "c" : m[2] ? "s" : m[3] ? "k" : m[4] ? "n" : "f"}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    return out + esc(line.slice(last));
  }
  function showSource(src) {
    if (!src) return;
    $("#codeName").textContent = src.name || "";
    $("#code").innerHTML = src.source.split("\n").map((l, i) => `<div class="ln" data-l="${i + 1}"><span>${i + 1}</span><span>${hl(l) || " "}</span></div>`).join("");
  }
  function hitLine(n, fn) {
    const old = $("#code .ln.hit"); if (old) old.classList.remove("hit");
    const el = $(`#code .ln[data-l="${n}"]`);
    if (el) { el.classList.add("hit"); const box = $("#code"); const top = el.offsetTop - box.clientHeight / 2; if (Math.abs(box.scrollTop - top) > 40) box.scrollTo({ top, behavior: "smooth" }); }
    $("#codeFn").textContent = fn && fn !== "<module>" ? `${fn}() · 第 ${n} 行` : `主程序 · 第 ${n} 行`;
  }
  function addLog(l) {
    const box = $("#logs");
    const d = document.createElement("div"); d.className = l.level || ""; d.innerHTML = `<time>${hhmm(l.t || Date.now())}</time>${esc(l.msg)}`;
    box.appendChild(d); while (box.children.length > 300) box.firstChild.remove();
    box.scrollTop = box.scrollHeight;
  }
  function drawChart() { if (page === "live") window.LaoChart($("#chart"), curve, { empty: "训练任务会在这里画误差曲线" }); }
  function gauge(id, v, max, text, warm, hot) {
    const el = $(id); const k = v == null ? 0 : Math.max(0, Math.min(1, v / max));
    el.querySelector(".v").style.strokeDashoffset = 163 * (1 - k);
    el.querySelector("b").textContent = v == null ? "—" : text;
    el.classList.toggle("warm", v != null && warm != null && v >= warm && !(hot != null && v >= hot)); el.classList.toggle("hot", v != null && hot != null && v >= hot);
  }
  function paintGpu(g) {
    if (!g) return;
    gauge("#gTemp", g.temp, 100, g.temp + "℃", 75, 84);
    gauge("#gUtil", g.util, 100, g.util + "%");
    gauge("#gVram", g.used, g.vram || 8, `${(+g.used || 0).toFixed(1)}G`, (g.vram || 8) * 0.85, (g.vram || 8) * 0.97);
    gauge("#gPow", g.power, 200, Math.round(g.power || 0) + "W");
  }
  const thumbs = new Set();
  async function addImage(v) {
    const url = v.url || await call("thumb", v.path).catch(() => null);
    if (!url) return;
    const box = $("#gallery"); const e = box.querySelector(".empty"); if (e) e.remove();
    const f = document.createElement("figure"); f.innerHTML = `<img src="${url}"><figcaption>${esc(v.caption || v.job || "")}</figcaption>`;
    box.prepend(f); while (box.children.length > 24) box.lastChild.remove();
  }
  window.lg.on("agent", ({ k, v }) => {
    if (k === "state") paintState(v);
    if (k === "task") {
      // 同一个任务的下一段：曲线接着画；换了任务才清空
      if (!curTask || curTask.job.id !== v.job.id) { curve.length = 0; metricKey = null; drawChart(); }
      curTask = v;
      $("#lvJob").textContent = v.job.name; $("#lvWhy").textContent = v.recipe ? "配方：" + v.recipe.name : "";
      $("#lvBar").style.width = "0%"; $("#lvPct").textContent = "0%";
    }
    if (k === "source") showSource(v);
    if (k === "line") hitLine(v.line, v.fn);
    if (k === "log") addLog(v);
    if (k === "progress") { $("#lvBar").style.width = v.p * 100 + "%"; $("#lvPct").textContent = Math.round(v.p * 100) + "%"; }
    if (k === "metric") {
      const keys = Object.keys(v).filter((x) => x !== "id" && x !== "step");
      if (!metricKey || !keys.includes(metricKey)) metricKey = keys.find((x) => x === "loss") || keys.find((x) => /loss/.test(x)) || keys[0];
      if (metricKey && v[metricKey] != null) { curve.push([v.step, v[metricKey]]); if (curve.length > 600) curve.splice(0, curve.length - 600); $("#chartKey").textContent = metricKey; drawChart(); }
    }
    if (k === "gpu") paintGpu(v);
    if (k === "image") addImage(v);
    if (k === "done") { if (v.ok && v.secs > 60) toast(`算完一个任务（${dur(v.secs)}）`); }
  });
  window.lg.on("kicked", (m) => toast("调度中心说：" + m, true));

  // ---------- 任务向导 ----------
  function paintGuide() {
    if (!S) return;
    const order = ["probe", "env", "test", "record", "policy"];
    const first = order.find((k) => !S.steps[k]);
    $$(".step").forEach((el) => { const k = el.dataset.s; el.classList.toggle("done", !!S.steps[k]); el.classList.toggle("cur", k === first); });
    const n = order.filter((k) => !S.steps[k]).length;
    $("#navGuide").hidden = !n; $("#navGuide").textContent = n;
    if (S.probe) paintProbe(S.probe);
    if (S.env) $("#envState").textContent = S.env.ok ? `已装好：Python ${S.env.python}，PyTorch ${S.env.torch}（CUDA ${S.env.cudaVer}）` : S.env.python ? `有 Python ${S.env.python}，${S.env.torch ? "PyTorch 看不到显卡" : "还没装 PyTorch"}` : "";
    if (S.testResult) paintTest(S.testResult);
    const p = S.policy || {};
    const m = $$("input[name=mode]").find((x) => x.value === (p.mode || "idle")); if (m) m.checked = true;
    if (p.idleMin) $("#pIdle").value = p.idleMin; if (p.from) $("#pFrom").value = p.from; if (p.to) $("#pTo").value = p.to; if (p.maxTemp) $("#pTemp").value = p.maxTemp;
    $("#pGames").checked = p.yieldGames !== false; $("#pAuto").checked = !!S.autostart;
  }
  function paintProbe(r) {
    $("#probeOut").innerHTML = r.items.map((i) => `<div class="${i.state}"><small>${esc(i.name)}</small><b>${esc(i.value)}</b>${i.tip ? `<p>${esc(i.tip)}</p>` : ""}</div>`).join("");
  }
  $("#probeGo").onclick = guard(async () => { $("#probeGo").disabled = true; $("#probeGo").textContent = "体检中…"; try { const r = await call("probe"); paintProbe(r); S = await call("status"); paintGuide(); toast(r.ok ? "体检通过" : "有几项要处理，看红色的提示"); } finally { $("#probeGo").disabled = false; $("#probeGo").textContent = "重新体检"; } });
  const term = (box, e) => {
    box.hidden = false;
    if (e.msg == null && e.progress != null) { let pg = box.querySelector(".pg:last-child"); if (!pg) { pg = document.createElement("div"); pg.className = "pg"; box.appendChild(pg); } pg.textContent = "下载 " + Math.round(e.progress * 100) + "%"; return; }
    const d = document.createElement("div"); d.className = e.cmd ? "cmd" : e.done ? "hd" : ""; d.textContent = (e.done ? "✓ " : "") + e.msg;
    box.appendChild(d); while (box.children.length > 400) box.firstChild.remove(); box.scrollTop = box.scrollHeight;
  };
  window.lg.on("env", (e) => term($("#envTerm"), e));
  $("#envGo").onclick = guard(async () => {
    $("#envGo").disabled = true; $("#envCancel").hidden = false; $("#envTerm").innerHTML = "";
    try { const r = await call("envInstall"); S = await call("status"); paintGuide(); toast(r.ok ? "环境装好了" : "装完了，但 PyTorch 看不到显卡：更新显卡驱动后点「检查」", !r.ok); }
    finally { $("#envGo").disabled = false; $("#envCancel").hidden = true; }
  });
  $("#envCheck").onclick = guard(async () => { const r = await call("envCheck"); S = await call("status"); paintGuide(); toast(r.ok ? "环境没问题" : r.python ? "有 Python，PyTorch 还不行" : "还没装"); });
  $("#envCancel").onclick = () => call("envCancel");
  function paintTest(r) { $("#testOut").innerHTML = r.ok ? `✓ ${esc(r.gpu)}：半精度算力 <b>${r.tflops}</b> TFLOPS，显存 <b>${r.vram}G</b>（空闲 ${r.free_vram}G）` : `✗ ${esc(r.why || "没通过")}`; }
  window.lg.on("test", ({ k, v }) => {
    if (k === "source") { showSource(v); }
    if (k === "line") hitLine(v.line, v.fn);
    if (k === "log") term($("#testTerm"), { msg: v.msg });
    if (k === "progress") term($("#testTerm"), { msg: `[${Math.round(v.p * 100)}%] ${v.note || ""}` });
  });
  $("#testGo").onclick = guard(async () => { $("#testGo").disabled = true; $("#testTerm").innerHTML = ""; try { const r = await call("test"); paintTest(r); S = await call("status"); paintGuide(); } finally { $("#testGo").disabled = false; } });
  $("#policyGo").onclick = guard(async () => {
    const mode = ($$("input[name=mode]").find((x) => x.checked) || {}).value || "idle";
    await call("setPolicy", { mode, idleMin: +$("#pIdle").value, from: $("#pFrom").value, to: $("#pTo").value, maxTemp: +$("#pTemp").value, yieldGames: $("#pGames").checked, autostart: $("#pAuto").checked });
    S = await call("status"); paintGuide(); $("#policyState").textContent = "保存好了"; toast("保存好了");
  });

  // ---------- 录表情（小页面 record.html 里认脸；录好的交给后台存、上传） ----------
  $("#recGo").onclick = guard(async () => {
    const r = await call("recordNext", null);
    if (!r.item) return toast("管理员还没发「录表情」的任务，或者已经录完了");
    go("record");
    const f = $("#recFrame");
    f.src = "record.html";
    f.onload = () => f.contentWindow.postMessage({ type: "start", item: r.item }, "*");
  });
  window.addEventListener("message", async (e) => {
    if (e.source !== $("#recFrame").contentWindow) return;
    const m = e.data || {};
    const reply = (x) => e.source.postMessage({ type: "reply", id: m.id, ...x }, "*");
    try {
      if (m.type === "save") reply({ ok: true, r: await call("recordSave", m.task, m.idx, new Uint8Array(m.audio), m.params) });
      if (m.type === "submit") { const r = await call("recordSubmit", m.task, m.job, m.secs); reply({ ok: true, r }); S = await call("status"); toast("交上去了，谢谢！+" + Math.round(m.secs / 60 * 3) + " 分"); }
      if (m.type === "close") { go("guide"); $("#recFrame").src = "about:blank"; }
    } catch (x) { reply({ ok: false, e: String(x.message || x) }); }
  });

  // ---------- 人工审核 ----------
  let rv = null;
  async function loadReview() {
    const box = $("#rvBox");
    const r = await call("reviewNext").catch(() => ({ item: null }));
    rv = r.item;
    if (!rv) { box.innerHTML = `<div class="rv-done"><b>✓</b>现在没有要审核的了，谢谢！</div>`; return; }
    const p = rv.payload;
    if (rv.kind === "ab") box.innerHTML = `<div class="q">${esc(p.question || "哪个更好？")}<small>${esc(rv.job)} · 已有 ${rv.votes} 票，要 ${rv.need} 票</small></div>
      <div class="ab"><button data-c="a"><img src="${esc(p.aUrl)}"><span><kbd>1</kbd>左边这个</span></button><button data-c="b"><img src="${esc(p.bUrl)}"><span><kbd>2</kbd>右边这个</span></button></div>
      <div class="rv-more"><button class="btn ghost" data-c="same"><kbd>3</kbd>差不多</button><button class="btn ghost" data-c="bad"><kbd>0</kbd>两个都不行</button></div>`;
    else box.innerHTML = `<div class="q">${esc(p.question || "这个合格吗？")}<small>${esc(rv.job)}</small></div>
      <div class="ab" style="grid-template-columns:1fr;max-width:460px">${p.imgUrl ? `<img src="${esc(p.imgUrl)}" style="border-radius:16px">` : ""}${p.text ? `<p>${esc(p.text)}</p>` : ""}</div>
      <div class="rv-more"><button class="btn primary" data-c="pass"><kbd>1</kbd>合格</button><button class="btn ghost" data-c="fail"><kbd>2</kbd>不合格</button><button class="btn ghost" data-c="skip"><kbd>0</kbd>看不出来</button></div>`;
    box.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => vote(b.dataset.c)));
  }
  const vote = guard(async (c) => { if (!rv) return; const id = rv.id; rv = null; await call("vote", id, c); loadReview(); refreshOverview(); });
  document.addEventListener("keydown", (e) => {
    if (page !== "review" || !rv || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const map = rv.kind === "ab" ? { 1: "a", 2: "b", 3: "same", 0: "bad" } : { 1: "pass", 2: "fail", 0: "skip" };
    if (map[e.key]) vote(map[e.key]);
  });

  // ---------- 贡献榜 ----------
  async function loadBoard() {
    const b = await call("board").catch(() => []);
    const top = b.slice(0, 3), order = [top[1], top[0], top[2]], medal = ["🥈", "🥇", "🥉"];
    $("#podium").innerHTML = order.map((m, i) => (m ? `<div><span class="medal">${medal[i]}</span><b>${esc(m.name)}</b><small>${pts(m.points)} 分</small></div>` : "<span></span>")).join("");
    $("#boardTbl").innerHTML = `<tr><th>#</th><th>名字</th><th>积分</th><th>算力</th><th>录表情</th><th>审核</th><th>电脑</th></tr>` + b.map((m, i) => `<tr class="${S && S.me && S.me.id === m.id ? "me" : ""}"><td>${i + 1}</td><td>${esc(m.name)}</td><td class="num">${pts(m.points)}</td><td>${dur(m.secs)}</td><td>${m.records} 段</td><td>${m.reviews} 票</td><td>${m.devices} 台</td></tr>`).join("");
  }

  $("#adminGo").onclick = guard(async () => { if (!(await call("openAdmin"))) toast("只有管理员能打开", true); });

  // ---------- 启动 ----------
  async function boot() {
    S = await call("status");
    if (!S.joined) { $("#joinPage").hidden = false; $("#appShell").hidden = true; return; }
    $("#joinPage").hidden = true; $("#appShell").hidden = false;
    $("#meName").textContent = `${S.me ? S.me.name : ""} · ${S.deviceName}`;
    $("#navAdmin").hidden = !(S.me && S.me.role === "admin");
    if (S.agent) { paintState(S.agent); if (S.agent.task) { curTask = S.agent.task; $("#lvJob").textContent = S.agent.task.job.name; const src = await call("source", S.agent.task.id); showSource(src); } S.agent.logs.slice(-80).forEach(addLog); paintGpu(S.agent.gpu); }
    paintGuide();
    const first = ["probe", "env", "test", "record", "policy"].find((k) => !S.steps[k]);
    go(first && !S.steps.probe ? "guide" : "home");
    clearInterval(boot.t); boot.t = setInterval(() => { if (page === "home") refreshOverview(); else if (page === "review" && !rv) loadReview(); }, 3000);
    refreshOverview();
  }
  boot();
  window.__ready = true;
})();
