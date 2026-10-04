// 整理群消息：把班级群里复制来的消息粘贴进来，先在本机用规则整理（不花 token），拿不准的交给
// 电脑里自带的 AI（不联网）或云端 AI。班委、老师可以直接发布到班级；同学整理进自己的「我的事项」。
// 改过的地方会被记住（和网页版、同班班委共享），下次同样的说法直接整理对。
"use strict";
const slim = (x) => ({ msg_type: x.msg_type, subject: x.subject || "", location: x.location || "", event_time: x.event_time || "" });
App.views.ingest = {
  title: "整理群消息", icon: "ingest", parsed: null, model: null, modelFor: "", remoteOk: null, showLearn: false,
  personal() { const c = App.cls(); return !(c && (c.is_teacher || c.can_ingest)); },
  allowed() { const c = App.cls(); if (!c) return false; return this.personal() ? App.feat("ingest_local") : App.feat("ingest_local") || App.feat("ingest_cloud"); },
  navOn() { return !!App.S.cid; },
  mount(el) {
    el.innerHTML = `
      <div class="vhead"><div><h1>整理群消息</h1><div class="sub" id="igSub"></div></div><span class="grow"></span>
        <label class="field ig-date">消息是哪天发的<input type="date" id="igPub" class="input"></label></div>
      <div class="vbody ig-body">
        <div class="card ig-in">
          <textarea id="igText" class="input" rows="9" placeholder="把班级群里的消息复制过来，粘贴到这里（Ctrl+V）。可以一次粘贴很多条，闲聊会自动去掉。&#10;&#10;小技巧：在微信、QQ 里复制了作业通知，右下角会弹出提示，点一下就到这里了。"></textarea>
          <div class="row ig-act"><button class="btn" id="igPaste">${icon("clip")}粘贴剪贴板</button><button class="btn ghost" id="igClear">清空</button><span class="grow"></span>
            <span class="ig-st" id="igSt"></span>
            <button class="btn" id="igCloud">☁ 直接交给云端 AI</button><button class="btn primary" id="igGo">✨ 整理（本机规则，不花 token）</button></div>
        </div>
        <div id="igLearn"></div>
        <div id="igRes"></div>
      </div>`;
    const ta = $("#igText", el);
    $("#igPub", el).value = todayKey();
    $("#igPaste", el).onclick = async () => { const t = await call("clip:read"); if (!t) return toast("剪贴板里没有文字"); ta.value = (ta.value ? ta.value + "\n" : "") + t; this.st(""); };
    $("#igClear", el).onclick = () => { ta.value = ""; this.parsed = null; this.drawRes(); ta.focus(); };
    $("#igGo", el).onclick = () => this.local();
    $("#igCloud", el).onclick = () => this.cloud(ta.value.trim(), false);
    ta.onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.local(); } };
    el.addEventListener("click", (e) => this.click(e));
    el.addEventListener("input", (e) => this.edit(e));
    el.addEventListener("change", (e) => this.edit(e));
  },
  show(arg) {
    const ta = $("#igText", this.el);
    if (arg && arg.text) { ta.value = arg.text; this.local(); }
    else if (arg && arg.paste) $("#igPaste", this.el).click();
    setTimeout(() => ta.focus(), 50);
    this.ensureModel().catch(() => {});
  },
  st(t, bad) { const s = $("#igSt", this.el); s.textContent = t; s.className = "ig-st" + (bad ? " bad" : ""); },
  pub() { return $("#igPub", this.el).value || todayKey(); },
  update() {
    const el = this.el, p = this.personal(), cloudOk = !p && App.feat("ingest_cloud");
    $("#igSub", el).textContent = !App.S.cid ? "加入班级后才能用" : p ? "整理到你自己的「我的事项」，只有你自己看得到，不花 token" : `整理好后发布到「${App.className()}」，全班都能看到`;
    $("#igCloud", el).classList.toggle("hidden", !cloudOk);
    if (this.modelFor && this.modelFor !== App.S.cid) { this.model = null; this.modelFor = ""; }
    this.drawLearn(); this.drawRes();
  },
  // ---------- 学习：本班以前的事项 + 班委的修改 ----------
  async ensureModel(rebuild) {
    const cid = App.S.cid; if (!cid) return null;
    if (this.model && this.modelFor === cid && !rebuild) return this.model;
    const m = LaoParse.createModel(), msgText = (o) => { const x = LaoParse.splitMessages(o || "")[0]; return x ? x.text : String(o || ""); };
    for (const r of (App.S.items || []).filter((r) => r.original && !/^（由/.test(r.original)).slice(-400)) m.learnExample(msgText(r.original), r.msg_type, "history");
    let rows = [];
    try { rows = (await api("parse_feedback_list", { cid }, true)) || []; this.remoteOk = true; } catch (e) { this.remoteOk = false; }
    const forgets = [];
    for (const r of rows) {
      if (r.source === "forget") { forgets.push(...(r.items || [])); continue; }
      try { m.learn({ text: r.text, pub: r.pub, before: LaoParse.parse(r.text, r.pub || todayKey()), items: r.items || [], chatter: !!r.chatter, source: r.source === "ai" ? "ai" : "user" }); } catch (e) {}
    }
    for (const f of forgets) m.forget(f.kind, f.key);
    if (App.S.cid === cid) { this.model = m; this.modelFor = cid; }
    this.drawLearn();
    return m;
  },
  async learn(rows) {
    if (!rows.length || !App.S.cid) return;
    if (this.model) for (const r of rows) {
      if (r.source === "forget") { for (const f of r.items) this.model.forget(f.kind, f.key); continue; }
      this.model.learn({ text: r.text, pub: r.pub, before: LaoParse.parse(r.text, r.pub), items: r.items, chatter: r.chatter, source: r.source });
    }
    this.drawLearn();
    if (this.personal()) return;   // 学生的修改只在自己电脑上生效
    try { await api("parse_feedback_add", { cid: App.S.cid, rows }, true); this.remoteOk = true; } catch (e) { this.remoteOk = false; }
  },
  drawLearn() {
    const el = $("#igLearn", this.el); if (!el) return;
    if (!this.model) { el.innerHTML = ""; return; }
    const s = this.model.stats(), d = this.model.dump(), c = App.cls(), canClear = c && (c.is_teacher || App.isAdmin());
    el.innerHTML = `<div class="card ig-learn"><div class="row"><span>🧠 捞捞从本班学到：<b>${s.fixes}</b> 次纠正 · <b>${s.places}</b> 个地名 · <b>${s.aliases}</b> 个课程叫法 · <b>${s.periods}</b> 个上课时间 · 参考历史事项 ${s.history} 条</span><span class="grow"></span><button class="btn ghost sm" data-learn>${this.showLearn ? "收起" : "查看"}</button></div>
      ${this.remoteOk === false ? `<div class="muted">学习记录暂时只在这台电脑上生效。</div>` : ""}
      ${this.showLearn ? `<div class="ig-ld"><p class="muted">在下面的整理结果里改类型、地点、科目、时间，点「不是事项」或「这条要记」，发布时捞捞都会记下来。学到的东西本班有整理权限的人共享。</p>
        ${[["places", "地名", d.places.map((p) => [p, p])], ["aliases", "课程叫法", Object.entries(d.aliases).map(([a, n]) => [a, `${a} → ${n}`])], ["periods", "上课时间", Object.entries(d.periods).map(([k, v]) => [k, `第${k}节 → ${v}`])], ["notPlaces", "不算地点的词", d.notPlaces.map((p) => [p, p])]]
          .map(([kind, name, list]) => `<div class="ig-lr"><b>${name}</b>${list.length ? list.map(([k, label]) => `<span class="chip">${esc(label)}<a data-forget="${kind}" data-key="${esc(k)}" title="忘掉这一条">✕</a></span>`).join("") : `<span class="muted">还没有</span>`}</div>`).join("")}
        ${canClear ? `<button class="btn sm danger" data-learn-clear>清空本班全部学习记录</button>` : ""}</div>` : ""}</div>`;
  },
  // ---------- 本机规则整理 ----------
  async local() {
    const text = $("#igText", this.el).value.trim();
    if (!App.S.cid) return this.st("加入班级后才能整理", true);
    if (!App.feat("ingest_local")) return this.st("本地整理已关闭：" + App.featWhy("ingest_local"), true);
    if (!text) return this.st("先粘贴群消息", true);
    let model = null; try { model = await this.ensureModel(); } catch (e) {}
    const r = LaoParse.parse(text, this.pub(), { model });
    this.parsed = { ...r, items: r.items.map((x) => ({ ...x, on: true, src: "", _shown: slim(x) })) };
    this.st(r.items.length ? "" : "没有整理出事项，看看下面拿不准的"); this.drawRes();
  },
  // ---------- 云端 AI（扣子后端，要花 token） ----------
  async cloud(text, fromUnsure) {
    if (this.personal() || !App.feat("ingest_cloud")) return this.st("云端 AI 整理已关闭：" + App.featWhy("ingest_cloud"), true);
    if (!text) return this.st("先粘贴群消息", true);
    const clean = LaoParse.splitMessages(text).filter((m, i, a) => !LaoParse.isChatter(m.text) && a.findIndex((y) => y.text.replace(/\s+/g, "") === m.text.replace(/\s+/g, "")) === i).map((m) => (m.sender ? m.sender + "：" : "") + m.text).join("\n");
    this.st("已提交，云端 AI 正在整理，大约需要半分钟到一分钟…");
    try {
      const job = await api("ingest_class_messages", { cid: App.S.cid, msg: clean || text, pub_date: this.pub() });
      const t0 = Date.now(); let st = null;
      while (Date.now() - t0 < 450000) {
        await new Promise((r) => setTimeout(r, 3000));
        st = await api("ingest_job_status", { jid: job.job_id }, true);
        if (st.status === "done") break;
        if (st.status === "failed") throw new Error(st.message || "整理失败");
        this.st(`云端 AI 正在整理，已等待 ${Math.round((Date.now() - t0) / 1000)} 秒…`);
      }
      if (!st || st.status !== "done") throw new Error("等太久了，稍后刷新看看是否已加入日历");
      await call("class:reload");
      if (fromUnsure && this.parsed) { this.parsed.unsure = []; this.drawRes(); this.ensureModel(true); }
      else if (!fromUnsure) $("#igText", this.el).value = "";
      this.st(st.added ? `云端 AI 新增 ${st.added} 条事项 ✓` : "整理完成，没有发现需要记录的事项");
    } catch (e) { this.st("云端 AI 失败：" + cleanErr(e), true); }
  },
  // ---------- 电脑里自带的 AI（不联网、不花 token） ----------
  async localAi(btn) {
    const ai = App.S.ai || {};
    if (!ai.ready) { if (await confirmBox("要先启动电脑里的 AI", "第一次用需要下载模型（约 1 GB），之后不联网也能用。现在去 AI 助手里准备吗？", "去准备")) { call("ai:prepare"); App.go("ai"); } return; }
    const pub = this.pub(), text = this.parsed.unsure.map((u) => (u.sender ? u.sender + "：" : "") + u.text).join("\n");
    btn.disabled = true; btn.textContent = "内置 AI 整理中…";
    try {
      const out = await call("ai:extract", text, pub), got = LaoParse.parseJsonItems(out, pub);
      if (!got) throw new Error("AI 没有按格式回答，再试一次或者自己填");
      const srcOf = (x) => { const o = (x.original || "").replace(/^[^：:]{1,10}[：:]/, "").trim(); const u = this.parsed.unsure.find((u) => o && (u.text.includes(o) || o.includes(u.text))); return u ? u.text : ""; };
      this.parsed.items.push(...got.map((x) => ({ ...x, on: true, src: "内置 AI", src_text: srcOf(x), _shown: slim(x) })));
      this.parsed.unsure = []; this.drawRes();
      this.st(got.length ? `内置 AI 又整理出 ${got.length} 条，确认后一起发布` : "内置 AI 认为这些消息里没有需要记录的事项");
    } catch (e) { this.st("内置 AI 失败：" + cleanErr(e), true); btn.disabled = false; btn.textContent = "🤖 交给内置 AI"; }
  },
  drawRes() {
    const box = $("#igRes", this.el), P = this.parsed; if (!box) return;
    if (!P) { box.innerHTML = ""; return; }
    const on = P.items.filter((x) => x.on).length, personal = this.personal();
    const tsel = (v) => CTYPES.map((t) => `<option${t === v ? " selected" : ""}>${t}</option>`).join("");
    box.innerHTML = `<div class="card ig-res">
      <div class="ig-sum">整理出 <b>${P.items.length}</b> 条 · 过滤闲聊 ${P.chatter.length} 条${P.dupes ? ` · 去掉重复 ${P.dupes} 条` : ""}${P.unsure.length ? ` · <b style="color:var(--warn)">拿不准 ${P.unsure.length} 条</b>` : ""}<span class="grow"></span><span class="muted">哪里不对直接改，捞捞会记住</span></div>
      ${P.items.map((x, i) => { const [d, t] = (x.event_time || "").split(" ");
        return `<div class="ig-it${x.on ? "" : " off"}" data-pi="${i}" style="--c:${tc(x.msg_type)}">
          <input type="checkbox" data-pf="on"${x.on ? " checked" : ""} title="要不要${personal ? "加" : "发布"}这条">
          <select class="input" data-pf="msg_type">${tsel(x.msg_type)}</select>
          <input class="input ig-sub" data-pf="subject" value="${esc(x.subject)}" placeholder="科目 / 标题">
          <input class="input" type="date" data-pf="date" value="${esc(d || "")}"><input class="input" type="time" data-pf="time" value="${esc(t || "")}">
          <input class="input ig-sum2" data-pf="summary" value="${esc(x.summary)}" placeholder="内容">
          <input class="input ig-loc" data-pf="location" value="${esc(x.location || "")}" placeholder="📍 地点">
          <div class="ig-m">${x.src ? `<span class="tag">${esc(x.src)}</span>` : ""}${x.via === "memory" ? `<span class="tag" style="--c:var(--ok)">🧠 按上次的修改</span>` : x.via === "learned" ? `<span class="tag" style="--c:var(--ok)">🧠 参考了本班以前的修改</span>` : ""}${x.prepare ? `<span class="muted">🎒 ${esc(x.prepare)}</span>` : ""}${x.need_confirm ? `<span class="muted" style="color:var(--warn)">⚠ 信息不完整，会提醒同学核实</span>` : ""}
            <span class="grow"></span>${x.src_text ? `<button class="btn ghost sm" data-notitem="${i}" title="这条其实是闲聊，以后别再整理出来">🚫 不是事项</button>` : ""}</div></div>`; }).join("") || `<div class="empty">没有整理出事项。</div>`}
      ${P.unsure.length ? `<div class="ig-uns"><div class="row"><b>🤔 拿不准的 ${P.unsure.length} 条</b><span class="grow"></span><button class="btn primary sm" data-ai>🤖 交给内置 AI</button>${!personal && App.feat("ingest_cloud") ? `<button class="btn sm" data-cloud>☁ 交给云端 AI</button>` : ""}<button class="btn ghost sm" data-drop>不要了</button></div>
        ${P.unsure.map((u, i) => `<div class="ig-u" title="${esc(u.text)}"><button class="btn ghost sm" data-fillu="${i}">我来填</button><em>${esc(u.why)}</em><span>${esc(u.text)}</span></div>`).join("")}</div>` : ""}
      ${P.chatter.length ? `<details class="ig-ch"><summary>被当成闲聊过滤掉的 ${P.chatter.length} 条（看看有没有漏掉的）</summary>${P.chatter.map((c, i) => `<div class="ig-u"><button class="btn ghost sm" data-keepc="${i}">这条要记</button><span>${esc(c)}</span></div>`).join("")}</details>` : ""}
      <div class="row ig-pub"><button class="btn ghost" data-cancel>取消</button><span class="grow"></span><button class="btn primary big" data-publish${on ? "" : " disabled"}>${personal ? `把选中的 ${on} 条加到我的事项` : `发布选中的 ${on} 条到班级`}</button></div></div>`;
  },
  edit(e) {
    const f = e.target.closest("[data-pf]"); if (!f || !this.parsed) return;
    const x = this.parsed.items[+f.closest("[data-pi]").dataset.pi], k = f.dataset.pf;
    if (k === "on") { if (e.type === "change") { x.on = f.checked; this.drawRes(); } return; }
    if (k === "date" || k === "time") { const row = f.closest("[data-pi]"), d = row.querySelector('[data-pf="date"]').value, t = row.querySelector('[data-pf="time"]').value; x.event_time = d ? d + (t ? " " + t : "") : ""; x.need_confirm = !d; }
    else x[k] = f.value.trim();
    if (k === "msg_type" && e.type === "change") this.drawRes();
  },
  async click(e) {
    const P = this.parsed;
    if (e.target.closest("[data-learn]")) { this.showLearn = !this.showLearn; this.drawLearn(); return; }
    const fg = e.target.closest("[data-forget]"); if (fg) { await this.learn([{ text: "（忘掉）" + fg.dataset.key, pub: this.pub(), chatter: false, source: "forget", items: [{ kind: fg.dataset.forget, key: fg.dataset.key }] }]); return; }
    if (e.target.closest("[data-learn-clear]")) { if (!(await confirmBox("清空本班全部学习记录？", "捞捞会忘掉所有学到的地名、课程叫法和纠正。", "清空", true))) return; try { await api("parse_feedback_clear", { cid: App.S.cid }); } catch (err) { return; } await this.ensureModel(true); return; }
    if (!P) return;
    const ni = e.target.closest("[data-notitem]");
    if (ni) { const x = P.items[+ni.dataset.notitem]; P.items = P.items.filter((y) => y !== x); if (!P.items.some((y) => y.src_text === x.src_text)) { P.chatter.push(x.src_text); this.learn([{ text: x.src_text, pub: x.publish_date || this.pub(), chatter: true, source: "user", items: [] }]); } this.drawRes(); return; }
    const kc = e.target.closest("[data-keepc]");
    if (kc) {
      const raw = P.chatter[+kc.dataset.keepc]; P.chatter = P.chatter.filter((c, i) => i !== +kc.dataset.keepc);
      const r = LaoParse.parse(raw, this.pub(), { model: this.model, force: true }), got = r.items.length ? r.items : r.unsure.map((u) => u.guess).filter(Boolean);
      P.items.push(...(got.length ? got : [{ msg_type: "通知", subject: raw.slice(0, 12), summary: raw.slice(0, 80), event_time: "", location: "", prepare: "", original: raw, publish_date: this.pub(), need_confirm: true }]).map((x) => ({ ...x, on: true, src: "", _forced: true, src_text: raw, _shown: slim(x) })));
      this.drawRes(); return;
    }
    const fu = e.target.closest("[data-fillu]");
    if (fu) {
      const u = P.unsure[+fu.dataset.fillu]; P.unsure = P.unsure.filter((y) => y !== u);
      const g = u.guess || LaoParse.parse(u.text, this.pub(), { model: this.model, force: true }).items[0] || { msg_type: "通知", subject: u.text.slice(0, 12), summary: u.text.slice(0, 80), event_time: "", location: "", prepare: "", original: u.text, publish_date: this.pub(), need_confirm: true };
      P.items.push({ ...g, on: true, src: "", _forced: true, src_text: u.text, _shown: slim(g) }); this.drawRes(); return;
    }
    if (e.target.closest("[data-cancel]")) { this.parsed = null; this.drawRes(); return; }
    if (e.target.closest("[data-drop]")) { P.unsure = []; this.drawRes(); return; }
    const ab = e.target.closest("[data-ai]"); if (ab) return this.localAi(ab);
    if (e.target.closest("[data-cloud]")) return this.cloud(P.unsure.map((u) => (u.sender ? u.sender + "：" : "") + u.text).join("\n"), true);
    const pb = e.target.closest("[data-publish]"); if (pb) return this.publish(pb);
  },
  // 发布时：和整理出来时比，改过的（或者手动要求记下的、AI 整理的）就学一下
  feedback() {
    const by = new Map();
    for (const x of this.parsed.items) { if (!x.on || !x.src_text) continue; if (!by.has(x.src_text)) by.set(x.src_text, []); by.get(x.src_text).push(x); }
    const rows = [];
    for (const [text, xs] of by) {
      const changed = xs.some((x) => x._forced || !x._shown || ["msg_type", "subject", "location", "event_time"].some((f) => (x[f] || "") !== (x._shown[f] || "")));
      const ai = xs.every((x) => x.src === "内置 AI");
      if (changed || ai) rows.push({ text, pub: xs[0].publish_date || this.pub(), chatter: false, source: ai && !changed ? "ai" : "user", items: xs.map(slim) });
    }
    return rows;
  },
  async publish(btn) {
    const P = this.parsed, chosen = P.items.filter((x) => x.on);
    btn.disabled = true;
    try {
      if (this.personal()) {
        for (const x of chosen) await call("mine:upsert", { subject: x.subject || x.summary.slice(0, 20), event_time: x.event_time || "", location: x.location || "", note: [x.msg_type, x.summary].filter(Boolean).join("：") });
        this.st(`已加到我的事项 ${chosen.length} 条 ✓（只有你自己看得到）`);
      } else {
        const items = chosen.map(({ on, src, _shown, _forced, src_text, via, confidence, ...x }) => x);
        const n = await api("publish_parsed_items", { cid: App.S.cid, items });
        const fb = this.feedback(); this.learn(fb);
        this.st(`已发布 ${n} 条事项 ✓${fb.length ? ` · 捞捞记住了 ${fb.length} 处修改` : ""}`);
        await call("class:reload");
      }
      const left = P.unsure.length; this.parsed = null; this.drawRes();
      if (!left) $("#igText", this.el).value = "";
    } catch (e) { btn.disabled = false; }
  },
};
