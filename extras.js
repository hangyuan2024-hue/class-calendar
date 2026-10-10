// 事项附件（图片、文件）+ 过期 2 周自动删除（最后 3 天提醒，可推迟 3 天；日历可关）
// 数据接口在 deploy/homework.sql。和 app.js 共用全局变量（mine、classRecords、currentClass、save、renderAll…）
(function () {
  const LS_PREF = "autodel_v1", LS_GRACE = "autodel_grace_v1";
  const EX = { cid: null, autodel: true, canSet: false, keep: {}, files: {}, loaded: false };
  window.EX = EX;
  const dkey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayK = () => dkey(typeof ccDate === "function" ? ccDate() : new Date());
  const addD = (k, n) => { const d = new Date(k + "T00:00:00"); d.setDate(d.getDate() + n); return dkey(d); };
  const diffD = (a, b) => Math.round((new Date(a + "T00:00:00") - new Date(b + "T00:00:00")) / 86400000);
  const pref = () => ({ cal: true, ...(load(LS_PREF, {}) || {}) });
  const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";

  // ---------- 自动删除 ----------
  // 这一条什么时候自动删（返回日期；不会自动删的返回 null）
  function expiry(r) {
    if (!r || r._plugin || r._study || !r._p || !r._p.day) return null;
    let keep = "";
    if (r._mine) { if (!pref().cal) return null; keep = r.keep || ""; }
    else { if (r.msg_type !== "作业" && !EX.autodel) return null; keep = EX.keep[r._key] || ""; }
    const base = addD(r._p.day, 14);
    return keep > base ? keep : base;
  }
  const daysLeft = (r) => { const e = expiry(r); return e ? diffD(e, todayK()) : null; };
  // 快要删了（3 天内）
  const soon = (r) => { const n = daysLeft(r); return n != null && n <= 3; };
  function badge(r) {
    const n = daysLeft(r); if (n == null || n > 3) return "";
    return `<div class="adwarn">🗑 ${n <= 0 ? "今天过后" : n + " 天后"}自动删除<button class="link" data-keep="${esc(r._key)}">推迟删除（多留 3 天）</button></div>`;
  }
  window.exBadge = badge; window.exSoon = soon;

  async function keep(k) {
    const today = todayK();
    if (k.startsWith("c")) {
      const r = (classRecords || []).find((x) => "c" + x.id === k); if (!r || !currentClass) return;
      const res = await CCAuth.rpc("item_keep", { cid: currentClass.id, item_id: r.id });
      EX.keep[k] = res.keep_until;
      toast2(`已推迟，${mdOf(res.keep_until)}之后才会删除`);
    } else {
      const i = mine.findIndex((x) => x.id === k); if (i < 0) return;
      const r = { ...mine[i], _mine: true, _p: parseTime(mine[i].event_time) }, e = expiry(r) || today;
      mine[i].keep = addD(e > today ? e : today, 3); save(LS_MINE, mine);
      toast2(`已推迟，${mdOf(mine[i].keep)}之后才会删除`);
    }
    renderAll();
  }
  function toast2(t) {
    let el = document.getElementById("exToast");
    if (!el) { el = document.createElement("div"); el.id = "exToast"; el.className = "extoast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = t; el.classList.add("show"); clearTimeout(toast2._t); toast2._t = setTimeout(() => el.classList.remove("show"), 2600);
  }

  // 自己记的：本机按规则删（第一次用时，已经过期的先多留 3 天）
  function cleanMine() {
    const today = todayK();
    if (!load(LS_GRACE, false)) {
      let ch = false;
      mine.forEach((m) => { const r = { ...m, _mine: true, _p: parseTime(m.event_time) }, e = expiry({ ...r, keep: "" }); if (e && e < addD(today, 3)) { m.keep = addD(today, 3); ch = true; } });
      if (ch) save(LS_MINE, mine);
      save(LS_GRACE, true);
      return;
    }
    if (!pref().cal) return;
    const gone = mine.filter((m) => { const e = expiry({ ...m, _mine: true, _p: parseTime(m.event_time) }); return e && e < today; });
    if (!gone.length) return;
    const ids = new Set(gone.map((m) => m.id));
    mine = mine.filter((m) => !ids.has(m.id)); save(LS_MINE, mine);
    if (currentUser) CCAuth.rpc("file_del_items", { items: [...ids] }).catch(() => {});
  }

  // 打开班级 / 刷新时：服务器顺手删掉过期的班级事项，拿回推迟日期、附件数量
  let loading = null;
  async function load2() {
    if (!currentUser) { cleanMine(); return; }
    if (loading) return loading;
    loading = (async () => {
      try {
        const cid = currentClass ? currentClass.id : null;
        const r = await CCAuth.rpc("item_extras", { cid });
        EX.cid = cid; EX.autodel = r.autodel !== false; EX.canSet = !!r.can_set; EX.keep = r.keep || {}; EX.files = r.files || {}; EX.loaded = true;
        if (r.deleted && r.deleted.length && classRecords) {
          const g = new Set(r.deleted.map(String));
          classRecords = classRecords.filter((x) => !g.has(String(x.id)));
        }
      } catch (e) { /* 数据库还没升级：不影响别的功能 */ }
      cleanMine();
      renderAll();
    })().finally(() => { loading = null; });
    return loading;
  }
  window.exLoad = load2;

  // 日历上方：自动删除的开关
  function renderBar() {
    const bar = $("autodelBar"); if (!bar) return;
    const p = pref();
    bar.innerHTML = `<span class="ad-t">🗑 过期 2 周自动删除</span>
      <span class="ad-i">作业：总是</span>
      ${currentClass ? `<label class="ad-i" title="${EX.canSet ? "本班的会议、活动、通知过期 2 周后自动删除" : "老师和有编辑权限的班委可以改"}"><input type="checkbox" data-adcls ${EX.autodel ? "checked" : ""} ${EX.canSet ? "" : "disabled"}>本班其它事项</label>` : ""}
      <label class="ad-i"><input type="checkbox" data-admine ${p.cal ? "checked" : ""}>我自己记的</label>
      <span class="ad-h">最后 3 天会提醒，点「推迟删除」多留 3 天</span>`;
  }
  // 作业页、日历：快要自动删除的列表
  function renderSoon() {
    for (const id of ["adSoonHw", "adSoonCal"]) {
      const box = $(id); if (!box) continue;
      const list = allItems().filter((r) => (id === "adSoonHw" ? r.msg_type === "作业" : true) && soon(r))
        .sort((a, b) => (expiry(a) || "").localeCompare(expiry(b) || ""));
      box.classList.toggle("hidden", !list.length);
      box.innerHTML = list.length ? `<div class="ads-h">🗑 ${list.length} 项快要自动删除了 <small>（日期过去 2 周）想留着就点「推迟删除」</small></div>
        ${list.slice(0, 20).map((r) => { const n = daysLeft(r); return `<div class="ads-r"><span class="ads-d">${n <= 0 ? "今天过后" : n + " 天后"}</span><b>${esc(r.subject || r.summary || r.msg_type)}</b><span class="ads-m">${esc(r._mine ? "我的" : r.msg_type)} · ${esc(r._p.day.slice(5))}</span>${EX.files[r._key] ? `<span class="ads-m">📎 ${EX.files[r._key]}</span>` : ""}<button class="small" data-keep="${esc(r._key)}">推迟删除</button></div>`; }).join("")}` : "";
    }
  }
  window.exRender = () => { try { renderBar(); renderSoon(); } catch (e) { console.error(e); } };

  document.addEventListener("change", async (e) => {
    if (e.target.matches("[data-admine]")) { save(LS_PREF, { ...pref(), cal: e.target.checked }); renderAll(); }
    if (e.target.matches("[data-adcls]") && currentClass) {
      const on = e.target.checked;
      try { EX.autodel = await CCAuth.rpc("class_autodel_set", { cid: currentClass.id, on_: on }); renderAll(); }
      catch (err) { alert(err.message); e.target.checked = !on; }
    }
  });
  document.addEventListener("click", async (e) => {
    const k = e.target.closest("[data-keep]");
    if (k) { e.preventDefault(); e.stopPropagation(); k.disabled = true; try { await keep(k.dataset.keep); } catch (err) { alert(err.message); k.disabled = false; } return; }
    const f = e.target.closest("[data-files]");
    if (f) { e.preventDefault(); e.stopPropagation(); openFiles(f.dataset.files); }
  }, true);

  // ---------- 附件 ----------
  function target(k) {
    if (k.startsWith("c")) {
      const r = (classRecords || []).find((x) => "c" + x.id === k);
      if (!r || !currentClass) return null;
      const me = currentUser && currentUser.id;
      return { r, cid: currentClass.id, item: String(r.id), canWrite: (typeof canEditIn === "function" && canEditIn(r.group_id)) || (me && r.created_by === me) };
    }
    const r = mine.find((x) => x.id === k);
    return r ? { r, cid: null, item: k, canWrite: true } : null;
  }
  function filesBtn(r) {
    if (!currentUser || r._plugin || r._study) return "";
    const n = EX.files[r._key] || 0, t = target(r._key);
    if (!n && !(t && t.canWrite)) return "";
    return `<button class="link" data-files="${esc(r._key)}">📎 ${n ? `附件（${n}）` : "加图片 / 文件"}</button>`;
  }
  window.exFilesBtn = filesBtn;
  window.exFilesTag = (r) => (EX.files[r._key] ? `<span class="afile" title="有 ${EX.files[r._key]} 个附件">📎${EX.files[r._key]}</span>` : "");

  let dlg = null, cur = null;
  function ensureDlg() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog"); dlg.className = "dlg kn-dlg exfiles"; dlg.id = "exFilesDlg";
    document.body.appendChild(dlg);
    dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-xclose]")) dlg.close(); });
    return dlg;
  }
  async function openFiles(k) {
    const t = target(k); if (!t) return;
    cur = { k, ...t };
    ensureDlg();
    dlg.innerHTML = `<h3>📎 ${esc(t.r.subject || t.r.summary || "附件")}<small>${t.cid ? "全班都能看到" : "只有你自己能看到"}${t.canWrite ? " · 图片、PDF、Word 等都可以，单个最多 20MB" : ""}</small></h3>
      <div id="xfList" class="xf-list"><div class="meta">加载中…</div></div>
      ${t.canWrite ? `<label class="xf-drop" id="xfDrop">＋ 选择图片或文件（可以多选，也可以拖进来）<input type="file" id="xfInput" multiple hidden></label><div class="meta" id="xfSt"></div>` : ""}
      <div class="nd-actions"><span class="spacer"></span><button class="small" data-xclose>关闭</button></div>`;
    if (!dlg.open) dlg.showModal();
    const inp = dlg.querySelector("#xfInput");
    if (inp) {
      inp.onchange = () => { upload([...inp.files]); inp.value = ""; };
      const drop = dlg.querySelector("#xfDrop");
      ["dragenter", "dragover"].forEach((x) => drop.addEventListener(x, (e) => { e.preventDefault(); drop.classList.add("over"); }));
      ["dragleave", "drop"].forEach((x) => drop.addEventListener(x, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
      drop.addEventListener("drop", (e) => upload([...e.dataTransfer.files]));
    }
    await list();
  }
  async function list() {
    const box = dlg.querySelector("#xfList");
    try {
      const l = await CCAuth.rpc("file_list", { cid: cur.cid, item: cur.item });
      EX.files[cur.k] = l.length;
      box.innerHTML = l.length ? l.map((f) => `<div class="xf-row" data-fid="${esc(f.id)}">
          <span class="xf-ic">${/^image\//.test(f.mime) ? "🖼" : /pdf/.test(f.mime) ? "📕" : /word|document/.test(f.mime) ? "📘" : /sheet|excel/.test(f.mime) ? "📗" : /presentation|powerpoint/.test(f.mime) ? "📙" : "📄"}</span>
          <span class="xf-n"><b>${esc(f.name)}</b><small>${fmtSize(f.size)}${cur.cid && f.by ? " · " + esc(f.by) : ""}</small></span>
          <button class="small" data-xopen="${esc(f.id)}" data-parts="${f.parts}" data-name="${esc(f.name)}" data-mime="${esc(f.mime)}">${/^image\//.test(f.mime) ? "查看" : "下载"}</button>
          ${f.can_del ? `<button class="small" data-xdel="${esc(f.id)}" style="color:var(--red)">删除</button>` : ""}</div><div class="xf-pv hidden" id="pv_${esc(f.id)}"></div>`).join("")
        : `<div class="meta">还没有附件</div>`;
      box.onclick = async (e) => {
        const o = e.target.closest("[data-xopen]"), d = e.target.closest("[data-xdel]");
        if (o) { o.disabled = true; try { await openOne(o.dataset.xopen, +o.dataset.parts, o.dataset.name, o.dataset.mime); } catch (err) { alert(err.message); } o.disabled = false; }
        if (d && confirm("删除这个附件？")) { await CCAuth.rpc("file_del", { fid: d.dataset.xdel }); await list(); renderAll(); }
      };
    } catch (e) { box.innerHTML = `<div class="meta">${esc(e.message)}</div>`; }
  }
  const blobCache = new Map();
  async function fetchBlob(fid, parts, mime) {
    if (blobCache.has(fid)) return blobCache.get(fid);
    const chunks = [];
    for (let i = 0; i < parts; i++) {
      const r = await CCAuth.rpc("file_get", { fid, n: i });
      const bin = atob(r.data), u = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) u[j] = bin.charCodeAt(j);
      chunks.push(u);
    }
    const b = new Blob(chunks, { type: mime || "application/octet-stream" });
    blobCache.set(fid, b);
    return b;
  }
  async function openOne(fid, parts, name, mime) {
    const b = await fetchBlob(fid, parts, mime), url = URL.createObjectURL(b);
    if (/^image\//.test(mime)) {
      const pv = dlg.querySelector("#pv_" + CSS.escape(fid));
      pv.classList.toggle("hidden"); pv.innerHTML = `<img src="${url}" alt="${esc(name)}"><a class="small" href="${url}" download="${esc(name)}">下载原图</a>`;
      return;
    }
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000);
  }
  // 大图先压一压（长边 2400，JPEG 0.85），省流量；GIF、小图、非图片原样传
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp|heic)/.test(file.type) || file.size < 1.5 * 1024 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file);
      const s = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const b = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
      return b && b.size < file.size ? new File([b], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
    } catch (e) { return file; }
  }
  const CH = 600 * 1024;
  async function upload(files) {
    const st = dlg.querySelector("#xfSt");
    for (const f0 of files) {
      if (f0.size > 20 * 1024 * 1024) { st.textContent = `「${f0.name}」太大了（单个最多 20MB）`; continue; }
      const f = await shrink(f0);
      const buf = new Uint8Array(await f.arrayBuffer()), parts = Math.max(1, Math.ceil(buf.length / CH));
      try {
        st.textContent = `正在上传「${f.name}」…`;
        const { id } = await CCAuth.rpc("file_begin", { cid: cur.cid, item: cur.item, fname: f.name, fmime: f.type || "", fsize: buf.length, nparts: parts });
        for (let i = 0; i < parts; i++) {
          const part = buf.subarray(i * CH, (i + 1) * CH);
          let s = ""; for (let j = 0; j < part.length; j += 0x8000) s += String.fromCharCode.apply(null, part.subarray(j, j + 0x8000));
          await CCAuth.rpc("file_part", { fid: id, n: i, b64: btoa(s) });
          st.textContent = `正在上传「${f.name}」… ${Math.round(((i + 1) / parts) * 100)}%`;
        }
        await CCAuth.rpc("file_end", { fid: id });
        st.textContent = `「${f.name}」上传好了 ✓`;
      } catch (err) { st.textContent = `「${f.name}」上传失败：${err.message}`; }
    }
    await list(); renderAll();
  }
})();
