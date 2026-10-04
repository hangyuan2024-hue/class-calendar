// AI 助手：在这台电脑上运行的小模型，知道你的课程表和作业；第一次用时下载模型
"use strict";
const SUGGEST = ["明天几点上课？在哪？", "这周要交哪些作业？", "今天还有什么没做完？", "帮我排一下今晚的学习计划", "下周有什么活动或会议？", "用简单的话解释一下什么是傅里叶变换"];
App.views.ai = {
  title: "AI 助手", icon: "ai", msgs: [], busy: null,
  mount(el) {
    el.innerHTML = `
      <div class="vhead"><div><h1>AI 助手「捞捞」</h1><div class="sub" id="aiSub">在你电脑上运行，不联网也能用，聊天内容不会上传</div></div><span class="grow"></span>
        <button class="btn" id="aiClear" title="清空对话，重新开始">${icon("plus")}新对话</button></div>
      <div class="ai-body">
        <div class="ai-setup hidden" id="aiSetup"></div>
        <div class="ai-chat" id="aiChat"></div>
        <form class="ai-input" id="aiForm"><textarea id="aiIn" rows="1" placeholder="问点什么…　Enter 发送，Shift+Enter 换行" spellcheck="false"></textarea><button class="btn primary iconbtn big" id="aiSend" title="发送">${icon("send")}</button></form>
      </div>`;
    const inp = $("#aiIn", el), form = $("#aiForm", el);
    const fit = () => { inp.style.height = "auto"; inp.style.height = Math.min(180, inp.scrollHeight) + "px"; };
    inp.oninput = fit;
    inp.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } };
    form.onsubmit = (e) => { e.preventDefault(); if (this.busy) return this.stop(); const t = inp.value.trim(); if (!t) return; inp.value = ""; fit(); this.ask(t); };
    $("#aiClear", el).onclick = () => { if (this.busy) this.stop(); this.msgs = []; this.chat(); inp.focus(); };
    $("#aiChat", el).onclick = (e) => { const s = e.target.closest("[data-q]"); if (s) this.ask(s.dataset.q); const c = e.target.closest("[data-copy]"); if (c) { const m = this.msgs[+c.dataset.copy]; if (m) navigator.clipboard.writeText(m.content).then(() => toast("已复制")); } };
    $("#aiSetup", el).onclick = (e) => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      if (b.dataset.a === "go") call("ai:prepare").then((a) => this.aiState(a));
      if (b.dataset.a === "cancel") call("ai:cancel");
    };
  },
  show() { const a = App.S.ai || {}; if (a.ready) setTimeout(() => $("#aiIn", this.el).focus(), 30); },
  update() { this.aiState(App.S.ai || {}); },
  aiState(a) {
    const el = this.el; if (!el) return;
    a = a || {};
    const box = $("#aiSetup", el), ready = !!a.ready;
    box.classList.toggle("hidden", ready);
    $("#aiForm", el).classList.toggle("off", !ready);
    $("#aiIn", el).disabled = !ready;
    $("#aiSub", el).textContent = ready ? `${a.model || "本地模型"} · 在你电脑上运行，不联网也能用，聊天内容不会上传` : "在你电脑上运行，不联网也能用，聊天内容不会上传";
    if (!ready) {
      const mb = (n) => (n / 1048576).toFixed(0);
      if (a.status === "downloading") {
        const pct = a.total ? Math.floor((a.got / a.total) * 100) : 0;
        box.innerHTML = `<div class="card ai-card"><b class="ai-big">⬇️</b><h3>正在下载 AI 模型</h3><p class="muted">只用下载这一次，可以先去做别的，下好了会自动启动</p>
          <div class="pbar"><i style="width:${pct}%"></i></div><div class="row" style="justify-content:space-between;font-size:12px"><span class="mono">${mb(a.got || 0)} / ${a.total ? mb(a.total) : "?"} MB</span><span class="mono">${pct}%</span></div>
          <button class="btn" data-a="cancel" style="margin-top:8px">暂停下载</button><p class="muted" style="font-size:12px">暂停后再点开始，会接着下载，不用重来</p></div>`;
      } else if (a.status === "starting") {
        box.innerHTML = `<div class="card ai-card"><div class="spin"></div><h3>正在启动 AI…</h3><p class="muted">第一次启动要十几秒</p></div>`;
      } else {
        box.innerHTML = `<div class="card ai-card"><b class="ai-big">✨</b><h3>${a.status === "error" ? "AI 没能启动" : "装上离线 AI 助手"}</h3>
          ${a.status === "error" ? `<p class="err">${esc(a.error || "出错了")}</p>` : `<p class="muted">它知道你的课程表和作业，可以问「明天几点上课」「这周要交什么」，<br>也能帮你解释知识点、排学习计划。</p>`}
          <ul class="ai-facts"><li>📦 第一次需要下载模型，约 <b>1 GB</b>（国内服务器，一般几分钟）</li><li>💻 在你电脑上运行，<b>不联网也能用</b>，聊天内容不会上传</li><li>🧠 模型：${esc(a.model || "通义千问 Qwen2.5 1.5B")}，普通笔记本就能跑</li></ul>
          <button class="btn primary big" data-a="go">${a.status === "error" ? "重试" : a.got ? "继续下载" : "下载并启动"}</button></div>`;
      }
    }
    if (!this._chatDrawn) { this._chatDrawn = true; this.chat(); }
    $("#aiChat", el).classList.toggle("hidden", !ready && !this.msgs.length);
  },
  chat() {
    const box = $("#aiChat", this.el);
    if (!this.msgs.length) {
      const me = (App.S.me || {}).display_name || "";
      box.innerHTML = `<div class="ai-hello"><div class="ai-face">捞</div><h2>${me ? esc(me) + "，" : ""}有什么想问的？</h2><p class="muted">我能看到你的课程表、作业和待办（只在这台电脑上）</p><div class="ai-sugs">${SUGGEST.map((s) => `<button class="ai-sug" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div></div>`;
      return;
    }
    box.innerHTML = this.msgs.map((m, i) => this.bubble(m, i)).join("");
    box.scrollTop = box.scrollHeight;
  },
  bubble(m, i) {
    if (m.role === "user") return `<div class="msg me"><div class="bub selectable">${esc(m.content)}</div></div>`;
    return `<div class="msg bot" data-i="${i}"><div class="ai-face sm">捞</div><div class="bub selectable${m.pending ? " typing" : ""}${m.err ? " err" : ""}">${m.content ? miniMd(m.content) : m.pending ? "<span class='dots'><i></i><i></i><i></i></span>" : ""}${m.stopped ? '<small class="muted">（已停止）</small>' : ""}</div>${!m.pending && m.content ? `<button class="btn ghost sm cp" data-copy="${i}">复制</button>` : ""}</div>`;
  },
  async ask(text) {
    if (this.busy || !(App.S.ai || {}).ready) return;
    this.msgs.push({ role: "user", content: text });
    const id = "q" + Date.now(), bot = { role: "assistant", content: "", pending: true, id };
    const history = this.msgs.filter((m) => !m.err && m.content).map((m) => ({ role: m.role, content: m.content }));
    this.msgs.push(bot); this.busy = id; this.chat(); this.sendBtn();
    try { const full = await window.cc.call("ai:chat", id, history); bot.content = full || bot.content || "（没有回答）"; }
    catch (e) { bot.content = "出错了：" + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""); bot.err = true; }
    bot.pending = false; this.busy = null; this.chat(); this.sendBtn();
    $("#aiIn", this.el).focus();
  },
  stop() { if (!this.busy) return; const m = this.msgs.find((x) => x.id === this.busy); if (m) m.stopped = true; call("ai:stop", this.busy); },
  token(t) {
    const m = this.msgs.find((x) => x.id === t.id); if (!m) return;
    m.content = t.text;
    const i = this.msgs.indexOf(m), node = $(`.msg.bot[data-i="${i}"]`, this.el);
    if (node) { node.outerHTML = this.bubble(m, i); const box = $("#aiChat", this.el); if (box.scrollHeight - box.scrollTop - box.clientHeight < 140) box.scrollTop = box.scrollHeight; }
  },
  sendBtn() { const b = $("#aiSend", this.el); b.innerHTML = icon(this.busy ? "stop" : "send"); b.title = this.busy ? "停止" : "发送"; b.classList.toggle("danger", !!this.busy); },
};
