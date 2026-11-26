// 捞捞算力 · 成品展示「捞小智」：讲题、做 PPT、办教务的事；一句一句边答边合成声音，公仔跟着张嘴；
//   调度中心发布了新版模型 → 后台自动换上，这里弹一句、成品版本加一。全屏模式：左边大形象和字幕，右边对话。
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const call = (m, ...a) => window.lg.call(m, ...a);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const msgOf = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '\w+': (Error: )?/, "");
  const toast = (t, err) => { const el = $("#toast"); el.textContent = t; el.className = "toast" + (err ? " err" : ""); el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), err ? 6000 : 2800); };
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(msgOf(e), true); } };
  const pct = (v) => Math.round(v * 100) + "%";
  const when = (t) => { const d = new Date(t), p = (n) => String(n).padStart(2, "0"); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  // 默认的捞捞公仔（和捞捞PPT助手里没上传照片时的那个一样）
  // 形象：捞小智（捞捞编程「冒泡排序」舞台上飞着讲解的那个小机器人，见 zhi3d.js）
  const EX = {
    student: [["讲题", ["鸡兔同笼，头 35 个、脚 94 只，各有几只？", "用通俗的话讲讲什么是冒泡排序"]], ["做 PPT", ["做一份讲「冒泡排序」的 PPT，8 页左右"]], ["办事", ["明天有什么课？", "我后天要请一天事假，回家办事", "查一下我上学期的成绩和绩点", "周四下午哪间教室空着？我们班想开班会", "帮我开一份在读证明"]], ["检测", ["我最近一次头皮检测怎么样？", "和上周比有什么进步？要调整什么？", "帮我做一下头皮自测"]]],
    teacher: [["讲题", ["出三道一元二次方程的练习题，带答案"]], ["做 PPT", ["做一份「期中复习：数组」的课件，7 页"]], ["办事", ["有没有等我审批的申请？", "我这周有哪些课？", "下周的课我要出差，想调到周六上午"]]],
    staff: [["办事", ["有哪些申请等我审批？", "明天上午第 3 节有哪些空教室？"]], ["讲题", ["请假超过 7 天要谁批？"]]],
  };
  let S = null, bot = null, busy = false, steps = new Map(), av = null, shown = false, timer = null, full = false;

  // ---------- 画 ----------
  function paint() {
    if (!S) return;
    const P = S.product, me = S.who.me;
    $("#shBuild").textContent = `成品 第 ${P.build} 版`;
    if (S.folder) paintFolder(S.folder);
    $("#shSpeak").checked = S.voice.on;
    const sel = $("#shRole");
    if (sel.options.length !== S.who.roles.length) sel.innerHTML = S.who.roles.map((r) => `<option value="${r.key}">${esc(r.name)}：${esc(r.who)}</option>`).join("");
    sel.value = S.who.role;
    $("#shMe").textContent = `现在是 ${me.role} ${me.name}${me.class ? " · " + me.class : me.dept ? " · " + me.dept : ""}`;
    $("#shVoice").textContent = "声音：" + S.voice.label;
    $("#shVoiceInstall").hidden = !(S.voice.model && !S.voice.gsv);
    const vp = $("#shVoicePick");
    if (vp) {
      const ch = S.voice.choices || {}, tOpt = vp.querySelector('[value="teacher"]');
      vp.value = S.voice.kind === "real" || S.voice.kind === "teacher" ? S.voice.kind : "kokoro";
      vp.querySelector('[value="real"]').disabled = !ch.real; if (tOpt) { tOpt.disabled = !ch.teacher; tOpt.hidden = !ch.teacher; }
      vp.hidden = S.voice.kind === "trained" && !ch.teacher;   // 捞捞的声音训练好了就用它；有老师的声音时还能换
    }
    if (S.prep) paintPrep(S.prep);
    paintBrain();
    $("#shChips").innerHTML = P.parts.map((p) => `<span class="sh-chip ${p.ready ? "" : "off"}">${esc(p.name)}<b>${p.ready ? "第 " + p.version + " 版" : "训练中"}</b></span>`).join("");
    $("#shParts").innerHTML = P.parts.map((p) => `<div class="sh-part ${p.ready ? "" : "tmp"}"><b>${esc(p.name)}</b><span class="v">${p.ready ? `第 ${p.version} 版` : "临时版在用"}${p.pending ? ` <span class="new">→ 第 ${p.pending} 版已下好</span>` : ""}</span><small>${esc(p.what)}${!p.ready && p.temp ? `<br>现在${esc(p.temp)}，训练、考试通过后自动换上` : ""}${p.metric != null ? ` · ${esc(p.metricName)} ${pct(p.metric)}${p.base != null ? `（没训练前 ${pct(p.base)}）` : ""}` : ""}</small></div>`).join("");
    $("#shHist").innerHTML = P.log.length ? P.log.map((l) => `<div><i>${when(l.at)}</i>${esc(l.name)} ${l.from ? `第 ${l.from} 版 → ` : ""}第 ${l.to} 版${l.metric != null ? `，${pct(l.metric)}` : ""}</div>`).join("") : `<div>还没有发布过的模型：训练、考试通过一版，这里自动记一笔、自动换上</div>`;
    $("#shPptBtns").hidden = !S.ppt; $("#shPptName").textContent = (S.ppt ? `${S.ppt.title}（${S.ppt.pages} 页）` : "还没有 PPT：让它做一份，或者打开一份让它改") + (S.exam ? "\n" + examLine(S.exam) : "");
    if (S.ppt && deck && (!deck.data() || deck.data().rev !== S.ppt.rev)) deck.refresh();
    const cs = S.campus;
    $("#shCampus").textContent = `捞捞学院（演示，数据都是编的）：${cs.student} 个学生、${cs.teacher} 位教师、${cs.section} 个教学班、${cs.room} 间教室`;
    const row = (r, mine) => `<div class="sh-req"><div class="top"><b>${esc(r.kind)}</b><span class="st ${/^已(批准|通过|出具)/.test(r.status) ? "ok" : /驳回|撤销/.test(r.status) ? "bad" : "wait"}">${esc(r.status)}</span><code>${esc(r.id)}</code><span class="grow"></span>${/^待/.test(r.status) ? `<button class="btn small" data-ap="${esc(r.id)}">${mine ? "模拟审批" : "同意"}</button>` : ""}</div><div class="sum">${esc(r.summary)}</div></div>`;
    $("#shReqs").innerHTML = (S.pending.length ? `<div class="muted small">等我审批的</div>` + S.pending.map((r) => row(r, false)).join("") : "") + (S.requests.length ? `<div class="muted small">我提交的</div>` + S.requests.map((r) => row(r, true)).join("") : "") || `<div class="muted small">还没有申请：让捞小智帮你请个假、借个教室试试</div>`;
    // 这台电脑正在算任务：显卡腾不出来
    $("#shBusy").hidden = !S.task || !!(S.cloud && S.cloud.on); if (S.task) $("#shBusyTip").textContent = `这台电脑正在算「${S.task}」，显卡腾不出来同时展示。暂停以后，手上的任务会交给别的电脑从存档接着算；看完再点「接着算」。`;
    $("#shPaused").hidden = !(S.paused && !S.task);
    $("#shTicker").innerHTML = `<span><b>成品 第 ${P.build} 版</b></span>` + P.parts.map((p) => `<span>${esc(p.name)} <b>${p.ready ? "第 " + p.version + " 版" : "训练中"}</b>${p.metric != null ? " " + esc(p.metricName) + " " + pct(p.metric) : ""}</span>`).join("") + `<span class="live">● 自动融合：训练出新版就自动换上</span>` + `<span>${S.task ? "这台电脑：正在算「" + esc(S.task) + "」" : S.paused ? "这台电脑：计算先停着" : "这台电脑：空着，可以展示"}</span>`;
  }
  // ---------- 准备组件：必需的下好了才开放使用；声音组件这些可以边用边下 ----------
  let prepAsked = false, prepWasOpen = null;
  function paintPrep(P) {
    const box = $("#shPrep"); if (!box) return;
    const ST = { ready: "✓ 好了", running: "下载中", missing: "还没下", error: "没成", waiting: "排队" };
    box.querySelector(".list").innerHTML = P.items.map((x) => `<div class="pi ${x.state}"><div class="t"><b>${esc(x.name)}</b>${x.required ? `<em>必需</em>` : `<em class="opt">打电话、真人声音要用</em>`}<span class="grow"></span><span class="st">${ST[x.state] || x.state}${x.state === "running" && x.pct != null ? " " + x.pct + "%" : ""}</span></div><small>${esc(x.what)} · ${esc(x.size)}</small>${x.state === "running" ? `<div class="bar"><i style="width:${x.pct || 0}%"></i></div><small class="msg">${esc(x.text || "")}</small>` : ""}${x.state === "error" ? `<small class="err">${esc(x.err)}</small>` : ""}</div>`).join("");
    const needLeft = P.items.filter((x) => x.required && x.state !== "ready").length, optLeft = P.items.filter((x) => !x.required && x.state !== "ready").length;
    box.querySelector(".go").hidden = P.running || (!needLeft && !optLeft);
    box.querySelector(".go").textContent = P.items.some((x) => x.state === "error") ? "重新下载没成的" : "开始准备";
    box.querySelector(".use").hidden = !!needLeft;
    // 本地大模型还没下好：可以不下，填 DeepSeek 的 Key 改用云端（大脑那张卡片在下面被挡着，这里直接给个入口）
    const cq = box.querySelector(".cloudq"), llmIt = P.items.find((x) => x.key === "llm");
    if (cq) cq.hidden = !llmIt || llmIt.state === "ready";
    box.querySelector(".tip").textContent = needLeft ? `先下好标着「必需」的 ${needLeft} 样才能开始用；其他的可以开始用以后接着在后台下。` : optLeft ? "必需的都好了，可以开始用了。打电话和真人感声音要用的还在后台下，下好了自动能用。" : "全部准备好了。";
    box.hidden = !!(P.open && (prepWasOpen !== false || box.dataset.closed === "1"));
    document.querySelector("#p-show .sh-grid").classList.toggle("locked", !P.open);
    if (P.open && prepWasOpen === false) { toast("组件准备好了：可以开始问捞小智了"); box.dataset.closed = "1"; box.hidden = true; }
    prepWasOpen = P.open;
    if (!P.open && !P.running && !prepAsked) { prepAsked = true; call("showPrepRun", { all: true }).then(paintPrep).catch((e) => toast(msgOf(e), true)); }
  }
  function hello() {
    const l = $("#shLog"); if (l.children.length || !S) return;
    const d = document.createElement("div"); d.className = "sh-hello";
    const h = new Date().getHours(), part = h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好", name = S.who && S.who.me ? S.who.me.name : "";
    d.innerHTML = `<div class="hi">${part}${name ? "，" + esc(name) : ""}</div><p>我是捞小智。讲题、查课表、请假借教室、做 PPT，直接跟我说就行。试试这些：</p>` +
      `<div class="grps">` + (EX[S.who.role] || EX.student).map(([g, xs]) => `<div class="grp"><span>${g}</span>${xs.map((x) => `<button class="ex">${esc(x)}</button>`).join("")}</div>`).join("") + `</div>`;
    l.appendChild(d);
  }
  const refresh = guard(async () => { S = await call("showState"); paint(); hello(); });

  // ---------- PPT 预览：做好 / 改好的每一页直接画出来；有 PPT 的时候它占大块，公仔缩到左下角 ----------
  let deckOn = false;
  const showDeck = (v) => { deckOn = !!v && deck && deck.has(); $("#shDeck").hidden = !deckOn; const dc = $("#shDeckClose"); if (dc) dc.hidden = !deckOn; document.querySelector(".sh-stagebox").classList.toggle("deck", deckOn); document.querySelector(".sh-grid").classList.toggle("deck", deckOn); $("#shPptShow").textContent = deckOn ? "看形象" : "看 PPT"; applyView(); setTimeout(() => window.dispatchEvent(new Event("resize")), 60); };

  // ---------- 右边显示什么：形象 / PPT 预览 / 说明文字，各自能关；全关掉就只留对话 ----------
  const VIEW_KEY = "lg-show-view";
  let view = { avatar: true, ppt: true, info: true };
  try { view = { ...view, ...(JSON.parse(localStorage.getItem(VIEW_KEY)) || {}) }; } catch (e) {}
  function applyView() {
    const g = document.querySelector(".sh-grid"); if (!g) return;
    document.body.classList.toggle("v-noav", !view.avatar);
    document.body.classList.toggle("v-noinfo", !view.info);
    const solo = !deckOn && !view.avatar;
    if (g.classList.contains("solo") !== solo) { g.classList.toggle("solo", solo); setTimeout(() => window.dispatchEvent(new Event("resize")), 60); }
    document.querySelectorAll("#shViewPop [data-v]").forEach((x) => { x.checked = !!view[x.dataset.v]; });
  }
  (function viewMenu() {
    const btn = $("#shViewBtn"), pop = $("#shViewPop"); if (!btn || !pop) return;
    const open = (v) => { pop.hidden = !v; btn.setAttribute("aria-expanded", v ? "true" : "false"); };
    btn.onclick = (e) => { e.stopPropagation(); open(pop.hidden); };
    document.addEventListener("click", (e) => { if (!pop.hidden && !e.target.closest("#shView")) open(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) open(false); });
    pop.addEventListener("change", (e) => {
      const k = e.target.dataset && e.target.dataset.v; if (!k) return;
      view[k] = e.target.checked;
      try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (x) {}
      if (k === "ppt") { if (!view.ppt && deckOn) showDeck(false); else if (view.ppt && deck && deck.has()) showDeck(true); }
      applyView();
    });
  })();
  const deck = window.LaoDeckView ? window.LaoDeckView.create($("#shDeck"), {
    load: (rev) => call("showSlides", rev), theme: (k) => call("showPptTheme", k), undo: async () => { const r = await call("showPptUndo"); toast("撤销了：" + r.undone); },
    open: () => call("showOpenPpt", false), reveal: () => call("showOpenPpt", true), onError: (e) => toast(msgOf(e), true),
    onChange: (has, fresh) => { if (!has) showDeck(false); else if ((fresh && view.ppt) || deckOn) showDeck(true); },
  }) : null;
  // 「关闭 PPT」放进 PPT 那一排按钮的最后，不再浮在右上角压住「用 PowerPoint 打开」
  { const bar = document.querySelector("#shDeck .dv-bar"), dc = $("#shDeckClose"); if (bar && dc) bar.appendChild(dc); }
  applyView();
  const PPT_TOOL = /^(make_ppt|set_text|replace_text|add_slide|edit_slide|delete_slide|move_slide|copy_slide|set_theme|set_font_size|format_text|insert_formula|insert_table|insert_image|delete_shape|set_notes|undo)$/;

  // ---------- 形象 ----------
  function stage() {
    const host = $("#shStage");
    if (av) return;
    try { if (window.LaoZhi && window.THREE) av = window.LaoZhi.create(host); } catch (e) { av = null; }
    if (!av && !host.querySelector(".sh-fallback")) host.innerHTML = `<div class="sh-fallback">捞</div>`;
    if (av) setTimeout(() => { try { av.mood("wave", 2); } catch (e) {} }, 300);
    if (!stage.tried) { stage.tried = true; loadAvatar(); }   // 只在第一次自动看一眼；之后换形象走 lg-avatar 事件
  }
  // 老师的 3D 小人（avatar.glb）：用捞捞PPT助手同一份渲染代码（avatar3d.js）；捞小智的表情、动作对到它会的那几个上
  const MAP3D = { wave: "wave", celebrate: "wave", happy: "wave", love: "wave", wow: "wave", point: "point", explain: "gesture", gesture: "gesture", nod: "nod", bow: "nod", listen: "nod", think: "think", confused: "think", sad: "idle", shake: "idle", idle: "idle" };
  function wrap3d(a) {
    let mode = "";
    return { ok: true, talk: (v) => a.talk(v), mood: (m, secs) => a.mood(MAP3D[m] || "idle", secs),
      setMode: (m) => { if (m === mode) return; mode = m; if (m === "think") a.mood("think", 20); else if (m === "listen") a.mood("nod", 1.2); else a.mood("idle", 0.5); },
      setManual: (v) => a.setManual(v), dispose: () => a.dispose() };
  }
  async function loadAvatar() {
    let b64 = null; try { b64 = await call("showAvatarModel"); } catch (e) { return; }
    const host = $("#shStage");
    if (!b64) { if (av && av.is3d) { try { av.dispose(); } catch (e) {} av = null; host.innerHTML = ""; stage(); } return; }
    if (!window.LaoAvatar || !window.THREE || !window.THREE.GLTFLoader) return;
    try {
      const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      if (av) try { av.dispose(); } catch (e) {}
      av = null; host.innerHTML = "";
      const a = window.LaoAvatar.create(host, window.LaoAvatar.sanitize({}), { transparent: true });
      try { await a.setAi(u8.buffer); } catch (e) { try { a.dispose(); } catch (x) {} host.innerHTML = ""; stage(); throw e; }
      av = wrap3d(a); av.is3d = true;
      window.dispatchEvent(new Event("resize"));
      setTimeout(() => { try { av.mood("wave", 2); } catch (e) {} }, 400);
    } catch (e) { toast("3D 形象读不出来：" + msgOf(e), true); }
  }
  window.addEventListener("lg-avatar", () => loadAvatar());
  // 形象卡片里换了老师的声音：重新看一下现在用哪种声音；「用老师的声音说一句」：照常念出来（带口型和动作）
  window.addEventListener("lg-voice", async () => { try { S = await call("showState"); spReset(); paint(); } catch (e) {} });
  window.addEventListener("lg-say", (e) => { if (!S) return; if (!S.voice.on) return toast("先勾上「开口说话」", true); spReset(); sayOne(String(e.detail || "")); });

  // ---------- 实时合成：回复一边出来，一句一句送去合成声音，按顺序念，公仔跟着张嘴 ----------
  const sp = { gen: 0, sent: 0, text: "", synth: Promise.resolve(), play: Promise.resolve(), player: null, told: false, q: 0 };   // q：排着没念完的句数（打电话时判断它是不是还在说）
  function spReset() { sp.gen++; sp.q = 0; sp.sent = 0; sp.text = ""; sp.synth = Promise.resolve(); sp.play = Promise.resolve(); if (sp.player) { try { sp.player.pause(); } catch (e) {} sp.player = null; } cancelAnimationFrame(lip.raf); if (av) try { av.talk(0); } catch (e) {} $("#shStage").classList.remove("talk"); $("#shSub").textContent = ""; }
  function lip(levels, ms, player) {
    cancelAnimationFrame(lip.raf);
    const t0 = performance.now(), host = $("#shStage");
    const tick = () => {
      const t = performance.now() - t0;
      if (t >= ms + 80 || player.paused || player !== sp.player) { if (av) try { av.talk(0); } catch (e) {} host.classList.remove("talk"); return; }
      const v = levels[Math.min(levels.length - 1, Math.floor((t / 1000) * 25))] || 0;
      if (av) try { av.talk(v); } catch (e) {}
      host.classList.toggle("talk", v > 0.12);
      lip.raf = requestAnimationFrame(tick);
    };
    lip.raf = requestAnimationFrame(tick);
  }
  function b64url(b64) { const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return URL.createObjectURL(new Blob([u8], { type: "audio/wav" })); }
  // 说一句话时配一个动作：看内容挑（高兴、抱歉、问题、打招呼），别的轮着比划、点头、指一下
  const GEST = ["explain", "nod", "gesture", "point"];
  let gi = 0;
  function moodOf(t) {
    if (/你好|欢迎|再见|拜拜|早上好|晚上好/.test(t)) return ["wave", 2];
    if (/恭喜|太棒|真棒|厉害|做好了|搞定|完成了|成功/.test(t)) return ["celebrate", 1.6];
    if (/抱歉|对不起|不好意思|没办法|做不到|失败|出错/.test(t)) return ["sad", 2];
    if (/[？?]\s*$/.test(t)) return ["confused", 1.8];
    if (/[！!]/.test(t)) return ["happy", 1.4];
    return [GEST[gi++ % GEST.length], 2.4];
  }
  function act(m, secs) { if (av) try { av.mood(m, secs); } catch (e) {} }
  function avMode(m) { if (av && av.setMode) try { av.setMode(m); } catch (e) {} }
  function sayOne(sentence) {
    if (window.LaoMd) sentence = window.LaoMd.speech(sentence).trim();   // 「**」「$x^2$」这些记号不念出来
    if (!S || !S.voice.on || sentence.replace(/[\s，。！？、,.!?：:；;（）()]/g, "").length < 2) return;
    const gen = sp.gen;
    sp.q++;
    // 合成一句接一句排着做（声音引擎一次做一句）；念也按顺序
    const job = (sp.synth = sp.synth.then(() => (gen === sp.gen ? call("showSpeak", sentence).catch((e) => ({ skip: "说不出来：" + msgOf(e) })) : null)));
    sp.play = sp.play.then(async () => {
      try { await play1(); } finally { if (gen === sp.gen) sp.q = Math.max(0, sp.q - 1); }
    });
    async function play1() {
      const r = await job;
      if (gen !== sp.gen || !r) return;
      if (r.skip) { if (!sp.told) { sp.told = true; toast(r.skip); } return; }
      await new Promise((done) => {
        const url = b64url(r.wav), a = new Audio(url);
        sp.player = a;
        const end = () => { URL.revokeObjectURL(url); done(); };
        a.onplay = () => { $("#shSub").textContent = r.text; lip(r.levels || [], r.ms || 0, a); const [m, secs] = moodOf(r.text || ""); act(m, Math.min(secs, Math.max(1, (r.ms || 2000) / 1000))); };
        a.onended = end; a.onerror = end; a.onpause = () => { if (a !== sp.player || gen !== sp.gen) end(); };
        a.play().catch(end);
      });
    }
  }
  // 从还没念的那一段里切出完整的句子
  function spFeed(all, flush) {
    sp.text = all.replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, "");
    for (;;) {
      const rest = sp.text.slice(sp.sent);
      const m = /^[\s\S]*?[。！？!?；;\n]+/.exec(rest);
      if (m && m[0].trim().length >= 6) { sp.sent += m[0].length; sayOne(m[0].trim()); continue; }
      if (m && rest.length > m[0].length) {   // 太短的一句（「好的。」）和后面一句并在一起
        const m2 = /^[\s\S]*?[。！？!?；;\n]+[\s\S]*?[。！？!?；;\n]+/.exec(rest);
        if (m2) { sp.sent += m2[0].length; sayOne(m2[0].trim()); continue; }
      }
      if (flush && rest.trim()) { sp.sent = sp.text.length; sayOne(rest.trim()); }
      break;
    }
  }

  // ---------- 对话 ----------
  const log = () => $("#shLog");
  const scroll = () => { const l = log(); l.scrollTop = l.scrollHeight; };
  // 回答按 Markdown 画（加粗、列表、表格、公式）；没有 md.js 时照旧纯文字
  function paintBot(el, raw) {
    const t = String(raw || "").replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, "").replace(/<\/?tool_call>?$/, "").trim();
    const box = el.querySelector(".t"); el._plain = t;
    if (window.LaoMd) { box.innerHTML = window.LaoMd.render(t); box.classList.add("md"); } else box.textContent = t;
  }
  function add(cls, html) { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; log().appendChild(d); scroll(); return d; }
  const fused = new Set();   // 已经在对话里提过的「××第 N 版换上了」，不重复提
  let said = "";   // 这一轮到现在为止说的话（几段回复接起来，给合成用）
  function botText(t) {
    if (!bot) { bot = add("sh-msg bot", '<span class="t"></span><span class="cursor"></span>'); bot._t = ""; }
    bot._t += t;
    paintBot(bot, bot._t);
    spFeed(said + bot._t, false);
    scroll();
  }
  function endBot() {
    if (!bot) return;
    said += bot._t + "\n";
    const c = bot.querySelector(".cursor"); if (c) c.remove();
    if (!(bot._plain || "").trim()) bot.remove();
    bot = null;
    spFeed(said, true);
  }
  function doneLine(e) {
    const r = e.result || {};
    if (!e.ok) return `${e.say}：${r.error || "没成功"}`;
    if (e.name === "make_ppt") return `做好了「${e.args.title || ""}」，一共 ${r.pages} 页${r.skipped ? `（有 ${r.skipped.length} 页没做出来）` : ""}`;
    if (e.name === "check_ppt") return r.ok ? "检查了一遍：版面没问题" : `检查了一遍：有 ${r.issues.length} 处要改`;
    if (PPT_TOOL.test(e.name)) return e.say + "：好了" + (r.warn ? `（${r.warn}）` : r.note ? `（${r.note}）` : "");
    if (r.id && r.status) return `${e.say}：${r.id}，${r.status}`;
    if (typeof r.count === "number") return `${e.say}（${r.count} 条）`;
    return e.say + "：好了";
  }
  // 多个助手一起做：一行一个助手，排队 → 在做 → 在查什么 → 做完（几秒）/ 没做成
  let teamBox = null;
  function teamStep(e) {
    if (e.stage === "plan") {
      endBot();
      teamBox = add("sh-step team", `<b>分给 ${e.tasks.length} 个助手同时做</b> <span class="muted">${esc(e.model || "")}</span>` + e.tasks.map((t, i) => `<div class="tm" data-i="${i}"><i>○</i> ${esc(t)} <span class="muted">排队</span></div>`).join(""));
      return;
    }
    const row = teamBox && teamBox.querySelector(`.tm[data-i="${e.i}"]`); if (!row) return;
    const ic = row.querySelector("i"), st = row.querySelector("span");
    if (e.stage === "start") { ic.textContent = "◔"; st.textContent = "在做…"; }
    else if (e.stage === "tool") st.textContent = "在" + (e.say || "查资料") + "…";
    else if (e.stage === "done") { ic.textContent = e.ok ? "✓" : "✗"; st.textContent = e.ok ? `${e.secs} 秒` : e.error || "没做成"; row.classList.add(e.ok ? "ok" : "bad"); }
    scroll();
  }
  window.lg.on("show", (e) => {
    if (e.type === "product") {   // 训练出了新版，后台已经换上
      if (S) { S.product = e.product; paint(); }
      const n0 = steps.get("note"); if (n0) { n0.remove(); steps.delete("note"); }
      if (shown && !busy) refresh();   // 声音那一行、能不能说话也跟着变
      for (const f of e.fresh || []) if (!fused.has(f.key + "|" + f.to) && fused.add(f.key + "|" + f.to)) add("sh-step fuse", esc(`✦ 「${f.name}」第 ${f.to} 版训练好了，已经自动换上${f.metric != null ? `（${pct(f.metric)}）` : ""} → 成品第 ${e.product.build} 版`));
      const b = $("#shBuild"); b.classList.remove("flash"); void b.offsetWidth; b.classList.add("flash");
      if (!shown && (e.fresh || []).length) $("#navShow").hidden = false;
      return;
    }
    if (e.type === "chats") { loadChats(); return; }
    // 混合模式：这一句交给了谁（本机 / 云端），在回答上面小字写一行
    if (e.type === "route") { endBot(); add("sh-route " + (e.where === "cloud" ? "cloud" : "local"), esc(e.where === "cloud" ? `云端回答 · ${e.why}` : `本机回答 · ${e.why}`)); return; }
    if (e.type === "exam") { endBot(); said = ""; add("sh-msg me", esc(`第 ${e.no} / ${e.total} 题：${e.q}`)); return; }
    if (e.type === "ear") { onEar(e); return; }
    if (e.type === "prep") { if (S) S.prep = e.prep; paintPrep(e.prep); if (e.prep.open && S && !e.prep.running) refresh(); return; }
    if (e.type === "note") { if (shown) { const k = "note"; const el = steps.get(k) || add("sh-step run", ""); steps.set(k, el); el.textContent = e.text; scroll(); } return; }
    if (e.type === "delta") { if (!cl.on) avMode("talk"); }
    if (e.type === "delta") { const n = steps.get("note"); if (n) { n.remove(); steps.delete("note"); } return botText(e.text); }
    if (e.type === "team") { teamStep(e); return; }
    if (e.type === "tool") {
      endBot();
      const key = e.name + JSON.stringify(e.args);
      if (e.stage === "start") { steps.set(key, add("sh-step run", esc("正在" + e.say + "…"))); if (av) try { av.mood("think", 1.5); } catch (x) {} return; }
      const el = steps.get(key) || add("sh-step", ""); steps.delete(key);
      el.className = "sh-step " + (e.ok ? "ok" : "bad"); el.textContent = doneLine(e);
      if (e.changed) refresh();
      // 改了 PPT：预览马上跟着变，跳到改的那一页
      if (window.LaoCheckup && /^checkup_/.test(e.name)) window.LaoCheckup.onTool(e, add);
      if (e.ok && e.name === "make_file" && e.result && e.result.file) { el.remove(); fileCard(e.result); }
      if (e.ok && e.result && (e.result.news || e.result.videos || e.result.images || e.result.results || e.result.pages)) webCard(e.name, e.result);
      if (e.ok && e.name === "make_ppt") add("sh-hello", `<span>做好了，左边能看到每一页。接着说怎么改就行，比如：</span><div class="grp">${["把第 3 页改成两栏对比", "整份换成绿色的", "字再大一点", "最后加一页练习题", "给每一页写上讲稿", "检查一遍有没有问题"].map((x) => `<button class="ex">${esc(x)}</button>`).join("")}</div>`);
      if (e.ok && e.changed && deck && PPT_TOOL.test(e.name)) { const r = e.result || {}; deck.refresh(e.name === "make_ppt" ? 1 : r.no || r.to || (r.pages && r.pages[0]) || (e.args && e.args.slide) || null).then(() => showDeck(true)); }
      return;
    }
    if (e.type === "done") { if (!cl.on) avMode(""); endBot(); said = ""; if (e.note) add("sh-msg bot", esc(e.note)); if (e.stopped) add("sh-step", "停下了"); return; }
    if (e.type === "error") { endBot(); said = ""; add("sh-msg bot err", esc(e.message)); }
  });
  // 自己发的一句：文字 + 带的文件（一排小卡片）
  const fileIco = (n) => { const x = (String(n).split(".").pop() || "").toLowerCase(); return /^(png|jpe?g|webp|gif|bmp)$/.test(x) ? "图" : /^docx?$/.test(x) ? "W" : /^pptx?$/.test(x) ? "P" : /^(xlsx?|csv|tsv)$/.test(x) ? "X" : x === "pdf" ? "PDF" : "</>"; };
  const meHtml = (text, files) => (files && files.length ? `<div class="me-files">${files.map((n) => `<span class="fchip"><i>${esc(fileIco(n))}</i>${esc(n)}</span>`).join("")}</div>` : "") + esc(text || "");
  async function send(text) {
    const typed = text == null;
    text = (typed ? $("#shText").value : text).trim();
    const ups = typed ? pend.filter((a) => a.id) : [];
    if (typed && pend.some((a) => !a.id && !a.err)) { toast("文件还在读，等一下再发", true); return; }
    if ((!text && !ups.length) || busy) return;
    if (S && S.prep && !S.prep.open) { toast("组件还在准备：上面的「必需」两样下好了就能用", true); return; }
    $("#shText").value = "";
    if (typed) { pend = []; paintAtts(); }
    if (!cl.on) { avMode("think"); act("think", 1.5); }
    const h = document.querySelector(".sh-hello"); if (h) h.remove();
    spReset(); said = "";
    add("sh-msg me", meHtml(text, ups.map((a) => a.name).concat($("#shScreen") && $("#shScreen").checked ? ["屏幕截图.jpg"] : [])));
    busy = true; $("#shSend").hidden = true; $("#shStop").hidden = false;
    const scr = !!($("#shScreen") && $("#shScreen").checked);
    try { S = await call("showSend", text, ups.map((a) => a.id), { screen: scr }); paint(); }
    catch (e) { endBot(); const m = msgOf(e); if (!/还没说完/.test(m)) add("sh-msg bot err", esc(m)); if (/暂停计算/.test(m)) refresh(); }
    // 这一句的收尾（把最后一段送去合成）等「done」事件来做：回话的最后几个字可能比这里晚到
    finally { busy = false; $("#shSend").hidden = false; $("#shStop").hidden = true; const n = steps.get("note"); if (n) { n.remove(); steps.delete("note"); } }
  }
  // ---------- 传文件：点回形针、拖进来、粘贴截图；先传上去读好，发的时候跟这句话一起 ----------
  let pend = [];
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + "M" : Math.max(1, Math.round(n / 1024)) + "K");
  function paintAtts() {
    const box = $("#shAtts"); if (!box) return;
    box.hidden = !pend.length;
    box.innerHTML = pend.map((a, i) => `<span class="fchip ${a.err ? "bad" : !a.id ? "up" : ""}" title="${esc(a.err || a.note || a.name)}"><i>${esc(fileIco(a.name))}</i><span class="fn">${esc(a.name)}</span><small>${a.err ? "读不了" : !a.id ? "在读…" : kb(a.size)}</small><button data-i="${i}" aria-label="去掉">×</button></span>`).join("");
  }
  async function addFiles(list) {
    for (const f of [...(list || [])].slice(0, 8)) {
      if (pend.length >= 8) { toast("一次最多带 8 个文件", true); break; }
      const a = { name: f.name || "截图.png", size: f.size };
      pend.push(a); paintAtts();
      try {
        if (f.size > 30 * 1048576) throw new Error("太大了：最多 30M");
        const r = await call("showAttach", a.name, new Uint8Array(await f.arrayBuffer()));
        Object.assign(a, { id: r.id, note: r.note, kind: r.kind });
        if (r.note) toast(r.note);
      } catch (e) { a.err = msgOf(e); toast(a.err, true); }
      paintAtts();
    }
  }
  if ($("#shScreen")) { try { $("#shScreen").checked = localStorage.getItem("lg-screen") === "1"; } catch (e) {} $("#shScreen").onchange = () => { try { localStorage.setItem("lg-screen", $("#shScreen").checked ? "1" : "0"); } catch (e) {} if ($("#shScreen").checked) toast("看屏幕打开了：每次发话都会截一张屏幕给捞小智看（不保存）"); }; }
  // 本机文件夹：选了以后，捞小智问到资料时自己去里面找、读；× 不用了
  function paintFolder(f) {
    if (!$("#shFolder")) return;
    const on = !!(f && f.root);
    $("#shFolderName").textContent = on ? f.name : "文件夹";
    $("#shFolderBox").classList.toggle("on", on);
    $("#shFolderBox").title = on ? `捞小智能在「${f.root}」里找文件、读文件（文件留在原地）。点名字换一个文件夹` : "选一个本机文件夹给捞小智：文件留在原地，问到时它自己去里面找、去读，不用一个个传";
    $("#shFolderX").hidden = !on;
  }
  if ($("#shFolder")) {
    $("#shFolder").onclick = guard(async () => { const f = await call("showFolderPick"); paintFolder(f); if (f.root) toast(`连上了「${f.name}」：可以直接问「在我的资料里找一下……」`); });
    $("#shFolderX").onclick = guard(async () => { paintFolder(await call("showFolderClear")); toast("不再看这个文件夹了"); });
  }
  if ($("#shAttach")) {
    $("#shAttach").onclick = () => $("#shFile").click();
    $("#shFile").onchange = () => { const fs = [...($("#shFile").files || [])]; if (!fs.length) return; addFiles(fs); setTimeout(() => { $("#shFile").value = ""; }, 0); };
    $("#shAtts").addEventListener("click", (e) => { const b = e.target.closest("button[data-i]"); if (b) { pend.splice(+b.dataset.i, 1); paintAtts(); } });
    const zone = document.querySelector(".sh-chat");
    zone.addEventListener("dragover", (e) => { if ([...(e.dataTransfer.types || [])].includes("Files")) { e.preventDefault(); zone.classList.add("drop"); } });
    zone.addEventListener("dragleave", (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove("drop"); });
    zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("drop"); addFiles(e.dataTransfer.files); });
    $("#shText").addEventListener("paste", (e) => { const fs = [...(e.clipboardData.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `截图-${new Date().toTimeString().slice(0, 8).replace(/:/g, "")}${i ? "-" + i : ""}.png`, { type: f.type })))); } });
  }
  // 新闻、视频、图片：在对话里直接列出来（标题点开原文、视频点「播放」在小窗口里放、图片点开所在网页）
  function webCard(name, r) {
    // 搜到的网页 / 顺着网站读过的几页：一排可以点开的来源
    const srcs = r.results || r.pages;
    if (srcs && srcs.length) {
      const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (x) { return ""; } };
      add("sh-web srcs", `<div class="wh">${r.pages ? `在 ${esc(r.site || "")} 上读了 ${r.pages.length} 页` : `搜到 ${srcs.length} 个网页`}</div><div class="sl">` + srcs.slice(0, 10).map((x) => `<a href="#" data-u="${esc(x.url)}" title="${esc(x.snippet || x.text || "")}"><b>${esc(x.title || host(x.url))}</b><small>${esc(host(x.url))}${x.engine ? " · " + esc(x.engine) : ""}</small></a>`).join("") + "</div>");
    }
    if (r.news && r.news.length) {
      add("sh-web news", `<div class="wh">今天的新闻 · ${r.news.length} 条</div>` + r.news.map((x) => `<a href="#" data-u="${esc(x.url)}"><b>${esc(x.title)}</b><small>${esc(x.source)}${x.when === "昨天" ? " · 昨天" : ""}</small></a>`).join(""));
    }
    if (r.videos && r.videos.length) {
      add("sh-web videos", `<div class="wh">${name === "news_video" ? "新闻联播" : "视频"} · ${r.videos.length} 个</div>` + r.videos.map((x) => `<div class="vi"><button class="play" data-u="${esc(x.url)}" data-play="1" aria-label="播放"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg></button><div class="vm"><b>${esc(x.title)}</b><small>${esc(x.source || "")}${x.when ? " · " + esc(x.when) : ""}</small></div><a href="#" data-u="${esc(x.url)}">原网页</a></div>`).join(""));
    }
    if (r.images && r.images.length) {
      const d = add("sh-web images", `<div class="wh">图片 · ${r.images.length} 张</div><div class="ig">` + r.images.map((x) => `<a href="#" data-u="${esc(x.page)}" title="${esc((x.title ? x.title + " · " : "") + x.source)}"><img src="${esc(x.thumb)}" alt="${esc(x.title || "")}" loading="lazy" referrerpolicy="no-referrer"><span>${esc(x.source)}</span></a>`).join("") + "</div>");
      d.querySelectorAll("img").forEach((i) => i.addEventListener("error", () => i.parentNode.remove()));
    }
  }
  $("#shLog").addEventListener("click", guard(async (e) => { const a = e.target.closest(".sh-web [data-u]"); if (!a) return; e.preventDefault(); await call("showOpenUrl", a.dataset.u, a.dataset.play ? "play" : "open"); }));
  // 捞小智交的文件：一张小卡片，点开 / 在文件夹里看 / 另存为
  function fileCard(r) {
    const d = add("sh-file", `<i>${esc(fileIco(r.file))}</i><div class="fm"><b>${esc(r.file)}</b><small>${esc(r.kind || "")}${r.size ? " · " + kb(r.size) : ""}${r.saved ? " · " + esc(r.saved) : ""}</small></div><div class="fa"><button class="btn small" data-f="open">打开</button><button class="btn small ghost" data-f="reveal">在文件夹里看</button><button class="btn small ghost" data-f="save">另存为</button></div>`);
    d.dataset.file = r.ref || r.file;
    return d;
  }
  $("#shLog").addEventListener("click", guard(async (e) => { const b = e.target.closest("[data-f]"); if (!b) return; const card = b.closest(".sh-file"); const r = await call("showFileOpen", card.dataset.file, b.dataset.f); if (b.dataset.f === "save" && r) toast("存好了：" + r); }));
  const clear = () => { log().innerHTML = ""; bot = null; said = ""; steps.clear(); spReset(); teamBox = null; };
  $("#shSend").onclick = () => send();
  $("#shStop").onclick = guard(async () => { spReset(); await call("showStop"); });
  $("#shText").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  $("#shLog").addEventListener("click", (e) => { const b = e.target.closest(".ex"); if (b) send(b.textContent); });
  const newChat = guard(async () => { if (busy) await call("showStop").catch(() => {}); await call("showReset"); clear(); hello(); chatCur = null; paintChats(); window.dispatchEvent(new CustomEvent("lg-go", { detail: "show" })); setTimeout(() => $("#shText").focus(), 50); });
  $("#shNew").onclick = newChat;
  if ($("#sideNew")) $("#sideNew").onclick = newChat;

  // ---------- 左边栏：最近的对话（存在这台电脑上），点开接着聊；⋯ 里改名、删除 ----------
  let chatRows = [], chatCur = null;
  const dayOf = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  function paintChats() {
    const box = $("#chatList"); if (!box) return;
    if (!chatRows.length) { box.innerHTML = `<div class="cl-empty">聊过的会留在这里，点一下接着聊</div>`; return; }
    const today = dayOf(Date.now()), DAY = 864e5;
    const grp = (t) => { const d = dayOf(t); return d >= today ? "今天" : d >= today - DAY ? "昨天" : d >= today - 6 * DAY ? "这一周" : d >= today - 29 * DAY ? "这个月" : "更早"; };
    let last = "", html = "";
    for (const c of chatRows) {
      const g = grp(c.at); if (g !== last) { html += `<div class="cl-g">${g}</div>`; last = g; }
      html += `<div class="ci${c.id === chatCur ? " on" : ""}" data-id="${esc(c.id)}" title="${esc(c.title)}" tabindex="0" role="button"><span class="ct">${esc(c.title)}</span><button class="ci-more" aria-label="更多" title="改名、删除"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/></svg></button></div>`;
    }
    box.innerHTML = html;
  }
  let chatsBooted = false;
  const loadChats = guard(async () => {
    if (!$("#chatList")) return;
    const r = await call("showChats"); chatRows = r.list || []; chatCur = r.cur || null; paintChats();
    // 界面刚打开（或者重新载入）而后台还在一段对话里：把那段画出来，左边亮着的和中间的对得上
    if (!chatsBooted) { chatsBooted = true; if (chatCur && !log().querySelector(".sh-msg")) openChat(chatCur); }
  });
  const openChat = guard(async (id) => {
    if (busy) { toast("捞小智正在回答，等它说完再换", true); return; }
    const r = await call("showChatOpen", id);
    clear(); chatCur = r.id; paintChats();
    window.dispatchEvent(new CustomEvent("lg-go", { detail: "show" }));
    for (const v of r.view || []) {
      if (v.k === "me") add("sh-msg me", meHtml(v.t, v.files));
      else if (v.k === "file") fileCard(v);
      else if (v.k === "bot") { const d = add("sh-msg bot", '<span class="t"></span>'); paintBot(d, v.t); }
      else add("sh-step ok", esc(v.t));
    }
    if (!(r.view || []).length) hello();
    refresh();   // 身份可能跟着这段对话换了
    scroll();
  });
  function chatMenu(row) {
    document.querySelectorAll(".ci-menu").forEach((m) => m.remove());
    const m = document.createElement("div"); m.className = "ci-menu";
    m.innerHTML = `<button data-a="ren">改名</button><button data-a="del" class="danger">删除</button>`;
    row.appendChild(m);
    m.onclick = guard(async (e) => {
      e.stopPropagation();
      const a = e.target.closest("[data-a]"); if (!a) return; m.remove();
      const id = row.dataset.id;
      if (a.dataset.a === "del") {
        if (!confirm("删除这段对话？删掉就找不回来了。")) return;
        const r = await call("showChatRemove", id); chatRows = r.list || [];
        if (chatCur === id) { clear(); hello(); chatCur = null; }
        paintChats();
      } else {
        const ct = row.querySelector(".ct"), old = ct.textContent;
        const inp = document.createElement("input"); inp.className = "ci-ren"; inp.value = old; inp.maxLength = 40;
        ct.replaceWith(inp); inp.focus(); inp.select();
        let done = false;
        const fin = guard(async (save) => { if (done) return; done = true; const v = inp.value.trim(); if (save && v && v !== old) { const r = await call("showChatRename", id, v); chatRows = r.list || []; } paintChats(); });
        inp.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); fin(true); } if (ev.key === "Escape") fin(false); };
        inp.onblur = () => fin(true);
        inp.onclick = (ev) => ev.stopPropagation();
      }
    });
  }
  if ($("#chatList")) {
    $("#chatList").addEventListener("click", (e) => {
      const row = e.target.closest(".ci"); if (!row) return;
      if (e.target.closest(".ci-more")) { e.stopPropagation(); chatMenu(row); return; }
      if (e.target.closest(".ci-menu, .ci-ren")) return;
      openChat(row.dataset.id);
    });
    $("#chatList").addEventListener("keydown", (e) => { const row = e.target.closest(".ci"); if (row && (e.key === "Enter" || e.key === " ") && e.target === row) { e.preventDefault(); openChat(row.dataset.id); } });
    document.addEventListener("click", (e) => { if (!e.target.closest(".ci-menu, .ci-more")) document.querySelectorAll(".ci-menu").forEach((m) => m.remove()); });
    loadChats();
  }
  // ---------- 对话框下面：选模型、多个助手一起做、今天的用量 ----------
  //   模型的 Key、自己加的模型、干活模型在「插件 → 模型」里管（models-ui.js），改完发 lg-models，这里跟着变
  function paintBrain() {
    const c = S && S.cloud; if (!c) return;
    const sel = $("#shModelPick"), want = (c.choices || []).map((x) => x.value + "|" + x.name).join(",");
    if (sel.dataset.v !== want) { sel.innerHTML = (c.choices || [{ value: "local", name: "本机模型" }]).map((x) => `<option value="${esc(x.value)}">${esc(x.name)}</option>`).join("") + `<option value="__add">＋ 接自己的模型…</option>`; sel.dataset.v = want; }
    sel.value = c.current || "local";
    $("#shTeam").checked = !!S.team;
    const u = c.usage || { today: {} };
    $("#shTok").textContent = c.on || (u.today && u.today.calls) ? `今天 ${u.today.calls || 0} 次 · ${fmtTok(u.today.tokens || 0)}${u.today.cost ? ` · 约 ¥${u.today.cost}` : ""}` : "";
    if ($("#shUsage")) $("#shUsage").textContent = u.today && u.today.calls ? `云端用量（估算，以各家账单为准）：今天 ${u.today.calls} 次、${fmtTok(u.today.tokens || 0)} tokens（其中 ${fmtTok(u.today.cached || 0)} 命中缓存，便宜几十倍）${u.today.cost ? `、DeepSeek 约 ¥${u.today.cost}` : ""}；本月 ${u.month.calls || 0} 次${u.month.cost ? `、约 ¥${u.month.cost}` : ""}。${c.provider === "deepseek" && c.on ? (c.peak ? "现在是 DeepSeek 高峰时段（工作日 9–12 点、14–18 点，价格翻倍）。" : "现在是 DeepSeek 空闲时段（半价）。") : ""}` : "";
  }
  const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n)) + (n ? " tokens" : "");
  $("#shModelPick").onchange = guard(async () => {
    const v = $("#shModelPick").value;
    if (v === "__add") { $("#shModelPick").value = (S && S.cloud && S.cloud.current) || "local"; window.dispatchEvent(new CustomEvent("lg-go", { detail: "plugins" })); return; }
    const was = S && S.cloud && S.cloud.current;
    try { S = await call("showCloudSet", { current: v }); } catch (e) { paintBrain(); throw e; }
    paint();
    if (was !== S.cloud.current) { clear(); hello(); toast("换成「" + S.cloud.currentName + "」：开了一段新对话"); }
  });
  $("#shTeam").onchange = guard(async () => { S = await call("showTeam", $("#shTeam").checked); paint(); toast(S.team ? "大任务会拆给几个助手同时做（用「" + (S.cloud.workerName || "本机模型") + "」）" : "不拆了：捞小智自己做"); });
  window.addEventListener("lg-models", async () => { try { const was = S && S.cloud ? S.cloud.current + "|" + S.cloud.think : ""; S = await call("showState"); paint(); if (was && was !== S.cloud.current + "|" + S.cloud.think) { clear(); hello(); chatCur = null; paintChats(); } } catch (e) {} });
  { const cq = document.querySelector("#shPrep .cloudq");
    if (cq) cq.querySelector("button").onclick = guard(async () => {
      const k = cq.querySelector("input").value.trim(); if (!k) return toast("先填 DeepSeek 的 API Key（在 platform.deepseek.com 申请）", true);
      S = await call("showCloudSet", { brain: "cloud", key: k }); cq.querySelector("input").value = ""; paint();
      window.dispatchEvent(new CustomEvent("lg-models-changed"));
      const r = await call("showCloudTest"); toast(`改用 DeepSeek 了：${(r.ms / 1000).toFixed(1)} 秒连上，不用下本地大模型`);
    }); }
  $("#shRole").onchange = guard(async () => { S = await call("showRole", $("#shRole").value); clear(); paint(); hello(); chatCur = null; paintChats(); });
  $("#shSpeak").onchange = guard(async () => { S.voice = await call("setShowSpeak", $("#shSpeak").checked); if (!S.voice.on) spReset(); paint(); if (S.voice.on && !S.voice.can) toast(S.voice.label); });
  $("#shVoiceInstall").onclick = guard(async () => { const b = $("#shVoiceInstall"); b.disabled = true; b.textContent = "正在装（几个 G，可以先接着用）…"; try { S = await call("showInstallVoice"); paint(); toast("声音组件装好了"); } finally { b.disabled = false; b.textContent = "装上声音组件"; } });
  $("#shCheck").onclick = guard(async () => { const b = $("#shCheck"); b.disabled = true; b.textContent = "正在看…"; try { const n = S ? S.product.build : 0; S = await call("showCheck"); paint(); toast(S.product.build > n ? `有新版：成品现在是第 ${S.product.build} 版` : "没有新版：现在用的就是最新的"); } finally { b.disabled = false; b.textContent = "看有没有新版"; } });
  $("#shPptOpen").onclick = guard(() => call("showOpenPpt", false));
  if ($("#shVoicePick")) $("#shVoicePick").onchange = guard(async () => { S.voice = await call("showVoicePref", $("#shVoicePick").value); spReset(); paint(); toast("声音换成：" + S.voice.label); });
  if ($("#shDeckClose")) $("#shDeckClose").onclick = () => showDeck(false);
  if ($("#shKb")) $("#shKb").onclick = guard(async () => {
    const k = await call("showKb", true);
    add("sh-step ok", esc(`知识库里有 ${k.files.length} 份资料${k.files.length ? "：" + k.files.slice(0, 8).join("、") : ""}。`)
      + ((k.errors || []).length ? "<br>" + esc("有几份读不了：" + k.errors.map((x) => x.file + "（" + x.error + "）").join("；")) : "") + "<br>"
      + esc(k.maps ? (k.maps.length ? `也连上了捞捞思维导图：${k.maps.length} 张导图（${k.maps.slice(0, 6).join("、")}）。` : "捞捞思维导图里还没有导图（在捞捞课程表电脑版里打开「思维导图」做一张）。") : "") + "<br>"
      + esc("能放：Word、PPT、PDF、网页（另存为 .html）、.txt、视频和录音（听写成带时间的文字稿）。校规、手册会按条查，回答时说「依据第几条」；想写日期、标「已废止」，在文件夹里放一个「资料说明.json」。")+ "<br>" + esc("把讲义、学生手册、通知放进刚打开的文件夹。问事实类的问题时捞小智会先查它们和你的思维导图，照资料回答、逐句核对，资料里没有就直说没有。也可以直接说「把我的××导图做成 PPT」「把这节课整理成思维导图」。"));
  });
  // 知识库里还有没听写的视频 / 录音：问一句要不要现在听写
  const kbMedia = async (k) => {
    const m = (k.status && k.status.media) || [];
    if (!m.length || !confirm(`知识库里有 ${m.length} 个视频 / 录音还没听写（${m.slice(0, 3).join("、")}${m.length > 3 ? "…" : ""}）。现在在这台电脑上听写成文字稿吗？一小时的视频要几分钟到十几分钟。`)) return;
    const r = await call("showKbImport");
    add("sh-step " + (r.errors.length ? "err" : "ok"), esc(`听写完了 ${r.done} 个` + (r.errors.length ? `；没成：${r.errors.map((x) => x.file + "（" + x.error + "）").join("；")}` : "") + "。以后问到课上讲过的内容，会说「见第几分几秒」。"));
  };
  if ($("#shKb")) { const o0 = $("#shKb").onclick; $("#shKb").onclick = guard(async () => { await o0(); const k = await call("showKb", false); await kbMedia(k); }); }
  if ($("#shVoiceExam")) $("#shVoiceExam").onclick = guard(async () => {
    const b = $("#shVoiceExam"); b.disabled = true; b.textContent = "考声音中…";
    try {
      const r = await call("showVoiceExam");
      add("sh-step " + (r.failed ? "err" : "ok"), esc(`声音考试（${{ trained: "捞捞的声音", real: "真人感", kokoro: "Kokoro", sys: "电脑自带" }[r.engine] || r.engine}）：错字率 ${Math.round(r.cer * 100)}%，数字念对 ${r.numOk == null ? "—" : Math.round(r.numOk * 100) + "%"}${r.failed ? `，${r.failed} 句没合成出来` : ""}。`)
        + r.items.filter((x) => x.cer > 0.1 || x.nums === false || x.error).slice(0, 5).map((x) => "<br>" + esc("✗ " + x.text + " → " + (x.error || "听成：" + x.heard))).join(""));
    } finally { b.disabled = false; b.textContent = "声音考试"; }
  });
  if ($("#shWebExam")) $("#shWebExam").onclick = guard(async () => {
    const b = $("#shWebExam"); b.disabled = true; b.textContent = "考试中…";
    try {
      const r = await call("showWebExam");
      const pc = (x) => Math.round(x * 100) + "%";
      add("sh-step ok", esc(`${r.mode === "record" ? "第一次：上网做了一遍、存成快照" : "按快照考的（和上次比得了）"}：${r.total} 道，答对 ${pc(r.acc)}，出处对 ${pc(r.cite)}，说「资料里没有」${pc(r.abstain)}，平均 ${r.secs} 秒一道。`)
        + r.items.filter((x) => !x.right).slice(0, 5).map((x) => "<br>" + esc("✗ " + x.q + (x.error ? "（" + x.error + "）" : x.abstained ? "（说资料里没有）" : "（答成：" + x.answer.slice(0, 40) + "）"))).join(""));
    } finally { b.disabled = false; b.textContent = "联网考试"; }
  });
  if ($("#shMm")) $("#shMm").onclick = guard(async () => {
    const b = $("#shMm"), cur = await call("showApi");
    if (cur.connected && !confirm("思维导图现在用的是捞小智。要断开、换回原来用的平台吗？（原来那家的 Key 要在思维导图里重新填一次）")) return;
    b.disabled = true;
    try {
      if (cur.connected) { await call("showApiDisconnect"); add("sh-step ok", esc("已断开：思维导图换回原来用的平台。")); return; }
      if (!confirm("接入以后，捞捞思维导图里的提问、生成导图、复核都改由这台电脑上的捞小智回答（不再用外面平台的 Key，不花钱，也不上传资料）。现在还没正式训练好，回答质量会随训练变好。要接入吗？")) return;
      let r;
      try { r = await call("showApiConnect"); }
      catch (e) {
        // 自动填不了（课内学习的统一 AI 设置、网页版、老版本）：把地址、模型、Key 给出来，照着手动填
        const m = await call("showApi");
        add("sh-step err", esc(String((e && e.message) || e).replace(/^Error:\s*/, "")) + (m.url ? "<br>" + esc("地址（接口基础地址）：" + m.url) + "<br>" + esc("模型名称：" + m.model) + "<br>" + esc("Key：") + "<code>" + esc(m.key) + "</code>" : ""));
        return;
      }
      add("sh-step ok", esc("接好了：思维导图的「大模型 API 接入」已经切到「自定义接口」，地址 " + r.url + "，模型 " + r.model + "。回到思维导图刷新一下页面，提问就是捞小智在答，回答照样变成导图节点。")
        + "<br>" + esc("别的软件也想用：地址填 " + r.url + "，模型填 " + r.model + "，Key：") + "<code>" + esc(r.key) + "</code>");
    } finally { b.disabled = false; }
  });
  if ($("#shVoiceTest")) $("#shVoiceTest").onclick = guard(async () => {
    const b = $("#shVoiceTest"); b.disabled = true; b.textContent = "试声音中…";
    try {
      const r = await call("showVoiceTest");
      add("sh-step " + (r.play ? "ok" : "err"), esc("试声音：") + r.results.map((x) => `<br>${x.ok ? "✓" : "✗"} ${esc(x.name)}：${x.ok ? "能用（合成一句 " + (x.ms / 1000).toFixed(1) + " 秒）" : esc(x.err)}`).join(""));
      if (r.play) { const url = b64url(r.play.wav), a = new Audio(url); sp.player = a; a.onplay = () => lip(r.play.levels || [], r.play.ms || 0, a); a.onended = () => URL.revokeObjectURL(url); a.play().catch(() => toast("声音放不出来：看看电脑的音量、耳机", true)); }
      else toast("三种声音都不能用：把上面那段截图发给维护的人", true);
    } finally { b.disabled = false; b.textContent = "试一下声音"; }
  });
  if ($("#shPrep")) {
    $("#shPrep .go").onclick = guard(async () => { prepAsked = true; paintPrep(await call("showPrepRun", { all: true })); });
    $("#shPrep .use").onclick = () => { $("#shPrep").dataset.closed = "1"; $("#shPrep").hidden = true; };
  }
  $("#shPptShow").onclick = guard(async () => { if (!deckOn) { await deck.refresh(); showDeck(true); } else showDeck(false); });
  $("#shPptPick").onclick = guard(async () => { const r = await call("showPickPpt"); if (!r) return; S = r; clear(); paint(); await deck.refresh(); showDeck(true); add("sh-step ok", esc(`打开了「${S.ppt.title}」（${S.ppt.pages} 页）：说要怎么改吧，比如「第 2 页的要点改成卡片」「整份换成绿色」。原来的文件不会动`)); });
  $("#shPptDir").onclick = guard(() => call("showOpenPpt", true));

  // 考一考：8 道题真的做一遍，程序核对
  const examLine = (x) => (x ? `上次考试：${x.total} 题对了 ${x.score} 题（${when(x.at)}${x.qa ? "，答题大脑第 " + x.qa + " 版" : ""}）` : "");
  $("#shPptExam").onclick = guard(async () => {
    if (busy) return toast("它正在回答，等它说完再考", true);
    if (!confirm("考一考它做 PPT、改 PPT 的本事？\n一共 8 道题，真的做一份、再照着改，要几分钟；做完由程序核对。现在的对话会清空。")) return;
    const b = $("#shPptExam"); b.disabled = true; b.textContent = "正在考…"; busy = true; clear(); add("sh-step fuse", "✦ PPT 考试开始：8 道题，做完程序自己核对");
    try {
      const r = await call("showPptExam"); S = r.state; paint(); const x = r.exam;
      add("sh-msg bot", esc(`考完了：${x.total} 题对了 ${x.score} 题，用了 ${Math.round(x.secs / 60 * 10) / 10} 分钟。\n` + x.items.map((i, k) => `${i.ok ? "✓" : "✕"} ${k + 1}. ${i.what}${i.ok ? "" : "：" + i.why}`).join("\n") + (x.score < x.total ? "\n没过的题说明这版模型这一样还不稳：换一种说法再让它做，或者等训练出新版再考。" : "")));
      if (deck) { await deck.refresh(1); showDeck(true); }
    } finally { busy = false; b.disabled = false; b.textContent = "考一考它"; $("#shSend").hidden = false; $("#shStop").hidden = true; }
  });
  $("#shCampusReset").onclick = guard(async () => { if (!confirm("把模拟教务系统恢复成刚造出来的样子？提交过的申请都会清掉。")) return; S = await call("showCampusReset"); clear(); paint(); hello(); toast("恢复好了"); });
  $("#shReqs").addEventListener("click", guard(async (e) => { const b = e.target.closest("[data-ap]"); if (!b) return; S = await call("showApprove", b.dataset.ap, true); paint(); toast("批了一步"); }));
  $("#shPause").onclick = guard(async () => { $("#shPause").disabled = true; try { S = await call("showPause", true); for (let i = 0; i < 20 && S.task; i++) { await new Promise((r) => setTimeout(r, 500)); S = await call("showState"); } paint(); } finally { $("#shPause").disabled = false; } });
  $("#shResume").onclick = guard(async () => { S = await call("showPause", false); paint(); toast("接着算了"); });

  // ---------- 打电话：一直听着；说完一停（0.75 秒没声音）就把这句话送去听写、回答；它说话的时候你一开口就打断它 ----------
  //   能量检测：安静的时候慢慢学背景噪声有多大，比它大好几倍才算有人说话；它自己在说话的时候门槛再抬高（防止听到自己的声音），
  //   要连着 0.25 秒都够大才算打断。麦克风开了回声消除。录到的话转成 16k 单声道 wav 送到本机听写，不上网。
  const FRAME = 2048, END_MS = 750, MAX_MS = 20000, MIN_MS = 350;
  const cl = { on: false, st: "off", ctx: null, stream: null, src: null, node: null, rate: 48000, floor: 0.004, pre: [], buf: null, voiced: 0, quiet: 0, speechFrames: 0, lvl: 0, seq: 0 };
  const frameMs = () => (FRAME / cl.rate) * 1000;
  const speaking = () => sp.q > 0 || !!(sp.player && !sp.player.paused && !sp.player.ended);
  const ST = { prep: "准备听写…", listen: "在听…", speech: "在听你说…", hear: "听写中…", think: "在想…", talk: "在说（你一开口就能打断）" };
  // 提示音：接通（两声上扬）、轮到你说（一声）、听到你说完了（一声低的）；自己的提示音不当成有人说话
  let bctx = null, muteUntil = 0;
  function beep(kind) {
    try {
      bctx = bctx || new (window.AudioContext || window.webkitAudioContext)();
      const c = bctx, t = c.currentTime + 0.02;
      const tones = kind === "start" ? [[660, 0, 0.1], [990, 0.12, 0.16]] : kind === "turn" ? [[880, 0, 0.11]] : [[520, 0, 0.08]];
      for (const [f, d, len] of tones) { const o = c.createOscillator(), g = c.createGain(); o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.2, t + d + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + d + len); o.connect(g); g.connect(c.destination); o.start(t + d); o.stop(t + d + len + 0.03); }
      muteUntil = performance.now() + 450;
    } catch (e) {}
  }
  function callSt(st) {
    const prev = cl.st;
    if (cl.on && st === "listen" && (prev === "think" || prev === "talk")) beep("turn");
    cl.st = st;
    avMode(st === "listen" || st === "speech" || st === "prep" ? "listen" : st === "hear" || st === "think" ? "think" : st === "talk" ? "talk" : ""); const b = $("#shCallBar"); b.dataset.st = st; $("#shCallSt").textContent = st === "prep" && cl.earPct != null ? `准备听写 ${cl.earPct}%` : st === "hear" && cl.earPct != null && !cl.earOk ? `听写准备中 ${cl.earPct}%` : ST[st] || ""; }
  // 听写模型的准备进度（第一次要下几百 M）：电话条上显示百分比，说明写在右边；准备好了换回原来的说明
  let callTip = "";
  function onEar(e) {
    if (e.done) { const was = cl.earOk; cl.earOk = true; cl.earPct = null; if (cl.on) { $("#shCallTip").textContent = callTip; if (cl.st === "prep") callSt("listen"); else callSt(cl.st); if (!was) beep("start"); } return; }
    cl.earOk = false; if (e.pct != null) cl.earPct = e.pct;
    if (!cl.on) return;
    $("#shCallTip").textContent = e.text + "。可以先说，准备好就回答你；也可以先打字";
    if (cl.st === "listen") callSt("prep"); else callSt(cl.st);
  }
  function onAudio(ev) {
    if (!cl.on) return;
    const x = ev.inputBuffer.getChannelData(0);
    let e = 0; for (let i = 0; i < x.length; i++) e += x[i] * x[i];
    const rms = Math.sqrt(e / x.length);
    cl.lvl = cl.lvl * 0.6 + rms * 0.4;
    $("#shCallLvl").style.width = Math.min(100, Math.round(Math.sqrt(cl.lvl) * 260)) + "%";
    const reply = busy || speaking();
    if ((cl.st === "think" || cl.st === "talk") && !reply) callSt("listen");
    else if (cl.st === "think" && speaking()) callSt("talk");
    if (cl.st === "hear") return;   // 正在听写上一句：先不录
    if (performance.now() < muteUntil) return;   // 自己的提示音
    const f = new Float32Array(x);
    if (!cl.buf) {
      cl.pre.push(f); if (cl.pre.length > Math.ceil(300 / frameMs())) cl.pre.shift();   // 开口前留 0.3 秒，不吃掉第一个字
      const thr = reply ? Math.max(cl.floor * 8, 0.04) : Math.max(cl.floor * 3.5, 0.012);
      if (rms > thr) cl.voiced++; else { cl.voiced = 0; if (!reply) cl.floor = Math.min(0.05, cl.floor * 0.97 + rms * 0.03); }
      if (cl.voiced >= Math.ceil((reply ? 250 : 120) / frameMs())) {
        if (reply) { spReset(); call("showStop").catch(() => {}); }   // 打断它
        cl.buf = cl.pre.slice(); cl.pre = []; cl.quiet = 0; cl.speechFrames = cl.voiced; cl.voiced = 0;
        callSt("speech");
      }
      return;
    }
    cl.buf.push(f);
    if (rms > Math.max(cl.floor * 2.5, 0.008)) { cl.quiet = 0; cl.speechFrames++; } else cl.quiet++;
    if (cl.quiet * frameMs() >= END_MS || cl.buf.length * frameMs() >= MAX_MS) finishUtt();
  }
  function finishUtt() {
    const frames = cl.buf; cl.buf = null;
    if (cl.speechFrames * frameMs() < MIN_MS) { callSt(busy || speaking() ? "talk" : "listen"); return; }   // 咳嗽、碰了一下桌子
    const n = frames.reduce((a, b) => a + b.length, 0), all = new Float32Array(n);
    let k = 0; for (const b of frames) { all.set(b, k); k += b.length; }
    const wav = toWav(all, cl.rate), seq = ++cl.seq;
    beep("got");
    callSt("hear");
    (async () => {
      let text = "";
      try { text = ((await call("showHear", wav)) || {}).text || ""; }
      catch (e) { toast(msgOf(e), true); }
      if (!cl.on || seq !== cl.seq) return;
      text = text.trim();
      if (text.replace(/[\s，。！？、,.!?嗯啊呃哦]/g, "").length < 1) { callSt("listen"); return; }
      for (let i = 0; i < 100 && busy; i++) await new Promise((r) => setTimeout(r, 50));   // 刚打断的那一句还在收尾
      callSt("think");
      await send(text);
      if (cl.on && cl.st === "think") callSt(speaking() ? "talk" : "listen");
    })();
  }
  // 降到 16k（每一段取平均，顺带滤掉高频）→ 16 位 wav → base64
  function toWav(x, rate) {
    const r = rate / 16000, n = Math.floor(x.length / r), pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) { const a = Math.floor(i * r), b = Math.max(a + 1, Math.floor((i + 1) * r)); let s = 0; for (let j = a; j < b; j++) s += x[j]; const v = Math.max(-1, Math.min(1, s / (b - a))); pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
    const u8 = new Uint8Array(44 + n * 2), dv = new DataView(u8.buffer);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) u8[o + i] = t.charCodeAt(i); };
    str(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, "data"); dv.setUint32(40, n * 2, true);
    new Uint8Array(u8.buffer, 44).set(new Uint8Array(pcm.buffer));
    let bin = ""; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  async function callOn() {
    if (cl.on) return;
    if (!S) await refresh();
    if (S && S.task) return toast(`这台电脑正在算「${S.task}」，显卡腾不出来：先点「暂停计算」再打电话`, true);
    if (S && S.call && !S.call.ear) return toast("打电话要用声音组件（GPT-SoVITS，里面带听写）：先点「装上声音组件」", true);
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
    catch (e) { return toast("用不了麦克风：" + (e.name === "NotAllowedError" ? "没有允许用麦克风" : e.name === "NotFoundError" ? "这台电脑没有麦克风" : msgOf(e)), true); }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    Object.assign(cl, { on: true, stream, ctx, rate: ctx.sampleRate, floor: 0.004, pre: [], buf: null, voiced: 0, quiet: 0, lvl: 0 });
    cl.src = ctx.createMediaStreamSource(stream);
    cl.node = ctx.createScriptProcessor(FRAME, 1, 1);
    cl.node.onaudioprocess = onAudio;
    cl.src.connect(cl.node); cl.node.connect(ctx.destination);   // 不接到输出 Chromium 不跑它（输出是静音的）
    $("#shCallBar").hidden = false; $("#shCall").classList.add("on"); $("#shCall").title = "挂断"; $("#shCall").setAttribute("aria-label", "挂断");
    const h = document.querySelector(".sh-hello"); if (h) h.remove();
    callSt("listen");
    try {
      S = await call("showCall", true);
      if (!S.voice.on) S.voice = await call("setShowSpeak", true);
      paint();
      const c = S.call || {};
      callTip = (c.lora ? `口语对话第 ${c.lora} 版` : "口语对话大脑还在训练，先用答题大脑") + (S.voice.can ? (S.voice.temp ? " · 先用电脑自带的声音说话" : "") : " · 这台电脑还出不了声，回答只出字");
      cl.earOk = !!c.earReady; if (c.earPct != null) cl.earPct = c.earPct;
      $("#shCallTip").textContent = c.earReady ? callTip : "正在准备听写（第一次要下载识别模型，几百 M，只下这一次）。可以先说，准备好就回答你；也可以先打字";
      if (!c.earReady && cl.st === "listen") callSt("prep");
      else if (c.earReady) beep("start");
    } catch (e) { toast(msgOf(e), true); }
    add("sh-step fuse", "✦ 电话接通了：直接说就行，说完停一下它就回答；它说话的时候你一开口就能打断");
  }
  async function callOff() {
    if (!cl.on) return;
    cl.on = false; cl.buf = null; cl.seq++;
    try { cl.node.disconnect(); cl.src.disconnect(); } catch (e) {}
    try { cl.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { await cl.ctx.close(); } catch (e) {}
    $("#shCallBar").hidden = true; $("#shCall").classList.remove("on"); $("#shCall").title = "打电话：一直听着，你说完一停它就回答；它说话的时候你一开口就能打断"; $("#shCall").setAttribute("aria-label", "打电话"); cl.st = "off"; avMode("");
    try { S = await call("showCall", false); paint(); } catch (e) {}
  }
  $("#shCall").onclick = () => (cl.on ? callOff() : callOn());
  $("#shHang").onclick = () => callOff();

  // ---------- 全屏展示 ----------
  async function setFull(v) {
    full = !!v;
    document.body.classList.toggle("show-full", full);
    $("#shFull").textContent = full ? "退出全屏（Esc）" : "⛶ 全屏展示";
    try { await call("showFullscreen", full); } catch (e) {}
    setTimeout(() => { scroll(); window.dispatchEvent(new Event("resize")); }, 250);
  }
  $("#shFull").onclick = () => setFull(!full);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && full) setFull(false); if (e.key === "F11" && shown) { e.preventDefault(); setFull(!full); } });

  // 进到这一页才画、才盯着新版；离开就停（全屏也退掉）
  window.addEventListener("lg-page", (e) => {
    const on = e.detail === "show";
    if (on === shown) return;
    shown = on;
    clearInterval(timer);
    if (av) try { av.setManual(!shown); } catch (x) {}
    if (!shown) { if (full) setFull(false); callOff(); spReset(); call("showActive", false).catch(() => {}); return; }
    $("#navShow").hidden = true;
    stage();
    guard(async () => { S = await call("showActive", true); paint(); hello(); if (deck && S.ppt) { await deck.refresh(); showDeck(true); } })();
    timer = setInterval(() => { if (!busy) refresh(); }, 15000);
  });
  window.__lgShow = { send, state: () => S, setFull, speech: sp, deck, call: cl, callOn, callOff };   // 测试用
})();
