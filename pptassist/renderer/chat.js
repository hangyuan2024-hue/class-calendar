// 捞捞PPT助手 · AI 改 PPT：和本地大模型「捞捞」对话（流式回复、每一步的进度），拍照认公式、预览、插进去，撤销、另存
"use strict";
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const call = (m, ...a) => window.cc.call(m, ...a);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const msgOf = (e) => String((e && e.message) || e).replace(/^Error invoking remote method 'call': (Error: )?/, "");
  const toast = (t, err) => { const el = $("#toast"); el.textContent = t; el.className = "toast" + (err ? " err" : ""); el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), err ? 6000 : 2600); };
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(msgOf(e), true); } };
  const gb = (b) => (b / 1073741824).toFixed(1) + "G";
  let A = null, imgs = [], bot = null, steps = new Map(), busy = false, ocrImage = null;

  // ---------- 状态 ----------
  const PILL = { off: ["没启动", ""], starting: ["启动中…", "busy"], ready: ["已就绪", "ok"], "need-model": ["要下载模型", "err"], missing: ["缺少程序", "err"], error: ["出错了", "err"] };
  function paintState(st) {
    const [t, c] = PILL[st.status] || [st.status, ""];
    $("#aiPill").textContent = t; $("#aiPill").className = "pill " + c;
    if (st.msg) $("#aiModelMeta").textContent = st.msg;
  }
  async function refresh() {
    A = await call("aiState");
    paintState(A.llm);
    $("#aiModelMeta").textContent = A.model.ready ? A.model.name : `${A.model.name}：还没下载（约 ${gb(A.model.size)}，从国内存储下）`;
    $("#aiDl").hidden = A.model.ready; $("#aiGo").hidden = !A.model.ready || A.llm.status === "ready" || A.llm.status === "starting";
    paintEdit(A.edit);
  }
  function paintEdit(ed) {
    $("#aiFile").textContent = ed ? ed.file.split(/[\\/]/).pop() + (ed.saved ? "" : "（改过，还没保存）") : "还没打开 PPT：先去「选页和内容」打开一个";
    $("#aiSaveBtn").disabled = !ed || ed.saved; $("#aiUndoBtn").disabled = !ed || !ed.history.length;
    $("#aiOutline").innerHTML = ed ? ed.outline.map((s) => `<li class="${s.hidden ? "hid" : ""}" data-no="${s.no}"><b>${s.no}</b><span>${esc(s.title || "（没有标题）")}</span>${s.formulas ? `<i>∑×${s.formulas}</i>` : ""}</li>`).join("") : "";
    $("#aiCount").textContent = ed ? `${ed.outline.length} 页` : "";
    $("#aiHist").textContent = ed && ed.history.length ? "改过：" + ed.history.slice(-4).join(" → ") : "";
    if (ed) $("#ocrSlide").max = String(ed.outline.length);
  }
  window.addEventListener("lao-ai-show", guard(refresh));

  // ---------- 模型 ----------
  $("#aiDl").onclick = guard(async () => {
    const b = $("#aiDl"); b.disabled = true; $("#aiDlProg").hidden = false;
    try { await call("aiDownload"); toast("模型下载好了"); await call("aiStart"); }
    finally { b.disabled = false; $("#aiDlProg").hidden = true; await refresh(); }
  });
  $("#aiGo").onclick = guard(async () => { $("#aiGo").disabled = true; try { await call("aiStart"); } finally { $("#aiGo").disabled = false; await refresh(); } });

  // ---------- 对话 ----------
  const log = () => $("#chatLog");
  const scroll = () => { const l = log(); l.scrollTop = l.scrollHeight; };
  function add(cls, html) { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; log().appendChild(d); scroll(); return d; }
  function botText(t) {
    if (!bot) { bot = add("msg bot", '<span class="t"></span><span class="cursor"></span>'); bot._t = ""; }
    bot._t += t;
    // 模型把工具调用写在正文里（<tool_call>…）：不给老师看
    bot.querySelector(".t").textContent = bot._t.replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, "").replace(/<\/?tool_call>?$/, "").trim();
    scroll();
  }
  function endBot() { if (bot) { const c = bot.querySelector(".cursor"); if (c) c.remove(); if (!bot.querySelector(".t").textContent.trim()) bot.remove(); else typeset(bot); } bot = null; }
  window.cc.on("agent", (e) => {
    if (e.type === "state") return paintState(e.state);
    if (e.type === "download") { const p = e.total ? e.got / e.total : 0; $("#aiDlProg .bar i").style.width = Math.round(p * 100) + "%"; $("#aiDlProg > span").textContent = e.checking ? "校验…" : `下载 ${e.name}：${gb(e.got || 0)} / ${e.total ? gb(e.total) : "?"}${e.speed ? `，${(e.speed / 1048576).toFixed(1)}MB/秒` : ""}`; return; }
    if (e.type === "delta") return botText(e.text);
    if (e.type === "tool") {
      endBot();
      const key = e.name + JSON.stringify(e.args);
      if (e.stage === "start") { steps.set(key, add("step run", esc("正在" + e.say + "…"))); return; }
      const el = steps.get(key) || add("step", ""); steps.delete(key);
      el.className = "step " + (e.ok ? "ok" : "bad");
      el.textContent = e.ok ? done(e) : `${e.say}：${(e.result && e.result.error) || "没成功"}`;
      if (e.changed) guard(refresh)();
      return;
    }
    if (e.type === "done") { endBot(); if (e.note) add("msg bot", esc(e.note)); if (e.stopped) add("step", "停下了"); return; }
    if (e.type === "error") { endBot(); add("msg bot err", esc(e.message)); }
  });
  // 做完一步的那一行字
  function done(e) {
    const r = e.result || {};
    if (e.name === "get_outline") return `看了大纲（${Array.isArray(r) ? r.length : "?"} 页）`;
    if (e.name === "get_slide") return `看了第 ${e.args.slide} 页（${(r.shapes || []).length} 个框）`;
    if (e.name === "replace_text") return `${e.say}：换了 ${r.count} 处（第 ${(r.pages || []).join("、")} 页）`;
    if (e.name === "add_slide") return `加好了第 ${r.no} 页「${e.args.title || ""}」`;
    if (e.name === "insert_formula") return `第 ${r.no} 页插好了公式 ${r.text || ""}` + (r.note ? `（${r.note}）` : "");
    if (e.name === "undo") return r.undone ? `撤销了：${r.undone}` : "没有可以撤销的了";
    return e.say.replace(/^改/, "改好了") + "";
  }
  function typeset(el) {
    // 回复里的公式（$…$、\(…\)、\[…\]）用 MathJax 画出来
    if (!window.MathJax || !MathJax.typesetPromise || !/\$|\\\(|\\\[/.test(el.textContent)) return;
    MathJax.typesetPromise([el]).catch(() => {});
  }
  async function send(text) {
    text = (text != null ? text : $("#chatText").value).trim();
    if ((!text && !imgs.length) || busy) return;
    const pics = imgs.slice(); imgs = []; paintImgs();
    $("#chatText").value = "";
    const hello = $(".chat-hello"); if (hello) hello.remove();
    add("msg me", pics.map((u) => `<img src="${u}" alt="">`).join("") + esc(text));
    busy = true; $("#chatSend").hidden = true; $("#chatStop").hidden = false;
    try { const ed = await call("aiSend", text, pics); if (ed) paintEdit(ed); }
    catch (e) { endBot(); if (!/还没说完/.test(msgOf(e))) add("msg bot err", esc(msgOf(e))); }
    finally { busy = false; $("#chatSend").hidden = false; $("#chatStop").hidden = true; endBot(); guard(refresh)(); }
  }
  $("#chatSend").onclick = () => send();
  $("#chatStop").onclick = guard(() => call("aiStop"));
  $("#chatText").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  $("#chatLog").addEventListener("click", (e) => { const b = e.target.closest(".ex"); if (b) send(b.textContent); });

  // ---------- 图片：选、粘贴、拖进来（缩到长边 1600，省内存） ----------
  async function shrink(src) {
    const im = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("图片读不了")); i.src = src; });
    const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  }
  const fileUrl = (f) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
  function paintImgs() { $("#chatImgs").innerHTML = imgs.map((u, i) => `<img src="${u}" data-i="${i}" title="点一下去掉">`).join(""); }
  $("#chatImgs").onclick = (e) => { const i = e.target.dataset.i; if (i != null) { imgs.splice(+i, 1); paintImgs(); } };
  $("#chatImg").onclick = guard(async () => { const u = await call("aiPickImage"); if (u) { imgs.push(await shrink(u)); paintImgs(); } });
  async function takeFiles(list, to) {
    for (const f of [...list].filter((x) => /^image\//.test(x.type)).slice(0, 3)) {
      const u = await shrink(await fileUrl(f));
      if (to === "ocr") { setOcr(u); return; }
      imgs.push(u);
    }
    paintImgs();
  }
  $("#pg-ai").addEventListener("paste", (e) => { const fs = [...(e.clipboardData || {}).files || []]; if (!fs.length) return; e.preventDefault(); guard(takeFiles)(fs, e.target.closest(".ai-side") ? "ocr" : "chat"); });
  $("#pg-ai").addEventListener("dragover", (e) => e.preventDefault());
  $("#pg-ai").addEventListener("drop", (e) => { e.preventDefault(); guard(takeFiles)(e.dataTransfer.files, e.target.closest(".ai-side") ? "ocr" : "chat"); });

  // ---------- 拍照插公式 ----------
  function setOcr(u) { ocrImage = u; const im = $("#ocrImg"); im.src = u; im.hidden = false; $("#ocrGo").disabled = false; }
  $("#ocrPick").onclick = guard(async () => { const u = await call("aiPickImage"); if (u) setOcr(await shrink(u)); });
  $("#ocrGo").onclick = guard(async () => {
    const b = $("#ocrGo"); b.disabled = true; b.textContent = "认公式中…";
    try { const r = await call("aiOcr", ocrImage); $("#ocrTex").value = r.latex; preview(); }
    finally { b.disabled = false; b.textContent = "认公式"; }
  });
  let pt = 0, styled = false;
  // MathJax 的样式表：第一次画公式时加到页面上
  function styles() { if (styled) return; styled = true; try { MathJax.startup.document.updateDocument(); } catch (e) {} }
  function preview() {
    const tex = $("#ocrTex").value.trim(), box = $("#ocrPrev");
    if (!tex) { box.innerHTML = ""; return; }
    if (!window.MathJax || !MathJax.tex2svgPromise) { box.textContent = tex; return; }
    MathJax.tex2svgPromise(tex.replace(/^\$+|\$+$/g, ""), { display: true }).then((n) => { box.innerHTML = ""; box.appendChild(n); styles(); const er = n.querySelector("[data-mjx-error]"); if (er) box.insertAdjacentHTML("beforeend", `<div class="bad">LaTeX 写得有问题：${esc(er.getAttribute("data-mjx-error"))}</div>`); }).catch((e) => { box.innerHTML = `<span class="bad">${esc(e.message)}</span>`; });
  }
  $("#ocrTex").addEventListener("input", () => { clearTimeout(pt); pt = setTimeout(preview, 250); });
  $("#ocrIns").onclick = guard(async () => {
    const tex = $("#ocrTex").value.trim(); if (!tex) throw new Error("先认公式，或者自己写 LaTeX");
    const r = await call("aiInsertFormula", +$("#ocrSlide").value || 1, tex, { where: $("#ocrWhere").value || undefined });
    paintEdit(r.edit); toast(`插到第 ${r.no} 页了` + (r.note ? "：" + r.note : ""), !!r.note);
    add("step ok", esc(`第 ${r.no} 页插好了公式 ${r.text}`));
  });
  $("#aiOutline").onclick = (e) => { const li = e.target.closest("li"); if (li) $("#ocrSlide").value = li.dataset.no; };

  // ---------- 撤销、保存 ----------
  $("#aiUndoBtn").onclick = guard(async () => { const r = await call("aiUndo"); if (r) { paintEdit(r.edit); toast(r.undone ? "撤销了：" + r.undone : "没有可以撤销的了"); if (r.undone) add("step ok", esc("撤销了：" + r.undone)); } });
  $("#aiSaveBtn").onclick = guard(async () => {
    const r = await call("aiSave");
    window.dispatchEvent(new CustomEvent("lao-doc", { detail: r.doc }));
    await refresh();
    toast("另存好了：" + r.file.split(/[\\/]/).pop() + "（「选页和内容」「生成 PPT」也换成了这一份）");
  });
})();
