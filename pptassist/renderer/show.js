// 捞捞PPT助手 · 成品展示「捞小智」：一个对话里讲题、做 PPT、办教务的事；形象跟着声音张嘴；右边是成品第几版、各样的成绩
"use strict";
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const call = (m, ...a) => window.cc.call(m, ...a);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const msgOf = (e) => String((e && e.message) || e).replace(/^Error invoking remote method 'call': (Error: )?/, "");
  const toast = (t, err) => { const el = $("#toast"); el.textContent = t; el.className = "toast" + (err ? " err" : ""); el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), err ? 6000 : 2600); };
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(msgOf(e), true); } };
  const pct = (v) => Math.round(v * 100) + "%";
  const when = (t) => { const d = new Date(t), p = (n) => String(n).padStart(2, "0"); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  let S = null, bot = null, said = "", busy = false, steps = new Map(), av = null, player = null, shown = false, timer = null;

  const PILL = { off: ["没启动", ""], starting: ["启动中…", "busy"], ready: ["已就绪", "ok"], "need-model": ["要下载模型", "err"], missing: ["缺少程序", "err"], error: ["出错了", "err"] };
  const EX = {
    student: [["讲题", ["鸡兔同笼，头 35 个、脚 94 只，各有几只？", "用通俗的话讲讲什么是冒泡排序"]], ["做 PPT", ["做一份讲「冒泡排序」的 PPT，6 页左右"]], ["办事", ["明天有什么课？", "我后天要请一天事假，回家办事", "查一下我上学期的成绩和绩点", "周四下午哪间教室空着？我们班想开班会", "帮我开一份在读证明"]]],
    teacher: [["讲题", ["出三道一元二次方程的练习题，带答案"]], ["做 PPT", ["做一份「期中复习：数组」的课件，7 页"]], ["办事", ["有没有等我审批的申请？", "我这周有哪些课？", "下周的课我要出差，想调到周六上午"]]],
    staff: [["办事", ["有哪些申请等我审批？", "把等我批的请假都看一下", "明天上午第 3 节有哪些空教室？"]], ["讲题", ["请假超过 7 天要谁批？"]]],
  };

  // ---------- 画 ----------
  function paint() {
    if (!S) return;
    const [t, c] = PILL[S.llm.status] || [S.llm.status, ""];
    $("#shPill").textContent = t; $("#shPill").className = "pill " + c;
    $("#shModel").textContent = S.model.ready ? S.model.name : `${S.model.name}：还没下载`;
    $("#shDl").hidden = S.model.ready; $("#shGo").hidden = !S.model.ready || S.llm.status === "ready" || S.llm.status === "starting";
    $("#shSpeak").checked = S.voice.on; $("#shSpeakWrap").title = S.voice.label + (S.voice.gsv ? "" : "（要先在「我的声音」里装好 GPT-SoVITS）");
    $("#shVoice").textContent = "声音：" + S.voice.label;
    const sel = $("#shRole");
    if (sel.options.length !== S.who.roles.length) sel.innerHTML = S.who.roles.map((r) => `<option value="${r.key}">${esc(r.name)}：${esc(r.who)}</option>`).join("");
    sel.value = S.who.role;
    const me = S.who.me;
    $("#shMe").textContent = `${me.role} ${me.name}${me.class ? " · " + me.class : me.dept ? " · " + me.dept : ""} · ${me.today} ${me.weekday} 第 ${me.week} 周`;
    $("#shName").textContent = S.avatar.own ? "捞小智（老师的形象）" : "捞小智（默认的捞捞）";
    // 成品
    const P = S.product;
    $("#shBuild").textContent = `第 ${P.build} 版`;
    $("#shParts").innerHTML = P.parts.map((p) => `<div class="sh-part ${p.ready ? "" : "off"}"><b>${esc(p.name)}</b><span class="v">${p.ready ? `第 ${p.version} 版` : "还没训练好"}${p.pending ? ` <span class="new">→ 第 ${p.pending} 版已下好，下次用时换上</span>` : ""}</span><small>${esc(p.what)}${p.metric != null ? ` · ${esc(p.metricName)} ${pct(p.metric)}${p.base != null ? `（没训练前 ${pct(p.base)}）` : ""}` : ""}</small></div>`).join("");
    $("#shHist").innerHTML = P.log.length ? P.log.map((l) => `<div><i>${when(l.at)}</i>${esc(l.name)} ${l.from ? `第 ${l.from} 版 → ` : ""}第 ${l.to} 版${l.metric != null ? `，${pct(l.metric)}` : ""}</div>`).join("") : `<div>还没有记录：捞捞算力每训练、考试通过一版，这里记一笔${P.checked ? "（上次看：" + when(P.checked) + "）" : ""}</div>`;
    // 做好的 PPT
    $("#shPptBtns").hidden = !S.ppt; $("#shPptName").textContent = (S.ppt ? `${S.ppt.title}（${S.ppt.pages} 页）` : "还没有 PPT：让它做一份，或者打开一份让它改") + (S.exam ? "\n" + examLine(S.exam) : "");
    if (S.ppt && deck && (!deck.data() || deck.data().rev !== S.ppt.rev)) deck.refresh();
    // 教务
    const cs = S.campus;
    $("#shCampus").textContent = `捞捞学院（演示）：${cs.student} 个学生、${cs.teacher} 位教师、${cs.section} 个教学班、${cs.room} 间教室；申请 ${cs.leave + cs.adjust + cs.booking + cs.cert} 份`;
    const row = (r, mine) => `<div class="sh-req"><div class="top"><b>${esc(r.kind)}</b><span class="pill ${/^已(批准|通过|出具)/.test(r.status) ? "ok" : /驳回|撤销/.test(r.status) ? "err" : "busy"}">${esc(r.status)}</span><code>${esc(r.id)}</code><span class="grow"></span>${/^待/.test(r.status) ? `<button class="btn sm" data-ap="${esc(r.id)}" title="${mine ? "替该审批的人点一下同意（演示用）" : "同意"}">${mine ? "模拟审批" : "同意"}</button>` : ""}</div><div class="sum">${esc(r.summary)}</div></div>`;
    $("#shReqs").innerHTML = (S.pending.length ? `<div class="muted">等我审批的</div>` + S.pending.map((r) => row(r, false)).join("") : "") + (S.requests.length ? `<div class="muted">我提交的</div>` + S.requests.map((r) => row(r, true)).join("") : "") || `<div class="muted">还没有申请：让捞小智帮你请个假、借个教室试试</div>`;
  }
  function hello() {
    const l = $("#shLog"); if (l.children.length) return;
    const d = document.createElement("div"); d.className = "sh-hello";
    d.innerHTML = `<b>你好，我是捞小智。</b><span>讲题、做 PPT、办教务的事都可以找我，比如：</span>` + (EX[S.who.role] || EX.student).map(([g, xs]) => `<div class="grp"><span>${g}</span>${xs.map((x) => `<button class="ex">${esc(x)}</button>`).join("")}</div>`).join("");
    l.appendChild(d);
  }
  const refresh = guard(async () => { S = await call("showState"); paint(); hello(); });

  // ---------- PPT 预览：做好 / 改好的每一页直接画出来，每改一步跟着变 ----------
  let deckOn = false;
  const showDeck = (v) => { deckOn = !!v && !!deck && deck.has(); $("#shDeck").hidden = !deckOn; $("#shDeck").closest(".chat").classList.toggle("deck", deckOn); setTimeout(() => window.dispatchEvent(new Event("resize")), 60); $("#shPptShow").textContent = deckOn ? "收起预览" : "看 PPT"; };
  const deck = window.LaoDeckView ? window.LaoDeckView.create($("#shDeck"), {
    load: (rev) => call("showSlides", rev), theme: (k) => call("showPptTheme", k), undo: async () => { const r = await call("showPptUndo"); toast("撤销了：" + r.undone); },
    open: () => call("showOpenPpt", false), reveal: () => call("showOpenPpt", true), onError: (e) => toast(String((e && e.message) || e), true),
    onChange: (has, fresh) => { if (!has) showDeck(false); else if (fresh || deckOn) showDeck(true); },
  }) : null;
  const PPT_TOOL = /^(make_ppt|set_text|replace_text|add_slide|edit_slide|delete_slide|move_slide|copy_slide|set_theme|set_font_size|format_text|insert_formula|insert_table|insert_image|delete_shape|set_notes|undo)$/;

  // ---------- 形象：用老师现在的形象（没有就是默认的捞捞），跟着声音张嘴 ----------
  function stage() {
    const host = $("#shStage");
    if (av || !window.LaoApp) return;
    try { if (window.LaoAvatar && window.THREE) av = window.LaoAvatar.create(host, window.LaoApp.spec(), { transparent: true, face: window.LaoApp.face() }); } catch (e) { av = null; }
    if (!av && !host.querySelector(".sh-fallback")) host.innerHTML = `<div class="sh-fallback">捞</div>`;
    if (av) setTimeout(() => { try { av.mood("wave", 2); } catch (e) {} }, 300);
  }
  function lip(levels, ms) {
    cancelAnimationFrame(lip.raf);
    const t0 = performance.now(), host = $("#shStage");
    const tick = () => {
      const t = performance.now() - t0;
      if (t >= ms || !player || player.paused) { if (av) try { av.talk(0); } catch (e) {} host.classList.remove("talk"); return; }
      const v = levels[Math.min(levels.length - 1, Math.floor((t / 1000) * 25))] || 0;
      if (av) try { av.talk(v); } catch (e) {}
      host.classList.toggle("talk", v > 0.12);
      lip.raf = requestAnimationFrame(tick);
    };
    lip.raf = requestAnimationFrame(tick);
  }
  async function speak(t) {
    if (!S || !S.voice.on || !t.trim()) return;
    try {
      const r = await call("showSpeak", t);
      if (!r) return;
      if (r.skip) { if (!speak.told) { toast(r.skip); speak.told = true; } return; }
      if (player) player.pause();
      player = new Audio(r.url);
      player.onplay = () => lip(r.levels || [], r.ms || 0);
      player.play().catch(() => {});
    } catch (e) { toast("说不出来：" + msgOf(e)); }
  }

  // ---------- 对话 ----------
  const log = () => $("#shLog");
  const scroll = () => { const l = log(); l.scrollTop = l.scrollHeight; };
  function add(cls, html) { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; log().appendChild(d); scroll(); return d; }
  function botText(t) {
    if (!bot) { bot = add("msg bot", '<span class="t"></span><span class="cursor"></span>'); bot._t = ""; }
    bot._t += t;
    bot.querySelector(".t").textContent = bot._t.replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, "").replace(/<\/?tool_call>?$/, "").trim();
    scroll();
  }
  function endBot() {
    if (!bot) return;
    const el = bot.querySelector(".t"), tx = el.textContent;
    if (tx.trim()) said = tx;
    const c = bot.querySelector(".cursor"); if (c) c.remove();
    if (!tx.trim()) bot.remove(); else if (window.MathJax && MathJax.typesetPromise && /\$|\\\(|\\\[/.test(tx)) MathJax.typesetPromise([el]).catch(() => {});
    bot = null;
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
  window.cc.on("show", (e) => {
    if (e.type === "exam") { endBot(); said = ""; add("msg me", esc(`第 ${e.no} / ${e.total} 题：${e.q}`)); return; }
    if (e.type === "delta") return botText(e.text);
    if (e.type === "tool") {
      endBot();
      const key = e.name + JSON.stringify(e.args);
      if (e.stage === "start") { steps.set(key, add("step run", esc("正在" + e.say + "…"))); if (av) try { av.mood("think", 1.5); } catch (x) {} return; }
      const el = steps.get(key) || add("step", ""); steps.delete(key);
      el.className = "step " + (e.ok ? "ok" : "bad"); el.textContent = doneLine(e);
      if (e.changed) refresh();
      if (e.ok && e.changed && deck && PPT_TOOL.test(e.name)) { const r = e.result || {}; deck.refresh(e.name === "make_ppt" ? 1 : r.no || r.to || (r.pages && r.pages[0]) || (e.args && e.args.slide) || null).then(() => showDeck(true)); }
      return;
    }
    if (e.type === "done") { endBot(); const t = said; said = ""; speak(t); if (e.note) add("msg bot", esc(e.note)); if (e.stopped) add("step", "停下了"); return; }
    if (e.type === "error") { endBot(); said = ""; add("msg bot err", esc(e.message)); }
  });
  window.cc.on("agent", (e) => { if (shown && (e.type === "state" || e.type === "download")) { if (e.type === "state" && S) { S.llm = e.state; paint(); } if (e.type === "download") $("#shModel").textContent = e.checking ? "校验…" : `下载 ${e.name}：${Math.round(((e.got || 0) / (e.total || 1)) * 100)}%`; } });
  async function send(text) {
    text = (text != null ? text : $("#shText").value).trim();
    if (!text || busy) return;
    $("#shText").value = "";
    const h = $(".sh-hello"); if (h) h.remove();
    add("msg me", esc(text));
    busy = true; $("#shSend").hidden = true; $("#shStop").hidden = false;
    try { S = await call("showSend", text, []); paint(); }
    catch (e) { endBot(); if (!/还没说完/.test(msgOf(e))) add("msg bot err", esc(msgOf(e))); }
    finally { busy = false; $("#shSend").hidden = false; $("#shStop").hidden = true; endBot(); }
  }
  $("#shSend").onclick = () => send();
  $("#shStop").onclick = guard(() => call("showStop"));
  $("#shText").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  $("#shLog").addEventListener("click", (e) => { const b = e.target.closest(".ex"); if (b) send(b.textContent); });
  const clear = () => { log().innerHTML = ""; bot = null; said = ""; steps.clear(); };
  $("#shNew").onclick = guard(async () => { await call("showReset"); clear(); hello(); });
  $("#shRole").onchange = guard(async () => { S = await call("showRole", $("#shRole").value); clear(); paint(); hello(); });
  $("#shSpeak").onchange = guard(async () => { S.voice = await call("setShowSpeak", $("#shSpeak").checked); paint(); if (S.voice.on && !S.voice.who) toast(S.voice.label); else if (S.voice.on && !S.voice.gsv) toast("要先在「我的声音」里装好 GPT-SoVITS，才能开口说话"); });
  $("#shDl").onclick = guard(async () => { $("#shDl").disabled = true; try { await call("aiDownload"); await call("aiStart"); } finally { $("#shDl").disabled = false; refresh(); } });
  $("#shGo").onclick = guard(async () => { $("#shGo").disabled = true; try { await call("aiStart"); } finally { $("#shGo").disabled = false; refresh(); } });
  $("#shCheck").onclick = guard(async () => { const b = $("#shCheck"); b.disabled = true; b.textContent = "正在看…"; try { const n = S ? S.product.build : 0; S = await call("showCheck"); paint(); toast(S.product.build > n ? `有新版：成品现在是第 ${S.product.build} 版` : "没有新版：现在用的就是最新的"); } finally { b.disabled = false; b.textContent = "看有没有新版"; } });
  $("#shPptOpen").onclick = guard(() => call("showOpenPpt", false));
  $("#shPptShow").onclick = guard(async () => { if (!deckOn) { await deck.refresh(); showDeck(true); } else showDeck(false); });
  $("#shPptPick").onclick = guard(async () => { const r = await call("showPickPpt"); if (!r) return; S = r; paint(); await deck.refresh(); showDeck(true); add("step ok", esc(`打开了「${S.ppt.title}」（${S.ppt.pages} 页）：说要怎么改吧，比如「第 2 页的要点改成卡片」「整份换成绿色」。原来的文件不会动`)); });
  $("#shPptDir").onclick = guard(() => call("showOpenPpt", true));
  // 考一考：8 道题真的做一遍，程序核对
  const examLine = (x) => (x ? `上次考试：${x.total} 题对了 ${x.score} 题（${when(x.at)}${x.qa ? "，答题大脑第 " + x.qa + " 版" : ""}）` : "");
  $("#shPptExam").onclick = guard(async () => {
    if (busy) return toast("它正在回答，等它说完再考", true);
    if (!confirm("考一考它做 PPT、改 PPT 的本事？\n一共 8 道题，真的做一份、再照着改，要几分钟；做完由程序核对。现在的对话会清空。")) return;
    const b = $("#shPptExam"); b.disabled = true; b.textContent = "正在考…"; busy = true; clear(); add("step ok", "✦ PPT 考试开始：8 道题，做完程序自己核对");
    try {
      const r = await call("showPptExam"); S = r.state; paint(); const x = r.exam;
      add("msg bot", esc(`考完了：${x.total} 题对了 ${x.score} 题，用了 ${Math.round(x.secs / 60 * 10) / 10} 分钟。\n` + x.items.map((i, k) => `${i.ok ? "✓" : "✕"} ${k + 1}. ${i.what}${i.ok ? "" : "：" + i.why}`).join("\n") + (x.score < x.total ? "\n没过的题说明这版模型这一样还不稳：换一种说法再让它做，或者等训练出新版再考。" : "")));
      if (deck) { await deck.refresh(1); showDeck(true); }
    } finally { busy = false; b.disabled = false; b.textContent = "考一考它"; $("#shSend").hidden = false; $("#shStop").hidden = true; }
  });
  $("#shCampusReset").onclick = guard(async () => { if (!confirm("把模拟教务系统恢复成刚造出来的样子？提交过的申请都会清掉。")) return; S = await call("showCampusReset"); clear(); paint(); hello(); toast("恢复好了"); });
  $("#shReqs").addEventListener("click", guard(async (e) => { const b = e.target.closest("[data-ap]"); if (!b) return; S = await call("showApprove", b.dataset.ap, true); paint(); toast("批了一步"); }));

  // 进到这一页才画、才定时看新版；离开就停
  window.addEventListener("lao-show", (e) => {
    shown = !!e.detail;
    clearInterval(timer);
    if (av) try { av.setManual(!shown); } catch (x) {}
    if (!shown) return;
    stage(); refresh();
    timer = setInterval(() => { if (!busy) refresh(); }, 60000);
  });
  window.__laoShow = { send, state: () => S };   // 测试用
})();
