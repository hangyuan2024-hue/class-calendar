// 捞捞编程 · 界面
"use strict";
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const call = (m, ...a) => window.cc.call(m, ...a).catch((e) => { throw new Error(String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); });
  const base = (f) => String(f || "").split(/[\\/]/).pop();
  const LS = { get(k, d) { try { const v = localStorage.getItem("lc_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem("lc_" + k, JSON.stringify(v)); } catch (e) {} } };

  let S = null;                 // 主进程给的状态
  let tabs = [], cur = -1;      // 打开的文件
  let running = false, runKind = "", lastExit = null;
  let chat = [], asking = null; // 问捞捞的对话
  const ICON = { c: "C", cpp: "C++", python: "Py", java: "Java", javascript: "JS", go: "Go" };
  const LANG = (id) => (S.langs || []).find((l) => l.id === id);

  function toast(msg, ms = 2600) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), ms); }

  // ================= 编辑器 =================
  const cm = CodeMirror($("#editorWrap"), {
    value: "", lineNumbers: true, indentUnit: 4, tabSize: 4, indentWithTabs: false, smartIndent: true, lineWrapping: false,
    matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true, gutters: ["gut-diag", "CodeMirror-linenumbers"],
    extraKeys: {
      Tab: (c) => (c.somethingSelected() ? c.indentSelection("add") : c.replaceSelection(c.getOption("indentWithTabs") ? "\t" : " ".repeat(c.getOption("indentUnit")), "end")),
      "Shift-Tab": (c) => c.indentSelection("subtract"),
      "Ctrl-/": (c) => c.toggleComment(), "Cmd-/": (c) => c.toggleComment(),
      "Ctrl-Space": (c) => c.showHint({ hint: hintAll, completeSingle: false }),
      "Ctrl-F": "findPersistent", "Ctrl-H": "replace",
    },
  });
  cm.getWrapperElement().style.display = "none";
  const KW = {
    c: "int long short char float double void unsigned signed const static struct typedef enum return if else for while do switch case break continue default sizeof printf scanf puts gets getchar putchar malloc free strlen strcpy strcmp strcat memset include define main NULL",
    cpp: "int long short char float double void bool unsigned const static struct class public private protected return if else for while do switch case break continue default auto vector string map set pair cout cin endl push_back size begin end sort include using namespace std main nullptr true false",
    python: "print input int float str list dict set tuple len range enumerate zip sorted reversed sum max min abs round open def return if elif else for while break continue in not and or True False None import from as class self try except finally with lambda pass append split join strip format",
    java: "public private protected static final void int long double float boolean char String class new return if else for while do switch case break continue Scanner System out println print printf nextInt nextLine next nextDouble length charAt ArrayList HashMap Math main args import true false null",
    javascript: "let const var function return if else for while do switch case break continue console log require process stdin stdout readFileSync split map filter reduce forEach length push parseInt parseFloat Number String Math true false null undefined",
    go: "package import func main var const type struct return if else for range switch case break continue fmt Println Printf Print Scan Scanln Sprintf len append make map int int64 float64 string bool true false nil",
  };
  function hintAll(c) {
    const r = CodeMirror.hint.anyword(c, { word: /[\w$]+/ }) || { list: [], from: c.getCursor(), to: c.getCursor() };
    const t = tabs[cur]; const cur0 = c.getCursor(), tok = c.getTokenAt(cur0), w = (tok.string.match(/[\w$]+$/) || [""])[0];
    const kws = (KW[t && t.lang] || "").split(" ").filter((k) => w && k.startsWith(w) && k !== w);
    r.list = [...new Set([...kws, ...r.list])].slice(0, 40);
    return r;
  }
  cm.on("inputRead", (c, ch) => { if (/^[A-Za-z_.]$/.test(ch.text[0]) && ch.origin === "+input") { const tok = c.getTokenAt(c.getCursor()); if (/^[\w$]{3,}$/.test(tok.string) && !/comment|string/.test(tok.type || "")) c.showHint({ hint: hintAll, completeSingle: false }); } });
  cm.on("change", (c, ch) => {
    const t = tabs[cur]; if (!t) return;
    if (t.diags && t.diags.length) clearDiags(t);
    t.dirty = true; paintTabs(); scheduleSave(t);
  });
  cm.on("cursorActivity", () => { const p = cm.getCursor(); $("#stPos").textContent = `第 ${p.line + 1} 行，第 ${p.ch + 1} 列`; });

  function applyTheme() {
    const dark = S.settings.theme === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    cm.setOption("theme", dark ? "material-darker" : "idea");
    document.documentElement.style.setProperty("--fs", (S.settings.fontSize || 15) + "px");
    cm.refresh();
  }

  // ================= 文件、标签页 =================
  function exOfFile(f) { const m = String(f).replace(/\\/g, "/").match(/\/练习\/([\w-]+)\/[^/]+$/); return m && S.exercises.find((e) => e.id === m[1]) ? m[1] : null; }
  async function openFile(f, { focus = true } = {}) {
    const i = tabs.findIndex((t) => t.file === f);
    if (i >= 0) { switchTab(i); return tabs[i]; }
    let r; try { r = await call("read", f); } catch (e) { toast("打不开：" + e.message); return null; }
    const L = LANG(r.lang);
    const doc = CodeMirror.Doc(r.text, L ? L.cm : "text/plain");
    const t = { file: f, name: base(f), lang: r.lang, doc, dirty: false, diags: [], marks: [], ex: exOfFile(f) };
    tabs.push(t); switchTab(tabs.length - 1);
    call("opened", f).catch(() => {});
    if (focus) cm.focus();
    return t;
  }
  function switchTab(i) {
    cur = i; const t = tabs[i];
    if (t) { cm.getWrapperElement().style.display = ""; $("#welcome").hidden = true; cm.swapDoc(t.doc); const L = LANG(t.lang); cm.setOption("indentUnit", t.lang === "go" ? 8 : 4); cm.setOption("indentWithTabs", t.lang === "go"); setTimeout(() => cm.refresh(), 0); call("setSettings", { lastFile: t.file }).catch(() => {}); }
    else { cm.getWrapperElement().style.display = "none"; $("#welcome").hidden = false; paintWelcome(); }
    paintTabs(); paintTop(); paintFiles(); paintExBar(); paintExList();
  }
  async function closeTab(i) {
    const t = tabs[i]; if (!t) return;
    if (t.dirty) await saveTab(t);
    tabs.splice(i, 1);
    switchTab(Math.min(i, tabs.length - 1));
  }
  const saveTimers = new WeakMap();
  function scheduleSave(t) { clearTimeout(saveTimers.get(t)); saveTimers.set(t, setTimeout(() => saveTab(t), 1200)); }
  async function saveTab(t) {
    clearTimeout(saveTimers.get(t));
    if (!t.dirty) return true;
    const text = t.doc.getValue();
    try { await call("write", t.file, text); if (t.doc.getValue() === text) t.dirty = false; paintTabs(); return true; }
    catch (e) { toast("没保存上：" + e.message, 4000); return false; }
  }
  const saveAll = () => Promise.all(tabs.map(saveTab));

  function paintTabs() {
    $("#tabs").innerHTML = tabs.map((t, i) => `<div class="tab${i === cur ? " on" : ""}" role="tab" data-tab="${i}" title="${esc(t.file)}"><span class="nm">${esc(t.name)}</span>${t.dirty ? '<span class="dirty" title="还没保存（会自动保存）"></span>' : ""}<button class="x" data-close="${i}" aria-label="关闭">✕</button></div>`).join("");
  }
  $("#tabs").addEventListener("click", (e) => { const x = e.target.closest("[data-close]"); if (x) { closeTab(+x.dataset.close); return; } const t = e.target.closest("[data-tab]"); if (t) switchTab(+t.dataset.tab); });
  $("#tabs").addEventListener("auxclick", (e) => { const t = e.target.closest("[data-tab]"); if (t && e.button === 1) closeTab(+t.dataset.tab); });

  function paintTop() {
    const t = tabs[cur], L = t && LANG(t.lang);
    $("#langChip").hidden = !L; if (L) $("#langChip").textContent = L.name;
    $("#runBtn").disabled = !L || running;
    $("#runBtn").hidden = running;
    $("#stopBtn").hidden = !running;
    $("#checkBtn").hidden = !(t && t.ex) || running;
    $("#stLang").textContent = L ? (L.ready ? `${L.name} · ${L.where === "bundled" ? "自带" : L.where === "user" ? "已安装" : "用电脑上装的"}` : `${L.name} · 还没装`) : "";
  }

  async function refreshFiles() { try { S.files = await call("files"); } catch (e) {} paintFiles(); }
  function paintFiles() {
    $("#wsPath").textContent = S.workspace; $("#wsPath").title = "代码放在：" + S.workspace;
    const t = tabs[cur];
    const sep = S.workspace.includes("\\") ? "\\" : "/";
    const full = (rel) => S.workspace + sep + rel.split("/").join(sep);
    $("#fileList").innerHTML = S.files.length ? S.files.map((f) => f.dir
      ? `<div class="f dir" style="padding-left:${8 + f.depth * 14}px">📁 <span class="nm">${esc(f.name)}</span></div>`
      : `<button class="f${t && t.file === full(f.rel) ? " on" : ""}" style="padding-left:${8 + f.depth * 14}px" data-open="${esc(full(f.rel))}" title="${esc(f.rel)}"><span class="fi ${esc(f.lang)}">${esc(ICON[f.lang] || "TXT")}</span><span class="nm">${esc(f.name)}</span></button>`).join("")
      : `<div class="empty">这里还没有代码文件。<br>点「＋ 新建」写第一个程序，<br>或者去「练习」做一道题。</div>`;
  }
  $("#fileList").addEventListener("click", (e) => { const b = e.target.closest("[data-open]"); if (b) openFile(b.dataset.open); });
  $("#fileList").addEventListener("contextmenu", (e) => { const b = e.target.closest("[data-open]"); if (!b) return; e.preventDefault(); fileMenu(b.dataset.open); });

  // ================= 对话框 =================
  const dlg = $("#dlg");
  function dialog(html, bind) {
    $("#dlgBody").innerHTML = html;
    if (!dlg.open) dlg.showModal();
    bind && bind($("#dlgBody"));
    const first = $("#dlgBody input, #dlgBody select"); if (first) setTimeout(() => first.focus(), 30);
  }
  const closeDlg = () => { if (dlg.open) dlg.close(); };
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDlg(); });

  function newFileDialog(langId) {
    let pick = langId || LS.get("lastLang", "c");
    const paint = (body) => { $$(".lang-pick button", body).forEach((b) => b.classList.toggle("on", b.dataset.l === pick)); const L = LANG(pick); $("#nfExt", body).textContent = L ? L.exts[0] : ""; };
    dialog(`<h3>新建程序</h3><p>选一种语言，起个名字。文件会放在「${esc(S.workspace)}」里。</p>
      <div class="lang-pick">${S.langs.map((l) => `<button type="button" data-l="${l.id}">${esc(l.name)}<small>${l.ready ? "能直接用" : "第一次运行时安装"}</small></button>`).join("")}</div>
      <label>文件名<span style="display:flex;gap:6px;align-items:center"><input id="nfName" value="hello" maxlength="50" style="flex:1"><b id="nfExt" style="font-family:var(--mono);color:var(--sub)"></b></span></label>
      <div class="err" id="nfErr"></div><div class="acts"><button class="btn" value="cancel">取消</button><button class="btn pri" id="nfOk" value="default">新建</button></div>`, (body) => {
      paint(body);
      $(".lang-pick", body).addEventListener("click", (e) => { const b = e.target.closest("[data-l]"); if (b) { pick = b.dataset.l; paint(body); } });
      $("#nfOk", body).addEventListener("click", async (e) => {
        e.preventDefault();
        try { const f = await call("create", $("#nfName", body).value, pick); LS.set("lastLang", pick); closeDlg(); await refreshFiles(); await openFile(f); cm.setCursor(cm.lineCount() - 1, 0); toast("写好了按 F5 运行"); }
        catch (err) { $("#nfErr", body).textContent = err.message; }
      });
    });
  }
  function fileMenu(f) {
    dialog(`<h3>${esc(base(f))}</h3><div class="menu"><button type="button" data-a="ren">✎ 改名</button><button type="button" data-a="show">📂 在文件夹里显示</button><button type="button" data-a="del" style="color:var(--err)">🗑 删除（放进回收站）</button></div><div class="acts"><button class="btn" value="cancel">取消</button></div>`, (body) => {
      body.addEventListener("click", async (e) => {
        const a = e.target.closest("[data-a]"); if (!a) return; e.preventDefault();
        if (a.dataset.a === "show") { call("reveal", f); closeDlg(); }
        if (a.dataset.a === "del") { if (!confirm(`把「${base(f)}」放进回收站？`)) return; const i = tabs.findIndex((t) => t.file === f); if (i >= 0) { tabs[i].dirty = false; await closeTab(i); } await call("remove", f); closeDlg(); refreshFiles(); }
        if (a.dataset.a === "ren") {
          const n = prompt("新名字", base(f)); if (!n || n === base(f)) return;
          try { const nf = await call("rename", f, n); const t = tabs.find((x) => x.file === f); if (t) { await saveTab(t); t.file = nf; t.name = base(nf); } closeDlg(); refreshFiles(); paintTabs(); } catch (err) { toast(err.message); }
        }
      });
    });
  }
  $("#newFileBtn").onclick = () => newFileDialog();
  $("#openFileBtn").onclick = async () => { const f = await call("openFile"); if (f) openFile(f); };
  $("#moreFilesBtn").onclick = () => dialog(`<h3>代码文件夹</h3><p>现在放在：${esc(S.workspace)}</p><div class="menu"><button type="button" data-a="open">📂 打开这个文件夹</button><button type="button" data-a="pick">🔁 换一个文件夹</button><button type="button" data-a="dir">＋ 新建子文件夹</button><button type="button" data-a="ref">↻ 刷新文件列表</button></div><div class="acts"><button class="btn" value="cancel">关闭</button></div>`, (body) => body.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-a]"); if (!a) return; e.preventDefault();
    if (a.dataset.a === "open") call("openWorkspaceFolder");
    if (a.dataset.a === "pick") { const d = await call("pickWorkspace"); if (d) { S.workspace = d; await refreshFiles(); } }
    if (a.dataset.a === "dir") { const n = prompt("文件夹名字"); if (n) { try { await call("mkdir", n); await refreshFiles(); } catch (err) { toast(err.message); } } }
    if (a.dataset.a === "ref") refreshFiles();
    closeDlg();
  }));

  // ================= 欢迎页 =================
  function paintWelcome() {
    const rec = (S.settings.recent || []).slice(0, 6);
    const p = S.progress || {};
    $("#welcome").innerHTML = `<h1>${p.streak > 1 ? `🔥 连续 ${p.streak} 天写代码，继续！` : "开始写代码吧 👋"}</h1>
      <p>选一种语言新建一个程序，写完按 <b>F5</b> 运行。程序要输入就在下面的「输入」框里打字；看不懂报错，点右边的「问捞捞」。</p>
      <div class="wl-grid">${S.langs.map((l) => `<button class="wl" data-new="${l.id}"><b>${esc(l.name)}</b><small class="${l.ready ? "ok" : ""}">${l.ready ? "✓ 能直接用" : "点一下自动安装 · " + esc(l.size)}</small></button>`).join("")}</div>
      ${rec.length ? `<div class="wl-sec">最近打开</div><div class="wl-recent">${rec.map((f) => `<button data-open="${esc(f)}"><b>${esc(base(f))}</b><small>${esc(f)}</small></button>`).join("")}</div>` : ""}
      <div class="wl-sec">刚开始学？</div>
      <div class="wl-tip">左边「练习」里有 ${S.exercises.length} 道入门题，从 Hello World 开始，一道一道来。每道题写完点「检查」，自动帮你跑测试。${p.solved ? `你已经做对了 <b>${p.solved}</b> 道。` : ""}</div>`;
  }
  $("#welcome").addEventListener("click", (e) => {
    const n = e.target.closest("[data-new]"); if (n) newFileDialog(n.dataset.new);
    const o = e.target.closest("[data-open]"); if (o) openFile(o.dataset.open);
  });

  // ================= 运行 =================
  const out = $("#conOut");
  function conClear() { out.innerHTML = ""; }
  function conAppend(text, cls) {
    const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
    const last = out.lastChild;
    if (last && last.nodeType === 1 && last.tagName === "SPAN" && last.className === (cls || "o") && !last.classList.contains("sys")) last.textContent += text;
    else { const s = document.createElement("span"); s.className = cls || "o"; s.textContent = text; out.appendChild(s); }
    if (out.childNodes.length > 4000) out.removeChild(out.firstChild);
    if (atBottom) out.scrollTop = out.scrollHeight;
  }
  function conSys(html, cls = "") { const d = document.createElement("span"); d.className = "sys " + cls; d.innerHTML = html; out.appendChild(d); out.scrollTop = out.scrollHeight; }
  function conState(text, cls) { const s = $("#conSt"); s.textContent = text; s.className = "con-st " + (cls || ""); }
  // 输入框只在程序真的跑起来以后能用（编译的时候不能输入）
  function setStdin(on) { $("#stdin").disabled = !on; $("#eofBtn").disabled = !on; if (on) setTimeout(() => { if (document.activeElement === document.body || document.activeElement === $("#conOut") || cm.hasFocus()) $("#stdin").focus(); }, 30); }
  function setRunning(on, kind) {
    running = on; runKind = on ? kind : "";
    setStdin(false);
    paintTop();
  }
  async function run() {
    const t = tabs[cur]; if (!t || running) return;
    const L = LANG(t.lang); if (!L) { toast("这种文件不能运行"); return; }
    if (!L.ready) { offerInstall(L, run); return; }
    await saveTab(t);
    clearDiags(t); conClear(); lastExit = null; $("#askErrBtn").hidden = true;
    conSys(`▶ 运行 ${esc(t.name)}`);
    setRunning(true, "run"); conState(L.id === "c" || L.id === "cpp" ? "正在编译…" : "正在运行…", "busy");
    try { await call("run", t.file, t.lang); } catch (e) { setRunning(false); conSys(esc(e.message), "bad"); }
  }
  window.cc.on("run", (m) => {
    const t = tabs[cur];
    if (m.type === "phase") { conState(m.phase === "compile" ? "正在编译…" : "正在运行… 要输入就在下面打字", "busy"); setStdin(m.phase === "run" && runKind === "run"); }
    else if (m.type === "out") conAppend(m.text, m.stream === "stderr" ? "e" : m.stream === "compile" ? "c" : "o");
    else if (m.type === "diags") { if (t) showDiags(t, m.diags); }
    else if (m.type === "exit") {
      setRunning(false); lastExit = m;
      const hasDiag = t && t.diags && t.diags.some((d) => d.severity === "error");
      if (m.needInstall) { conState("还没装", "bad"); const L = LANG(m.lang); if (L) offerInstall(L, run); return; }
      if (m.error) { conSys(esc(m.error), "bad"); conState("没运行", "bad"); return; }
      if (m.stopped) { conSys("■ 已停止", ""); conState("已停止"); return; }
      if (m.compileFailed) { const h = firstErrHint(t); conSys(`✗ 编译没通过${h ? "：" + esc(h) + (t && t.diags.some((x) => x.fix) ? "（代码里点「帮我改好」就行）" : "") : hasDiag ? "：代码里标红的地方就是问题" : ""}`, "bad"); conState("编译出错", "bad"); $("#askErrBtn").hidden = false; return; }
      if (m.tooMuch) conSys("程序输出太多了，已经停掉（是不是写了死循环？）", "bad");
      const ok = m.code === 0 && !hasDiag;
      conSys(`${ok ? "✓" : "✗"} 程序结束${m.code != null ? `（返回值 ${m.code}）` : ""} · 用时 ${(m.ms / 1000).toFixed(2)} 秒`, ok ? "ok" : "bad");
      conState(ok ? "运行完了" : "程序出错了", ok ? "ok" : "bad");
      $("#askErrBtn").hidden = ok;
    }
  });
  $("#conIn").addEventListener("submit", async (e) => { e.preventDefault(); if (!running || $("#stdin").disabled) return; const v = $("#stdin").value; $("#stdin").value = ""; const echo = document.createElement("span"); echo.className = "in"; echo.textContent = v + "\n"; out.appendChild(echo); out.scrollTop = out.scrollHeight;
    const ok = await call("input", v + "\n").catch(() => false); if (!ok) { echo.remove(); $("#stdin").value = v; toast("程序还没开始运行，等一下再输入"); } });
  $("#stdin").addEventListener("keydown", (e) => { if (e.ctrlKey && (e.key === "d" || e.key === "z")) { e.preventDefault(); call("endInput"); conSys("（输入完了）"); } });
  $("#eofBtn").onclick = () => { call("endInput"); conSys("（输入完了）"); };
  $("#runBtn").onclick = run;
  $("#stopBtn").onclick = () => call("stop");
  $("#clearBtn").onclick = conClear;
  $("#askErrBtn").onclick = () => ask("error");

  // 报错：行标红、行号旁边一个点、下面一条中文提示
  function clearDiags(t) {
    for (const m of t.marks || []) { try { if (m.clear) m.clear(); else if (m.line != null) { t.doc.removeLineClass(m.line, "background", m.cls); } } catch (e) {} }
    t.marks = []; t.diags = [];
    if (tabs[cur] === t) cm.clearGutter("gut-diag");
  }
  // 「帮我改好」：按编译器给的改法改这一处，标红清掉，提醒再运行一次
  function applyFix(t, fx) {
    if (!fx || tabs[cur] !== t) return;
    const from = { line: fx.line - 1, ch: fx.ch }, to = { line: fx.endLine - 1, ch: fx.endCh };
    clearDiags(t);
    t.doc.replaceRange(fx.text, from, to, "+fix");
    cm.focus(); cm.setCursor({ line: from.line, ch: from.ch + fx.text.length });
    toast("改好了，按 F5 再运行一次看看 👍");
  }
  // 第一处错误的一句话说明（输出区里也写上，不用去找标红的地方）
  const firstErrHint = (t) => { const d = (t && t.diags || []).find((x) => x.severity !== "warning" && (x.hint || x.message)); return d ? (d.hint || d.message) : ""; };
  function showDiags(t, diags) {
    clearDiags(t);
    t.diags = diags || [];
    if (tabs[cur] !== t) return;
    const seen = new Set();
    for (const d of t.diags) {
      if (!d.line || d.line > t.doc.lineCount()) continue;
      const ln = d.line - 1, warn = d.severity === "warning", cls = warn ? "line-warn" : "line-err";
      t.doc.addLineClass(ln, "background", cls); t.marks.push({ line: ln, cls });
      const dot = document.createElement("span"); dot.className = "gut-dot" + (warn ? " warn" : ""); dot.title = d.message + (d.hint ? "\n" + d.hint : "");
      cm.setGutterMarker(ln, "gut-diag", dot);
      if (seen.has(ln) || (warn && t.diags.some((x) => x.line === d.line && x.severity !== "warning"))) continue;
      seen.add(ln);
      // 知道怎么改（少了分号、少了冒号、cout 要写成 std::cout）：在代码里把要加的东西虚着画出来，再给一个「帮我改好」
      const fx = !warn && d.fix && d.fix.line <= t.doc.lineCount() ? d.fix : null;
      if (fx) {
        const from = { line: fx.line - 1, ch: fx.ch }, to = { line: fx.endLine - 1, ch: fx.endCh };
        if (fx.ch === fx.endCh && fx.line === fx.endLine) {
          const ghost = document.createElement("span"); ghost.className = "fix-ghost"; ghost.textContent = fx.text; ghost.title = "这里要加上「" + fx.text + "」";
          t.marks.push(t.doc.setBookmark(from, { widget: ghost, insertLeft: true }));
        } else t.marks.push(t.doc.markText(from, to, { className: "fix-old", title: "改成「" + fx.text + "」" }));
      }
      const w = document.createElement("div"); w.className = "diag-widget" + (warn ? " warn" : "") + (fx ? " has-fix" : "");
      w.innerHTML = `<span class="dw-t">${d.hint ? esc(d.hint) : warn ? "提醒" : "这一行有问题"}</span>${fx ? '<button type="button" class="fix-btn" data-fix>✔ 帮我改好</button>' : ""}${warn ? "" : '<button type="button" data-ask>问捞捞</button>'}<small>${esc(d.message)}${d.reported && d.reported !== d.line ? `（编译器报在第 ${d.reported} 行，其实是这一行的问题）` : ""}</small>`;
      const b = w.querySelector("[data-ask]"); if (b) b.onclick = () => ask("error");
      const fb = w.querySelector("[data-fix]"); if (fb) fb.onclick = () => applyFix(t, fx);
      t.marks.push(cm.addLineWidget(ln, w, { coverGutter: false, noHScroll: true }));
    }
    const first = t.diags.find((d) => d.line && d.severity !== "warning");
    if (first) cm.scrollIntoView({ line: first.line - 1, ch: 0 }, 120);
    const noLine = t.diags.filter((d) => !d.line);
    for (const d of noLine) conSys(`⚠ ${esc(d.hint || d.message)}`, "bad");
  }

  // ================= 安装语言 =================
  function offerInstall(L, then) {
    if (!L.installable) { dialog(`<h3>${esc(L.name)} 不能用</h3><p>这个版本里没找到 ${esc(L.name)} 的编译器，重新安装捞捞编程试试。</p><div class="acts"><button class="btn pri" value="ok">知道了</button></div>`); return; }
    dialog(`<h3>先装好 ${esc(L.toolName)}</h3><p>第一次用 ${esc(L.name)} 要先下载安装（${esc(L.size)}），装在捞捞编程自己的文件夹里，不改电脑的其它设置。优先用国内镜像，一般一两分钟。</p>
      <div class="acts"><button class="btn" value="cancel">先不装</button><button class="btn pri" id="instOk" value="default">现在安装</button></div>`, (body) => {
      $("#instOk", body).addEventListener("click", (e) => { e.preventDefault(); closeDlg(); install(L, then); });
    });
  }
  async function install(L, then) {
    conClear(); conSys(`⬇ 正在安装 ${esc(L.toolName)}…（可以接着写代码）`); conState("正在安装…", "busy");
    const bar = document.createElement("span"); bar.className = "sys"; out.appendChild(bar);
    const on = (p) => {
      if (p.tool !== L.tool) return;
      if (p.phase === "download") bar.textContent = `下载中 ${(p.got / 1048576).toFixed(1)} MB${p.total ? " / " + (p.total / 1048576).toFixed(1) + " MB（" + Math.floor((p.got / p.total) * 100) + "%）" : ""} · 来自 ${p.source}`;
      if (p.phase === "extract") bar.textContent = "下载好了，正在解压…";
    };
    install.on = on;
    try {
      S.langs = await call("install", L.tool);
      conSys(`✓ ${esc(L.toolName)} 装好了`, "ok"); conState("装好了", "ok"); paintTop();
      if (!tabs[cur]) paintWelcome();
      if (then) setTimeout(then, 300);
    } catch (e) { conSys("✗ " + esc(e.message), "bad"); conState("没装上", "bad"); }
  }
  window.cc.on("install", (p) => { if (install.on) install.on(p); });

  // ================= 练习 =================
  function paintExList() {
    const p = S.progress || {}, done = (id) => p.ex && p.ex[id] && p.ex[id].done, tried = (id) => p.ex && p.ex[id] && !p.ex[id].done;
    const n = S.exercises.filter((e) => done(e.id)).length;
    $("#exCount").textContent = `${n}/${S.exercises.length}`;
    $("#exStat").innerHTML = `做对了 <b>${n}</b> / ${S.exercises.length} 道${p.streak ? ` · 🔥 连续 ${p.streak} 天` : ""}<div class="ex-bar"><i style="width:${(n / S.exercises.length) * 100}%"></i></div>`;
    const t = tabs[cur], LV = { 1: "第一关 · 输入输出和判断", 2: "第二关 · 循环", 3: "第三关 · 数组和字符串" };
    let html = "", lv = 0;
    for (const e of S.exercises) {
      if (e.level !== lv) { lv = e.level; html += `<div class="ex-lv">${LV[lv] || "第 " + lv + " 关"}</div>`; }
      html += `<button class="ex${done(e.id) ? " done" : tried(e.id) ? " tried" : ""}${t && t.ex === e.id ? " on" : ""}" data-ex="${e.id}"><span class="st">✓</span><span class="t"><b>${esc(e.title)}</b><small>${esc(e.topic)}</small></span></button>`;
    }
    $("#exList").innerHTML = html;
  }
  $("#exList").addEventListener("click", (e) => { const b = e.target.closest("[data-ex]"); if (b) openExercise(b.dataset.ex); });
  function openExercise(id) {
    const ex = S.exercises.find((e) => e.id === id); if (!ex) return;
    const open = tabs.find((t) => t.ex === id); if (open) { switchTab(tabs.indexOf(open)); return; }
    let pick = LS.get("exLang", LS.get("lastLang", "c"));
    dialog(`<h3>${esc(ex.title)}</h3><p>用哪种语言做这道题？</p><div class="lang-pick">${S.langs.map((l) => `<button type="button" data-l="${l.id}" class="${l.id === pick ? "on" : ""}">${esc(l.name)}<small>${l.ready ? "能直接用" : "要先安装"}</small></button>`).join("")}</div><div class="acts"><button class="btn" value="cancel">取消</button><button class="btn pri" id="exGo" value="default">开始</button></div>`, (body) => {
      $(".lang-pick", body).addEventListener("click", (e) => { const b = e.target.closest("[data-l]"); if (b) { pick = b.dataset.l; $$(".lang-pick button", body).forEach((x) => x.classList.toggle("on", x === b)); } });
      $("#exGo", body).addEventListener("click", async (e) => {
        e.preventDefault(); LS.set("exLang", pick); closeDlg();
        const f = await call("exOpen", id, pick); await refreshFiles(); const t = await openFile(f);
        if (t) { const n = t.doc.lineCount(); for (let i = 0; i < n; i++) if (/在这里写代码/.test(t.doc.getLine(i))) { cm.setCursor(i + 1, 4); break; } }
      });
    });
  }
  function paintExBar() {
    const t = tabs[cur], ex = t && t.ex && S.exercises.find((e) => e.id === t.ex);
    $("#exBar").hidden = !ex; if (!ex) return;
    const done = S.progress.ex && S.progress.ex[ex.id] && S.progress.ex[ex.id].done;
    $("#exTitle").textContent = ex.title + (done ? "  ✓ 已做对" : "");
    $("#exDesc").textContent = ex.desc;
    $("#exBar").classList.toggle("fold", !!LS.get("exFold", false));
    $("#exToggle").textContent = LS.get("exFold", false) ? "看题目" : "收起题目";
  }
  $("#exToggle").onclick = () => { LS.set("exFold", !LS.get("exFold", false)); paintExBar(); cm.refresh(); };
  async function checkEx() {
    const t = tabs[cur]; if (!t || !t.ex || running) return;
    const L = LANG(t.lang); if (!L.ready) { offerInstall(L, checkEx); return; }
    await saveTab(t); clearDiags(t); conClear(); $("#askErrBtn").hidden = true;
    conSys("✓ 正在检查：用几组输入跑你的程序，看输出对不对…"); setRunning(true, "check"); conState("检查中…", "busy");
    let r; try { r = await call("exCheck", t.ex, t.file, t.lang); } catch (e) { r = { error: e.message }; }
    setRunning(false);
    if (r.needInstall) { offerInstall(L, checkEx); return; }
    if (r.error) { conSys(esc(r.error), "bad"); conState("没检查", "bad"); return; }
    S.progress = r.progress || S.progress; paintExList(); paintExBar(); paintStatus();
    if (r.compileFailed) { showDiags(t, r.diags || []); conAppend(r.stderr || "", "c"); conSys("✗ 编译没通过：" + esc(firstErrHint(t) || "先把标红的地方改好"), "bad"); conState("编译出错", "bad"); $("#askErrBtn").hidden = false; return; }
    const ex = S.exercises.find((e) => e.id === t.ex);
    if (r.pass) {
      conSys(`<span class="res pass"><b>🎉 全部 ${ex.tests} 组测试都对了！</b>${r.first ? "<br>又攻下一道题。" + nextTip(ex) : "<br>这道题之前就做对了，再写一遍记得更牢。"}</span>`);
      conState("通过", "ok"); if (r.first) confetti();
    } else {
      const f = r.results[r.results.length - 1];
      const why = f.timedOut ? "程序跑太久了（超过 6 秒），是不是死循环了，或者在等输入？" : f.code && f.code !== 0 ? "程序出错退出了（看下面的报错）" : "输出和答案不一样";
      conSys(`<span class="res"><b>✗ 第 ${f.i + 1} 组测试没过：${esc(why)}</b><table><tr><td>输入</td><td>${esc(f.input || "（没有输入）")}</td></tr><tr><td>应该输出</td><td>${esc(f.expected)}</td></tr><tr><td>你的输出</td><td>${esc(f.got || "（什么都没输出）")}</td></tr></table></span>`);
      if (f.stderr) conAppend(f.stderr, "e");
      if (f.diags && f.diags.length) showDiags(t, f.diags);
      conState(`第 ${f.i + 1} 组没过`, "bad"); $("#askErrBtn").hidden = false;
    }
  }
  function nextTip(ex) {
    const i = S.exercises.indexOf(ex), nx = S.exercises.slice(i + 1).find((e) => !(S.progress.ex && S.progress.ex[e.id] && S.progress.ex[e.id].done));
    return nx ? ` 下一道：<b>${esc(nx.title)}</b>（左边「练习」里点开）` : " 全部题目都做完了，太强了！";
  }
  $("#checkBtn").onclick = checkEx;
  function confetti() { if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; const C = ["#2f5fd0", "#1f8a5b", "#e0683a", "#ffd23f", "#ff9db5"]; for (let i = 0; i < 60; i++) { const d = document.createElement("i"); d.className = "confetti"; d.style.left = Math.random() * 100 + "vw"; d.style.background = C[i % C.length]; d.style.animationDelay = Math.random() * .5 + "s"; d.style.animationDuration = 1.2 + Math.random() * 1.2 + "s"; document.body.appendChild(d); setTimeout(() => d.remove(), 3000); } }

  // ================= 问捞捞 =================
  function paintAiState() {
    const a = S.ai || {}, st = $("#aiSt");
    $("#aiModel").textContent = a.state === "ready" ? "本地 · " + S.model : "";
    const mb = (n) => (n / 1048576).toFixed(0) + " MB";
    if (a.state === "starting") st.innerHTML = `⏳ ${esc(a.msg)}`;
    else if (a.state === "need-model") st.innerHTML = `${esc(a.msg)}<br><button class="btn sm pri" id="aiDl">下载本地模型（约 1 GB）</button>`;
    else if (a.state === "downloading") st.innerHTML = `⬇ ${esc(a.msg)} ${a.total ? mb(a.got) + " / " + mb(a.total) : mb(a.got || 0)}<div class="bar"><i style="width:${a.total ? (a.got / a.total) * 100 : 3}%"></i></div>`;
    else if (a.state === "error" || a.state === "missing") st.innerHTML = `⚠ ${esc(a.msg)}${a.state === "error" ? '<br><button class="btn sm" id="aiRetry">再试一次</button>' : ""}`;
    else st.innerHTML = "";
    const dl = $("#aiDl"); if (dl) dl.onclick = () => call("aiDownload").catch((e) => toast(e.message));
    const rt = $("#aiRetry"); if (rt) rt.onclick = () => call("aiStart").catch(() => {});
  }
  window.cc.on("ai-state", (a) => { S.ai = a; paintAiState(); });
  function paintChat() {
    const box = $("#aiMsgs");
    if (!chat.length) { box.innerHTML = `<div class="ai-empty"><span class="fish">🐟</span>卡住了就问我。<br>运行出错时点「哪里错了」，<br>想自己写出来就点「给我提示」。<br><small>选中一段代码再问，我只看那一段。</small></div>`; return; }
    box.innerHTML = chat.map((m, i) => m.role === "user"
      ? `<div class="msg me">${m.label ? `<small>${esc(m.label)}</small>` : ""}${esc(m.show || m.content)}</div>`
      : `<div class="msg bot${m.error ? " err" : ""}" data-i="${i}">${m.error ? esc(m.error) : MD.render(m.content)}${m.pending ? '<span class="typing"></span>' : ""}</div>`).join("");
    box.scrollTop = box.scrollHeight;
  }
  $("#aiMsgs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy]"); if (!b) return;
    const code = b.closest(".md-code").querySelector("code").textContent;
    navigator.clipboard.writeText(code).then(() => { b.textContent = "已复制"; setTimeout(() => (b.textContent = "复制"), 1500); });
  });
  const ASK_LABEL = { error: "❓ 哪里错了", hint: "💡 给我提示", explain: "📖 讲讲这段代码", review: "✨ 帮我看看" };
  async function ask(mode, question) {
    if (asking) return;
    if ($("#main").classList.contains("no-ai")) toggleAi(true);
    const t = tabs[cur], L = t && LANG(t.lang);
    if (!t && !question) { toast("先打开一个代码文件，或者直接在下面打字问"); return; }
    const ex = t && t.ex && S.exercises.find((e) => e.id === t.ex);
    const sel = t && cm.somethingSelected() ? cm.getSelection() : "";
    const ctx = t ? { lang: L ? L.name : "", file: t.name, fileFull: t.file, code: sel ? "" : t.doc.getValue(), selection: sel, diags: t.diags || [], output: out.textContent.slice(-3000), exercise: ex ? { title: ex.title, desc: ex.desc } : null } : {};
    const history = chat.filter((m) => !m.error && !m.pending).map((m) => ({ role: m.role, content: m.content }));
    const show = question || (sel ? "（关于选中的这段代码）" : "");
    chat.push({ role: "user", content: question || ASK_LABEL[mode] || "", show: show || ASK_LABEL[mode], label: question ? "" : "" });
    const bot = { role: "assistant", content: "", pending: true }; chat.push(bot); paintChat();
    const id = "q" + Date.now(); asking = { id, bot };
    $("#aiStop").hidden = false; $("#aiSend").disabled = true; $$("#aiQuick button").forEach((b) => (b.disabled = true));
    try { await call("ask", { mode: question ? "free" : mode, ctx, question: question || "", history, id }); }
    catch (e) { if (!bot.content) { bot.error = e.message; } }
    bot.pending = false; asking = null; paintChat();
    $("#aiStop").hidden = true; $("#aiSend").disabled = false; $$("#aiQuick button").forEach((b) => (b.disabled = false));
  }
  window.cc.on("ai", (m) => {
    if (!asking || m.id !== asking.id) return;
    if (m.error) asking.bot.error = m.error; else if (m.text != null) asking.bot.content = m.text;
    const el = $(`#aiMsgs .msg.bot[data-i="${chat.indexOf(asking.bot)}"]`);
    if (el) { el.innerHTML = MD.render(asking.bot.content) + (m.done ? "" : '<span class="typing"></span>'); const box = $("#aiMsgs"); if (box.scrollHeight - box.scrollTop - box.clientHeight < 120) box.scrollTop = box.scrollHeight; }
  });
  $("#aiQuick").addEventListener("click", (e) => { const b = e.target.closest("[data-ask]"); if (b) ask(b.dataset.ask); });
  $("#aiForm").addEventListener("submit", (e) => { e.preventDefault(); const q = $("#aiInput").value.trim(); if (!q) return; $("#aiInput").value = ""; ask("free", q); });
  $("#aiInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#aiForm").requestSubmit(); } });
  $("#aiInput").addEventListener("focus", () => { if (S.ai.state === "off") call("aiStart").catch(() => {}); }, { once: true });
  $("#aiStop").onclick = () => call("aiStop");
  $("#aiNew").onclick = () => { if (asking) call("aiStop"); chat = []; paintChat(); };
  function toggleAi(on) {
    const want = on != null ? on : $("#main").classList.contains("no-ai");
    $("#main").classList.toggle("no-ai", !want); call("setSettings", { aiOpen: want }).catch(() => {});
    $("#aiToggle").classList.toggle("on", want);
    setTimeout(() => cm.refresh(), 0);
    if (want) setTimeout(() => $("#aiInput").focus(), 50);
  }
  $("#aiToggle").onclick = () => toggleAi();
  $("#aiClose").onclick = () => toggleAi(false);

  // ================= 账号 =================
  function paintMe() {
    const me = S.me;
    $("#meChip").innerHTML = me ? `<span class="av">${esc([...(me.display_name || me.account || "我")].slice(-1)[0])}</span><span>${esc(me.display_name || me.account || "已登录")}</span>` : `<span class="av">?</span><span>登录</span>`;
    $("#meChip").title = me ? "捞捞账号：" + (me.account || "") : "登录捞捞账号（和捞捞课程表同一个），练习进度跟着账号走";
  }
  $("#meChip").onclick = () => {
    if (S.me) return dialog(`<h3>${esc(S.me.display_name || S.me.account || "我的账号")}</h3><p>账号：${esc(S.me.account || "")}<br>练习进度、连续写代码天数会同步到账号，换电脑也接得上。和捞捞课程表、捞捞学习是同一个账号。</p><div class="acts"><button class="btn" type="button" id="meSync">↻ 同步进度</button><button class="btn" type="button" id="meOut">退出登录</button><button class="btn pri" value="ok">好</button></div>`, (body) => {
      $("#meSync", body).onclick = async () => { try { const r = await call("syncNow"); S.progress = r.progress; paintExList(); paintStatus(); toast("同步好了"); } catch (e) { toast(e.message); } };
      $("#meOut", body).onclick = async () => { await call("logout"); S.me = null; paintMe(); closeDlg(); toast("已退出登录"); };
    });
    dialog(`<h3>登录捞捞账号</h3><p>和捞捞课程表、捞捞学习是同一个账号。登录后练习进度跟着账号走。没有账号？去 <b>laolaokechengbiao.cn</b> 注册一个。不登录也能用全部功能。</p>
      <label>账号<input id="lgAcc" autocomplete="username" maxlength="20" placeholder="小写字母、数字或下划线"></label><label>密码<input id="lgPw" type="password" autocomplete="current-password"></label>
      <div class="err" id="lgErr"></div><div class="acts"><button class="btn" value="cancel">取消</button><button class="btn pri" id="lgOk" value="default">登录</button></div>`, (body) => {
      $("#lgOk", body).addEventListener("click", async (e) => {
        e.preventDefault(); const b = e.target; b.disabled = true; $("#lgErr", body).textContent = "";
        try { const r = await call("login", $("#lgAcc", body).value, $("#lgPw", body).value); S.me = r.me; S.progress = r.progress; paintMe(); paintExList(); paintStatus(); closeDlg(); toast("登录好了，进度已同步"); }
        catch (err) { $("#lgErr", body).textContent = err.message; b.disabled = false; }
      });
    });
  };
  window.cc.on("me", (me) => { S.me = me; paintMe(); });
  window.cc.on("progress", (p) => { S.progress = p; paintExList(); paintStatus(); });

  // ================= 底栏、主题、字号 =================
  function paintStatus() {
    const p = S.progress || {};
    $("#stStreak").innerHTML = p.streak ? `🔥 连续 <b>${p.streak}</b> 天` : "🔥 今天开始连续打卡";
    $("#stToday").innerHTML = `今天运行 <b>${(p.today && p.today.runs) || 0}</b> 次`;
    $("#stSolved").innerHTML = `练习 <b>${p.solved || 0}</b>/${S.exercises.length}`;
  }
  $("#themeBtn").onclick = async () => { S.settings = await call("setSettings", { theme: S.settings.theme === "dark" ? "light" : "dark" }); applyTheme(); };
  const font = async (d) => { S.settings = await call("setSettings", { fontSize: Math.max(12, Math.min(24, (S.settings.fontSize || 15) + d)) }); applyTheme(); };
  $("#fontMinus").onclick = () => font(-1); $("#fontPlus").onclick = () => font(1);

  // 侧栏：文件 / 练习
  $(".side-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-side]"); if (!b) return; $$(".side-tabs button").forEach((x) => x.classList.toggle("on", x === b)); $("#sideFiles").hidden = b.dataset.side !== "files"; $("#sideEx").hidden = b.dataset.side !== "ex"; LS.set("side", b.dataset.side); });

  // 输出区高度：拖
  (() => {
    const sp = $("#splitter"), con = $("#console"); let y0 = 0, h0 = 0;
    const h = LS.get("conH", 0); if (h) con.style.height = h + "px";
    sp.addEventListener("pointerdown", (e) => { y0 = e.clientY; h0 = con.offsetHeight; sp.setPointerCapture(e.pointerId); });
    sp.addEventListener("pointermove", (e) => { if (!sp.hasPointerCapture(e.pointerId)) return; const v = Math.max(110, Math.min(window.innerHeight - 260, h0 + (y0 - e.clientY))); con.style.height = v + "px"; cm.refresh(); });
    sp.addEventListener("pointerup", () => LS.set("conH", con.offsetHeight));
  })();

  // 快捷键
  document.addEventListener("keydown", (e) => {
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (k === "F5" && !e.shiftKey) { e.preventDefault(); run(); }
    else if (k === "F5" && e.shiftKey) { e.preventDefault(); call("stop"); }
    else if (k === "F6") { e.preventDefault(); checkEx(); }
    else if (ctrl && k.toLowerCase() === "s") { e.preventDefault(); const t = tabs[cur]; if (t) { t.dirty = true; saveTab(t).then((ok) => ok && toast("已保存")); } }
    else if (ctrl && k.toLowerCase() === "n") { e.preventDefault(); newFileDialog(); }
    else if (ctrl && k.toLowerCase() === "o") { e.preventDefault(); $("#openFileBtn").click(); }
    else if (ctrl && k.toLowerCase() === "w") { e.preventDefault(); if (cur >= 0) closeTab(cur); }
    else if (ctrl && k.toLowerCase() === "l") { e.preventDefault(); toggleAi(true); }
    else if (ctrl && (k === "=" || k === "+")) { e.preventDefault(); font(1); }
    else if (ctrl && k === "-") { e.preventDefault(); font(-1); }
    else if (ctrl && k === "Tab" && tabs.length > 1) { e.preventDefault(); switchTab((cur + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length); }
  });

  // 关窗口前把没保存的存了
  window.cc.on("before-close", async () => { try { await saveAll(); } catch (e) {} window.cc.closingOk(); });

  // ================= 启动 =================
  (async function boot() {
    S = await call("state");
    applyTheme(); paintMe(); paintStatus(); paintAiState(); paintChat(); paintFiles(); paintExList();
    if (S.settings.aiOpen === false) toggleAi(false); else $("#aiToggle").classList.add("on");
    if (LS.get("side", "files") === "ex") $('.side-tabs [data-side="ex"]').click();
    switchTab(-1);
    if (S.settings.lastFile) await openFile(S.settings.lastFile, { focus: false }).catch(() => {});
    conState(S.dev ? "开发版：用电脑上装好的编译器" : "还没运行");
    window.LC = { get tabs() { return tabs; }, get S() { return S; }, cm, run, checkEx, ask, openFile, openExercise };   // 测试用
  })().catch((e) => { document.body.innerHTML = `<p style="padding:40px">捞捞编程启动失败：${esc(e.message)}</p>`; });
})();
