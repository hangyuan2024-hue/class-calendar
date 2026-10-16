/* 5.8.0 作业页：已读人数 + 已读名单（发布人 / 老师 / 班委）+ 图片附件直接显示小图
 * 依赖 app.js 的全局：currentUser currentClass classRecords mine esc renderAll；extras.js 的 EX、exFetchBlob、exMakeThumb
 * 数据库函数在 5.8.0 SQL：item_seen item_view_counts item_viewers item_files_many file_thumb */
(function () {
  "use strict";
  const HP = { counts: null, cid: null, at: 0, files: {}, filesAt: {}, seen: new Set(), busy: false, ok: true };
  window.HP = HP;
  const hasDb = () => HP.ok && typeof CCAuth !== "undefined" && currentUser;

  // ---------- 作业行里插入的两块：小图、已读 ----------
  window.hwPlusRow = function (r) {
    if (!currentUser || r._plugin || r._study) return "";
    const k = esc(r._key);
    let read = "";
    if (!r._mine && currentClass && HP.counts && HP.cid === currentClass.id) {
      const c = HP.counts, id = String(r.id), v = (c.views && c.views[id]) || 0, d = (c.done && c.done[id]) || 0;
      const canList = c.can_list || (c.mine || []).map(String).includes(id);
      const t = `👀 已读 ${v}/${c.total}${d ? ` · ✓ 完成 ${d}` : ""}`;
      read = canList ? `<button class="hw-read link" data-viewers="${esc(id)}" title="看看谁看过、谁还没看">${t} ›</button>` : `<span class="hw-read">${t}</span>`;
    }
    const n = (typeof EX !== "undefined" && EX.files[r._key]) || 0;
    const thumbs = n ? `<div class="hw-thumbs" data-hwt="${k}">${thumbHtml(r._key)}</div>` : "";
    return thumbs || read ? `<div class="hw-plus">${thumbs}${read}</div>` : "";
  };
  function thumbHtml(key) {
    const l = HP.files[key];
    if (!l) return `<span class="hw-tload">📎 附件加载中…</span>`;
    return l.map((f) => {
      const img = /^image\//.test(f.mime);
      if (img && f._src) return `<button class="hw-th" data-hwimg="${esc(f.id)}" data-key="${esc(key)}" title="${esc(f.name)}"><img src="${f._src}" alt="${esc(f.name)}" loading="lazy"></button>`;
      if (img) return `<button class="hw-th ph" data-hwimg="${esc(f.id)}" data-key="${esc(key)}" title="${esc(f.name)}">🖼<small>${esc(short(f.name))}</small></button>`;
      return `<button class="hw-fl" data-files="${esc(key)}" title="${esc(f.name)}">${/pdf/.test(f.mime) ? "📕" : /word|document/.test(f.mime) ? "📘" : "📄"} ${esc(short(f.name))}</button>`;
    }).join("");
  }
  const short = (s) => (s || "").length > 14 ? s.slice(0, 6) + "…" + s.slice(-6) : s || "";

  // ---------- 作业页画完以后：记已读、拿人数、拿附件 ----------
  window.hwPlusAfter = async function (items) {
    if (!hasDb()) return;
    const cid = currentClass ? currentClass.id : null;
    const cls = items.filter((r) => !r._mine && !r._plugin && !r._study && r.id != null);
    // 1. 记已读（每条每次打开网页只记一次）
    if (cid && cls.length) {
      const ids = cls.map((r) => Number(r.id)).filter((x) => x && !HP.seen.has(cid + ":" + x));
      if (ids.length) {
        ids.forEach((x) => HP.seen.add(cid + ":" + x));
        CCAuth.rpc("item_seen", { cid, ids: ids.slice(0, 200) }).catch(noDb);
      }
    }
    let changed = false;
    // 2. 已读人数（1 分钟内不重复拿）
    if (cid && cls.length && (HP.cid !== cid || Date.now() - HP.at > 60000)) {
      HP.at = Date.now();
      try { HP.counts = await CCAuth.rpc("item_view_counts", { cid }); HP.cid = cid; changed = true; } catch (e) { noDb(e); }
    }
    // 3. 有附件的：一次拿齐附件列表（含小图）
    const want = (cidv, list) => list.filter((r) => (EX.files[r._key] || 0) > 0 && (!HP.files[r._key] || Date.now() - (HP.filesAt[r._key] || 0) > 300000));
    const needC = cid ? want(cid, cls) : [], needM = want(null, items.filter((r) => r._mine));
    for (const [c, list] of [[cid, needC], [null, needM]]) {
      if (!list.length) continue;
      try {
        const m = await CCAuth.rpc("item_files_many", { cid: c, keys: list.slice(0, 60).map((r) => r._mine ? r._key : String(r.id)) });
        for (const r of list) {
          const l = (m && m[r._mine ? r._key : String(r.id)]) || [];
          l.forEach((f) => { if (f.thumb) f._src = "data:image/jpeg;base64," + f.thumb; });
          HP.files[r._key] = l; HP.filesAt[r._key] = Date.now();
        }
        changed = true;
      } catch (e) { noDb(e); list.forEach((r) => { HP.files[r._key] = []; }); }
    }
    if (changed) paintAll();
    fillOld();
  };
  function noDb(e) { if (/item_seen|item_view_counts|item_files_many|function|schema cache|PGRST202/i.test(String(e && e.message))) HP.ok = false; }
  // 只更新作业页上的小块，不整页重画（不打断展开的行）
  function paintAll() {
    const box = document.getElementById("hwView"); if (!box) return;
    box.querySelectorAll(".arow[data-row]").forEach((row) => {
      const k = row.dataset.row, r = findItem(k); if (!r) return;
      const old = row.querySelector(".hw-plus"), html = window.hwPlusRow(r);
      if (old) old.outerHTML = html || ""; else if (html) row.querySelector(".abody").insertAdjacentHTML("beforeend", html);
    });
  }
  function findItem(k) {
    if (k.startsWith("c")) { const r = (classRecords || []).find((x) => "c" + x.id === k); return r ? { ...r, _key: k, _mine: false } : null; }
    const r = mine.find((x) => x.id === k); return r ? { ...r, _key: k, _mine: true } : null;
  }

  // 以前传的图片没有小图：小图片（单块）下载下来现做一张，能写的顺便存回去
  let filling = false;
  async function fillOld() {
    if (filling) return; filling = true;
    try {
      for (const key of Object.keys(HP.files)) {
        for (const f of HP.files[key]) {
          if (f._src || f._tried || !/^image\/(jpeg|png|webp|gif)/.test(f.mime) || f.parts > 2 || f.size > 1600000) continue;
          f._tried = true;
          if (!document.querySelector(`[data-hwt="${CSS.escape(key)}"]`)) continue;
          try {
            const b = await window.exFetchBlob(f.id, f.parts, f.mime);
            const t = await window.exMakeThumb(b);
            if (!t) continue;
            f._src = t;
            if (f.can_thumb) CCAuth.rpc("file_thumb", { fid: f.id, b64: t }).catch(() => {});
            const box = document.querySelector(`[data-hwt="${CSS.escape(key)}"]`);
            if (box) box.innerHTML = thumbHtml(key);
          } catch (e) { /* 拿不到就还显示图标 */ }
        }
      }
    } finally { filling = false; }
  }

  // ---------- 点小图：看大图 ----------
  let lb = null;
  async function openImg(key, fid) {
    const l = HP.files[key] || [], imgs = l.filter((f) => /^image\//.test(f.mime));
    let i = Math.max(0, imgs.findIndex((f) => f.id === fid));
    if (!lb) {
      lb = document.createElement("dialog"); lb.className = "hw-lb"; document.body.appendChild(lb);
      lb.addEventListener("click", (e) => {
        if (e.target.closest("[data-lbx]") || e.target === lb) lb.close();
        const nv = e.target.closest("[data-lbn]"); if (nv) show(+nv.dataset.lbn);
      });
      lb.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") show(1); if (e.key === "ArrowLeft") show(-1); });
    }
    let n = i;
    async function show(step) {
      n = step === 0 ? n : (n + step + imgs.length) % imgs.length;
      const f = imgs[n];
      lb.innerHTML = `<div class="hw-lb-bar"><b>${esc(f.name)}</b><small>${imgs.length > 1 ? `${n + 1} / ${imgs.length}` : ""}</small><span class="spacer"></span><a class="small" id="hwLbDl" download="${esc(f.name)}">下载原图</a><button class="small" data-lbx aria-label="关闭">✕</button></div>
        <div class="hw-lb-img">${f._src ? `<img src="${f._src}" alt="" class="blur">` : ""}<span class="hw-lb-st">加载原图…</span></div>
        ${imgs.length > 1 ? `<button class="hw-lb-nav l" data-lbn="-1" aria-label="上一张">‹</button><button class="hw-lb-nav r" data-lbn="1" aria-label="下一张">›</button>` : ""}`;
      try {
        const b = await window.exFetchBlob(f.id, f.parts, f.mime), url = URL.createObjectURL(b);
        if (imgs[n] !== f) return;
        lb.querySelector(".hw-lb-img").innerHTML = `<img src="${url}" alt="${esc(f.name)}">`;
        lb.querySelector("#hwLbDl").href = url;
      } catch (e) { const s = lb.querySelector(".hw-lb-st"); if (s) s.textContent = "原图没加载出来：" + e.message; }
    }
    if (!lb.open) lb.showModal();
    show(0);
  }

  // ---------- 已读名单 ----------
  let vd = null;
  async function openViewers(id, cid, title) {
    cid = cid || (currentClass && currentClass.id); if (!cid) return;
    const r0 = (classRecords || []).find((x) => String(x.id) === String(id)), r = r0 || (title ? { subject: title } : null);
    if (!vd) {
      vd = document.createElement("dialog"); vd.className = "dlg kn-dlg hw-vd"; document.body.appendChild(vd);
      vd.addEventListener("click", (e) => {
        if (e.target === vd || e.target.closest("[data-vx]")) vd.close();
        const t = e.target.closest("[data-vtab]");
        if (t) { vd.querySelectorAll("[data-vtab]").forEach((b) => b.classList.toggle("on", b === t)); vd.querySelectorAll("[data-vpane]").forEach((p) => p.classList.toggle("hidden", p.dataset.vpane !== t.dataset.vtab)); }
        const c = e.target.closest("[data-vcopy]");
        if (c) { const txt = c.dataset.vcopy; (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => { c.textContent = "已复制 ✓"; }).catch(() => prompt("复制下面的名字：", txt)); }
      });
    }
    vd.innerHTML = `<h3>👀 ${esc(r ? r.subject || r.summary || "事项" : "事项")}<small>谁看过、谁还没看（只有发布人、老师、班委能看到这个名单）</small></h3><div class="meta">加载中…</div>`;
    if (!vd.open) vd.showModal();
    try {
      const l = await CCAuth.rpc("item_viewers", { cid, iid: Number(id) });
      const no = l.filter((x) => !x.seen_at), yes = l.filter((x) => x.seen_at), done = l.filter((x) => x.done), seenNot = yes.filter((x) => !x.done);
      const who = (x) => `<span class="hw-vp${x.done ? " ok" : ""}"><span class="av sm">${esc([...(x.name || "?")][0])}</span>${esc(x.name || x.account)}${x.role === "monitor" ? "<i>班委</i>" : ""}${x.seen_at ? `<small>${esc(when(x.seen_at))}</small>` : ""}${x.done ? "<b>✓</b>" : ""}</span>`;
      const pane = (key, list, empty, copy) => `<div data-vpane="${key}" class="hw-vpane${key === "no" ? "" : " hidden"}">${list.length ? list.map(who).join("") : `<div class="meta">${empty}</div>`}${copy && list.length ? `<div class="hw-vcopy"><button class="small" data-vcopy="${esc(list.map((x) => "@" + (x.name || x.account)).join(" "))}">复制名字（发到群里提醒）</button></div>` : ""}</div>`;
      vd.innerHTML = `<h3>👀 ${esc(r ? r.subject || r.summary || "事项" : "事项")}<small>只有发布人、老师、班委能看到这个名单 · 全班 ${l.length} 人</small></h3>
        <div class="hw-vsum"><div><b>${yes.length}</b><span>看过</span></div><div><b>${no.length}</b><span>还没看</span></div><div><b>${done.length}</b><span>标记完成</span></div></div>
        <div class="hw-vtabs"><button class="on" data-vtab="no">还没看（${no.length}）</button><button data-vtab="seen">看过没完成（${seenNot.length}）</button><button data-vtab="done">已完成（${done.length}）</button></div>
        ${pane("no", no, "全班都看过了 🎉", true)}${pane("seen", seenNot, "没有", true)}${pane("done", done, "还没有人标记完成")}
        <p class="meta">「看过」= 打开过作业页或点开过这条；老师自己看不算。「完成」= 同学自己勾了完成。</p>
        <div class="nd-actions"><span class="spacer"></span><button class="small" data-vx>关闭</button></div>`;
    } catch (e) { vd.innerHTML = `<h3>👀 已读名单</h3><div class="meta">${esc(e.message)}</div><div class="nd-actions"><span class="spacer"></span><button class="small" data-vx>关闭</button></div>`; }
  }
  function when(t) {
    const d = new Date(t); if (isNaN(d)) return "";
    const now = new Date(), same = d.toDateString() === now.toDateString();
    const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    return same ? "今天 " + hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }

  document.addEventListener("click", (e) => {
    const v = e.target.closest("[data-viewers]");
    if (v) { e.preventDefault(); e.stopPropagation(); openViewers(v.dataset.viewers); return; }
    const im = e.target.closest("[data-hwimg]");
    if (im) { e.preventDefault(); e.stopPropagation(); openImg(im.dataset.key, im.dataset.hwimg); return; }
    // 在首页 / 日历点开一条班级事项，也算看过
    const row = e.target.closest(".arow[data-row^='c']");
    if (row && hasDb() && currentClass) {
      const id = Number(row.dataset.row.slice(1)), k = currentClass.id + ":" + id;
      if (id && !HP.seen.has(k)) { HP.seen.add(k); CCAuth.rpc("item_seen", { cid: currentClass.id, ids: [id] }).catch(noDb); }
    }
  }, true);
  // 换班、上传附件后：清掉缓存
  window.hwOpenViewers = openViewers;
  window.hwPlusReset = (key) => { if (key) { delete HP.files[key]; delete HP.filesAt[key]; } else { HP.files = {}; HP.filesAt = {}; HP.at = 0; } };
})();
