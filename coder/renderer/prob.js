// 捞捞编程 · 题目栏：在软件里做力扣 / Codeforces 的题
// 打开一个「刷题」文件夹里的代码文件 → 左边换成题目（题面、样例），下面「运行样例」「提交」，结果也在这里。
"use strict";
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const I = window.ICON;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let LC = null, P = null, file = "", view = "desc", busy = false, acct = null, lastRes = null, judgeState = "";

  // ---------- 题面 HTML 只留安全的标签 ----------
  const OK_TAGS = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "CODE", "PRE", "UL", "OL", "LI", "SUP", "SUB", "SPAN", "DIV", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "H1", "H2", "H3", "H4", "BLOCKQUOTE", "HR", "IMG", "FONT", "CENTER", "A", "SMALL", "DL", "DT", "DD"]);
  function clean(html) {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    const walk = (n) => {
      for (const c of [...n.childNodes]) {
        if (c.nodeType === 8) { c.remove(); continue; }
        if (c.nodeType !== 1) continue;
        if (!OK_TAGS.has(c.tagName)) { if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|FORM|INPUT|BUTTON|TEXTAREA|SELECT|LINK|META)$/.test(c.tagName)) { c.remove(); continue; } c.replaceWith(...c.childNodes); walk(n); return; }
        const keepCls = c.getAttribute("class");
        for (const a of [...c.attributes]) c.removeAttribute(a.name);
        if (keepCls && /example|tex|title|section/.test(keepCls)) c.setAttribute("class", keepCls.split(/\s+/).filter((x) => /^[\w-]+$/.test(x)).join(" "));
        // 网上的图片在软件里加载不了（安全策略）：换成一行字
        if (c.tagName === "IMG") { const s = document.createElement("span"); s.className = "pb-img"; s.textContent = "［题目里有一张图，点右上角在网站上看］"; c.replaceWith(s); continue; }
        if (c.tagName === "A") { c.setAttribute("class", "pb-a"); }
        walk(c);
      }
    };
    walk(doc.body.firstChild);
    return doc.body.firstChild.innerHTML;
  }
  // Codeforces 题面里的公式 $$$...$$$：换成能看懂的写法
  const TEX = { "\\le": "≤", "\\leq": "≤", "\\ge": "≥", "\\geq": "≥", "\\ne": "≠", "\\neq": "≠", "\\cdot": "·", "\\times": "×", "\\dots": "…", "\\ldots": "…", "\\cdots": "⋯", "\\lt": "<", "\\gt": ">", "\\sum": "∑", "\\infty": "∞", "\\pm": "±", "\\to": "→", "\\in": "∈", "\\oplus": "⊕", "\\land": "∧", "\\lor": "∨", "\\lfloor": "⌊", "\\rfloor": "⌋", "\\lceil": "⌈", "\\rceil": "⌉", "\\,": " ", "\\;": " ", "\\quad": "  " };
  function tex(s) {
    return s.replace(/\$\$\$([\s\S]+?)\$\$\$/g, (_, m) => {
      let t = m.replace(/\\(?:le|leq|ge|geq|ne|neq|cdot|times|dots|ldots|cdots|lt|gt|sum|infty|pm|to|in|oplus|land|lor|lfloor|rfloor|lceil|rceil|quad)\b|\\[,;]/g, (k) => TEX[k] || k);
      t = t.replace(/\\text\{([^}]*)\}|\\mathrm\{([^}]*)\}|\\textbf\{([^}]*)\}/g, (_, a, b, c) => a || b || c || "");
      t = t.replace(/\^\{([^}]*)\}|\^(\w)/g, (_, a, b) => `<sup>${a || b}</sup>`).replace(/_\{([^}]*)\}|_(\w)/g, (_, a, b) => `<sub>${a || b}</sub>`);
      t = t.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1)/($2)").replace(/[{}]/g, "").replace(/\\(\w+)/g, "$1");
      return `<span class="pb-math">${t}</span>`;
    });
  }

  function pane() { return $("#prob"); }
  function show(on) {
    const p = pane(); if (!p) return;
    p.hidden = !on;
    LC.main.classList.toggle("has-prob", !!on);
    $("#probHandle").hidden = on || !P;
  }

  async function onTab(e) {
    const t = e.detail;
    if (!t) { P = null; file = ""; show(false); return; }
    let m = null;
    try { m = await LC.call("problemOfFile", t.file); } catch (err) {}
    if (!m) { P = null; file = ""; show(false); return; }
    file = t.file;
    if (P && P.id === m.id && file === t.file) { show(true); return; }
    P = m.problem; lastRes = null; view = "desc";
    show(true);
    if (!P) { paintLoading(); try { P = await LC.call("problemGet", m.id); } catch (err) { paintErr(err.message, m.id); return; } }
    paint();
    if (!acct) refreshAcct();
  }

  function paintLoading() { $("#probBody").innerHTML = `<div class="pb-empty">${I("radar", 26)}<span>正在拿题目…</span></div>`; }
  function paintErr(msg, id) {
    $("#probBody").innerHTML = `<div class="pb-empty">${I("warn", 26)}<b>${esc(msg)}</b><span>可以先在网站上看题，代码照样在这里写、在这里跑。</span><button class="btn sm" id="pbRetry">${I("refresh", 14)}再试一次</button></div>`;
    $("#pbRetry").onclick = async () => { paintLoading(); try { P = await LC.call("problemGet", id, true); paint(); } catch (e) { paintErr(e.message, id); } };
  }

  function head() {
    return `<button class="ic-btn" id="pbBack" title="收起题目（回到文件列表）">${I("prev", 18)}</button>
      <span class="lc-src ${P.src}">${P.src === "lc" ? "力扣" : "CF"}</span>
      <b class="pb-title" title="${esc(P.title)}">${esc(P.no)}${P.src === "lc" ? "." : ""} ${esc(P.title)}</b>
      <span class="grow"></span>
      ${P.level ? `<span class="lv lv-${esc(P.level)}">${esc(P.level)}</span>` : ""}
      <button class="ic-btn" id="pbWeb" title="在网站上打开">${I("external", 15)}</button>`;
  }

  function paint() {
    if (!P) return;
    $("#probHead").innerHTML = head();
    $("#pbBack").onclick = () => show(false);
    $("#pbWeb").onclick = () => LC.call("openUrl", P.url);
    $("#probTabs").innerHTML = `<button data-v="desc" class="${view === "desc" ? "on" : ""}">${I("book", 14)}题目</button><button data-v="res" class="${view === "res" ? "on" : ""}">${I("flask", 14)}结果${lastRes ? `<i class="pb-badge ${lastRes.ok ? "ok" : "bad"}"></i>` : ""}</button>`;
    if (view === "desc") paintDesc(); else paintRes();
    paintActs();
  }
  function paintDesc() {
    const samples = (P.samples || []).map((s, i) => `<div class="pb-sample"><div class="pb-sh"><b>样例 ${i + 1}</b><span class="grow"></span><button class="link" data-copy="${i}">复制输入</button></div>
      <div class="pb-io"><div><small>输入</small><pre>${esc(s.input)}</pre></div><div><small>输出</small><pre>${esc(s.output == null ? "（题面里没找到）" : s.output)}</pre></div></div></div>`).join("");
    $("#probBody").innerHTML = `${P.limits ? `<div class="pb-lim">${I("timer", 13)}${esc(P.limits)}</div>` : ""}
      ${(P.tags || []).length ? `<div class="pb-tags">${P.tags.slice(0, 6).map((t) => `<span class="tg">${esc(t)}</span>`).join("")}</div>` : ""}
      <article class="pb-desc">${tex(clean(P.html || ""))}</article>
      ${P.src === "cf" && samples ? `<h4 class="pb-h">样例</h4>${samples}` : ""}
      ${P.src === "lc" && samples ? `<details class="pb-raw"><summary>样例的原始输入（本地运行用的就是这些）</summary>${samples}</details>` : ""}
      <p class="pb-cr">题目来自 ${P.src === "lc" ? "力扣 leetcode.cn" : "Codeforces"}，版权归原网站；只在你电脑上临时保存。</p>`;
    $("#probBody").scrollTop = 0;
  }
  function caseHtml(c, i) {
    const st = c.skipped ? "skip" : c.pass ? "ok" : c.pass === null ? "unk" : "bad";
    return `<div class="pb-case ${st}"><div class="pb-ch">${I(st === "ok" ? "ok" : st === "bad" ? "bad" : "hourglass", 15)}<b>样例 ${i + 1}</b><span>${st === "ok" ? "对了" : st === "bad" ? (c.error ? "出错了" : "不对") : st === "skip" ? "没跑到" : "没有标准答案，自己看看"}</span>${c.ms ? `<small>${c.ms} ms</small>` : ""}</div>
      ${st === "ok" ? "" : `<div class="pb-io"><div><small>输入</small><pre>${esc(c.input)}</pre></div><div><small>标准答案</small><pre>${esc(c.want == null ? "" : c.want)}</pre></div><div class="${st === "bad" ? "bad" : ""}"><small>你的输出</small><pre>${esc(c.error ? c.error : c.got)}</pre></div>${c.stdout ? `<div><small>你打印的</small><pre>${esc(c.stdout)}</pre></div>` : ""}</div>`}</div>`;
  }
  function paintRes() {
    const r = lastRes, b = $("#probBody");
    if (busy) { b.innerHTML = `<div class="pb-empty">${I("radar", 28, "spin")}<span>${esc(judgeState || "正在判…")}</span></div>`; return; }
    if (!r) { b.innerHTML = `<div class="pb-empty">${I("flask", 26)}<span>写好了点下面「运行样例」先自己试试，<br>都对了再「提交」。</span></div>`; return; }
    if (r.unsupported) { b.innerHTML = `<div class="pb-empty">${I("warn", 26)}<b>${esc(r.unsupported)}</b>${acct && acct.available && !acct.signedIn ? `<button class="btn sm pri" id="pbLogin2">${I("login", 14)}登录力扣</button>` : ""}</div>`; const l = $("#pbLogin2"); if (l) l.onclick = login; return; }
    if (r.compileFailed || r.compileError) {
      b.innerHTML = `<div class="pb-verdict bad">${I("bad", 22)}<b>编译没通过</b></div><pre class="pb-err">${esc(r.stderr || r.compileError)}</pre>`;
      return;
    }
    if (r.remote && r.mode === "submit") {
      b.innerHTML = `<div class="pb-verdict ${r.ok ? "ok" : "bad"}">${I(r.ok ? "trophy" : "bad", 24)}<b>${esc(r.status)}</b>${r.total ? `<span>${r.passed} / ${r.total} 个测试</span>` : ""}</div>
        ${r.ok ? `<div class="pb-stats"><div><small>用时</small><b>${esc(r.runtime || "")}</b>${r.runtimePct ? `<span>击败 ${Math.round(r.runtimePct)}%</span>` : ""}</div><div><small>内存</small><b>${esc(r.memory || "")}</b>${r.memoryPct ? `<span>击败 ${Math.round(r.memoryPct)}%</span>` : ""}</div></div>` : ""}
        ${r.delta ? `<div class="pb-delta">${I("zap", 14)}水平分 ${r.delta > 0 ? "+" : ""}${r.delta}</div>` : ""}
        ${r.runtimeError ? `<pre class="pb-err">${esc(r.runtimeError)}</pre>` : ""}
        ${!r.ok && r.last ? `<div class="pb-io"><div><small>没过的输入</small><pre>${esc(r.last)}</pre></div><div><small>标准答案</small><pre>${esc(r.want)}</pre></div><div class="bad"><small>你的输出</small><pre>${esc(r.got)}</pre></div></div>` : ""}
        <button class="link" id="pbSub">在力扣上看这次提交 ↗</button>`;
      $("#pbSub").onclick = () => LC.call("openUrl", "https://leetcode.cn/problems/" + P.slug + "/submissions/");
      return;
    }
    const cases = r.cases || [];
    const n = cases.filter((c) => c.pass).length;
    b.innerHTML = `<div class="pb-verdict ${r.allPass || r.ok ? "ok" : "bad"}">${I(r.allPass || r.ok ? "ok" : "bad", 22)}<b>${r.remote ? "力扣运行：" : "本地运行："}${n} / ${cases.length} 个样例对了</b></div>
      ${r.offline && r.allPass ? `<div class="pb-note">${acct && acct.available && P.src === "lc" ? "没登录力扣，只比了样例。登录后提交会用力扣全部的测试数据判。" : P.src === "cf" ? "样例都对了。Codeforces 的完整测试要在网站上提交。" : "样例都对了。"}</div>` : ""}
      ${r.delta ? `<div class="pb-delta">${I("zap", 14)}水平分 ${r.delta > 0 ? "+" : ""}${r.delta}</div>` : ""}
      ${r.runtimeError ? `<pre class="pb-err">${esc(r.runtimeError)}</pre>` : ""}
      ${cases.map(caseHtml).join("")}
      ${P.src === "cf" && r.allPass ? `<button class="btn sm" id="pbCfSub">${I("external", 14)}去 Codeforces 提交</button>` : ""}`;
    const cs = $("#pbCfSub"); if (cs) cs.onclick = () => LC.call("openUrl", P.url);
  }
  function paintActs() {
    const online = P.src === "lc" && acct && acct.signedIn;
    $("#probActs").innerHTML = `<button class="btn sm" id="pbRun" ${busy ? "disabled" : ""} title="Ctrl+'">${I("play", 14)}运行样例</button>
      <button class="btn sm pri" id="pbSubmit" ${busy ? "disabled" : ""} title="${online ? "交到力扣，用全部测试数据判" : "比一比样例；都对了算做出来"}">${I("upload", 14)}${online ? "提交到力扣" : "提交"}</button>
      <span class="grow"></span>
      ${P.src === "lc" && acct && acct.available ? (acct.signedIn ? `<button class="pb-acct on" id="pbAcct" title="已登录力扣，点一下退出">${I("user", 13)}${esc(acct.name || "已登录")}</button>` : `<button class="pb-acct" id="pbAcct" title="登录后提交用力扣全部的测试数据判，结果和网页上一样">${I("login", 13)}登录力扣</button>`) : ""}`;
    $("#pbRun").onclick = () => judge("run");
    $("#pbSubmit").onclick = () => judge("submit");
    const a = $("#pbAcct"); if (a) a.onclick = () => (acct.signedIn ? logout() : login());
  }

  async function judge(mode) {
    if (busy || !P) return;
    const t = LC.cur; if (!t || t.file !== file) return;
    busy = true; judgeState = mode === "submit" ? "正在提交…" : "正在运行样例…"; view = "res"; paint();
    let r;
    try {
      await LC.saveAll();
      r = await LC.call("problemSubmit", file, LC.cm.getValue(), mode);
    } catch (e) {
      r = { unsupported: e.message };
      if (/登录/.test(e.message)) { acct = null; refreshAcct(); }
    }
    busy = false; lastRes = { ...r, ok: r.ok || r.allPass };
    if (r.compileFailed && r.diags) LC.showDiags(t, r.diags);
    paint();
    if (r.delta) document.dispatchEvent(new CustomEvent("skill", { detail: r.delta }));
    if ((r.ok || r.allPass) && mode === "submit") LC.toast(r.remote ? "通过了！" : "样例全对");
  }

  async function refreshAcct() { try { acct = await LC.call("lcAccount"); } catch (e) { acct = { available: false }; } if (P) paintActs(); }
  async function login() {
    LC.toast("在弹出的窗口里登录力扣（扫码、密码都行），登录好窗口会自己关掉", 5000);
    try { acct = await LC.call("lcLogin"); LC.toast(acct.signedIn ? "登录好了：" + (acct.name || "") : "没登录上"); } catch (e) { LC.toast(e.message); }
    if (P) paintActs();
  }
  async function logout() {
    const ok = await new Promise((res) => { LC.dialog(`<h3>退出力扣登录？</h3><p>退出后提交只比样例。</p><div class="acts"><button class="btn" value="no">不退出</button><button class="btn pri" value="yes">退出</button></div>`); const d = $("#dlg"); d.addEventListener("close", () => res(d.returnValue === "yes"), { once: true }); });
    if (!ok) return;
    try { acct = await LC.call("lcLogout"); } catch (e) {}
    if (P) paintActs();
  }

  function hook() {
    LC = window.LC;
    const p = pane(); if (!p) return;
    $("#probTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { view = b.dataset.v; paint(); } });
    $("#probBody").addEventListener("click", (e) => {
      const c = e.target.closest("[data-copy]"); if (c && P) { navigator.clipboard.writeText(P.samples[+c.dataset.copy].input).then(() => LC.toast("复制好了：运行时粘贴到下面的输入框")).catch(() => {}); }
      const a = e.target.closest("a.pb-a"); if (a) e.preventDefault();
    });
    $("#probHandle").onclick = () => show(true);
    document.addEventListener("tab", onTab);
    document.addEventListener("keydown", (e) => { if (P && !pane().hidden && (e.ctrlKey || e.metaKey) && e.key === "'") { e.preventDefault(); judge(e.shiftKey ? "submit" : "run"); } });
    if (window.cc && window.cc.on) window.cc.on("judge", (d) => { judgeState = { PENDING: "排队中…", STARTED: "力扣正在判…" }[d && d.state] || "力扣正在判…"; if (busy && view === "res") paintRes(); });
    if (LC.cur) onTab({ detail: LC.cur });
  }
  if (window.LC) hook(); else document.addEventListener("lc-ready", hook, { once: true });
  window.LaolaoProb = { get problem() { return P; }, open: async (id, lang) => { const r = await LC.call("problemOpen", id, lang); await LC.refreshFiles(); P = null; await LC.openFile(r.file); return r; } };
})();
