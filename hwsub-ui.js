// 7.55 网页也能交作业证明（和小程序 1.26 的「交作业」页一样，7.35 SQL：hw_sub_open / hw_file_* / hw_sub_submit）
//   这个班要求交证明时，同学点作业的「完成」→ 打开这个对话框：拍照 / 选图片 / 选文件 → 交给老师 → 待审核
//   被退回的改好再交；已通过的只能看。上传和小程序一样分块（每块 600KB），单个文件最多 10MB，最多 9 个
(function () {
  "use strict";
  const CH = 600 * 1024, MAX = 10 * 1024 * 1024;
  const ST = { draft: ["还没交", ""], pending: ["已交，等老师审核", "wait"], approved: ["老师已通过 ✓", "ok"], rejected: ["被退回了，改好再交", "bad"] };
  const E = (s) => (typeof esc === "function" ? esc(s) : String(s ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";"));
  const sizeText = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  const isImg = (m) => /^image\//.test(m || "");
  const MIME = { pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", txt: "text/plain", zip: "application/zip",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic" };
  const mimeOf = (f) => f.type || MIME[String(f.name || "").split(".").pop().toLowerCase()] || "application/octet-stream";

  try {
    const st = document.createElement("style");
    st.textContent = `.hs-st{font-weight:700;margin:4px 0 2px}.hs-st.wait{color:#c48a00}.hs-st.ok{color:#1f9d55}.hs-st.bad{color:#d64545}
.hs-rn{background:rgba(214,69,69,.08);border-radius:10px;padding:8px 10px;margin-top:8px;font-size:13px}.hs-rn.ok{background:rgba(31,157,85,.09)}
.hs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;margin:12px 0}
.hs-f{position:relative;height:96px;border-radius:12px;overflow:hidden;background:rgba(127,127,127,.1);cursor:pointer;border:0;padding:0;color:inherit;font:inherit}
.hs-f img{width:100%;height:100%;object-fit:cover;display:block}
.hs-doc{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:6px;box-sizing:border-box;font-size:12px;text-align:center;word-break:break-all}
.hs-doc b{font-size:13px;margin-bottom:4px}.hs-sz{position:absolute;left:0;right:0;bottom:0;font-size:11px;background:rgba(0,0,0,.45);color:#fff;padding:1px 4px}
.hs-x{position:absolute;top:3px;right:3px;width:22px;height:22px;border-radius:50%;border:0;background:rgba(0,0,0,.55);color:#fff;font-size:12px;cursor:pointer;line-height:22px;padding:0}
.hs-add{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border:1.5px dashed rgba(127,127,127,.5);background:none}
.hs-add b{font-size:24px;font-weight:400}.hs-add.off{opacity:.45;pointer-events:none}
.hs-note{width:100%;box-sizing:border-box;margin-top:4px}`;
    document.head.appendChild(st);
  } catch (e) {}

  // 大照片先压一下（手机拍的常常 3~8MB）：长边 1600，JPEG
  function shrink(file, side, q) {
    return new Promise((ok) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        try {
          const k = Math.min(1, side / Math.max(im.naturalWidth, im.naturalHeight));
          const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
          c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
          c.toBlob((b) => { URL.revokeObjectURL(url); ok(b); }, "image/jpeg", q);
        } catch (e) { URL.revokeObjectURL(url); ok(null); }
      };
      im.onerror = () => { URL.revokeObjectURL(url); ok(null); };
      im.src = url;
    });
  }
  const b64 = (blob) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => no(new Error("读不了这个文件")); r.readAsDataURL(blob); });

  async function upload(sid, file, say) {
    let blob = file, name = file.name || "文件", mime = mimeOf(file);
    if (isImg(mime) && !/gif|heic/.test(mime) && file.size > 1500 * 1024) {
      const s = await shrink(file, 1600, 0.8);
      if (s && s.size < file.size) { blob = s; mime = "image/jpeg"; name = name.replace(/\.[a-z0-9]+$/i, "") + ".jpg"; }
    }
    if (blob.size > MAX) throw new Error("「" + name + "」太大了（单个最多 10MB）");
    const n = Math.max(1, Math.ceil(blob.size / CH));
    const { id } = await CCAuth.rpc("hw_file_begin", { p_sid: sid, fname: name, fmime: mime, fsize: blob.size, nparts: n });
    for (let i = 0; i < n; i++) {
      await CCAuth.rpc("hw_file_part", { fid: id, n: i, b64: await b64(blob.slice(i * CH, (i + 1) * CH)) });
      say(Math.round(((i + 1) / n) * 100));
    }
    let thumb = "";
    if (isImg(mime)) { const t = await shrink(blob, 360, 0.55); if (t) { thumb = await b64(t).catch(() => ""); if (thumb.length > 150000) thumb = ""; } }
    return CCAuth.rpc("hw_file_end", { fid: id, p_thumb: thumb || null });
  }
  async function openFile(f) {
    const w = window.open("", "_blank");
    try {
      const parts = [];
      for (let i = 0; i < (f.parts || 1); i++) {
        const r = await CCAuth.rpc("hw_file_get", { fid: f.id, n: i });
        const bin = atob(String((r && r.data) || "").replace(/[^A-Za-z0-9+/=]/g, "")), u = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) u[j] = bin.charCodeAt(j);
        parts.push(u);
      }
      const url = URL.createObjectURL(new Blob(parts, { type: f.mime || "application/octet-stream" }));
      if (w) w.location = url; else location.href = url;
    } catch (e) { if (w) w.close(); alert(e.message || "打开失败"); }
  }

  // open(作业编号, { onDone }) → 对话框
  let d = null;
  async function open(itemId, opt) {
    opt = opt || {};
    if (!d) { d = document.createElement("dialog"); d.className = "dlg ck-dlg"; document.body.appendChild(d); }
    d.innerHTML = `<h3>交作业</h3><div class="meta">加载中…</div>`;
    if (!d.open) d.showModal();
    let r;
    try { r = await CCAuth.rpc("hw_sub_open", { p_item: +itemId }); }
    catch (e) { d.innerHTML = `<h3>交作业</h3><div class="meta">${E(e.message || "打不开")}</div><div class="row"><span class="spacer"></span><button class="small" data-x>关闭</button></div>`; d.querySelector("[data-x]").onclick = () => d.close(); return; }
    if (!r || r.mode === "off") { d.close(); if (opt.onDone) opt.onDone(); return; }   // 班里没开：照常打勾
    const sid = r.id, mode = r.mode;
    let s = { status: r.status || "draft", note: r.note || "", review: r.review_note || "", late: !!r.late }, files = r.files || [], busy = false, prog = "";
    const lock = () => s.status === "approved";
    const paint = () => {
      const t = ST[s.status] || ST.draft;
      d.innerHTML = `<h3>${E(r.title || "作业")}<small>${mode === "photo" ? "拍照交：拍下写好的作业，或选手机 / 电脑里的照片" : "照片和文件都可以，混着交也行（照片、PDF、Word…）"}。交上去后老师审核，通过了才算完成。</small></h3>
        <div class="hs-st ${t[1]}">${t[0]}</div>
        ${s.review ? `<div class="hs-rn ${s.status === "approved" ? "ok" : ""}">老师说：${E(s.review)}</div>` : ""}
        ${s.late ? `<div class="hs-rn">已经过了截止时间，现在交会标记为「迟交」，老师照样能审核。</div>` : ""}
        <div class="hs-grid">${files.map((f, i) => `<button class="hs-f" data-v="${i}" title="${E(f.name)}">${f.thumb ? `<img src="data:image/jpeg;base64,${f.thumb}" alt="">` : `<span class="hs-doc"><b>${isImg(f.mime) ? "图" : "文件"}</b>${E(f.name)}</span>`}<span class="hs-sz">${sizeText(f.size || 0)}</span>${lock() ? "" : `<span class="hs-x" data-del="${i}" role="button" aria-label="删掉">✕</span>`}</button>`).join("")}
          ${!lock() && files.length < 9 ? `<button class="hs-f hs-add${busy ? " off" : ""}" data-add><b>＋</b>${mode === "photo" ? "拍照 / 选照片" : "照片 / 文件"}</button>` : ""}</div>
        ${prog ? `<div class="meta">${E(prog)}</div>` : ""}
        ${lock() ? "" : `<input class="hs-note" data-note maxlength="200" placeholder="想跟老师说的话（可以不填）" value="${E(s.note)}">`}
        <div class="row"><span class="spacer"></span><button class="small" data-x>关闭</button>${lock() ? "" : `<button class="btn ink sm" data-go${busy || !files.length ? " disabled" : ""}>${s.status === "pending" ? "重新提交" : s.status === "rejected" ? "改好了，再交一次" : "交给老师"}</button>`}</div>`;
      d.querySelector("[data-x]").onclick = () => d.close();
      const ni = d.querySelector("[data-note]"); if (ni) ni.oninput = () => (s.note = ni.value);
      d.querySelectorAll("[data-v]").forEach((b) => (b.onclick = (e) => {
        const del = e.target.closest("[data-del]"); const f = files[+b.dataset.v]; if (!f) return;
        if (del) { if (!confirm("删掉「" + f.name + "」？")) return; CCAuth.rpc("hw_file_del", { fid: f.id }).then(() => { files = files.filter((x) => x.id !== f.id); paint(); }).catch((er) => alert(er.message)); return; }
        openFile(f);
      }));
      const add = d.querySelector("[data-add]"); if (add) add.onclick = pick;
      const go = d.querySelector("[data-go]"); if (go) go.onclick = submit;
    };
    const reload = async () => { try { const x = await CCAuth.rpc("hw_sub_open", { p_item: +itemId }); files = x.files || []; } catch (e) {} };
    function pick() {
      const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true;
      inp.accept = mode === "photo" ? "image/*" : "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip";
      inp.onchange = async () => {
        const list = [...inp.files].slice(0, 9 - files.length); if (!list.length) return;
        busy = true; let ok = 0;
        for (let i = 0; i < list.length; i++) {
          prog = `正在上传 ${i + 1}/${list.length}…`; paint();
          try { await upload(sid, list[i], (p) => { prog = `正在上传 ${i + 1}/${list.length} · ${p}%`; const m = d.querySelector(".meta"); if (m) m.textContent = prog; }); ok++; }
          catch (e) { alert("「" + list[i].name + "」没传上：" + (e.message || "")); }
        }
        busy = false; prog = ""; if (ok) await reload(); paint();
      };
      inp.click();
    }
    async function submit() {
      if (busy) return; if (!files.length) { alert(mode === "photo" ? "先上传一张作业照片" : "先上传照片或文件"); return; }
      busy = true; paint();
      try {
        await CCAuth.rpc("hw_sub_submit", { p_sid: sid, p_note: s.note || "" });
        s.status = "pending"; s.review = ""; busy = false; paint();
        if (opt.onSubmitted) opt.onSubmitted();
        setTimeout(() => d.open && d.close(), 900);
      } catch (e) { busy = false; paint(); alert("没交上：" + (e.message || "")); }
    }
    paint();
  }
  window.CCHwSub = { open };
})();
