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
    student: [["讲题", ["鸡兔同笼，头 35 个、脚 94 只，各有几只？", "用通俗的话讲讲什么是冒泡排序"]], ["做 PPT", ["做一份讲「冒泡排序」的 PPT，8 页左右"]], ["办事", ["明天有什么课？", "我后天要请一天事假，回家办事", "查一下我上学期的成绩和绩点", "周四下午哪间教室空着？我们班想开班会", "帮我开一份在读证明"]]],
    teacher: [["讲题", ["出三道一元二次方程的练习题，带答案"]], ["做 PPT", ["做一份「期中复习：数组」的课件，7 页"]], ["办事", ["有没有等我审批的申请？", "我这周有哪些课？", "下周的课我要出差，想调到周六上午"]]],
    staff: [["办事", ["有哪些申请等我审批？", "明天上午第 3 节有哪些空教室？"]], ["讲题", ["请假超过 7 天要谁批？"]]],
  };
  let S = null, bot = null, busy = false, steps = new Map(), av = null, shown = false, timer = null, full = false;

  // ---------- 画 ----------
  function paint() {
    if (!S) return;
    const P = S.product, me = S.who.me;
    $("#shBuild").textContent = `成品 第 ${P.build} 版`;
    $("#shSpeak").checked = S.voice.on;
    const sel = $("#shRole");
    if (sel.options.length !== S.who.roles.length) sel.innerHTML = S.who.roles.map((r) => `<option value="${r.key}">${esc(r.name)}：${esc(r.who)}</option>`).join("");
    sel.value = S.who.role;
    $("#shMe").textContent = `现在是 ${me.role} ${me.name}${me.class ? " · " + me.class : me.dept ? " · " + me.dept : ""}`;
    $("#shVoice").textContent = "声音：" + S.voice.label;
    $("#shVoiceInstall").hidden = !(S.voice.model && !S.voice.gsv);
    $("#shChips").innerHTML = P.parts.map((p) => `<span class="sh-chip ${p.ready ? "" : "off"}">${esc(p.name)}<b>${p.ready ? "第 " + p.version + " 版" : "训练中"}</b></span>`).join("");
    $("#shParts").innerHTML = P.parts.map((p) => `<div class="sh-part ${p.ready ? "" : "off"}"><b>${esc(p.name)}</b><span class="v">${p.ready ? `第 ${p.version} 版` : "还没训练好"}${p.pending ? ` <span class="new">→ 第 ${p.pending} 版已下好</span>` : ""}</span><small>${esc(p.what)}${p.metric != null ? ` · ${esc(p.metricName)} ${pct(p.metric)}${p.base != null ? `（没训练前 ${pct(p.base)}）` : ""}` : ""}</small></div>`).join("");
    $("#shHist").innerHTML = P.log.length ? P.log.map((l) => `<div><i>${when(l.at)}</i>${esc(l.name)} ${l.from ? `第 ${l.from} 版 → ` : ""}第 ${l.to} 版${l.metric != null ? `，${pct(l.metric)}` : ""}</div>`).join("") : `<div>还没有发布过的模型：训练、考试通过一版，这里自动记一笔、自动换上</div>`;
    $("#shPptBtns").hidden = !S.ppt; $("#shPptName").textContent = (S.ppt ? `${S.ppt.title}（${S.ppt.pages} 页）` : "还没有 PPT：让它做一份，或者打开一份让它改") + (S.exam ? "\n" + examLine(S.exam) : "");
    if (S.ppt && deck && (!deck.data() || deck.data().rev !== S.ppt.rev)) deck.refresh();
    const cs = S.campus;
    $("#shCampus").textContent = `捞捞学院（演示，数据都是编的）：${cs.student} 个学生、${cs.teacher} 位教师、${cs.section} 个教学班、${cs.room} 间教室`;
    const row = (r, mine) => `<div class="sh-req"><div class="top"><b>${esc(r.kind)}</b><span class="st ${/^已(批准|通过|出具)/.test(r.status) ? "ok" : /驳回|撤销/.test(r.status) ? "bad" : "wait"}">${esc(r.status)}</span><code>${esc(r.id)}</code><span class="grow"></span>${/^待/.test(r.status) ? `<button class="btn small" data-ap="${esc(r.id)}">${mine ? "模拟审批" : "同意"}</button>` : ""}</div><div class="sum">${esc(r.summary)}</div></div>`;
    $("#shReqs").innerHTML = (S.pending.length ? `<div class="muted small">等我审批的</div>` + S.pending.map((r) => row(r, false)).join("") : "") + (S.requests.length ? `<div class="muted small">我提交的</div>` + S.requests.map((r) => row(r, true)).join("") : "") || `<div class="muted small">还没有申请：让捞小智帮你请个假、借个教室试试</div>`;
    // 这台电脑正在算任务：显卡腾不出来
    $("#shBusy").hidden = !S.task; if (S.task) $("#shBusyTip").textContent = `这台电脑正在算「${S.task}」，显卡腾不出来同时展示。暂停以后，手上的任务会交给别的电脑从存档接着算；看完再点「接着算」。`;
    $("#shPaused").hidden = !(S.paused && !S.task);
    $("#shTicker").innerHTML = `<span><b>成品 第 ${P.build} 版</b></span>` + P.parts.map((p) => `<span>${esc(p.name)} <b>${p.ready ? "第 " + p.version + " 版" : "训练中"}</b>${p.metric != null ? " " + esc(p.metricName) + " " + pct(p.metric) : ""}</span>`).join("") + `<span class="live">● 自动融合：训练出新版就自动换上</span>` + `<span>${S.task ? "这台电脑：正在算「" + esc(S.task) + "」" : S.paused ? "这台电脑：计算先停着" : "这台电脑：空着，可以展示"}</span>`;
  }
  function hello() {
    const l = $("#shLog"); if (l.children.length || !S) return;
    const d = document.createElement("div"); d.className = "sh-hello";
    d.innerHTML = `<b>你好，我是捞小智。</b><span>讲题、做 PPT、办教务的事都可以找我，比如：</span>` + (EX[S.who.role] || EX.student).map(([g, xs]) => `<div class="grp"><span>${g}</span>${xs.map((x) => `<button class="ex">${esc(x)}</button>`).join("")}</div>`).join("");
    l.appendChild(d);
  }
  const refresh = guard(async () => { S = await call("showState"); paint(); hello(); });

  // ---------- PPT 预览：做好 / 改好的每一页直接画出来；有 PPT 的时候它占大块，公仔缩到左下角 ----------
  let deckOn = false;
  const showDeck = (v) => { deckOn = !!v && deck && deck.has(); $("#shDeck").hidden = !deckOn; document.querySelector(".sh-stagebox").classList.toggle("deck", deckOn); document.querySelector(".sh-grid").classList.toggle("deck", deckOn); $("#shPptShow").textContent = deckOn ? "看形象" : "看 PPT"; setTimeout(() => window.dispatchEvent(new Event("resize")), 60); };
  const deck = window.LaoDeckView ? window.LaoDeckView.create($("#shDeck"), {
    load: (rev) => call("showSlides", rev), theme: (k) => call("showPptTheme", k), undo: async () => { const r = await call("showPptUndo"); toast("撤销了：" + r.undone); },
    open: () => call("showOpenPpt", false), reveal: () => call("showOpenPpt", true), onError: (e) => toast(msgOf(e), true),
    onChange: (has, fresh) => { if (!has) showDeck(false); else if (fresh || deckOn) showDeck(true); },
  }) : null;
  const PPT_TOOL = /^(make_ppt|set_text|replace_text|add_slide|edit_slide|delete_slide|move_slide|copy_slide|set_theme|set_font_size|format_text|insert_formula|insert_table|insert_image|delete_shape|set_notes|undo)$/;

  // ---------- 形象 ----------
  function stage() {
    const host = $("#shStage");
    if (av) return;
    try { if (window.LaoZhi && window.THREE) av = window.LaoZhi.create(host); } catch (e) { av = null; }
    if (!av && !host.querySelector(".sh-fallback")) host.innerHTML = `<div class="sh-fallback">捞</div>`;
    if (av) setTimeout(() => { try { av.mood("wave", 2); } catch (e) {} }, 300);
  }

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
  function sayOne(sentence) {
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
        a.onplay = () => { $("#shSub").textContent = r.text; lip(r.levels || [], r.ms || 0, a); };
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
  function add(cls, html) { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; log().appendChild(d); scroll(); return d; }
  const fused = new Set();   // 已经在对话里提过的「××第 N 版换上了」，不重复提
  let said = "";   // 这一轮到现在为止说的话（几段回复接起来，给合成用）
  function botText(t) {
    if (!bot) { bot = add("sh-msg bot", '<span class="t"></span><span class="cursor"></span>'); bot._t = ""; }
    bot._t += t;
    bot.querySelector(".t").textContent = bot._t.replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, "").replace(/<\/?tool_call>?$/, "").trim();
    spFeed(said + bot._t, false);
    scroll();
  }
  function endBot() {
    if (!bot) return;
    said += bot._t + "\n";
    const c = bot.querySelector(".cursor"); if (c) c.remove();
    if (!bot.querySelector(".t").textContent.trim()) bot.remove();
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
    if (e.type === "exam") { endBot(); said = ""; add("sh-msg me", esc(`第 ${e.no} / ${e.total} 题：${e.q}`)); return; }
    if (e.type === "note") { if (shown) { const k = "note"; const el = steps.get(k) || add("sh-step run", ""); steps.set(k, el); el.textContent = e.text; scroll(); } return; }
    if (e.type === "delta") { const n = steps.get("note"); if (n) { n.remove(); steps.delete("note"); } return botText(e.text); }
    if (e.type === "tool") {
      endBot();
      const key = e.name + JSON.stringify(e.args);
      if (e.stage === "start") { steps.set(key, add("sh-step run", esc("正在" + e.say + "…"))); if (av) try { av.mood("think", 1.5); } catch (x) {} return; }
      const el = steps.get(key) || add("sh-step", ""); steps.delete(key);
      el.className = "sh-step " + (e.ok ? "ok" : "bad"); el.textContent = doneLine(e);
      if (e.changed) refresh();
      // 改了 PPT：预览马上跟着变，跳到改的那一页
      if (e.ok && e.name === "make_ppt") add("sh-hello", `<span>做好了，左边能看到每一页。接着说怎么改就行，比如：</span><div class="grp">${["把第 3 页改成两栏对比", "整份换成绿色的", "字再大一点", "最后加一页练习题", "给每一页写上讲稿", "检查一遍有没有问题"].map((x) => `<button class="ex">${esc(x)}</button>`).join("")}</div>`);
      if (e.ok && e.changed && deck && PPT_TOOL.test(e.name)) { const r = e.result || {}; deck.refresh(e.name === "make_ppt" ? 1 : r.no || r.to || (r.pages && r.pages[0]) || (e.args && e.args.slide) || null).then(() => showDeck(true)); }
      return;
    }
    if (e.type === "done") { endBot(); said = ""; if (e.note) add("sh-msg bot", esc(e.note)); if (e.stopped) add("sh-step", "停下了"); return; }
    if (e.type === "error") { endBot(); said = ""; add("sh-msg bot err", esc(e.message)); }
  });
  async function send(text) {
    text = (text != null ? text : $("#shText").value).trim();
    if (!text || busy) return;
    $("#shText").value = "";
    const h = document.querySelector(".sh-hello"); if (h) h.remove();
    spReset(); said = "";
    add("sh-msg me", esc(text));
    busy = true; $("#shSend").hidden = true; $("#shStop").hidden = false;
    try { S = await call("showSend", text); paint(); }
    catch (e) { endBot(); const m = msgOf(e); if (!/还没说完/.test(m)) add("sh-msg bot err", esc(m)); if (/暂停计算/.test(m)) refresh(); }
    // 这一句的收尾（把最后一段送去合成）等「done」事件来做：回话的最后几个字可能比这里晚到
    finally { busy = false; $("#shSend").hidden = false; $("#shStop").hidden = true; const n = steps.get("note"); if (n) { n.remove(); steps.delete("note"); } }
  }
  const clear = () => { log().innerHTML = ""; bot = null; said = ""; steps.clear(); spReset(); };
  $("#shSend").onclick = () => send();
  $("#shStop").onclick = guard(async () => { spReset(); await call("showStop"); });
  $("#shText").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  $("#shLog").addEventListener("click", (e) => { const b = e.target.closest(".ex"); if (b) send(b.textContent); });
  $("#shNew").onclick = guard(async () => { await call("showReset"); clear(); hello(); });
  $("#shRole").onchange = guard(async () => { S = await call("showRole", $("#shRole").value); clear(); paint(); hello(); });
  $("#shSpeak").onchange = guard(async () => { S.voice = await call("setShowSpeak", $("#shSpeak").checked); if (!S.voice.on) spReset(); paint(); if (S.voice.on && !S.voice.model) toast(S.voice.label); });
  $("#shVoiceInstall").onclick = guard(async () => { const b = $("#shVoiceInstall"); b.disabled = true; b.textContent = "正在装（几个 G，可以先接着用）…"; try { S = await call("showInstallVoice"); paint(); toast("声音组件装好了"); } finally { b.disabled = false; b.textContent = "装上声音组件"; } });
  $("#shCheck").onclick = guard(async () => { const b = $("#shCheck"); b.disabled = true; b.textContent = "正在看…"; try { const n = S ? S.product.build : 0; S = await call("showCheck"); paint(); toast(S.product.build > n ? `有新版：成品现在是第 ${S.product.build} 版` : "没有新版：现在用的就是最新的"); } finally { b.disabled = false; b.textContent = "看有没有新版"; } });
  $("#shPptOpen").onclick = guard(() => call("showOpenPpt", false));
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
  const ST = { listen: "在听…", speech: "在听你说…", hear: "听写中…", think: "在想…", talk: "在说（你一开口就能打断）" };
  function callSt(st) { cl.st = st; const b = $("#shCallBar"); b.dataset.st = st; $("#shCallSt").textContent = ST[st] || ""; }
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
    $("#shCallBar").hidden = false; $("#shCall").classList.add("on"); $("#shCall").textContent = "📞 挂断";
    const h = document.querySelector(".sh-hello"); if (h) h.remove();
    callSt("listen");
    try {
      S = await call("showCall", true);
      if (!S.voice.on) S.voice = await call("setShowSpeak", true);
      paint();
      const c = S.call || {};
      $("#shCallTip").textContent = (c.lora ? `口语对话第 ${c.lora} 版` : "口语对话大脑还在训练，先用答题大脑") + (S.voice.model ? "" : " · 捞捞的声音还没训练好，回答只出字");
    } catch (e) { toast(msgOf(e), true); }
    add("sh-step fuse", "✦ 电话接通了：直接说就行，说完停一下它就回答；它说话的时候你一开口就能打断");
  }
  async function callOff() {
    if (!cl.on) return;
    cl.on = false; cl.buf = null; cl.seq++;
    try { cl.node.disconnect(); cl.src.disconnect(); } catch (e) {}
    try { cl.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { await cl.ctx.close(); } catch (e) {}
    $("#shCallBar").hidden = true; $("#shCall").classList.remove("on"); $("#shCall").textContent = "📞 打电话"; cl.st = "off";
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
