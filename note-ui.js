// 7.2 全屏备忘录（网页版）：格式、清单、图片、手写，和小程序 1.18 的备忘录存同一份数据（规则在 note-core.js）。
// 每次保存都写回 note + list（老版本、表单里照样能看），格式、图片、手写存在 rich：{ d: delta, s: 指纹, f: { 图片编号: 附件 id } }。
// 用到 app.js 里的 mine / save / LS_MINE / renderAll / openForm / Sync / currentUser / quadMap / LS_QUAD。
(function () {
  "use strict";
  const NC = window.NoteCore, MC = window.MemoCore;
  if (!NC || !MC) return;
  const COLORS = [["", "默认"], ["#e5484d", "红"], ["#f76b15", "橙"], ["#2f9e44", "绿"], ["#3e63dd", "蓝"], ["#8e4ec6", "紫"]];
  const HL = [["", "无"], ["#fff3a3", "黄"], ["#d3f9d8", "绿"], ["#d0ebff", "蓝"], ["#ffdeeb", "粉"]];
  const PENS = [["pen", "钢笔", 2.4, 1], ["marker", "马克笔", 6, 1], ["hl", "荧光笔", 18, 0.32], ["eraser", "橡皮", 22, 1]];
  const INKS = ["#1f2328", "#3e63dd", "#e5484d", "#2f9e44", "#f76b15", "#8e4ec6", "#f5c400"];
  const PAPERS = [["plain", "空白"], ["line", "横线"], ["grid", "方格"]];
  const PAPER_BG = "#fffdf8";
  const KINDS = ["", "作业", "会议", "活动", "通知"], KIND_N = ["普通", "作业", "会议", "活动", "通知"];
  const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => (n < 10 ? "0" : "") + n;
  const madeAt = (r) => r.upd || (/^p(\d{13})/.exec(r.id || "") || [])[1] * 1 || 0;
  const whenOf = (t) => {
    if (!t) return "";
    const d = new Date(t), now = new Date();
    if (d.toDateString() === now.toDateString()) return pad(d.getHours()) + ":" + pad(d.getMinutes());
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "昨天";
    return (d.getFullYear() === now.getFullYear() ? "" : d.getFullYear() + "/") + (d.getMonth() + 1) + "月" + d.getDate() + "日";
  };
  const mineArr = () => (typeof mine !== "undefined" && Array.isArray(mine) ? mine : []);
  const recOf = (id) => mineArr().find((x) => x.id === id) || null;
  const say = (t) => { if (typeof memoToast === "function") memoToast(t); else console.log(t); };

  // ---------- 这台电脑上的图片（没登录、还没传上去的也不会丢） ----------
  const IDB = (() => {
    let p = null;
    const db = () => p || (p = new Promise((ok, no) => {
      try { const r = indexedDB.open("lao_note_img", 1); r.onupgradeneeded = () => r.result.createObjectStore("i"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); } catch (e) { no(e); }
    }));
    return {
      async put(k, b) { try { const d = await db(); await new Promise((ok, no) => { const t = d.transaction("i", "readwrite"); t.objectStore("i").put(b, k); t.oncomplete = ok; t.onerror = () => no(t.error); }); } catch (e) {} },
      async get(k) { try { const d = await db(); return await new Promise((ok) => { const r = d.transaction("i").objectStore("i").get(k); r.onsuccess = () => ok(r.result || null); r.onerror = () => ok(null); }); } catch (e) { return null; } },
    };
  })();
  const urls = new Map();   // 图片编号 → 这一页能显示的地址

  // ---------- 样式 ----------
  const css = `
  .nt-ov{position:fixed;inset:0;z-index:2000;background:var(--bg2,#f6f8fa);color:var(--text,#0f1419);display:none;flex-direction:column}
  .nt-ov.open{display:flex}
  .nt-top{display:flex;align-items:center;gap:8px;padding:10px 20px;background:var(--card,#fff);border-bottom:1px solid var(--line,#eee);flex:none}
  .nt-top .sp{flex:1}
  .nt-h{font-size:18px;font-weight:800;margin:0 4px 0 6px;white-space:nowrap}
  .nt-main{flex:1;display:flex;min-height:0}
  .nt-side{width:340px;flex:none;display:flex;flex-direction:column;min-height:0;background:var(--card,#fff);border-right:1px solid var(--line,#eee)}
  .nt-side .nt-q{margin:14px 14px 6px;width:calc(100% - 28px)}
  .nt-cnt{font-size:12px;color:var(--sub,#778);padding:0 18px 6px}
  .nt-rows{flex:1;overflow:auto;padding:0 10px 30px}
  .nt-grp{font-size:12px;font-weight:700;color:var(--sub,#778);padding:12px 8px 6px}
  .nt-pane{flex:1;min-width:0;overflow:auto;position:relative}
  .nt-blank{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--sub,#778);font-size:14px;text-align:center;padding:24px}
  .nt-blank .big{font-size:56px;line-height:1}
  .nt-blank b{font-size:18px;color:var(--text,#111)}
  .nt-ov.editing .nt-blank{display:none}
  .nt-ov:not(.editing) .nt-wrap{display:none}
  .nt-btn{border:0;background:var(--muted-bg,#f5f7f9);color:inherit;border-radius:999px;padding:6px 12px;font-size:14px;cursor:pointer;white-space:nowrap}
  .nt-btn:hover{background:var(--hover,#eef)}
  .nt-btn.pri{background:var(--accent,#1d9bf0);color:#fff}
  .nt-btn.dang{color:var(--red,#e5484d)}
  .nt-saved{font-size:12px;color:var(--sub,#667)}
  .nt-wrap{max-width:860px;margin:28px auto 40vh;background:var(--card,#fff);border:1px solid var(--line,#eee);border-radius:22px;box-shadow:0 18px 50px -28px rgba(15,30,60,.35);padding:10px 44px 48px;box-sizing:border-box;width:calc(100% - 56px);min-height:calc(100% - 56px)}
  .nt-title{width:100%;border:0;outline:0;background:transparent;color:inherit;font-size:28px;font-weight:800;padding:22px 0 6px}
  .nt-meta{font-size:12px;color:var(--sub,#667);display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding-bottom:8px}
  .nt-chip{border:1px solid var(--line,#e3e3e3);background:transparent;color:inherit;border-radius:999px;padding:2px 10px;font-size:12px;cursor:pointer}
  .nt-chip.on{border-color:var(--accent,#1d9bf0);color:var(--accent,#1d9bf0)}
  .nt-bar{position:sticky;top:0;z-index:2;background:var(--card,#fff);display:flex;gap:2px;flex-wrap:wrap;align-items:center;padding:8px 0;border-bottom:1px solid var(--line,#eee);margin:0 -8px;padding-left:8px;padding-right:8px}
  .nt-bar button{border:0;background:transparent;color:inherit;min-width:34px;height:34px;border-radius:8px;font-size:15px;cursor:pointer;padding:0 6px;position:relative}
  .nt-bar button:hover{background:var(--hover,#eef)}
  .nt-bar button.on{background:var(--selected,#e8f5fd);color:var(--accent,#1d9bf0)}
  .nt-bar button:disabled{opacity:.35;cursor:default}
  .nt-bar .sep{width:1px;height:20px;background:var(--line,#ddd);margin:0 4px}
  .nt-pop{display:none;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 0;font-size:13px;border-bottom:1px solid var(--line,#eee)}
  .nt-pop.open{display:flex}
  .nt-sw{width:26px;height:26px;border-radius:50%;border:2px solid var(--line,#ddd);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:11px;background:var(--card,#fff);color:inherit}
  .nt-ed{outline:0;min-height:50vh;font-size:16.5px;line-height:1.8;padding:16px 0;word-break:break-word}
  .nt-ed:focus,.nt-ed:focus-visible,.nt-title:focus,.nt-title:focus-visible{outline:0!important;box-shadow:none!important}
  .nt-ed>div{position:relative;min-height:1.75em}
  .nt-ed>div[data-h="1"]{font-size:1.5em;font-weight:700;line-height:1.5}
  .nt-ed>div[data-h="2"]{font-size:1.22em;font-weight:700;line-height:1.55}
  .nt-ed>div[data-list]{padding-left:28px}
  .nt-ed>div[data-list]::before{position:absolute;left:4px;top:0;width:22px;text-align:center;color:var(--sub,#667)}
  .nt-ed>div[data-list=bullet]::before{content:"•";font-weight:700}
  .nt-ed>div:not([data-list=ordered]){counter-reset:ntol}
  .nt-ed>div[data-list=ordered]{counter-increment:ntol}
  .nt-ed>div[data-list=ordered]::before{content:counter(ntol) ".";font-variant-numeric:tabular-nums}
  .nt-ed>div[data-list=unchecked]::before,.nt-ed>div[data-list=checked]::before{content:"";top:.32em;left:5px;width:16px;height:16px;border:2px solid var(--gray,#8b98a5);border-radius:5px;box-sizing:border-box;cursor:pointer}
  .nt-ed>div[data-list=checked]::before{background:var(--accent,#1d9bf0) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-7' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/12px no-repeat;border-color:var(--accent,#1d9bf0)}
  .nt-ed>div[data-list=checked]{color:var(--sub,#889);text-decoration:line-through}
  .nt-ed>div[data-ind="1"]{margin-left:24px}.nt-ed>div[data-ind="2"]{margin-left:48px}.nt-ed>div[data-ind="3"]{margin-left:72px}
  .nt-ed>div[data-ind="4"]{margin-left:96px}.nt-ed>div[data-ind="5"]{margin-left:120px}.nt-ed>div[data-ind="6"]{margin-left:144px}
  .nt-ed>div[data-hr]{min-height:0;padding:8px 0;user-select:none}
  .nt-ed>div[data-hr] hr{border:0;border-top:1px solid var(--line,#ddd);margin:0}
  .nt-ed img.nt-img{max-width:100%;border-radius:10px;display:block;margin:6px 0;cursor:default}
  .nt-ed img.nt-img.miss{min-height:60px;width:100%;background:var(--muted-bg,#f3f3f3);font-size:13px;color:var(--sub,#778)}
  .nt-q{width:100%;box-sizing:border-box;border:1px solid var(--line,#ddd);border-radius:12px;padding:9px 14px 9px 34px;font-size:14.5px;background:var(--muted-bg,#f7f9f9) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b98a5' stroke-width='2.4' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='M20 20l-4-4'/%3E%3C/svg%3E") 12px center/15px no-repeat;color:inherit;outline:0}
  .nt-q:focus{border-color:var(--accent,#1d9bf0)}
  .nt-row{display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:11px 12px;border-radius:14px;cursor:pointer;margin-bottom:2px;position:relative}
  .nt-row:hover{background:var(--hover,#f4f6f8)}
  .nt-row.on{background:var(--selected,#e8f5fd)}
  .nt-row.on::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:3px;border-radius:3px;background:var(--accent,#1d9bf0)}
  .nt-row b{display:block;font-size:15px;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .nt-row.dn b{color:var(--sub,#778);text-decoration:line-through;text-decoration-color:rgba(0,0,0,.25)}
  .nt-row .s{font-size:13px;color:var(--sub,#667);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.45}
  .nt-row .m{font-size:11.5px;color:var(--sub,#889);margin-top:5px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .nt-row .kd{font-weight:700;border-radius:6px;padding:0 6px;background:var(--muted-bg,#f0f2f4)}
  .nt-row .kd.k1{color:var(--red,#e5484d)}.nt-row .kd.k2{color:var(--accent,#1d9bf0)}.nt-row .kd.k3{color:var(--green,#2f9e44)}.nt-row .kd.k4{color:var(--purple,#8e4ec6)}
  .nt-empty{color:var(--sub,#778);text-align:center;padding:48px 0;font-size:14px}
  .nt-draw{position:fixed;inset:0;z-index:2100;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center}
  .nt-draw.open{display:flex}
  .nt-dbox{background:var(--card,#fff);color:var(--text,#111);border-radius:16px;padding:12px;width:min(760px,calc(100vw - 24px));max-height:calc(100vh - 24px);display:flex;flex-direction:column;gap:8px;box-sizing:border-box}
  .nt-dtools{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:13px}
  .nt-dtools .nt-btn.on{background:var(--accent,#1d9bf0);color:#fff}
  .nt-dtools .nt-sw.on{border-color:var(--text,#111)}
  .nt-cv{position:relative;border-radius:10px;overflow:hidden;border:1px solid var(--line,#ddd);touch-action:none;background:${PAPER_BG}}
  .nt-cv canvas{display:block;width:100%;touch-action:none}
  .nt-cv canvas.bg{position:absolute;inset:0;pointer-events:none}
  @media (max-width:899px){
    .nt-side{width:100%;border:0}.nt-ov.editing .nt-side{display:none}.nt-ov:not(.editing) .nt-pane{display:none}
    .nt-pane{background:var(--card,#fff)}
    .nt-wrap{width:auto;max-width:none;margin:0 0 40vh;border:0;border-radius:0;box-shadow:none;padding:0 16px;min-height:0}
    .nt-h{display:none}.nt-ov:not(.editing) .nt-h{display:inline}.nt-top{padding:10px 12px}
  }
  @media (max-width:640px){.nt-title{font-size:21px}.nt-bar{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.nt-bar::-webkit-scrollbar{display:none}.nt-bar button{min-width:34px;height:34px;font-size:14px;flex:none}.nt-bar .sep{flex:none}}
  `;

  let ov, ed, titleEl, metaEl, savedEl, barEl, popEl, listEl, qEl, drawEl;
  const S = { id: "", isNew: false, fmap: {}, kind: "", dirty: false, t: 0, undo: [], redo: [], snapT: 0, mode: "" };

  function build() {
    if (ov) return;
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    ov = document.createElement("div"); ov.className = "nt-ov"; ov.id = "noteOv";
    ov.innerHTML = `
      <div class="nt-top">
        <button class="nt-btn" data-n="back">‹ 返回</button>
        <span class="nt-h">📒 备忘录</span><span class="nt-saved"></span><span class="sp"></span>
        <button class="nt-btn" data-n="quick" title="换成「记一件事」的表单：改日期、提醒、重复、地点">⚡ 快速记</button>
        <button class="nt-btn dang" data-n="del" title="删除这条备忘">删除</button>
        <button class="nt-btn pri" data-n="new">＋ 新备忘</button>
      </div>
      <div class="nt-main">
      <aside class="nt-side"><input class="nt-q" placeholder="搜索标题、内容、清单" type="search"><div class="nt-cnt"></div><div class="nt-rows"></div></aside>
      <section class="nt-pane">
      <div class="nt-blank"><div class="big">📒</div><b>选一条备忘，或者新写一条</b><div>格式、清单、图片、手写都可以；网页、小程序、安卓 App 同一份</div><button class="nt-btn pri" data-n2="new">＋ 新备忘</button></div>
      <div class="nt-wrap">
        <input class="nt-title" maxlength="60" placeholder="标题（不写就用第一行）">
        <div class="nt-meta"></div>
        <div class="nt-bar">
          <button data-c="undo" title="撤销（Ctrl+Z）">↶</button><button data-c="redo" title="重做（Ctrl+Shift+Z）">↷</button><span class="sep"></span>
          <button data-c="h1" title="大标题"><b>H1</b></button><button data-c="h2" title="小标题"><b>H2</b></button><span class="sep"></span>
          <button data-c="bold" title="加粗（Ctrl+B）"><b>B</b></button><button data-c="italic" title="斜体（Ctrl+I）"><i>I</i></button>
          <button data-c="underline" title="下划线（Ctrl+U）"><u>U</u></button><button data-c="strike" title="删除线"><s>S</s></button>
          <button data-c="color" title="文字颜色"><span style="border-bottom:3px solid #e5484d">A</span></button>
          <button data-c="hl" title="高亮"><span style="background:#fff3a3;color:#222;padding:0 3px;border-radius:3px">A</span></button><span class="sep"></span>
          <button data-c="check" title="清单（可以一项项勾）">☑</button><button data-c="bullet" title="圆点列表">•≡</button><button data-c="ordered" title="编号列表">1.</button>
          <button data-c="outdent" title="减少缩进">⇤</button><button data-c="indent" title="增加缩进">⇥</button><span class="sep"></span>
          <button data-c="hr" title="分割线">―</button><button data-c="stamp" title="插入现在的时间">🕒</button>
          <button data-c="img" title="插入图片">🖼</button><button data-c="draw" title="手写 / 画图">✍️</button>
          <button data-c="clear" title="清除格式">⌫</button>
        </div>
        <div class="nt-pop"></div>
        <div class="nt-ed" contenteditable="true" spellcheck="false"></div>
      </div>
      </section>
      </div>
      <input type="file" accept="image/*" multiple hidden class="nt-file">`;
    document.body.appendChild(ov);
    ed = ov.querySelector(".nt-ed"); titleEl = ov.querySelector(".nt-title"); metaEl = ov.querySelector(".nt-meta");
    savedEl = ov.querySelector(".nt-saved"); barEl = ov.querySelector(".nt-bar"); popEl = ov.querySelector(".nt-pop");
    listEl = ov.querySelector(".nt-side"); qEl = ov.querySelector(".nt-q");
    ov.querySelector(".nt-blank").onclick = (e) => { if (e.target.closest("[data-n2]")) open(null); };
    try { document.execCommand("defaultParagraphSeparator", false, "div"); } catch (e) {}

    ov.querySelector(".nt-top").onclick = (e) => {
      const b = e.target.closest("[data-n]"); if (!b) return;
      const n = b.dataset.n;
      if (n === "back") { if (S.mode === "edit" && S.from === "list" && !wide()) { flush(); showList(); } else close(); }
      if (n === "new") open(null);
      if (n === "del") delNote();
      if (n === "quick") toQuick();
    };
    qEl.oninput = () => renderList();
    ov.querySelector(".nt-rows").onclick = (e) => { const b = e.target.closest("[data-id]"); if (b) open(b.dataset.id, { from: "list" }); };
    // 工具栏：mousedown 先拦住，编辑框不会失去选区
    barEl.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
    popEl.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
    barEl.onclick = (e) => { const b = e.target.closest("[data-c]"); if (b) cmd(b.dataset.c); };
    popEl.onclick = (e) => {
      const b = e.target.closest("[data-v]"); if (!b) return;
      if (popEl.dataset.k === "color") inlineColor("foreColor", b.dataset.v);
      if (popEl.dataset.k === "hl") inlineColor("hiliteColor", b.dataset.v);
      if (popEl.dataset.k === "kind") setKind(b.dataset.v);
      closePop();
    };
    metaEl.onclick = (e) => {
      const b = e.target.closest("[data-m]"); if (!b) return;
      if (b.dataset.m === "kind") togglePop("kind");
      if (b.dataset.m === "date") toQuick();
      if (b.dataset.m === "pin") { flush(true); const r = recOf(S.id); if (r) { if (r.pin) delete r.pin; else r.pin = true; save(LS_MINE, mine); meta(); } }
    };
    titleEl.oninput = () => dirty();
    titleEl.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); focusEnd(); } };
    ed.addEventListener("input", onInput);
    ed.addEventListener("keydown", onKey);
    ed.addEventListener("beforeinput", (e) => {
      if (e.inputType === "historyUndo") { e.preventDefault(); undo(); }
      if (e.inputType === "historyRedo") { e.preventDefault(); redo(); }
    });
    ed.addEventListener("mousedown", onEdDown);
    ed.addEventListener("paste", onPaste);
    ed.addEventListener("drop", (e) => { const fs = [...((e.dataTransfer && e.dataTransfer.files) || [])].filter((f) => /^image\//.test(f.type)); if (fs.length) { e.preventDefault(); fs.forEach((f) => addImageFile(f)); } });
    document.addEventListener("selectionchange", () => { if (S.mode === "edit" && ov.classList.contains("open")) syncBar(); });
    ov.querySelector(".nt-file").onchange = (e) => { [...e.target.files].forEach((f) => addImageFile(f)); e.target.value = ""; };
    document.addEventListener("keydown", (e) => {
      if (!ov.classList.contains("open") || (drawEl && drawEl.classList.contains("open"))) return;
      if (e.key === "Escape") { e.preventDefault(); if (popEl.classList.contains("open")) closePop(); else ov.querySelector('[data-n="back"]').click(); }
    });
    window.addEventListener("beforeunload", () => { if (S.mode === "edit") flush(); });
  }

  // ================= 列表 =================
  function list() {
    build(); flushIfEdit();
    S.mode = "list"; S.id = ""; showList();
  }
  const wide = () => matchMedia("(min-width: 900px)").matches;
  function showList() {
    S.mode = "list"; S.id = "";
    ov.classList.add("open"); ov.classList.remove("editing"); document.body.style.overflow = "hidden";
    ov.querySelector('[data-n="del"]').style.display = "none"; ov.querySelector('[data-n="quick"]').style.display = "none";
    savedEl.textContent = "";
    renderList();
  }
  function renderList() {
    const q = qEl.value.trim().toLowerCase();
    const all = mineArr().filter((r) => r && !r.dplan);
    const hit = (r) => !q || (String(r.subject || "") + "\n" + String(r.note || "") + "\n" + MC.listOf(r).map((x) => x.t).join("\n")).toLowerCase().indexOf(q) >= 0;
    const rows = all.filter(hit).sort((a, b) => (!!b.pin - !!a.pin) || (!!a.done - !!b.done) || (madeAt(b) - madeAt(a)));
    const wk = Date.now() - 7 * 864e5;
    const grp = (r) => r.pin && !r.done ? "📌 置顶" : r.done ? "已完成" : madeAt(r) >= wk ? "最近 7 天" : "更早";
    let last = "";
    const row = (r) => {
      const ls = MC.listStat(r), lines = String(r.note || "").split("\n").map((s) => s.trim()).filter((s) => s && s !== r.subject && s !== "[图片]");
      const body = lines.slice(0, 2).join(" ") || (ls.n ? MC.listOf(r).map((x) => (x.d ? "✓ " : "○ ") + x.t).slice(0, 3).join("  ") : "");
      const et = String(r.event_time || ""), m = [et ? "📅 " + (+et.slice(5, 7)) + "月" + (+et.slice(8, 10)) + "日" : whenOf(madeAt(r))];
      if (ls.n) m.push("☑ " + ls.text); const ni = NC.imgCount(r); if (ni) m.push("🖼 " + ni);
      const ki = KINDS.indexOf(r.kind || "");
      const g = grp(r), head = g !== last ? `<div class="nt-grp">${g}</div>` : ""; last = g;
      return `${head}<button class="nt-row${r.id === S.id ? " on" : ""}${r.done ? " dn" : ""}" data-id="${h(r.id)}"><b>${h(r.subject || "无标题备忘")}</b>${body ? `<div class="s">${h(body.slice(0, 120))}</div>` : ""}<div class="m">${ki > 0 ? `<span class="kd k${ki}">${h(KIND_N[ki])}</span>` : ""}<span>${h(m.join(" · "))}</span></div></button>`;
    };
    ov.querySelector(".nt-rows").innerHTML = rows.length ? rows.map(row).join("") : `<div class="nt-empty">${q ? "没有找到「" + h(q) + "」" : "还没有备忘。点右上角「＋ 新备忘」写一条"}</div>`;
    ov.querySelector(".nt-cnt").textContent = q ? `找到 ${rows.length} 条` : `共 ${all.length} 条 · ${all.filter((r) => !r.done).length} 条没做完`;
  }

  // ================= 编辑 =================
  function open(id, opt) {
    build(); opt = opt || {};
    flushIfEdit();
    const rec = id ? recOf(id) : null;
    if (id && !rec) { say("这条备忘已经不在了"); return; }
    S.id = id || "p" + Date.now(); S.isNew = !rec; S.fmap = Object.assign({}, (rec && rec.rich && rec.rich.f) || {});
    S.kind = rec ? rec.kind || "" : KINDS.indexOf(opt.kind || "") > 0 ? opt.kind : "";
    S.from = opt.from || (S.mode === "list" ? "list" : ""); S.mode = "edit"; S.dirty = false; S.undo = []; S.redo = []; S.files = null;
    ov.classList.add("open", "editing"); document.body.style.overflow = "hidden";
    ov.querySelector('[data-n="del"]').style.display = rec ? "" : "none"; ov.querySelector('[data-n="quick"]').style.display = "";
    renderList();
    ov.querySelector(".nt-pane").scrollTop = 0;
    titleEl.value = rec && !rec.tAuto ? rec.subject || "" : (opt.title || "");
    savedEl.textContent = ""; closePop();
    const L = NC.load(rec || {});
    let ops = L.ops;
    if (!rec && opt.note) ops = NC.fromPlain({ note: opt.note, list: opt.list });
    setOps(ops);
    S.lastSig = NC.sig(rec || {});
    if (L.fresh) say("这条在别的地方改过文字，已按新内容显示（图片还在）");
    if (!rec && (opt.note || opt.title)) dirty();
    meta(); snap(true); syncBar();
    setTimeout(() => { if (!rec && !titleEl.value) titleEl.focus(); else focusEnd(); }, 30);
  }
  function close() {
    flushIfEdit();
    if (!ov) return;
    ov.classList.remove("open"); document.body.style.overflow = "";
    S.mode = ""; closeDraw();
    try { renderAll(); } catch (e) {}
  }
  function flushIfEdit() { if (S.mode === "edit") flush(); }
  function meta() {
    const rec = recOf(S.id), p = [];
    p.push(rec && rec.upd ? whenOf(rec.upd) + " 编辑过" : S.isNew ? "新备忘" : "");
    const ls = rec ? MC.listStat(rec) : { n: 0 };
    if (ls.n) p.push("清单 " + ls.text);
    const et = rec ? String(rec.event_time || "") : "", k = (rec ? rec.kind : S.kind) || "";
    metaEl.innerHTML = `<button class="nt-chip${k ? " on" : ""}" data-m="kind">${h(k ? KIND_N[KINDS.indexOf(k)] || k : "类型：普通")} ▾</button>
      <button class="nt-chip${et ? " on" : ""}" data-m="date" title="日期、提醒、重复、地点到「记一件事」里改">${et ? "📅 " + (+et.slice(5, 7)) + "月" + (+et.slice(8, 10)) + "日" + (et.length > 10 ? " " + et.slice(11, 16) : "") : "📅 加日期 / 提醒"}</button>
      ${rec ? `<button class="nt-chip${rec.pin ? " on" : ""}" data-m="pin">${rec.pin ? "📌 已置顶" : "📌 置顶"}</button>` : ""}
      <span>${h(p.filter(Boolean).join(" · "))}</span>`;
  }
  function setKind(k) {
    S.kind = KINDS.indexOf(k) > 0 ? k : "";
    const r = recOf(S.id);
    if (r) { if (S.kind) r.kind = S.kind; else delete r.kind; save(LS_MINE, mine); } else dirty();
    meta();
    if (S.kind === "作业") say("会显示在作业页");
  }
  function dirty() { S.dirty = true; savedEl.textContent = ""; clearTimeout(S.t); S.t = setTimeout(() => flush(), 700); }
  function flush(force) {
    clearTimeout(S.t);
    if (S.mode !== "edit" || (!S.dirty && !force)) return;
    const ops = toOps(), p = NC.toPlain(ops);
    let title = titleEl.value.trim(), auto = false;
    if (!title) { auto = true; title = (p.note.split("\n").map((s) => s.trim()).filter((s) => s && s !== "[图片]")[0] || (p.list[0] && p.list[0].t) || (p.imgs.length ? "手写备忘" : "")); }
    if (S.isNew && !title && !p.note && !p.list.length) return;   // 空白的新备忘不存
    const fields = { subject: title.slice(0, 60) || "无标题备忘", tAuto: auto || undefined, note: p.note, list: p.list.length ? p.list : undefined, upd: Date.now() };
    fields.rich = { d: ops, s: NC.sig(fields), f: Object.keys(S.fmap).length ? S.fmap : undefined };
    if (!fields.rich.f) delete fields.rich.f;
    let r = recOf(S.id);
    if (!r) { r = { id: S.id, event_time: "" }; if (S.kind) r.kind = S.kind; mine.push(r); }
    Object.assign(r, fields);
    for (const f of ["tAuto", "list"]) if (fields[f] === undefined) delete r[f];
    S.isNew = false; S.lastSig = fields.rich.s; S.dirty = false;
    save(LS_MINE, mine);
    savedEl.textContent = "已保存";
    ov.querySelector('[data-n="del"]').style.display = "";
    meta();
    if (wide()) renderList();
  }
  function delNote() {
    const r = recOf(S.id);
    if (!r) { close(); return; }
    if (!confirm(`删除「${r.subject || "这条备忘"}」？`)) return;
    const i = mine.indexOf(r); if (i >= 0) mine.splice(i, 1);
    try { delete quadMap[r.id]; save(LS_QUAD, quadMap); } catch (e) {}
    save(LS_MINE, mine); S.dirty = false;
    if (S.from === "list" || wide()) showList(); else close();
  }
  // 换成「记一件事」表单（日期、提醒、重复、地点在那里改）
  function toQuick() {
    flush(true);
    const r = recOf(S.id), kind = S.kind;
    S.dirty = false; close();
    if (r) openForm(r); else openForm(null, { kind });
  }

  // ---------- 内容 ↔ delta ----------
  let defColor = "";
  const hex = (c) => {
    c = String(c || "").trim().toLowerCase();
    if (!c || c === "transparent" || c === "inherit" || c === "initial") return "";
    if (/^#[0-9a-f]{6}$/.test(c)) return c;
    if (/^#[0-9a-f]{3}$/.test(c)) return "#" + c.slice(1).split("").map((x) => x + x).join("");
    const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(c);
    if (m) { if (m[4] !== undefined && parseFloat(m[4]) === 0) return ""; return "#" + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, "0")).join(""); }
    return c;
  };
  function inlineAttrs(el, a) {
    a = Object.assign({}, a);
    const tg = el.tagName, s = el.style || {};
    if (tg === "B" || tg === "STRONG" || s.fontWeight === "bold" || +s.fontWeight >= 600) a.bold = true;
    if (s.fontWeight === "normal" || s.fontWeight === "400") delete a.bold;
    if (tg === "I" || tg === "EM" || s.fontStyle === "italic") a.italic = true;
    const td = String(s.textDecoration || s.textDecorationLine || "");
    if (tg === "U" || td.indexOf("underline") >= 0) a.underline = true;
    if (tg === "S" || tg === "STRIKE" || tg === "DEL" || td.indexOf("line-through") >= 0) a.strike = true;
    const col = hex((tg === "FONT" && el.getAttribute("color")) || s.color);
    if (col) { if (col === defColor) delete a.color; else a.color = col; }
    const bg = hex(s.backgroundColor || s.background);
    if (bg) a.backgroundColor = bg; else if (s.backgroundColor === "transparent") delete a.backgroundColor;
    return a;
  }
  function blockAttrs(b) {
    const a = {}, d = b.dataset || {};
    if (d.h === "1" || d.h === "2") a.header = +d.h;
    if (/^(bullet|ordered|checked|unchecked)$/.test(d.list || "")) a.list = d.list;
    if (+d.ind > 0) a.indent = +d.ind;
    if (d.align) a.align = d.align;
    return a;
  }
  const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
  function toOps() {
    defColor = hex(getComputedStyle(ed).color);
    const ops = [];
    const push = (ins, at) => {
      at = at && Object.keys(at).length ? at : undefined;
      const last = ops[ops.length - 1];
      if (typeof ins === "string" && last && typeof last.insert === "string" && same(last.attributes, at)) { last.insert += ins; return; }
      const op = { insert: ins }; if (at) op.attributes = at; ops.push(op);
    };
    let blk = null;
    const trailing = (n, b) => { while (n && n !== b) { let x = n.nextSibling; while (x && x.nodeType === 3 && !x.nodeValue) x = x.nextSibling; if (x) return false; n = n.parentNode; } return true; };
    const walk = (node, at) => {
      node.childNodes.forEach((c) => {
        if (c.nodeType === 3) { const t = c.nodeValue.replace(/[​﻿]/g, "").replace(/ /g, " ").replace(/\n/g, " "); if (t) push(t, at); }
        else if (c.nodeType === 1) {
          if (c.tagName === "BR") { if (!trailing(c, blk)) push("\n", blockAttrs(blk)); return; }
          if (c.tagName === "IMG") { const k = c.dataset.k || ""; const op = { insert: { image: c.dataset.src || "web:" + k }, attributes: Object.assign({ "data-custom": "k=" + encodeURIComponent(k) }, c.dataset.at ? JSON.parse(c.dataset.at) : {}) }; if (!op.attributes.width) op.attributes.width = "100%"; ops.push(op); return; }
          if (c.tagName === "HR") { ops.push({ insert: { divider: true } }); return; }
          walk(c, inlineAttrs(c, at));
        }
      });
    };
    [...ed.children].forEach((b) => {
      if (b.dataset.hr !== undefined) { ops.push({ insert: { divider: true } }); push("\n"); return; }
      blk = b; walk(b, {});
      push("\n", blockAttrs(b));
    });
    if (!ops.length) ops.push({ insert: "\n" });
    return ops;
  }
  function runEl(t, a) {
    let n = document.createTextNode(t);
    if (!a) return n;
    const wrap = (tag) => { const e = document.createElement(tag); e.appendChild(n); n = e; };
    if (a.bold) wrap("b"); if (a.italic) wrap("i"); if (a.underline) wrap("u"); if (a.strike) wrap("s");
    if (a.color || a.backgroundColor) { wrap("span"); if (a.color) n.style.color = a.color; if (a.backgroundColor) n.style.backgroundColor = a.backgroundColor; }
    return n;
  }
  function imgEl(op) {
    const k = NC.imgKey(op) || Date.now().toString(36), at = Object.assign({}, op.attributes || {});
    delete at["data-custom"]; delete at.dataCustom;
    const im = document.createElement("img");
    im.className = "nt-img"; im.contentEditable = "false"; im.dataset.k = k; im.dataset.src = String(op.insert.image || "");
    if (Object.keys(at).length) im.dataset.at = JSON.stringify(at);
    im.alt = "图片加载中…";
    if (urls.has(k)) im.src = urls.get(k); else { im.classList.add("miss"); resolveImg(im, k); }
    return im;
  }
  function hrBlock() { const d = document.createElement("div"); d.dataset.hr = ""; d.contentEditable = "false"; d.innerHTML = "<hr>"; return d; }
  function setOps(ops) {
    ed.innerHTML = "";
    NC.lines(ops).forEach((ln) => {
      let div = document.createElement("div"); const a = ln.attrs || {};
      const apply = (d) => { if (a.header) d.dataset.h = String(a.header); if (a.list) d.dataset.list = a.list; if (a.indent) d.dataset.ind = String(a.indent); if (a.align) d.dataset.align = a.align; };
      apply(div);
      let has = false;
      ln.runs.forEach((r) => {
        if (r.hr) { if (has) { ed.appendChild(div); div = document.createElement("div"); apply(div); has = false; } ed.appendChild(hrBlock()); return; }
        if (r.img) { div.appendChild(imgEl(r.img)); has = true; return; }
        div.appendChild(runEl(r.t, r.a)); has = true;
      });
      if (has || !ln.runs.some((r) => r.hr)) { if (!div.firstChild) div.appendChild(document.createElement("br")); ed.appendChild(div); }
    });
    ensureBlocks();
  }
  // 编辑框里的东西都放在一行一行的 <div> 里
  function ensureBlocks() {
    if (!ed.firstChild || ![...ed.childNodes].some((n) => n.nodeType === 1)) {
      const txt = ed.textContent; ed.innerHTML = ""; const d = document.createElement("div");
      if (txt) d.textContent = txt; else d.appendChild(document.createElement("br"));
      ed.appendChild(d); if (txt) caretTo(d, true); return;
    }
    const sel = getSelection(), an = sel.rangeCount ? sel.anchorNode : null, ao = sel.anchorOffset;
    let moved = false, cur = null;
    [...ed.childNodes].forEach((n) => {
      if (n.nodeType === 1 && n.tagName === "DIV") { cur = null; return; }
      if (n.nodeType === 3 && !n.nodeValue.trim() && !cur) { if (n.nodeValue === "" || /\n/.test(n.nodeValue)) { n.remove(); return; } }
      if (n.nodeType === 1 && (n.tagName === "P" || /^H[1-6]$/.test(n.tagName) || n.tagName === "UL" || n.tagName === "OL")) { cur = null; return; }
      if (!cur) { cur = document.createElement("div"); ed.insertBefore(cur, n); }
      cur.appendChild(n); moved = true;
    });
    if (moved && an && an.isConnected) { try { sel.collapse(an, ao); } catch (e) {} }
    // 粘贴进来的 <p>、<h1>、<li> 换成一行行的 div
    [...ed.children].forEach((n) => {
      if (n.tagName === "DIV") { if (n.querySelector(":scope > div, :scope > p")) unnest(n); return; }
      if (/^H[1-6]$/.test(n.tagName)) { const d = document.createElement("div"); d.dataset.h = n.tagName === "H1" ? "1" : "2"; d.append(...n.childNodes); n.replaceWith(d); return; }
      if (n.tagName === "UL" || n.tagName === "OL") {
        const frag = [...n.querySelectorAll("li")].map((li) => { const d = document.createElement("div"); d.dataset.list = n.tagName === "OL" ? "ordered" : "bullet"; d.append(...li.childNodes); return d; });
        n.replaceWith(...frag); return;
      }
      if (n.tagName === "P") { const d = document.createElement("div"); d.append(...n.childNodes); if (!d.firstChild) d.appendChild(document.createElement("br")); n.replaceWith(d); return; }
      if (n.tagName === "HR") { n.replaceWith(hrBlock()); }
    });
  }
  function unnest(div) {
    const kids = [...div.childNodes], out = []; let cur = null;
    kids.forEach((k) => {
      if (k.nodeType === 1 && (k.tagName === "DIV" || k.tagName === "P")) { cur = null; const d = document.createElement("div"); Object.assign(d.dataset, div.dataset); d.append(...k.childNodes); out.push(d); return; }
      if (!cur) { cur = document.createElement("div"); Object.assign(cur.dataset, div.dataset); out.push(cur); }
      cur.appendChild(k);
    });
    out.forEach((d) => { if (!d.firstChild) d.appendChild(document.createElement("br")); });
    div.replaceWith(...out);
  }

  // ---------- 撤销 ----------
  function caretOff() {
    const sel = getSelection(); if (!sel.rangeCount || !ed.contains(sel.anchorNode)) return -1;
    const r = document.createRange(); r.selectNodeContents(ed); r.setEnd(sel.anchorNode, sel.anchorOffset);
    return r.toString().length + Math.max(0, r.cloneContents().querySelectorAll("div").length - 1);
  }
  function caretSet(off) {
    if (off < 0) return focusEnd();
    let left = off; const blocks = [...ed.children];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]; if (i > 0) left -= 1;
      const len = b.textContent.length;
      if (left <= len) {
        const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT); let n;
        while ((n = w.nextNode())) { if (left <= n.nodeValue.length) { getSelection().collapse(n, left); return; } left -= n.nodeValue.length; }
        caretTo(b, true); return;
      }
      left -= len;
    }
    focusEnd();
  }
  function snap(reset) {
    clearTimeout(S.snapT);
    const v = ed.innerHTML;
    if (reset) { S.undo = [{ v, c: -1 }]; S.redo = []; return syncUR(); }
    if (S.undo.length && S.undo[S.undo.length - 1].v === v) return;
    S.undo.push({ v, c: caretOff() }); if (S.undo.length > 120) S.undo.shift(); S.redo = []; syncUR();
  }
  function restore(st) { ed.innerHTML = st.v; ed.querySelectorAll("img.nt-img").forEach((im) => { const u = urls.get(im.dataset.k); if (u) { im.src = u; im.classList.remove("miss"); } }); ed.focus(); caretSet(st.c); dirty(); syncUR(); }
  function undo() { clearTimeout(S.snapT); if (ed.innerHTML !== (S.undo[S.undo.length - 1] || {}).v) snap(); if (S.undo.length < 2) return; S.redo.push(S.undo.pop()); restore(S.undo[S.undo.length - 1]); }
  function redo() { if (!S.redo.length) return; const st = S.redo.pop(); S.undo.push(st); restore(st); }
  function syncUR() { barEl.querySelector('[data-c="undo"]').disabled = S.undo.length < 2 && ed.innerHTML === (S.undo[0] || {}).v; barEl.querySelector('[data-c="redo"]').disabled = !S.redo.length; }

  // ---------- 输入 ----------
  function curBlock() {
    const sel = getSelection(); if (!sel.rangeCount) return null;
    let n = sel.anchorNode; if (!ed.contains(n)) return null;
    while (n && n.parentNode !== ed) n = n.parentNode;
    return n && n.nodeType === 1 ? n : null;
  }
  function selBlocks() {
    const sel = getSelection(); if (!sel.rangeCount) return [];
    const r = sel.getRangeAt(0); if (!ed.contains(r.commonAncestorContainer) && r.commonAncestorContainer !== ed) return [];
    const up = (n) => { while (n && n.parentNode !== ed) n = n.parentNode; return n; };
    let a = up(r.startContainer), b = up(r.endContainer);
    if (r.startContainer === ed) a = ed.children[Math.min(r.startOffset, ed.children.length - 1)];
    if (r.endContainer === ed) b = ed.children[Math.max(0, r.endOffset - 1)];
    const out = []; let n = a;
    while (n) { if (n.nodeType === 1 && n.dataset.hr === undefined) out.push(n); if (n === b) break; n = n.nextSibling; }
    return out;
  }
  function atStart(b) {
    const sel = getSelection(); if (!sel.rangeCount || !sel.isCollapsed) return false;
    const r = document.createRange(); r.selectNodeContents(b); r.setEnd(sel.anchorNode, sel.anchorOffset);
    return !r.toString().length && !r.cloneContents().querySelector("img");
  }
  function onInput(e) {
    ensureBlocks();
    if (e.inputType === "insertParagraph") {
      const b = curBlock();
      // 回车新起的一行不带标题；勾过的清单新起一行是没勾的（在行首回车时，新的空行在上面）
      const p = b && b.previousElementSibling;
      const t = b && atStart(b) && b.textContent.trim() && p && !p.textContent.trim() && !p.querySelector("img") ? p : b;
      if (t) { delete t.dataset.hr; if (t.dataset.h) delete t.dataset.h; if (t.dataset.list === "checked") t.dataset.list = "unchecked"; }
    }
    dirty(); clearTimeout(S.snapT); S.snapT = setTimeout(snap, 400); syncUR();
  }
  function onKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
    if (mod && (e.key === "b" || e.key === "i" || e.key === "u")) { e.preventDefault(); cmd({ b: "bold", i: "italic", u: "underline" }[e.key]); return; }
    if (e.key === "Tab") { e.preventDefault(); cmd(e.shiftKey ? "outdent" : "indent"); return; }
    const b = curBlock(); if (!b) return;
    if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); document.execCommand("insertParagraph"); return; }
    // 空的清单 / 列表行再按回车：退出列表
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && (b.dataset.list || b.dataset.ind) && !b.textContent.trim() && !b.querySelector("img")) {
      e.preventDefault(); snap();
      if (b.dataset.list) delete b.dataset.list; else delete b.dataset.ind;
      dirty(); syncBar(); return;
    }
    // 行首按退格：先去掉列表 / 标题 / 缩进
    if (e.key === "Backspace" && (b.dataset.list || b.dataset.h || b.dataset.ind) && atStart(b)) {
      e.preventDefault(); snap();
      if (b.dataset.list) delete b.dataset.list; else if (b.dataset.h) delete b.dataset.h; else b.dataset.ind = String(Math.max(0, +b.dataset.ind - 1)) || "";
      if (b.dataset.ind === "0") delete b.dataset.ind;
      dirty(); syncBar(); return;
    }
    if (e.key === "Backspace" && atStart(b) && b.previousElementSibling && b.previousElementSibling.dataset.hr !== undefined) { e.preventDefault(); snap(); b.previousElementSibling.remove(); dirty(); }
  }
  // 点清单前面的小方框：勾上 / 取消
  function onEdDown(e) {
    let b = e.target; while (b && b.parentNode !== ed) b = b.parentNode;
    if (!b || b.nodeType !== 1 || !/^(un)?checked$/.test(b.dataset.list || "")) return;
    const x = e.clientX - b.getBoundingClientRect().left;
    if (x < 0 || x > 28) return;
    e.preventDefault(); snap();
    b.dataset.list = b.dataset.list === "checked" ? "unchecked" : "checked";
    dirty(); snap();
  }
  function onPaste(e) {
    const cd = e.clipboardData; if (!cd) return;
    const fs = [...cd.files].filter((f) => /^image\//.test(f.type));
    if (fs.length) { e.preventDefault(); fs.forEach((f) => addImageFile(f)); return; }
    // 只粘文字（别处网页的样式不要），一行一个 div
    const t = cd.getData("text/plain");
    if (t != null) { e.preventDefault(); snap(); document.execCommand("insertText", false, t.replace(/\r/g, "")); }
  }
  function caretTo(b, end) { const r = document.createRange(); r.selectNodeContents(b); r.collapse(!end); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  function focusEnd() { ed.focus(); const b = ed.lastElementChild; if (b && b.dataset.hr === undefined) caretTo(b, true); else if (b) { const d = document.createElement("div"); d.appendChild(document.createElement("br")); ed.appendChild(d); caretTo(d, false); } }

  // ---------- 工具栏 ----------
  function syncBar() {
    const on = (c, v) => { const b = barEl.querySelector(`[data-c="${c}"]`); if (b) b.classList.toggle("on", !!v); };
    // 只看光标所在文字自己的格式（标题本来就粗、勾过的清单本来就有删除线，不算）
    const b = curBlock(), d = (b && b.dataset) || {}, st = {};
    const sel = getSelection();
    let n = sel.rangeCount && ed.contains(sel.anchorNode) ? sel.anchorNode : null;
    if (n && n.nodeType === 3) n = n.parentNode;
    while (n && n !== b && n !== ed) {
      const tg = n.tagName, ss = n.style || {}, td = String(ss.textDecoration || ss.textDecorationLine || "");
      if (tg === "B" || tg === "STRONG" || ss.fontWeight === "bold" || +ss.fontWeight >= 600) st.bold = true;
      if (tg === "I" || tg === "EM" || ss.fontStyle === "italic") st.italic = true;
      if (tg === "U" || td.indexOf("underline") >= 0) st.underline = true;
      if (tg === "S" || tg === "STRIKE" || tg === "DEL" || td.indexOf("line-through") >= 0) st.strike = true;
      n = n.parentNode;
    }
    on("bold", st.bold); on("italic", st.italic); on("underline", st.underline); on("strike", st.strike);
    on("h1", d.h === "1"); on("h2", d.h === "2"); on("bullet", d.list === "bullet"); on("ordered", d.list === "ordered");
    on("check", d.list === "checked" || d.list === "unchecked");
  }
  function togglePop(k) {
    if (popEl.classList.contains("open") && popEl.dataset.k === k) return closePop();
    popEl.dataset.k = k;
    if (k === "color") popEl.innerHTML = "文字颜色 " + COLORS.map(([c, n]) => `<button class="nt-sw" data-v="${c}" title="${n}" style="${c ? "background:" + c + ";border-color:" + c : ""}">${c ? "" : "默认"}</button>`).join("");
    if (k === "hl") popEl.innerHTML = "高亮 " + HL.map(([c, n]) => `<button class="nt-sw" data-v="${c}" title="${n}" style="${c ? "background:" + c + ";border-color:" + c : ""}">${c ? "" : "无"}</button>`).join("");
    if (k === "kind") popEl.innerHTML = "类型 " + KINDS.map((c, i) => `<button class="nt-btn" data-v="${c}">${KIND_N[i]}</button>`).join("");
    if (k === "kind") metaEl.after(popEl); else barEl.after(popEl);
    popEl.classList.add("open");
  }
  function closePop() { if (popEl) { popEl.classList.remove("open"); barEl.after(popEl); } }
  function inlineColor(c, v) {
    ed.focus(); snap();
    try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
    if (c === "foreColor") document.execCommand("foreColor", false, v || getComputedStyle(ed).color);
    else document.execCommand("hiliteColor", false, v || "transparent");
    try { document.execCommand("styleWithCSS", false, false); } catch (e) {}
    dirty(); snap();
  }
  function setBlocks(fn) {
    ed.focus(); snap();
    let bs = selBlocks(); if (!bs.length) { const b = curBlock(); if (b) bs = [b]; }
    if (!bs.length) { ensureBlocks(); bs = [ed.lastElementChild]; }
    fn(bs); dirty(); snap(); syncBar();
  }
  function cmd(c) {
    if (c === "undo") return undo();
    if (c === "redo") return redo();
    if (c === "color" || c === "hl") return togglePop(c);
    closePop();
    if (c === "img") { ov.querySelector(".nt-file").click(); return; }
    if (c === "draw") { openDraw(); return; }
    if (["bold", "italic", "underline", "strike"].includes(c)) {
      ed.focus(); snap(); try { document.execCommand("styleWithCSS", false, false); } catch (e) {}
      document.execCommand(c === "strike" ? "strikeThrough" : c); dirty(); snap(); syncBar(); return;
    }
    if (c === "h1" || c === "h2") { const v = c.slice(1); return setBlocks((bs) => { const all = bs.every((b) => b.dataset.h === v); bs.forEach((b) => { if (all) delete b.dataset.h; else { b.dataset.h = v; delete b.dataset.list; } }); }); }
    if (c === "bullet" || c === "ordered") return setBlocks((bs) => { const all = bs.every((b) => b.dataset.list === c); bs.forEach((b) => { if (all) delete b.dataset.list; else { b.dataset.list = c; delete b.dataset.h; } }); });
    if (c === "check") return setBlocks((bs) => { const all = bs.every((b) => /^(un)?checked$/.test(b.dataset.list || "")); bs.forEach((b) => { if (all) delete b.dataset.list; else { if (!/^(un)?checked$/.test(b.dataset.list || "")) b.dataset.list = "unchecked"; delete b.dataset.h; } }); });
    if (c === "indent" || c === "outdent") return setBlocks((bs) => bs.forEach((b) => { const n = Math.max(0, Math.min(6, (+b.dataset.ind || 0) + (c === "indent" ? 1 : -1))); if (n) b.dataset.ind = String(n); else delete b.dataset.ind; }));
    if (c === "clear") { ed.focus(); snap(); document.execCommand("removeFormat"); selBlocks().forEach((b) => { delete b.dataset.h; delete b.dataset.list; delete b.dataset.ind; }); dirty(); snap(); syncBar(); return; }
    if (c === "stamp") { ed.focus(); const d = new Date(); document.execCommand("insertText", false, (d.getMonth() + 1) + "月" + d.getDate() + "日 " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + " "); return; }
    if (c === "hr") { insertBlocks([hrBlock()]); return; }
  }
  // 在光标那一行后面插入几行（图片、分割线），后面再留一行空的接着写
  function insertBlocks(nodes) {
    ed.focus(); snap();
    let b = curBlock();
    const empty = b && !b.textContent.trim() && !b.querySelector("img") && b.dataset.hr === undefined;
    let at = b ? b.nextSibling : null;
    if (!b) at = null;
    nodes.forEach((n) => ed.insertBefore(n, at));
    if (empty) b.remove();
    let next = nodes[nodes.length - 1].nextElementSibling;
    if (!next || next.dataset.hr !== undefined || next.querySelector("img")) { next = document.createElement("div"); next.appendChild(document.createElement("br")); ed.insertBefore(next, nodes[nodes.length - 1].nextSibling); }
    caretTo(next, false);
    dirty(); snap();
  }

  // ---------- 图片 ----------
  async function resolveImg(im, k) {
    let url = urls.get(k);
    if (!url) {
      const b = await IDB.get(k);
      if (b) url = URL.createObjectURL(b);
    }
    if (!url) {
      const fid = S.fmap[k];
      if (fid && window.CCAuth && typeof currentUser !== "undefined" && currentUser) {
        try {
          if (!S.files) S.files = CCAuth.rpc("file_list", { cid: null, item: S.id }).then((l) => l || []).catch(() => []);
          const f = (await S.files).find((x) => x.id === fid);
          if (f && window.exFetchBlob) { const b = await exFetchBlob(fid, f.parts, f.mime); url = URL.createObjectURL(b); IDB.put(k, b); }
        } catch (e) {}
      }
    }
    if (url) { urls.set(k, url); im.src = url; im.classList.remove("miss"); im.alt = ""; }
    else { im.alt = S.fmap[k] ? "图片没下载下来（登录后再打开试试）" : "图片在另一台设备上，这里没有"; im.removeAttribute("src"); }
  }
  async function addImageFile(file, ext) {
    if (!file) return;
    const k = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    let blob = file;
    try { blob = await shrinkImg(file); } catch (e) {}
    const url = URL.createObjectURL(blob); urls.set(k, url); IDB.put(k, blob);
    const im = document.createElement("img"); im.className = "nt-img"; im.contentEditable = "false"; im.dataset.k = k; im.dataset.src = "web:" + k; im.src = url;
    const d = document.createElement("div"); d.appendChild(im);
    insertBlocks([d]);
    flush(true);
    upload(k, blob, ext || (blob.type === "image/png" ? "png" : "jpg"));
  }
  async function shrinkImg(f) {
    if (!/^image\/(jpeg|png|webp)/.test(f.type) || f.size < 1.2 * 1024 * 1024) return f;
    const bmp = await createImageBitmap(f), s = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((ok) => c.toBlob((b) => ok(b || f), "image/jpeg", 0.85));
  }
  // 登录了、开着云端同步、这条不是「只存本机」：传成附件，换手机也能看
  async function upload(k, blob, ext) {
    const id = S.id, rec = recOf(id);
    const can = window.exUploadTo && typeof currentUser !== "undefined" && currentUser && typeof Sync !== "undefined" && Sync.active() && !(rec && rec.local);
    if (!can) { if (!S.warned) { S.warned = true; say("图片先存在这台电脑的浏览器里（登录并开云端同步后，换手机也能看到）"); } return; }
    const file = new File([blob], (ext === "png" ? "手写" : "图片") + "_" + k + "." + ext, { type: blob.type || (ext === "png" ? "image/png" : "image/jpeg") });
    const out = [];
    await exUploadTo(null, id, [file], (t) => { if (S.id === id && S.mode === "edit") savedEl.textContent = t.replace(/「[^」]*」/, "图片"); }, out);
    if (!out[0]) return;
    if (S.id === id && S.mode === "edit") { S.fmap[k] = out[0]; S.dirty = true; flush(); }
    else { const r = recOf(id); if (r && r.rich) { r.rich.f = Object.assign({}, r.rich.f || {}, { [k]: out[0] }); save(LS_MINE, mine); } }
  }

  // ---------- 手写 ----------
  const D = { pen: "pen", ink: INKS[0], paper: "line", strokes: [], redo: [], cur: null, w: 0, hgt: 0, dpr: 1 };
  function buildDraw() {
    if (drawEl) return;
    drawEl = document.createElement("div"); drawEl.className = "nt-draw";
    drawEl.innerHTML = `<div class="nt-dbox">
      <div class="nt-dtools" data-g="pen">${PENS.map((p) => `<button class="nt-btn" data-pen="${p[0]}">${p[1]}</button>`).join("")}<span class="sp" style="flex:1"></span>
        <button class="nt-btn" data-d="undo">↶</button><button class="nt-btn" data-d="redo">↷</button><button class="nt-btn" data-d="clear">清空</button></div>
      <div class="nt-dtools">${INKS.map((c) => `<button class="nt-sw" data-ink="${c}" style="background:${c};border-color:${c}"></button>`).join("")}<span style="flex:1"></span>
        ${PAPERS.map((p) => `<button class="nt-btn" data-paper="${p[0]}">${p[1]}</button>`).join("")}</div>
      <div class="nt-cv"><canvas class="bg"></canvas><canvas class="fg"></canvas></div>
      <div class="nt-dtools"><span class="nt-saved">用鼠标、触屏或手写笔都可以</span><span style="flex:1"></span><button class="nt-btn" data-d="cancel">取消</button><button class="nt-btn pri" data-d="ok">插入备忘</button></div>
    </div>`;
    document.body.appendChild(drawEl);
    const fg = drawEl.querySelector("canvas.fg");
    drawEl.onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.pen) D.pen = b.dataset.pen;
      if (b.dataset.ink) { D.ink = b.dataset.ink; if (D.pen === "eraser") D.pen = "pen"; }
      if (b.dataset.paper) { D.paper = b.dataset.paper; paintPaper(drawEl.querySelector("canvas.bg").getContext("2d"), D.w, D.hgt, D.dpr); }
      const d = b.dataset.d;
      if (d === "undo" && D.strokes.length) { D.redo.push(D.strokes.pop()); redraw(); }
      if (d === "redo" && D.redo.length) { D.strokes.push(D.redo.pop()); redraw(); }
      if (d === "clear" && D.strokes.length && confirm("清空这张？")) { D.redo = D.strokes.splice(0).reverse(); redraw(); }
      if (d === "cancel") { if (!D.strokes.length || confirm("不插入这张手写了？")) closeDraw(); }
      if (d === "ok") finishDraw();
      syncDraw();
    };
    const pt = (e) => { const r = fg.getBoundingClientRect(); return [(e.clientX - r.left) * (D.w / r.width), (e.clientY - r.top) * (D.hgt / r.height)]; };
    fg.addEventListener("pointerdown", (e) => {
      e.preventDefault(); fg.setPointerCapture(e.pointerId);
      const p = PENS.find((x) => x[0] === D.pen);
      D.cur = { pen: D.pen, ink: D.ink, w: p[2], a: p[3], pts: [pt(e)] }; D.strokes.push(D.cur); D.redo = []; redraw(); syncDraw();
    });
    fg.addEventListener("pointermove", (e) => { if (!D.cur) return; e.preventDefault(); const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; evs.forEach((x) => D.cur.pts.push(pt(x))); redraw(); });
    const up = () => { D.cur = null; };
    fg.addEventListener("pointerup", up); fg.addEventListener("pointercancel", up);
    document.addEventListener("keydown", (e) => { if (drawEl.classList.contains("open") && e.key === "Escape") { e.preventDefault(); drawEl.querySelector('[data-d="cancel"]').click(); } });
  }
  function syncDraw() {
    drawEl.querySelectorAll("[data-pen]").forEach((b) => b.classList.toggle("on", b.dataset.pen === D.pen));
    drawEl.querySelectorAll("[data-ink]").forEach((b) => b.classList.toggle("on", b.dataset.ink === D.ink));
    drawEl.querySelectorAll("[data-paper]").forEach((b) => b.classList.toggle("on", b.dataset.paper === D.paper));
    drawEl.querySelector('[data-d="undo"]').disabled = !D.strokes.length; drawEl.querySelector('[data-d="redo"]').disabled = !D.redo.length;
  }
  function paintPaper(g, w, hh, dpr) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = PAPER_BG; g.fillRect(0, 0, w, hh);
    if (D.paper === "plain") return;
    g.strokeStyle = D.paper === "line" ? "rgba(62,99,221,.18)" : "rgba(0,0,0,.08)"; g.lineWidth = 1;
    const step = D.paper === "line" ? 32 : 24;
    g.beginPath();
    for (let y = step; y < hh; y += step) { g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); }
    if (D.paper === "grid") for (let x = step; x < w; x += step) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, hh); }
    g.stroke();
  }
  function drawStrokes(g, dpr) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, D.w, D.hgt);
    D.strokes.forEach((s) => {
      g.save();
      g.globalCompositeOperation = s.pen === "eraser" ? "destination-out" : s.pen === "hl" ? "multiply" : "source-over";
      g.globalAlpha = s.a; g.strokeStyle = s.ink; g.fillStyle = s.ink; g.lineWidth = s.w; g.lineCap = s.pen === "hl" ? "butt" : "round"; g.lineJoin = "round";
      const p = s.pts;
      if (p.length === 1) { g.beginPath(); g.arc(p[0][0], p[0][1], s.w / 2, 0, Math.PI * 2); g.fill(); }
      else {
        g.beginPath(); g.moveTo(p[0][0], p[0][1]);
        for (let i = 1; i < p.length - 1; i++) { const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2; g.quadraticCurveTo(p[i][0], p[i][1], mx, my); }
        g.lineTo(p[p.length - 1][0], p[p.length - 1][1]); g.stroke();
      }
      g.restore();
    });
  }
  function redraw() { drawStrokes(drawEl.querySelector("canvas.fg").getContext("2d"), D.dpr); }
  function openDraw() {
    buildDraw(); flush(true);
    D.strokes = []; D.redo = []; D.cur = null;
    drawEl.classList.add("open");
    const box = drawEl.querySelector(".nt-cv"), w = Math.round(box.clientWidth || 600);
    const hh = Math.round(Math.min(window.innerHeight - 230, w * 0.75));
    D.w = w; D.hgt = Math.max(220, hh); D.dpr = Math.min(3, window.devicePixelRatio || 1);
    drawEl.querySelectorAll("canvas").forEach((c) => { c.width = Math.round(D.w * D.dpr); c.height = Math.round(D.hgt * D.dpr); c.style.height = D.hgt + "px"; });
    paintPaper(drawEl.querySelector("canvas.bg").getContext("2d"), D.w, D.hgt, D.dpr); redraw(); syncDraw();
  }
  function closeDraw() { if (drawEl) drawEl.classList.remove("open"); }
  function finishDraw() {
    if (!D.strokes.length) { closeDraw(); return; }
    const c = document.createElement("canvas"); c.width = Math.round(D.w * D.dpr); c.height = Math.round(D.hgt * D.dpr);
    const g = c.getContext("2d"); paintPaper(g, D.w, D.hgt, D.dpr); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(drawEl.querySelector("canvas.fg"), 0, 0);
    c.toBlob((b) => { closeDraw(); if (b) addImageFile(b, "png"); }, "image/png");
  }

  window.NoteUI = { open, list, close, isOpen: () => !!(ov && ov.classList.contains("open")), _toOps: () => toOps(), _setOps: (o) => setOps(o) };
})();
