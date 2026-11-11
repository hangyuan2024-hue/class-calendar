// 捞捞编程 · 画出来
//   悬浮小窗：在编辑器右下角，边打字边画 —— 你停手 1 秒多，就把代码一行行走一遍，把最重要的那个数组 / 链表 / 变量画成动画；
//             点小窗（或右上角放大）进入大画面，停在同一步。
//   大画面：所有变量（每一层函数调用一张卡片）、正在执行的代码行、输出、一句话说明这一步发生了什么；还有六种经典算法的演示。
"use strict";
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const A = window.VizAlgos, B = window.VizBoard, I = window.ICON, SND = window.LaoSfx;
  const STAGE = window.LaoStage && window.LaoStage.webgl() ? window.LaoStage : null;   // 3D 舞台（没有 WebGL 就用平面柱子）
  const sndIcon = () => I(SND && SND.muted ? "mute" : "sound", 15);
  const plain = (h) => String(h || "").replace(/<br>/g, " ").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const ascending = (a) => a.every((x, i) => i === 0 || a[i - 1] <= x), descending = (a) => a.every((x, i) => i === 0 || a[i - 1] >= x);
  // 算法演示的一步 → 舞台要的样子
  function algoState(s, k, n, kind) {
    const h = s.hi || {}, marks = {};
    for (const [nm, v] of Object.entries(s.ptr || {})) if (v >= 0 && v < s.a.length) (marks[v] ||= []).push(nm);
    const swap = h.swap && h.swap.length === 2 && !s.tmp ? h.swap : [];
    return { a: s.a, cmp: h.cmp || [], swap, sorted: s.sorted || [], pivot: h.pivot, range: h.range, found: h.found, mark: h.mark, marks, note: s.note, done: kind !== "search" && k === n - 1 };
  }
  let LC = null;
  const LS = { get(k, d) { try { const v = localStorage.getItem("lc_viz_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem("lc_viz_" + k, JSON.stringify(v)); } catch (e) {} } };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TRACEABLE = /\.(c|cpp|cc|cxx|py)$/i;
  const needsInput = (src) => /\b(scanf|getchar|gets|fgets\s*\(\s*\w+\s*,[^)]*stdin|cin\s*>>|input\s*\()/.test(src);

  // 算法演示的状态
  const V = { mode: LS.get("mode", "user"), data: LS.get("data", null) || A.randomData(8), x: null, steps: [], code: "", k: 0, timer: 0, speed: LS.get("speed", 1) };
  // 我的代码（大画面）
  const U = { res: null, steps: [], k: 0, src: "", file: "", lang: "", busy: false };
  // 悬浮小窗
  const CAN_POP = !!(window.cc && window.cc.popOpen);   // 电脑版：可以拖出程序，变成单独的置顶小窗口
  const F = { on: LS.get("float", true), min: LS.get("floatMin", false), popped: false, res: null, steps: [], k: 0, timer: 0, seq: 0, debounce: 0, focus: null, src: "", file: "", status: "", lineH: null };
  const SPEEDS = [[0.5, "慢"], [1, "正常"], [2, "快"], [4, "很快"]];

  // =====================================================================
  //  大画面
  // =====================================================================
  function el() {
    let root = $("#viz"); if (root) return root;
    root = document.createElement("div"); root.id = "viz"; root.className = "viz hud"; root.hidden = true;
    root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "画出来");
    root.innerHTML = `
      <div class="viz-head">
        <span class="viz-title">${I("activity", 18)}<b>画出来</b><small>CODE VISUALIZER</small></span>
        <div class="viz-modes" id="vzModes" role="tablist"><button data-m="user">${I("code", 14)}我的代码</button><span class="viz-sep"></span><small class="viz-grp">算法演示</small>${A.ALGOS.map((a) => `<button data-m="${a.id}">${esc(a.name.replace("排序", "").replace("查找", ""))}</button>`).join("")}</div>
        <span class="grow"></span>
        ${window.LaoSkins && STAGE ? `<button class="btn sm ghost" id="vzSkin" title="皮肤商店：换数据小兵的样子">${I("shirt", 14)}皮肤</button>` : ""}
        ${SND ? `<button class="ic-btn" id="vzSnd" title="音效（M）">${sndIcon()}</button>` : ""}
        <button class="ic-btn" id="vzClose" title="关掉（Esc）" aria-label="关掉">${I("x", 18)}</button>
      </div>
      <div class="viz-body">
        <section class="viz-stage">
          <div class="viz-hud-line"><span class="hud-k">STEP</span><b id="vzStepN">0</b><span class="hud-k">/ <i id="vzStepT">0</i></span><span class="hud-k">LINE</span><b id="vzLineN">-</b><span class="grow"></span><span class="viz-status" id="vzStatus"></span></div>
          <div class="viz-note" id="vzNote" aria-live="polite"></div>
          <div class="viz-userview" id="vzUser"><div class="viz-stage3 user" id="vzUStage" hidden></div><div class="vb" id="vzBoard"></div></div>
          <div class="viz-algoview" id="vzAlgo" hidden>
            <div class="viz-desc" id="vzDesc"></div>
            <div class="viz-canvas${STAGE ? " has3d" : ""}"><div class="viz-stage3" id="vzStage3"></div><div class="viz-bars" id="vzBars"></div><div class="viz-tmp" id="vzTmp" hidden></div></div>
            <div class="viz-legend" id="vzLegend"></div>
          </div>
          <div class="viz-ctrl">
            <button class="ic-btn" data-c="first" title="回到开头（Home）" aria-label="回到开头">${I("first", 15)}</button>
            <button class="ic-btn" data-c="prev" title="上一步（←）" aria-label="上一步">${I("prev", 17)}</button>
            <button class="btn sm pri viz-play" data-c="play" title="播放 / 暂停（空格）"></button>
            <button class="ic-btn" data-c="next" title="下一步（→）" aria-label="下一步">${I("next", 17)}</button>
            <button class="ic-btn" data-c="last" title="跳到最后（End）" aria-label="跳到最后">${I("last", 15)}</button>
            <div class="viz-track"><input type="range" id="vzSlider" min="0" max="0" value="0" aria-label="第几步"><div class="viz-ticks" id="vzTicks"></div></div>
            <select id="vzSpeed" title="速度">${SPEEDS.map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}</select>
          </div>
          <div class="viz-data" id="vzData"></div>
        </section>
        <aside class="viz-side">
          <div class="viz-code-h"><span class="hud-k">SOURCE</span><b id="vzCodeH">代码</b><span class="grow"></span><button class="btn sm ghost" id="vzOpen" title="把这段代码存成文件，自己改改再跑">${I("file-code", 14)}打开这段代码</button></div>
          <pre class="viz-code" id="vzCode"></pre>
          <div class="viz-vars" id="vzVars"></div>
          <div class="viz-outbox"><div class="viz-code-h"><span class="hud-k">OUTPUT</span><b>输出</b></div><pre class="viz-out" id="vzOut"></pre></div>
        </aside>
      </div>`;
    document.body.appendChild(root);
    $("#vzClose").onclick = close;
    if ($("#vzSkin")) $("#vzSkin").onclick = () => window.LaoSkins.show();
    if ($("#vzSnd")) { $("#vzSnd").onclick = () => SND.toggle(); SND.onChange(() => { for (const b of document.querySelectorAll("#vzSnd, #vizFloat [data-f=snd]")) b.innerHTML = sndIcon(); }); }
    $("#vzModes").onclick = (e) => { const b = e.target.closest("[data-m]"); if (b) setMode(b.dataset.m); };
    root.querySelector(".viz-ctrl").addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return; const c = b.dataset.c; if (c === "play") toggle(); else { pause(); go(c === "first" ? 0 : c === "last" ? cur().length - 1 : st().k + (c === "next" ? 1 : -1)); } });
    $("#vzSlider").oninput = (e) => { pause(); go(+e.target.value); };
    $("#vzSpeed").value = String(V.speed);
    $("#vzSpeed").onchange = (e) => { V.speed = +e.target.value; LS.set("speed", V.speed); if (V.timer) { pause(); play(); } };
    $("#vzOpen").onclick = openCode;
    $("#vzCode").onclick = (e) => { const ln = e.target.closest(".ln"); if (!ln || V.mode !== "user") return; jumpToLine(+ln.dataset.l); };
    root.addEventListener("keydown", (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.key !== "Escape") return;
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === " ") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); pause(); go(st().k + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); pause(); go(st().k - 1); }
      else if (e.key === "Home") { pause(); go(0); } else if (e.key === "End") { pause(); go(cur().length - 1); }
      else if ((e.key === "m" || e.key === "M") && SND) SND.toggle();
    });
    playBtn();
    return root;
  }
  const st = () => (V.mode === "user" ? U : V);
  let stA = null, stU = null;   // 算法演示的舞台、我的代码的舞台
  function stageA() { if (!stA && STAGE) stA = STAGE.create($("#vzStage3"), { hello: true }); return stA; }
  function stageU() { if (!stU && STAGE) stU = STAGE.create($("#vzUStage"), {}); return stU; }
  // 这一步是不是紧接着上一步（是：动画过去；不是：直接摆好）
  function stepDur(o) { return V.timer ? Math.max(140, (o.interval || 700) * 0.9) : 650; }
  const cur = () => st().steps;

  function open(mode, k) {
    const root = el(); root.hidden = false;
    setMode(mode || V.mode, k);
    root.tabIndex = -1; root.focus();
  }
  function close() { pause(); const r = $("#viz"); if (r) r.hidden = true; if (LC && LC.cm) LC.cm.focus(); }

  function setMode(m, k) {
    pause();
    if (m !== "user" && !A.byId(m)) m = "user";
    V.mode = m; LS.set("mode", m);
    for (const b of $("#vzModes").querySelectorAll("[data-m]")) b.classList.toggle("on", b.dataset.m === m);
    $("#vzUser").hidden = m !== "user"; $("#vzAlgo").hidden = m === "user";
    $("#vzOpen").hidden = m === "user";
    if (m === "user") return userMode(k);
    $("#vzCodeH").textContent = "C 代码";
    $("#vzVars").hidden = false;
    const al = A.byId(m);
    $("#vzDesc").innerHTML = `<b>${esc(al.name)}</b><span class="viz-big">${esc(al.big)}</span>${esc(al.desc)}`;
    paintDataForm(al);
    build();
  }

  // ---------------- 我的代码 ----------------
  function userMode(k) {
    $("#vzCodeH").textContent = "你的代码";
    $("#vzVars").hidden = true;
    const t = LC && LC.cur;
    const ok = t && TRACEABLE.test(t.file);
    if (!ok) {
      U.steps = []; paintCode("");
      $("#vzBoard").innerHTML = `<div class="viz-empty">${I("code", 28)}<b>先打开一个 C / C++ / Python 文件</b><span>写好代码，这里会一步一步画出所有变量的变化：数组、字符串、结构体、链表、二叉树、递归……<br>也可以先看看上面的算法演示。</span></div>`;
      $("#vzData").innerHTML = ""; $("#vzNote").innerHTML = ""; status(""); hud();
      return;
    }
    $("#vzData").innerHTML = `<label class="grow">程序的输入<textarea id="vzStdin" rows="2" placeholder="程序里有 scanf / cin / input() 就在这里填，比如：5 3 8 1 9">${esc(LS.get("stdin:" + t.file, ""))}</textarea></label>
      <button class="btn sm pri" id="vzRun">${I("play", 14)}重新运行</button>`;
    $("#vzRun").onclick = () => runUser();
    $("#vzStdin").addEventListener("change", (e) => { LS.set("stdin:" + t.file, e.target.value); });
    // 悬浮小窗已经有这份代码的结果：直接用，停在同一步
    const text = LC.cm.getValue();
    if (F.res && F.file === t.file && F.src === text && F.steps.length) { useResult(F.res, F.src, t, k != null ? k : F.k); return; }
    if (U.res && U.file === t.file && U.src === text) { useResult(U.res, U.src, t, k != null ? k : U.k); return; }
    runUser();
  }

  async function runUser() {
    const t = LC.cur; if (!t) return;
    const box = $("#vzStdin"); const stdin = box ? box.value : LS.get("stdin:" + t.file, "");
    LS.set("stdin:" + t.file, stdin);
    const text = LC.cm.getValue();
    U.busy = true; status("run", "正在一步一步运行…");
    const btn = $("#vzRun"); if (btn) btn.disabled = true;
    let r;
    try { r = await LC.call("traceRun", t.file, fixIn(stdin), "main", text); } catch (e) { r = { error: { msg: e.message } }; }
    U.busy = false; if (btn) btn.disabled = false;
    if (!r || r.cancelled) return;
    useResult(r, text, t, 0);
    if (r.steps && r.steps.length) play();
  }
  const fixIn = (s) => (s && !s.endsWith("\n") ? s + "\n" : s || "");

  function useResult(r, src, t, k) {
    U.res = r; U.src = src; U.file = t.file; U.lang = r.lang || t.lang; U.steps = r.steps || []; U.k = 0; U.pk = -5;
    U.focus = B.pickFocus(U.steps);
    // 这个数组在运行过程中变过没有（变过、最后又是有序的 → 结尾庆祝）
    U.changed = false;
    if (U.focus) { let first = null; for (const x of U.steps) { const fa = B.focusArray(x, U.focus); if (!fa) continue; const k = fa.values.join(); if (first == null) first = k; else if (k !== first) { U.changed = true; break; } } }
    paintCode(src);
    $("#vzSlider").max = String(Math.max(0, U.steps.length - 1));
    paintTicks();
    if (r.compileFailed) {
      const d = (r.diags || [])[0];
      status("err", "编译没通过");
      $("#vzNote").innerHTML = `<span class="bad">${d ? `第 ${d.line} 行：${esc(d.hint || d.message)}` : esc((r.stderr || "").split("\n")[0])}</span>`;
      $("#vzBoard").innerHTML = `<pre class="viz-err">${esc((r.stderr || "").slice(0, 2000))}</pre>`;
      if (d) markLine(d.line, "err");
      $("#vzOut").textContent = ""; hud();
      return;
    }
    if (r.unsupported) { status("", ""); $("#vzBoard").innerHTML = `<div class="viz-empty"><b>这种语言还不能画</b><span>现在支持 C、C++、Python。</span></div>`; return; }
    if (r.needInstall || (r.error && !U.steps.length)) { status("err", "没跑起来"); $("#vzBoard").innerHTML = `<div class="viz-empty"><b>${esc((r.error && r.error.msg) || "没跑起来")}</b></div>`; return; }
    if (!U.steps.length) { status("", ""); $("#vzBoard").innerHTML = `<div class="viz-empty"><b>程序一行都没走到</b><span>看看是不是没有 main 函数。</span></div>`; return; }
    const tips = [];
    if (r.trunc) tips.push(`只画了前 ${U.steps.length} 步`);
    if (r.fallback) tips.push("简化模式：只画数组");
    if (needsInput(src) && !($("#vzStdin") || {}).value) tips.push("程序要输入：在下面填好再点「重新运行」");
    status(r.error ? "err" : "ok", r.error ? "程序出错停下了" : tips.join(" · ") || "跑完了");
    go(Math.min(k || 0, U.steps.length - 1));
  }

  // 时间轴上标出：出错的那一步、有输出的步
  function paintTicks() {
    const box = $("#vzTicks"); if (!box) return;
    const S = cur(), n = S.length;
    if (V.mode !== "user" || n < 2) { box.innerHTML = ""; return; }
    let h = "";
    S.forEach((s, i) => { if (s.o || s.err) h += `<i class="${s.err ? "e" : "o"}" style="left:${(i / (n - 1)) * 100}%"></i>`; });
    box.innerHTML = h;
  }

  function hud() {
    const S = cur(), s = S[st().k];
    $("#vzStepN").textContent = S.length ? st().k + 1 : 0;
    $("#vzStepT").textContent = S.length;
    $("#vzLineN").textContent = s ? (s.l != null ? s.l : s.line) : "-";
  }
  function status(kind, txt) { const e = $("#vzStatus"); if (e) { e.className = "viz-status " + (kind || ""); e.textContent = txt || ""; } }

  function paintUserStep() {
    const s = U.steps[U.k], prev = U.steps[U.k - 1];
    const py = U.lang === "python";
    B.render($("#vzBoard"), s, prev, { py, n: U.k });
    let note = B.narrate(s, prev, { py });
    // 重点数组（一维、全是数）：上面用 3D 舞台演
    const fa = U.focus ? B.focusArray(s, U.focus) : null;
    const box = $("#vzUStage");
    if (fa && stageU()) {
      box.hidden = false;
      const last = U.k === U.steps.length - 1, err = s.err || (last && U.res.error);
      const stt = { a: fa.values, marks: fa.marks, note: err ? plain((U.res.error && U.res.error.msg) || s.err) : plain(note) || `第 ${s.l} 行`, error: !!err,
        done: last && !err && U.changed && (ascending(fa.values) || descending(fa.values)) };
      if (U.pk === U.k - 1) stU.step(stt, { dur: stepDur(U) }); else stU.set(stt);
    } else box.hidden = true;
    U.pk = U.k;
    if (s.err) note = `<span class="bad">${esc((U.res.error && U.res.error.msg) || s.err)}</span>`;
    if (U.k === U.steps.length - 1 && U.res.error && !s.err) note = `<span class="bad">${esc(U.res.error.msg)}</span>`;
    const lineTxt = (U.src.split("\n")[s.l - 1] || "").trim();
    $("#vzNote").innerHTML = `${note ? note + "<br>" : ""}<span class="viz-cl"><span class="hud-k">L${s.l}</span><code>${esc(lineTxt.slice(0, 120))}</code></span>`;
    // 到这一步为止的输出
    let out = ""; for (let i = 0; i <= U.k; i++) if (U.steps[i].o) out += U.steps[i].o;
    const o = $("#vzOut"); o.textContent = out.slice(-6000); o.scrollTop = o.scrollHeight;
    markLine(s.l, "on");
  }

  // 点代码的某一行：跳到下一次走到这一行的那一步
  function jumpToLine(l) {
    const S = U.steps; if (!S.length) return;
    for (let d = 1; d <= S.length; d++) { const i = (U.k + d) % S.length; if (S[i].l === l) { pause(); go(i); return; } }
    LC.toast("程序没走到第 " + l + " 行");
  }

  function paintCode(code) {
    $("#vzCode").innerHTML = code.split("\n").map((l, i) => `<div class="ln" data-l="${i + 1}"><span class="no">${i + 1}</span>${esc(l) || " "}</div>`).join("");
  }
  function markLine(l, cls) {
    const code = $("#vzCode");
    for (const x of code.querySelectorAll(".ln.on, .ln.err")) x.classList.remove("on", "err");
    const ln = code.querySelector(`.ln[data-l="${l}"]`);
    if (ln) { ln.classList.add(cls); const top = ln.offsetTop - code.clientHeight / 2 + ln.offsetHeight / 2; code.scrollTo({ top, behavior: V.timer ? "smooth" : "auto" }); }
  }

  // ---------------- 算法演示 ----------------
  function paintDataForm(al) {
    const search = al.kind === "search";
    $("#vzData").innerHTML = `<label>数据<input id="vzIn" value="${esc(V.data.join(" "))}" placeholder="用空格隔开，最多 16 个，比如 5 3 8 1"></label>
      ${search ? `<label class="sm">要找<input id="vzX" value="${V.x == null ? "" : V.x}" placeholder="自动" inputmode="numeric"></label>` : ""}
      <button class="btn sm" id="vzApply">${I("check", 14)}用这组数</button><button class="btn sm ghost" id="vzRand">${I("shuffle", 14)}随机一组</button>
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
    V.steps = t.steps; V.code = t.code; V.k = 0; V.pk = -5;
    paintCode(t.code);
    $("#vzSlider").max = String(V.steps.length - 1);
    paintTicks();
    status("ok", al.big);
    legend(al.kind === "search" ? [["cmp", "正在看的"], ["found", "找到了"], ["out", "已经排除"]] : V.mode === "quick" ? [["cmp", "在比较"], ["swap", "交换了"], ["pivot", "基准"], ["sorted", "排好了"]] : V.mode === "merge" ? [["cmp", "在比较"], ["swap", "刚合并好的"], ["out", "这次不管"], ["sorted", "排好了"]] : [["cmp", "在比较"], ["swap", "交换了"], ["mark", "正在处理"], ["sorted", "排好了"]]);
    go(0);
  }
  function legend(items) { $("#vzLegend").innerHTML = items.map(([c, n]) => `<span><i class="lg ${c}"></i>${esc(n)}</span>`).join(""); }
  function bars(a, cls, ptr) {
    const lo = Math.min(0, ...a), hi = Math.max(1, ...a), span = hi - lo || 1;
    const box = $("#vzBars");
    if (box.children.length !== a.length) box.innerHTML = a.map(() => `<div class="bar"><div class="tk"><span class="v"></span><i></i></div><span class="ix"></span><span class="pt"></span></div>`).join("");
    box.style.setProperty("--n", a.length);
    a.forEach((v, i) => {
      const b = box.children[i];
      b.className = "bar " + (cls[i] || "");
      b.querySelector("i").style.height = Math.max(3, ((v - lo) / span) * 86) + "%";
      b.querySelector(".v").textContent = v;
      b.querySelector(".ix").textContent = i;
      b.querySelector(".pt").textContent = (ptr && ptr[i]) || "";
    });
  }
  function paintAlgoStep(s) {
    const sa = stageA();
    if (sa) {
      $("#vzBars").hidden = true;
      const kind = A.byId(V.mode).kind, stt = algoState(s, V.k, V.steps.length, kind);
      if (V.pk === V.k - 1) sa.step(stt, { dur: stepDur(V) }); else sa.set(stt);
    }
    V.pk = V.k;
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
    bars(s.a, cls, ptr);
    const tm = $("#vzTmp");
    if (s.tmp) { tm.hidden = false; tm.innerHTML = `<small>临时数组 tmp</small>${s.tmp.map((v) => `<span>${v}</span>`).join("") || "<em>（空）</em>"}`; } else tm.hidden = true;
    $("#vzNote").innerHTML = esc(s.note || "");
    const vars = Object.entries(s.vars || {}).map(([k, v]) => `<span><code>${esc(k)}</code> = <b>${esc(v)}</b></span>`).join("");
    $("#vzVars").innerHTML = `${vars ? `<div class="vv">${vars}</div>` : ""}<div class="vs"><span>比较 <b>${s.cmp}</b> 次</span><span>${V.mode === "binary" ? "" : `交换 / 移动 <b>${s.swp}</b> 次`}</span>${s.depth != null ? `<span>递归第 <b>${s.depth + 1}</b> 层</span>` : ""}</div>`;
    // 算法演示的 C 代码里 main 打印最终结果：输出栏显示
    $("#vzOut").textContent = V.k === V.steps.length - 1 ? (s.a ? (A.byId(V.mode).kind === "search" ? "" : s.a.join(" ")) : "") : "";
    markLine(s.line, "on");
  }

  // ---------------- 一步 / 播放 ----------------
  function go(k) {
    const S = cur(); if (!S.length) { hud(); return; }
    const o = st(); o.k = Math.max(0, Math.min(S.length - 1, k));
    $("#vzSlider").value = String(o.k);
    if (V.mode === "user") paintUserStep(); else paintAlgoStep(S[o.k]);
    hud();
    if (o.k >= S.length - 1) pause();
  }
  function playBtn() { const b = document.querySelector(".viz-play"); if (b) b.innerHTML = V.timer ? `${I("pause", 14)}暂停` : `${I("play", 14)}播放`; }
  function play() {
    const S = cur(); if (!S.length) return;
    if (st().k >= S.length - 1) go(0);
    const base = V.mode === "user" ? Math.max(STAGE ? 260 : 70, Math.min(700, (STAGE ? 26000 : 9000) / S.length)) : 900;
    st().interval = Math.max(40, base / V.speed);
    V.timer = setInterval(() => go(st().k + 1), st().interval);
    playBtn();
  }
  function pause() { if (V.timer) clearInterval(V.timer); V.timer = 0; playBtn(); }
  function toggle() { if (V.timer) pause(); else play(); }

  async function openCode() {
    if (!LC) return;
    const al = A.byId(V.mode); if (!al) return;
    try { await LC.newFile(al.name + ".c", "c", V.code); close(); LC.toast("存好了：改改数据，右下角的小窗会跟着画"); }
    catch (e) { LC.toast(e.message); }
  }

  // =====================================================================
  //  悬浮小窗
  // =====================================================================
  function fel() {
    let f = $("#vizFloat"); if (f) return f;
    const wrap = $("#editorWrap"); if (!wrap) return null;
    f = document.createElement("div"); f.id = "vizFloat"; f.className = "vf hud"; f.hidden = true;
    f.innerHTML = `
      <header class="vf-h" title="拖动可以挪位置">
        <span class="vf-dot" id="vfDot"></span><b>实时画面</b><span class="vf-step" id="vfStep"></span><span class="grow"></span>
        <button class="vf-b" data-f="play" title="播放 / 暂停">${I("play", 14)}</button>
        ${SND ? `<button class="vf-b" data-f="snd" title="音效">${sndIcon()}</button>` : ""}
        ${CAN_POP ? `<button class="vf-b" data-f="pop" title="拖出程序：变成单独的小窗口，放在屏幕任何地方（直接把标题栏拖出窗口也行）">${I("external", 14)}</button>` : ""}
        <button class="vf-b" data-f="max" title="放大看全部变量（F7）">${I("maximize", 14)}</button>
        <button class="vf-b" data-f="min" title="收起">${I("minimize", 14)}</button>
      </header>
      <div class="vf-line" id="vfLine"></div>
      <div class="vf-stage viz-stage3" id="vfStage" hidden title="点一下放大"></div>
      <div class="vf-board vb mini" id="vfBoard" title="点一下放大"></div>
      <div class="vf-note" id="vfNote"></div>
      <div class="vf-track" id="vfTrack"><i id="vfBar"></i></div>`;
    wrap.appendChild(f);
    const pill = document.createElement("button");
    pill.id = "vizPill"; pill.className = "vf-pill"; pill.hidden = true; pill.title = "边写边画：打开实时画面";
    pill.innerHTML = `${I("activity", 14)}<span>实时画面</span>`;
    wrap.appendChild(pill);
    pill.onclick = () => { F.min = false; LS.set("floatMin", false); F.on = true; LS.set("float", true); paintFloatShell(); schedule(0); };
    f.addEventListener("click", (e) => {
      const b = e.target.closest("[data-f]");
      if (b) { e.stopPropagation(); const a = b.dataset.f; if (a === "play") { F.userPlay = true; fToggle(); } else if (a === "snd") SND.toggle(); else if (a === "pop") popOut(); else if (a === "max") open("user", F.k); else if (a === "min") { F.min = true; LS.set("floatMin", true); fPause(); clearLine(); paintFloatShell(); } return; }
      if (e.target.closest("#vfTrack")) { const r = $("#vfTrack").getBoundingClientRect(); fPause(); fGo(Math.round(((e.clientX - r.left) / r.width) * (F.steps.length - 1))); return; }
      if (e.target.closest(".vf-board, .vf-line, .vf-note, .vf-stage") && F.steps.length) open("user", F.k);
    });
    drag(f);
    return f;
  }
  // 拖动挪位置（记住离右下角多远）
  function drag(f) {
    const pos = LS.get("floatPos", null); if (pos) { f.style.right = pos.r + "px"; f.style.bottom = pos.b + "px"; }
    const h = f.querySelector(".vf-h");
    h.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const wrap = f.parentElement.getBoundingClientRect(), r0 = f.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY, R = wrap.right - r0.right, Bm = wrap.bottom - r0.bottom;
      const offX = sx - r0.left, offY = sy - r0.top;
      let out = false;
      h.setPointerCapture(e.pointerId); f.classList.add("drag");
      const mv = (ev) => {
        // 拖到程序窗口外面了：变成单独的小窗口，接着跟着鼠标走，松手就停在那儿
        if (CAN_POP && !out && (ev.clientX < 0 || ev.clientY < 0 || ev.clientX > innerWidth || ev.clientY > innerHeight)) {
          out = true; f.classList.add("popping");
          popOut({ x: ev.screenX - offX, y: ev.screenY - offY, width: Math.round(r0.width), height: Math.round(r0.height) }, true);
          return;
        }
        if (out) { window.cc.popMove(ev.screenX - offX, ev.screenY - offY); return; }
        const r = Math.max(6, Math.min(wrap.width - r0.width - 6, R - (ev.clientX - sx)));
        const b = Math.max(6, Math.min(wrap.height - r0.height - 6, Bm - (ev.clientY - sy)));
        f.style.right = r + "px"; f.style.bottom = b + "px";
      };
      const up = () => { h.removeEventListener("pointermove", mv); f.classList.remove("drag", "popping"); if (out) paintFloatShell(); else LS.set("floatPos", { r: parseInt(f.style.right) || 16, b: parseInt(f.style.bottom) || 16 }); };
      h.addEventListener("pointermove", mv); h.addEventListener("pointerup", up, { once: true });
    });
  }

  function traceable() { const t = LC && LC.cur; return t && TRACEABLE.test(t.file) ? t : null; }
  function paintFloatShell() {
    const f = fel(); if (!f) return;
    const t = traceable();
    const show = !!t && F.on;
    f.hidden = !show || F.min || F.popped;
    $("#vizPill").hidden = !(t && (F.min || !F.on)) || F.popped;
  }
  // ---------- 拖出程序 ----------
  // dragging：正在拖着标题栏拖出去 —— 先别把程序里的小窗藏起来（藏了鼠标就「丢」了），松手再藏
  async function popOut(bounds, dragging) {
    if (!CAN_POP) return;
    F.popped = true; LS.set("floatPop", true);
    F.min = false; LS.set("floatMin", false); F.on = true; LS.set("float", true);
    fPause(); clearLine();
    try { await window.cc.popOpen(bounds || null); } catch (e) { F.popped = false; LS.set("floatPop", false); }
    if (!dragging) paintFloatShell();
    sendPop();
    schedule(0);
  }
  // 拖出去的小窗口也穿同一身皮肤：每次发结果都带上；在皮肤商店里换了也马上告诉它
  const skinNow = () => { const s = STAGE && STAGE.getSkin(); return s && s.id !== "robot" ? s : null; };
  const popSend = (m) => { if (F.popped && CAN_POP) window.cc.popSend(m.type === "result" ? { ...m, skin: skinNow() } : m); };
  if (window.LaoSkins) window.LaoSkins.onChange((s) => popSend({ type: "skin", skin: s }));
  function sendPop() {
    if (!F.popped) return;
    const t = traceable();
    if (!t) return popSend({ type: "clear" });
    if (F.steps.length && F.file === t.file) popSend({ type: "result", steps: F.steps, focus: F.focus, src: F.src, lang: F.res.lang || "", tip: F.tip, kind: F.status, name: t.name, k: F.k, autoplay: false });
    else popSend({ type: "status", kind: F.status || "wait", html: ($("#vfNote") || {}).innerHTML || "" });
  }
  function onPopCmd(m) {
    if (!m) return;
    if (m.type === "ready") sendPop();
    else if (m.type === "expand") open("user", m.k);
    else if (m.type === "dock") window.cc.popClose();
    else if (m.type === "closed") { F.popped = false; LS.set("floatPop", false); clearLine(); paintFloatShell(); if (F.steps.length) fGo(F.k); }
    else if (m.type === "k") {
      F.k = m.k; clearLine();
      const t = traceable();
      if (t && F.file === t.file && LC.cm.getValue() === F.src && m.line) F.lineH = LC.cm.addLineClass(m.line - 1, "background", "vf-runline");
    }
  }
  function fStatus(kind, txt) {
    F.status = kind;
    const d = $("#vfDot"); if (d) d.className = "vf-dot " + kind;
    if (txt != null) { const n = $("#vfNote"); if (n) n.innerHTML = txt; }
    popSend({ type: "status", kind, html: txt, stale: kind === "err" });
  }
  function schedule(ms = 1300) {
    clearTimeout(F.debounce);
    const t = traceable(); paintFloatShell();
    if (!t || !F.on || F.min) return;
    if (F.res && F.file === t.file && F.src === LC.cm.getValue()) return;
    fStatus("wait", F.steps.length ? null : "等你写完，停一下就开始画…");
    F.debounce = setTimeout(traceFloat, ms);
  }
  async function traceFloat() {
    const t = traceable(); if (!t || !F.on || F.min) return;
    const text = LC.cm.getValue();
    if (text.trim().length < 15) { fStatus("idle", "写点代码，这里会把它画出来"); return; }
    const seq = ++F.seq;
    fStatus("run", null);
    let r;
    try { r = await LC.call("traceRun", t.file, fixIn(LS.get("stdin:" + t.file, "")), "float", text); } catch (e) { r = { error: { msg: e.message } }; }
    if (seq !== F.seq || !r || r.cancelled) return;
    const still = traceable();
    if (!still || still.file !== t.file) return;
    if (r.compileFailed) {
      const d = (r.diags || [])[0];
      fStatus("err", `<span class="bad">${d ? `第 ${d.line} 行有错` : "代码还有错"}</span>，改好了自动接着画`);
      $("#vfBoard").classList.add("stale"); clearLine();
      return;
    }
    if (r.unsupported || r.needInstall || (!r.steps || !r.steps.length)) {
      fStatus("idle", esc((r.error && r.error.msg) || (r.unsupported ? "这种语言还不能画" : "程序没走起来（有 main 吗？）")));
      return;
    }
    $("#vfBoard").classList.remove("stale");
    F.res = r; F.src = text; F.file = t.file; F.steps = r.steps; F.focus = B.pickFocus(r.steps); F.k = 0; F.pk = -5; F.userPlay = false;
    F.changed = false;
    if (F.focus) { let first = null; for (const x of r.steps) { const fa = B.focusArray(x, F.focus); if (!fa) continue; const k = fa.values.join(); if (first == null) first = k; else if (k !== first) { F.changed = true; break; } } }
    const tip = r.harness ? "用第 1 个样例跑你的函数" : needsInput(text) && !LS.get("stdin:" + t.file, "") && !r.harness ? "程序要输入：放大后在下面填" : r.error ? `<span class="bad">${esc(r.error.msg)}</span>` : r.trunc ? `只画了前 ${r.steps.length} 步` : "";
    fStatus(r.error ? "err" : "ok", tip);
    F.tip = tip;
    if (F.popped) { popSend({ type: "result", steps: r.steps, focus: F.focus, src: text, lang: r.lang || "", tip, kind: r.error ? "err" : "ok", name: t.name, k: 0 }); return; }
    fGo(0); fPlay();
  }
  function fGo(k) {
    if (!F.steps.length) return;
    F.k = Math.max(0, Math.min(F.steps.length - 1, k));
    const s = F.steps[F.k], prev = F.steps[F.k - 1];
    const py = (F.res.lang || "") === "python";
    // 重点是一维数字数组：小窗里也用 3D 舞台（下面只留几个变量）
    const fa = F.focus ? B.focusArray(s, F.focus) : null;
    if (fa && !F.stage && STAGE) F.stage = STAGE.create($("#vfStage"), { mini: true });
    $("#vfStage").hidden = !(fa && F.stage);
    if (fa && F.stage) {
      const last = F.k === F.steps.length - 1;
      const stt = { a: fa.values, marks: fa.marks, error: !!(s.err || (last && F.res.error)), done: last && !F.res.error && F.changed && (ascending(fa.values) || descending(fa.values)) };
      // 边打字边自动播：不出声（吵）；点了播放才出声
      if (F.pk === F.k - 1) F.stage.step(stt, { dur: F.timer ? F.interval * 0.9 : 600, sound: !!F.userPlay }); else F.stage.set(stt);
    }
    F.pk = F.k;
    B.render($("#vfBoard"), s, prev, { mini: true, focus: fa && F.stage ? null : F.focus, py, n: F.k });
    const lineTxt = (F.src.split("\n")[s.l - 1] || "").trim();
    $("#vfLine").innerHTML = `<span class="hud-k">L${s.l}</span><code>${esc(lineTxt.slice(0, 60))}</code>`;
    $("#vfStep").textContent = `${F.k + 1}/${F.steps.length}`;
    $("#vfBar").style.width = ((F.k + 1) / F.steps.length) * 100 + "%";
    if (!F.tip) { const n = B.narrate(s, prev, { py }); $("#vfNote").innerHTML = n; }
    // 编辑器里也标出正在执行的那一行（代码没改过才标）
    clearLine();
    if (LC.cm.getValue() === F.src && s.l) F.lineH = LC.cm.addLineClass(s.l - 1, "background", "vf-runline");
    if (F.k >= F.steps.length - 1) fPause();
  }
  function clearLine() { if (F.lineH != null) { try { LC.cm.removeLineClass(F.lineH, "background", "vf-runline"); } catch (e) {} F.lineH = null; } }
  function fPlay() {
    if (!F.steps.length) return;
    if (F.k >= F.steps.length - 1) fGo(0);
    clearInterval(F.timer);
    const ms = F.stage || (STAGE && F.focus) ? Math.max(220, Math.min(650, 20000 / F.steps.length)) : Math.max(60, Math.min(450, 7000 / F.steps.length));
    F.interval = ms;
    F.timer = setInterval(() => fGo(F.k + 1), ms);
    const b = $('#vizFloat [data-f="play"]'); if (b) b.innerHTML = I("pause", 14);
  }
  function fPause() { clearInterval(F.timer); F.timer = 0; const b = $('#vizFloat [data-f="play"]'); if (b) b.innerHTML = I("play", 14); }
  function fToggle() { if (F.timer) fPause(); else fPlay(); }

  // ---------- 接到主界面 ----------
  function hook() {
    LC = window.LC;
    const btn = document.getElementById("vizBtn");
    if (btn) btn.onclick = () => open(traceable() ? "user" : V.mode, F.steps.length && traceable() && F.file === traceable().file ? F.k : undefined);
    document.addEventListener("keydown", (e) => { if (e.key === "F7") { e.preventDefault(); const r = $("#viz"); if (r && !r.hidden) close(); else btn && btn.click(); } });
    LC.cm.on("changes", () => { if (F.timer) fPause(); clearLine(); schedule(); });
    document.addEventListener("tab", () => {
      fPause(); clearLine(); F.res = null; F.steps = []; F.tip = ""; F.seq++;
      for (const id of ["#vfBoard", "#vfLine", "#vfNote", "#vfStep"]) { const e = $(id); if (e) e.innerHTML = ""; }
      const bar = $("#vfBar"); if (bar) bar.style.width = "0";
      popSend(traceable() ? { type: "status", kind: "wait", html: "等你写完，停一下就开始画…" } : { type: "clear" });
      schedule(400);
    });
    if (CAN_POP) {
      window.cc.on("vizpop-cmd", onPopCmd);
      // 上次关软件时实时画面在程序外面：还放回那儿
      if (LS.get("floatPop", false)) setTimeout(() => popOut(null), 600);
    }
    schedule(800);
  }
  if (window.LC) hook(); else document.addEventListener("lc-ready", hook, { once: true });
  window.LaolaoViz = { open, close, get state() { return { V, U, F }; }, setFloat(on) { F.on = !!on; LS.set("float", F.on); paintFloatShell(); schedule(0); } };
})();
