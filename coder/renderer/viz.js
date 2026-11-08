// 捞捞编程 · 画出来：把代码的执行过程画成动画（柱子 = 数组里的数，一步一步看它怎么变）
// 两种用法：
//   ① 算法动画：冒泡 / 选择 / 插入 / 快排 / 归并 / 二分，左边柱子动，右边 C 代码跟着高亮正在执行的那一行；
//   ② 我的代码：把你自己写的 C / C++ 跑一遍（不改你的文件），数组每变一次画一帧。
"use strict";
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const A = window.VizAlgos;
  let LC = null;
  const LS = { get(k, d) { try { const v = localStorage.getItem("lc_viz_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem("lc_viz_" + k, JSON.stringify(v)); } catch (e) {} } };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // 当前状态
  const V = { mode: LS.get("mode", "bubble"), data: LS.get("data", null) || A.randomData(8), x: null, steps: [], code: "", k: 0, timer: 0, speed: LS.get("speed", 1), user: null, arr: "" };
  const SPEEDS = [[0.5, "慢"], [1, "正常"], [2, "快"], [4, "很快"]];

  function el() {
    let root = $("#viz"); if (root) return root;
    root = document.createElement("div"); root.id = "viz"; root.className = "viz"; root.hidden = true;
    root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "画出来");
    root.innerHTML = `
      <div class="viz-head">
        <b class="viz-title">🎬 画出来</b>
        <div class="viz-modes" id="vzModes" role="tablist">${A.ALGOS.map((a) => `<button data-m="${a.id}">${esc(a.name)}</button>`).join("")}<span class="viz-sep"></span><button data-m="user">我的代码</button></div>
        <span class="grow"></span>
        <button class="ic-btn" id="vzClose" title="关掉（Esc）" aria-label="关掉">✕</button>
      </div>
      <div class="viz-body">
        <section class="viz-stage">
          <div class="viz-desc" id="vzDesc"></div>
          <div class="viz-canvas"><div class="viz-bars" id="vzBars"></div><div class="viz-tmp" id="vzTmp" hidden></div></div>
          <div class="viz-note" id="vzNote" aria-live="polite"></div>
          <div class="viz-ctrl">
            <button class="ic-btn" data-c="first" title="回到开头（Home）" aria-label="回到开头"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3 3h2v10H3zM13 3v10L6 8z"/></svg></button>
            <button class="ic-btn" data-c="prev" title="上一步（←）" aria-label="上一步"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M11 3v10L4 8z"/></svg></button>
            <button class="btn sm pri viz-play" data-c="play" title="播放 / 暂停（空格）">▶ 播放</button>
            <button class="ic-btn" data-c="next" title="下一步（→）" aria-label="下一步"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M5 3v10l7-5z"/></svg></button>
            <button class="ic-btn" data-c="last" title="跳到最后（End）" aria-label="跳到最后"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M11 3h2v10h-2zM3 3v10l7-5z"/></svg></button>
            <input type="range" id="vzSlider" min="0" max="0" value="0" aria-label="第几步">
            <span class="viz-step" id="vzStep"></span>
            <select id="vzSpeed" title="速度">${SPEEDS.map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}</select>
          </div>
          <div class="viz-data" id="vzData"></div>
          <div class="viz-legend" id="vzLegend"></div>
        </section>
        <aside class="viz-side">
          <div class="viz-code-h"><b id="vzCodeH">C 代码</b><span class="grow"></span><button class="btn sm ghost" id="vzOpen" title="把这段代码存成文件，自己改改再跑">📄 打开这段代码</button></div>
          <pre class="viz-code" id="vzCode"></pre>
          <div class="viz-vars" id="vzVars"></div>
        </aside>
      </div>`;
    document.body.appendChild(root);
    $("#vzClose").onclick = close;
    $("#vzModes").onclick = (e) => { const b = e.target.closest("[data-m]"); if (b) setMode(b.dataset.m); };
    root.querySelector(".viz-ctrl").addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return; const c = b.dataset.c; if (c === "play") toggle(); else { pause(); go(c === "first" ? 0 : c === "last" ? V.steps.length - 1 : V.k + (c === "next" ? 1 : -1)); } });
    $("#vzSlider").oninput = (e) => { pause(); go(+e.target.value); };
    $("#vzSpeed").value = String(V.speed);
    $("#vzSpeed").onchange = (e) => { V.speed = +e.target.value; LS.set("speed", V.speed); if (V.timer) { pause(); play(); } };
    $("#vzOpen").onclick = openCode;
    root.addEventListener("keydown", (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.key !== "Escape") return;
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === " ") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); pause(); go(V.k + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); pause(); go(V.k - 1); }
      else if (e.key === "Home") { pause(); go(0); } else if (e.key === "End") { pause(); go(V.steps.length - 1); }
    });
    return root;
  }

  function open(mode) {
    const root = el(); root.hidden = false;
    // 当前打开的是 C / C++ 文件、而且里面有数组 → 默认「我的代码」
    if (mode) setMode(mode); else setMode(V.mode);
    root.tabIndex = -1; root.focus();
  }
  function close() { pause(); const r = $("#viz"); if (r) r.hidden = true; if (LC && LC.cm) LC.cm.focus(); }

  function setMode(m) {
    pause();
    V.mode = m; LS.set("mode", m);
    for (const b of $("#vzModes").children) if (b.dataset) b.classList.toggle("on", b.dataset.m === m);
    if (m === "user") return userMode();
    $("#vzOpen").hidden = false; $("#vzCodeH").textContent = "C 代码";
    const al = A.byId(m);
    $("#vzDesc").innerHTML = `<b>${esc(al.name)}</b><span class="viz-big">${esc(al.big)}</span>${esc(al.desc)}`;
    paintDataForm(al);
    build();
  }

  function paintDataForm(al) {
    const search = al.kind === "search";
    $("#vzData").innerHTML = `<label>数据<input id="vzIn" value="${esc(V.data.join(" "))}" placeholder="用空格隔开，最多 16 个，比如 5 3 8 1"></label>
      ${search ? `<label class="sm">要找<input id="vzX" value="${V.x == null ? "" : V.x}" placeholder="自动" inputmode="numeric"></label>` : ""}
      <button class="btn sm" id="vzApply">用这组数</button><button class="btn sm ghost" id="vzRand">🎲 随机一组</button>
      ${search ? "" : `<button class="btn sm ghost" id="vzWorst" title="倒着排好的，最费劲的情况">倒序</button>`}`;
    const apply = () => {
      const d = A.parseData($("#vzIn").value);
      if (!d.length) { LC && LC.toast("至少输一个数"); return; }
      V.data = d; LS.set("data", d);
      if (search) { const x = $("#vzX").value.trim(); V.x = x === "" ? null : +x; }
      build();
    };
    $("#vzApply").onclick = apply;
    $("#vzIn").onkeydown = (e) => { if (e.key === "Enter") apply(); };
    if (search) $("#vzX").onkeydown = (e) => { if (e.key === "Enter") apply(); };
    $("#vzRand").onclick = () => { V.data = A.randomData(Math.max(5, Math.min(12, V.data.length || 8))); V.x = null; LS.set("data", V.data); paintDataForm(al); build(); };
    if (!search) $("#vzWorst").onclick = () => { V.data = V.data.slice().sort((p, q) => q - p); LS.set("data", V.data); paintDataForm(al); build(); };
  }

  function build() {
    const al = A.byId(V.mode);
    const t = al.trace(V.data, V.x);
    V.steps = t.steps; V.code = t.code; V.k = 0; V.user = null;
    if (al.kind === "search") V.xShown = t.x;
    paintCode(t.code);
    $("#vzSlider").max = String(V.steps.length - 1);
    legend(al.kind === "search" ? [["cmp", "正在看的"], ["found", "找到了"], ["out", "已经排除"]] : V.mode === "quick" ? [["cmp", "在比较"], ["swap", "交换了"], ["pivot", "基准"], ["sorted", "排好了"]] : V.mode === "merge" ? [["cmp", "在比较"], ["swap", "刚合并好的"], ["out", "这次不管"], ["sorted", "排好了"]] : [["cmp", "在比较"], ["swap", "交换了"], ["mark", "正在处理"], ["sorted", "排好了"]]);
    go(0);
  }

  function legend(items) { $("#vzLegend").innerHTML = items.map(([c, n]) => `<span><i class="lg ${c}"></i>${esc(n)}</span>`).join(""); }

  function paintCode(code) {
    $("#vzCode").innerHTML = code.split("\n").map((l, i) => `<div class="ln" data-l="${i + 1}"><span class="no">${i + 1}</span>${esc(l) || " "}</div>`).join("");
  }

  // ---------- 一帧 ----------
  function go(k) {
    if (!V.steps.length) return;
    V.k = Math.max(0, Math.min(V.steps.length - 1, k));
    const s = V.steps[V.k];
    $("#vzSlider").value = String(V.k);
    $("#vzStep").textContent = `第 ${V.k + 1} / ${V.steps.length} 步`;
    if (V.user) paintUserFrame(s); else paintAlgoStep(s);
    // 代码高亮
    const code = $("#vzCode");
    for (const x of code.querySelectorAll(".ln.on")) x.classList.remove("on");
    const ln = code.querySelector(`.ln[data-l="${s.line}"]`);
    if (ln) { ln.classList.add("on"); const top = ln.offsetTop - code.clientHeight / 2 + ln.offsetHeight / 2; code.scrollTo({ top, behavior: V.timer ? "smooth" : "auto" }); }
    if (V.k >= V.steps.length - 1) pause();
  }

  function bars(a, cls, labels, ptr) {
    const lo = Math.min(0, ...a), hi = Math.max(1, ...a), span = hi - lo || 1;
    const box = $("#vzBars");
    // 复用柱子（数量不变时只改高度 → 有过渡动画）
    if (box.children.length !== a.length) box.innerHTML = a.map(() => `<div class="bar"><div class="tk"><span class="v"></span><i></i></div><span class="ix"></span><span class="pt"></span></div>`).join("");
    box.style.setProperty("--n", a.length);
    a.forEach((v, i) => {
      const b = box.children[i];
      b.className = "bar " + (cls[i] || "");
      b.querySelector("i").style.height = Math.max(3, ((v - lo) / span) * 86) + "%";
      b.querySelector(".v").textContent = v;
      b.querySelector(".ix").textContent = labels ? labels[i] : i;
      b.querySelector(".pt").textContent = (ptr && ptr[i]) || "";
    });
  }

  function paintAlgoStep(s) {
    const n = s.a.length, cls = Array(n).fill("");
    const h = s.hi || {};
    const sorted = new Set(s.sorted || []);
    for (let i = 0; i < n; i++) if (sorted.has(i)) cls[i] = "sorted";
    if (h.range) for (let i = 0; i < n; i++) if (i < h.range[0] || i > h.range[1]) cls[i] = (cls[i] === "sorted" && V.mode !== "binary" ? "sorted " : "") + "out";
    for (const i of h.mark || []) cls[i] = "mark";
    if (h.pivot != null) cls[h.pivot] = "pivot";
    for (const i of h.cmp || []) cls[i] = "cmp";
    for (const i of h.swap || []) cls[i] = "swap";
    if (h.found != null) cls[h.found] = "found";
    if (h.split != null) cls[h.split] = (cls[h.split] || "") + " split";
    const ptr = {};
    for (const [k, v] of Object.entries(s.ptr || {})) if (v >= 0 && v < n) ptr[v] = ptr[v] ? ptr[v] + "," + k : k;
    bars(s.a, cls, null, ptr);
    // 归并的临时数组
    const tm = $("#vzTmp");
    if (s.tmp) { tm.hidden = false; tm.innerHTML = `<small>临时数组 tmp</small>${s.tmp.map((v) => `<span>${v}</span>`).join("") || "<em>（空）</em>"}`; } else tm.hidden = true;
    $("#vzNote").innerHTML = esc(s.note || "");
    const vars = Object.entries(s.vars || {}).map(([k, v]) => `<span><code>${esc(k)}</code> = <b>${esc(v)}</b></span>`).join("");
    $("#vzVars").innerHTML = `${vars ? `<div class="vv">${vars}</div>` : ""}<div class="vs"><span>比较 <b>${s.cmp}</b> 次</span><span>${V.mode === "binary" ? "" : `交换 / 移动 <b>${s.swp}</b> 次`}</span>${s.depth != null ? `<span>递归第 <b>${s.depth + 1}</b> 层</span>` : ""}</div>`;
  }

  // ---------- 播放 ----------
  function play() {
    if (!V.steps.length) return;
    if (V.k >= V.steps.length - 1) go(0);
    const ms = Math.max(60, 700 / V.speed);
    V.timer = setInterval(() => go(V.k + 1), ms);
    const b = document.querySelector(".viz-play"); b.textContent = "⏸ 暂停";
  }
  function pause() { if (V.timer) clearInterval(V.timer); V.timer = 0; const b = document.querySelector(".viz-play"); if (b) b.textContent = "▶ 播放"; }
  function toggle() { if (V.timer) pause(); else play(); }

  async function openCode() {
    if (!LC) return;
    const al = A.byId(V.mode); if (!al) return;
    try { await LC.newFile(al.name + ".c", "c", V.code); close(); LC.toast("存好了：改改数据按 F5 运行，或者点「画出来」看你改的版本"); }
    catch (e) { LC.toast(e.message); }
  }

  // ---------- 我的代码 ----------
  function userMode() {
    $("#vzOpen").hidden = true; $("#vzCodeH").textContent = "你的代码";
    legend([["swap", "这一步变了的"], ["cmp", "SHOW2 标出的 i / j"]]);
    const t = LC && LC.cur;
    const okLang = t && /\.(c|cpp|cc|cxx)$/i.test(t.file);
    $("#vzDesc").innerHTML = okLang
      ? `<b>${esc(t.name)}</b>把你的程序跑一遍，数组每变一次画一帧。你的文件不会被改。`
      : `<b>我的代码</b>先在编辑器里打开一个 C / C++ 文件（里面有 int 数组，比如自己写的排序），再来点这里。`;
    $("#vzData").innerHTML = okLang ? `<label class="grow">程序要的输入<textarea id="vzStdin" rows="2" placeholder="程序里有 scanf 就在这里填，比如：5 3 8 1 9">${esc(LS.get("stdin:" + t.file, ""))}</textarea></label>
      <div class="viz-urun"><button class="btn sm pri" id="vzRun">▶ 跑一遍，画出来</button><label class="chk" title="自动在给数组赋值的地方加 SHOW（复制一份去跑，不改你的文件）"><input type="checkbox" id="vzAuto" ${LS.get("auto", true) ? "checked" : ""}> 自动找数组</label></div>` : "";
    V.steps = []; V.user = { file: okLang ? t.file : "" };
    $("#vzBars").innerHTML = ""; $("#vzTmp").hidden = true; $("#vzSlider").max = "0"; $("#vzStep").textContent = "";
    $("#vzVars").innerHTML = ""; $("#vzNote").innerHTML = okLang ? "点「跑一遍，画出来」" : "";
    paintCode(okLang ? LC.cm.getValue() : "");
    if (!okLang) return;
    $("#vzRun").onclick = runUser;
    $("#vzAuto").onchange = (e) => LS.set("auto", e.target.checked);
  }

  async function runUser() {
    const t = LC.cur; if (!t) return;
    const stdin = $("#vzStdin").value; LS.set("stdin:" + t.file, stdin);
    const btn = $("#vzRun"); btn.disabled = true; btn.textContent = "运行中…";
    $("#vzNote").innerHTML = "编译、运行中…";
    let r;
    try { await LC.saveAll(); r = await LC.call("vizRun", t.file, stdin.endsWith("\n") || !stdin ? stdin : stdin + "\n", $("#vzAuto").checked); }
    catch (e) { r = { error: e.message }; }
    btn.disabled = false; btn.textContent = "▶ 跑一遍，画出来";
    paintCode(LC.cm.getValue());
    if (r.error) { $("#vzNote").innerHTML = `<span class="bad">${esc(r.error)}</span>`; return; }
    if (r.compileFailed) {
      const d = (r.diags || [])[0];
      $("#vzNote").innerHTML = `<span class="bad">编译没通过${d ? `：第 ${d.line} 行 ${esc(d.hint || d.message)}` : ""}</span>　先在编辑器里改好（按 F5 能看到完整报错）`;
      if (d) { const ln = $(`#vzCode .ln[data-l="${d.line}"]`); if (ln) { ln.classList.add("err"); ln.scrollIntoView({ block: "center" }); } }
      return;
    }
    const names = [...new Set(r.frames.map((f) => f.name))];
    if (!r.frames.length) {
      $("#vzNote").innerHTML = r.noArray
        ? `没找到给数组赋值的地方。可以自己在想看的地方加一句 <code>SHOW(a, n);</code>（a 是数组名，n 是个数），或者 <code>SHOW2(a, n, i, j);</code> 顺便标出 i 和 j。`
        : `程序跑完了，但数组一次都没变${r.timedOut ? "（程序跑了 8 秒还没完，是不是在等输入？上面填好输入再试）" : ""}。`;
      out(r); return;
    }
    V.arr = names.includes(V.arr) ? V.arr : names[0];
    V.user = { file: t.file, frames: r.frames, names, r };
    pickArr(V.arr);
    const tip = [r.timedOut ? "程序跑太久，停在第 8 秒" : "", r.tooMuch ? "输出太多，后面的没画" : "", r.frames.length >= 3000 ? "最多画 3000 帧" : ""].filter(Boolean).join("；");
    if (tip) LC.toast(tip);
    play();
  }

  function pickArr(name) {
    const u = V.user; V.arr = name;
    V.steps = u.frames.filter((f) => f.name === name);
    $("#vzSlider").max = String(V.steps.length - 1);
    // 多个数组：可以切换
    const sw = u.names.length > 1 ? `<span class="viz-arrs">看哪个数组：${u.names.map((n) => `<button class="btn sm ${n === name ? "pri" : ""}" data-arr="${esc(n)}">${esc(n)}</button>`).join("")}</span>` : "";
    let box = $("#vzArrs"); if (!box) { box = document.createElement("div"); box.id = "vzArrs"; $("#vzData").appendChild(box); }
    box.innerHTML = sw; box.onclick = (e) => { const b = e.target.closest("[data-arr]"); if (b) { pause(); pickArr(b.dataset.arr); } };
    out(u.r);
    go(0);
  }
  function out(r) {
    const o = String(r.output || "").trim();
    const prev = $("#vzOut"); if (prev) prev.remove();
    if (!o && !r.stderr) return;
    const d = document.createElement("details"); d.id = "vzOut"; d.className = "viz-out";
    d.innerHTML = `<summary>程序的输出</summary><pre>${esc(o.slice(-3000))}${r.stderr ? `\n<span class="bad">${esc(String(r.stderr).slice(-1500))}</span>` : ""}</pre>`;
    $("#vzData").appendChild(d);
  }

  function paintUserFrame(f) {
    const prev = V.steps[V.k - 1];
    const cls = f.a.map((v, i) => (prev && prev.a.length === f.a.length && prev.a[i] !== v ? "swap" : ""));
    const ptr = {};
    if (f.i >= 0 && f.i < f.a.length) { cls[f.i] = cls[f.i] || "cmp"; ptr[f.i] = "i"; }
    if (f.j >= 0 && f.j < f.a.length) { cls[f.j] = cls[f.j] || "cmp"; ptr[f.j] = ptr[f.j] ? ptr[f.j] + ",j" : "j"; }
    if (V.k === V.steps.length - 1) for (let i = 0; i < cls.length; i++) if (!cls[i]) cls[i] = "done";
    bars(f.a, cls, null, ptr);
    const ch = prev ? f.a.map((v, i) => (prev.a[i] !== v ? i : -1)).filter((i) => i >= 0) : [];
    const lineTxt = (LC.cm.getLine(f.line - 1) || "").trim();
    $("#vzNote").innerHTML = (V.k === 0 ? "一开始：" : ch.length === 2 ? `a[${ch[0]}] 和 a[${ch[1]}] 换了位置：` : ch.length ? `${ch.map((i) => `${esc(f.name)}[${i}] 变成 ${f.a[i]}`).slice(0, 3).join("，")}${ch.length > 3 ? " …" : ""}：` : "")
      + `第 ${f.line} 行 <code>${esc(lineTxt.slice(0, 80))}</code>`;
    const changes = V.steps.slice(0, V.k + 1).reduce((m, x, i, arr) => m + (i && arr[i - 1].a.some((v, j) => v !== x.a[j]) ? 1 : 0), 0);
    $("#vzVars").innerHTML = `<div class="vs"><span>数组 <b>${esc(f.name)}</b>，${f.a.length} 个数</span><span>到这一步变了 <b>${changes}</b> 次</span></div>`;
  }

  // ---------- 接到主界面 ----------
  function hook() {
    LC = window.LC;
    const btn = document.getElementById("vizBtn");
    if (btn) btn.onclick = () => open();
    document.addEventListener("keydown", (e) => { if (e.key === "F7") { e.preventDefault(); const r = $("#viz"); if (r && !r.hidden) close(); else open(); } });
  }
  if (window.LC) hook(); else document.addEventListener("lc-ready", hook, { once: true });
  window.LaolaoViz = { open, close, get state() { return V; } };
})();
