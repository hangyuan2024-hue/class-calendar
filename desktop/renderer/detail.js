// 一件事的详情（事项页右栏、任何页面点一下弹出的详情栏共用）+ 云端附件 + 过期自动删除 + 「编辑（仅自己）」+ 记一件事的编辑框
// 云端附件、自动删除和网页版 extras.js 是同一套接口（file_* / item_extras / item_keep），换设备也能看到
"use strict";

// ---------- 过期 2 周自动删除（最后 3 天提醒，可以推迟 3 天） ----------
const Autodel = {
  ex() { return (App.S && App.S.extras) || { autodel: true, keep: {}, files: {} }; },
  expiry(x) {
    if (!x || x.study || x.plugin || !x.day) return null;
    let keep = "";
    if (x.mine) { if (App.S.settings.autodelMine === false) return null; keep = x.keep || ""; }
    else { if (x.type !== "作业" && !this.ex().autodel) return null; keep = this.ex().keep[x.key] || ""; }
    const base = shiftDay(x.day, 14);
    return keep > base ? keep : base;
  },
  left(x) { const e = this.expiry(x); return e ? M.dayDiff(e, App.now()) : null; },
  soon(x) { const n = this.left(x); return n != null && n <= 3; },
  async keep(key) {
    const until = await call("item:keep", key);
    toast(`已推迟，${until ? M.fromKey(until).getMonth() + 1 + "月" + M.fromKey(until).getDate() + "日" : "几天"}之后才会删除`);
  },
  badge(x) {
    const n = this.left(x); if (n == null || n > 3) return "";
    return `<div class="ad-warn">🗑 ${n <= 0 ? "今天过后" : n + " 天后"}自动删除（日期过去 2 周了）<button class="btn ghost sm" data-keep="${esc(x.key)}">推迟删除</button></div>`;
  },
};
document.addEventListener("click", async (e) => {
  const k = e.target.closest("[data-keep]"); if (!k) return;
  e.preventDefault(); e.stopPropagation(); k.disabled = true;
  try { await Autodel.keep(k.dataset.keep); } catch (err) { k.disabled = false; }
}, true);

// ---------- 云端附件（全班 / 自己能看到；单个最多 20MB） ----------
const CloudFiles = {
  CH: 600 * 1024, cache: new Map(),
  count(key) { return (Autodel.ex().files || {})[key] || 0; },
  target(x) {
    if (!x || x.study || x.plugin || !App.S.me) return null;
    if (!x.mine) { const me = App.S.me.id; return { cid: App.S.cid, item: String(x.id), canWrite: App.canEditIn(x.gid) || (!!x.by && x.by === me) }; }
    return x.local ? null : { cid: null, item: x.key, canWrite: true };
  },
  size: (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"),
  icon: (m) => (/^image\//.test(m) ? "🖼" : /pdf/.test(m) ? "📕" : /word|document/.test(m) ? "📘" : /sheet|excel/.test(m) ? "📗" : /presentation|powerpoint/.test(m) ? "📙" : "📄"),
  async list(x) { const t = this.target(x); if (!t) return []; const l = await api("file_list", { cid: t.cid, item: t.item }, true); call("files:count", x.key, l.length).catch(() => {}); return l; },
  // 大图先压一压（长边 2400，JPEG 0.85），省流量；和网页版一样
  async shrink(file) {
    if (!/^image\/(jpeg|png|webp)/.test(file.type) || file.size < 1.5 * 1024 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file), s = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const b = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
      return b && b.size < file.size ? new File([b], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
    } catch (e) { return file; }
  },
  async upload(x, files, say) {
    const t = this.target(x); if (!t || !t.canWrite) throw new Error("没有给这件事加附件的权限");
    let ok = 0;
    for (const f0 of files) {
      if (f0.size > 20 * 1024 * 1024) { say(`「${f0.name}」太大了（单个最多 20MB）`); continue; }
      const f = await this.shrink(f0), buf = new Uint8Array(await f.arrayBuffer()), parts = Math.max(1, Math.ceil(buf.length / this.CH));
      try {
        say(`正在上传「${f.name}」…`);
        const { id } = await api("file_begin", { cid: t.cid, item: t.item, fname: f.name, fmime: f.type || "", fsize: buf.length, nparts: parts }, true);
        for (let i = 0; i < parts; i++) {
          const part = buf.subarray(i * this.CH, (i + 1) * this.CH);
          let s = ""; for (let j = 0; j < part.length; j += 0x8000) s += String.fromCharCode.apply(null, part.subarray(j, j + 0x8000));
          await api("file_part", { fid: id, n: i, b64: btoa(s) }, true);
          say(`正在上传「${f.name}」… ${Math.round(((i + 1) / parts) * 100)}%`);
        }
        await api("file_end", { fid: id }, true);
        ok++; say(`「${f.name}」上传好了`);
      } catch (err) { say(`「${f.name}」上传失败：${cleanErr(err)}`); }
    }
    return ok;
  },
  async b64(fid, parts) {
    if (this.cache.has(fid)) return this.cache.get(fid);
    const chunks = [];
    for (let i = 0; i < parts; i++) chunks.push((await api("file_get", { fid, n: i }, true)).data);
    // 每一块是单独编码的 base64：拼起来之前先解码再整体重新编码，免得中间夹着「=」
    const all = chunks.length === 1 ? chunks[0] : btoa(chunks.map((c) => atob(c)).join(""));
    this.cache.set(fid, all);
    return all;
  },
};

// 详情里的「云端附件」一块：列表、上传（选文件或拖进来）、看图、另存为、删除
function cloudFilesHtml(x) {
  const t = CloudFiles.target(x); if (!t) return "";
  const n = CloudFiles.count(x.key);
  if (!n && !t.canWrite) return "";
  return `<div class="dt-sec"><div class="dt-l">附件 <small class="muted">${t.cid ? "存在云端，全班都能看到" : "存在云端，只有你自己能看到"}</small></div>
    <div class="cf" data-cf="${esc(x.key)}" ${t.canWrite ? 'data-drop="1"' : ""}><div class="cf-list">${n ? `<div class="muted cf-load">${n} 个附件，正在读取…</div>` : ""}</div>
      ${t.canWrite ? `<label class="att-add cf-add">${icon("clip")}加图片 / 文件<small>或者把文件拖到这里，单个最多 20MB</small><input type="file" multiple hidden></label><div class="cf-st muted"></div>` : ""}</div></div>`;
}
async function cloudFilesLoad(box, x) {
  const el = $(`.cf[data-cf="${CSS.escape(x.key)}"]`, box); if (!el) return;
  const listEl = $(".cf-list", el), st = $(".cf-st", el);
  const draw = async () => {
    try {
      const l = await CloudFiles.list(x);
      listEl.innerHTML = l.map((f) => `<div class="cf-f" data-fid="${esc(f.id)}" data-parts="${f.parts}" data-name="${esc(f.name)}" data-mime="${esc(f.mime)}">
        <span>${CloudFiles.icon(f.mime)}</span><b title="${esc(f.name)}">${esc(f.name)}</b><small>${CloudFiles.size(f.size)}${f.by && x.mine === false ? " · " + esc(f.by) : ""}</small>
        ${/^image\//.test(f.mime) ? `<button class="btn ghost sm" data-cfa="view">看图</button>` : ""}<button class="btn ghost sm" data-cfa="save" title="存到电脑上">另存为</button>${f.can_del ? `<button class="btn ghost sm danger" data-cfa="del" title="删除">✕</button>` : ""}</div><div class="cf-pv hidden"></div>`).join("");
    } catch (e) { listEl.innerHTML = `<div class="muted">${esc(cleanErr(e))}</div>`; }
  };
  const up = async (files) => { if (!files.length) return; await CloudFiles.upload(x, files, (s) => { if (st) st.textContent = s; }); await draw(); };
  const inp = $("input[type=file]", el); if (inp) inp.onchange = () => { up([...inp.files]); inp.value = ""; };
  el.ondragover = (e) => { if (e.dataTransfer.types.includes("Files") && inp) { e.preventDefault(); el.classList.add("over"); } };
  el.ondragleave = (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove("over"); };
  el.ondrop = (e) => { if (!inp) return; e.preventDefault(); e.stopPropagation(); el.classList.remove("over"); up([...e.dataTransfer.files]); };
  listEl.onclick = async (e) => {
    const b = e.target.closest("[data-cfa]"); if (!b) return;
    const f = b.closest(".cf-f"), a = b.dataset.cfa; b.disabled = true;
    try {
      if (a === "del") { if (await confirmBox("删除这个附件？", f.dataset.name, "删除", true)) { await api("file_del", { fid: f.dataset.fid }); await draw(); } return; }
      const data = await CloudFiles.b64(f.dataset.fid, +f.dataset.parts);
      if (a === "view") { const pv = f.nextElementSibling; pv.classList.toggle("hidden"); pv.innerHTML = `<img src="data:${esc(f.dataset.mime)};base64,${data}" alt="${esc(f.dataset.name)}">`; }
      if (a === "save") { const p = await call("file:save", f.dataset.name, data); if (p) toast("已保存：" + p.split(/[\\/]/).pop()); }
    } catch (err) {} finally { b.disabled = false; }
  };
  if (CloudFiles.count(x.key) || inp) draw();
}

// ---------- 一件事的详情 ----------
const ItemDetail = {
  html(x, opts = {}) {
    const now = App.now(), late = overdue(x, now), g = App.group(x.gid);
    const canCls = !x.mine && App.canEditIn(x.gid);
    return `
      <div class="dt-top">${tagHtml(x.type)}${x.mine && x.kind === "作业" ? '<span class="tag" style="--c:var(--t-个人)">我的</span>' : ""}${g ? `<span class="tag" style="--c:var(--ok)">👥 ${esc(g.name)}</span>` : ""}${x.from ? '<span class="tag" style="--c:var(--brand)">我改过的</span>' : ""}${x.local ? '<span class="tag" style="--c:var(--muted)" title="不上传云端；同一个 Wi-Fi 里的设备之间局域网互传">🔒 仅本机</span>' : ""}${x.done ? '<span class="tag" style="--c:var(--ok)">已完成</span>' : late ? '<span class="tag" style="--c:var(--bad)">过期了</span>' : ""}${x.confirm ? '<span class="tag" style="--c:var(--warn)">待核实</span>' : ""}<span class="grow"></span>
        ${x.study ? `<button class="btn ghost sm" data-d="study" title="在课内学习里打开">📖 课内学习</button>` : x.mine ? `<button class="btn ghost iconbtn sm" data-d="edit" title="编辑（Enter）">${icon("edit")}</button>` : canCls ? `<button class="btn ghost iconbtn sm" data-d="cedit" title="修改这条班级事项">${icon("edit")}</button>` : `<button class="btn ghost sm" data-d="mycopy" title="班级事项只有老师和班委能改；这里改的只对你自己生效">${icon("edit")}仅自己</button>`}
        ${!x.mine && !x.study && App.S.groupsOk && x.updated ? `<button class="btn ghost iconbtn sm" data-d="hist" title="修改记录">${icon("history")}</button>` : ""}
        ${!x.study && App.canDelItem(x) ? `<button class="btn ghost iconbtn sm danger" data-d="cdel" title="从班级里删除">${icon("trash")}</button>` : ""}
        ${opts.close ? `<button class="btn ghost iconbtn sm" data-d="close" title="关闭（Esc）">${icon("close")}</button>` : ""}</div>
      <h2 class="dt-title selectable">${x.mine && x.pin && !x.done ? "📌 " : ""}${esc(x.title)}</h2>
      <div class="dt-rows">
        <div>${icon("clock")}<span class="${late ? "late" : ""}">${x.day ? dateCN(x.day) + (x.time ? " " + x.time : "") + (dateCN(x.day).startsWith(M.relDay(x.day, now)) ? (x.type === "作业" && x.time ? "　<small>截止</small>" : "") : `　<small>${esc(M.relDay(x.day, now))}${x.type === "作业" && x.time ? " 截止" : ""}</small>`) : "没定日子"}</span></div>
        ${x.location ? `<div>${icon("place")}<span class="selectable">${esc(x.location)}</span></div>` : ""}
        ${x.publish ? `<div>📣<span>${esc(x.publish)} 发布</span></div>` : ""}
        ${x.study ? `<div>📖<span>${esc(x.course || "课内学习")} · 考核</span></div>` : ""}
      </div>
      ${Autodel.badge(x)}
      ${x.summary ? `<div class="dt-sec"><div class="dt-l">内容</div><div class="selectable dt-txt">${esc(x.summary)}</div></div>` : ""}
      ${x.mine && x.list && x.list.length ? `<div class="dt-sec"><div class="dt-l">清单 <small class="muted">${x.list.filter((i) => i.d).length}/${x.list.length}</small></div><div class="mlist">${x.list.map((i, n) => `<button type="button" class="mli${i.d ? " on" : ""}" data-d="li" data-i="${n}"><span class="mcb">${i.d ? "✓" : ""}</span><span class="mlt selectable">${esc(i.t)}</span></button>`).join("")}</div></div>` : ""}
      ${x.mine && x.rep ? `<div class="dt-sec"><div class="dt-l">重复</div><div class="dt-txt">🔁 ${esc(MemoCore.repName(x.rep))}${x.reps ? ` · 已完成 ${x.reps} 次` : ""}<small class="muted">　勾完成会自动排到下一次</small></div></div>` : ""}
      ${x.prepare ? `<div class="dt-sec"><div class="dt-l">要准备</div><div class="selectable dt-txt">${esc(x.prepare)}</div></div>` : ""}
      ${x.original ? `<details class="dt-sec"><summary class="dt-l">原始消息</summary><div class="selectable dt-txt dt-orig">${esc(x.original)}</div></details>` : ""}
      ${!x.mine && x.editor && x.updated ? `<div class="dt-by muted">✏️ ${esc(x.editor)} · ${esc(whenStr(x.updated))}更新</div>` : ""}
      ${cloudFilesHtml(x)}
      ${x.study ? "" : `<div class="dt-sec"><div class="dt-l">电脑上的文件 <small class="muted">只记在这台电脑上，点开直接打开</small></div>${attachHtml(x.key)}</div>`}
      <div class="dt-sec"><div class="dt-l">我的备注 <small class="muted dt-saved"></small></div><textarea class="input" rows="4" maxlength="5000" placeholder="写点什么，自动保存，手机和网页上也能看到">${esc(x.note)}</textarea></div>
      <div class="dt-act">
        <button class="btn ${x.done ? "" : "primary"}" data-d="done">${x.done ? "标记为没完成" : "✓ 完成"}${opts.kbd ? "<kbd>空格</kbd>" : ""}</button>
        <button class="btn" data-d="focus">🍅 专注</button>
        ${x.mine ? `<button class="btn ghost" data-d="pin">${x.pin ? "取消置顶" : "📌 置顶"}</button>` : ""}
        ${x.study ? "" : x.mine ? `<button class="btn danger" data-d="del">${icon("trash")}${x.from ? "删掉我的版本" : "删除"}</button>` : `<button class="btn" data-d="hide">${x.hidden ? "取消隐藏" : "隐藏"}</button>`}
        ${x.day && !x.study ? `<button class="btn ghost" data-d="ics" title="导出成日历文件，双击就能加到 Outlook / 系统日历">📅 加到日历</button>` : ""}
        ${x.original ? `<button class="btn ghost" data-d="copy">复制原文</button>` : ""}
      </div>`;
  },
  bind(box, x, onDone) {
    const t = $("textarea", box); let timer = 0;
    const save = async () => {
      clearTimeout(timer); const v = t.value.trim(); const cur = App.find(x.key); if (!cur || v === (cur.note || "")) return;
      if (x.study) await Study.setNote(x, v);
      else if (x.mine) { const raw = (App.S.mine || []).find((r) => r.id === x.key); await call("mine:upsert", { ...raw, note: v }); }
      else await call("mark", x.key, { note: v });
      const s = $(".dt-saved", box); if (s) s.textContent = "已保存";
    };
    t.oninput = () => { clearTimeout(timer); timer = setTimeout(save, 700); $(".dt-saved", box).textContent = "…"; };
    t.onblur = save;
    t.onkeydown = (e) => { if (e.key === "Escape") { t.blur(); e.stopPropagation(); if (onDone) onDone(); } };
    box.onclick = (e) => this.act(e, x);
    cloudFilesLoad(box, x);
  },
  act(e, x) {
    const b = e.target.closest("[data-d]"); if (!b) return;
    x = App.find(x.key) || x;
    const a = b.dataset.d;
    if (a === "done") toggleDone(x.key, !x.done);
    // 6.2 清单一项项勾、置顶
    if (a === "li" || a === "pin") {
      const raw = (App.S.mine || []).find((r) => r.id === x.key); if (!raw) return;
      const rec = a === "li" ? { ...raw, list: MemoCore.toggleItem(raw, +b.dataset.i) } : { ...raw, pin: !raw.pin };
      call("mine:upsert", rec).then(() => { if (a === "pin") toast(rec.pin ? "已置顶，今天页最上面一直能看到" : "已取消置顶"); else if (MemoCore.listStat(rec).all && !raw.done) toast("清单都勾完了 🎉"); });
    }
    if (a === "edit") editItem(x);
    if (a === "cedit") editClassItem(x);
    if (a === "mycopy") editItem(x, { from: x.key });
    if (a === "cdel") deleteClassItem(x);
    if (a === "hist") showItemHistory(x);
    if (a === "focus") App.go("focus", { task: x.title });
    if (a === "del") deleteMine(x.key);
    if (a === "hide") hideItem(x.key, !x.hidden);
    if (a === "study") App.go("study", { item: x });
    if (a === "close") Insp.close();
    if (a === "ics") call("export:ics", [x.key]).then((n) => n && toast("已导出，双击文件就能加到日历"));
    if (a === "copy") navigator.clipboard.writeText(x.original).then(() => toast("已复制"));
  },
};

// ---------- 详情栏：任何页面点一件事，右边滑出来 ----------
const Insp = {
  key: null,
  isOpen() { return !!this.key && $("#insp").classList.contains("open"); },
  open(key) {
    const x = App.find(key); if (!x) return;
    // 事项页自己就有详情栏：在那里选中就好
    if (App.view === "tasks") { App.views.tasks.show({ key }); return; }
    this.key = key; this.draw(true);
    $("#insp").classList.add("open");
    $$("[data-k].insp-sel").forEach((n) => n.classList.remove("insp-sel"));
    $$(`.view [data-k="${CSS.escape(key)}"]`).filter((n) => !n.matches(".chk, button")).forEach((n) => n.classList.add("insp-sel"));
  },
  close() { if (!this.key) return; this.key = null; $("#insp").classList.remove("open"); $$(".insp-sel").forEach((n) => n.classList.remove("insp-sel")); },
  refresh() { if (this.key) { if (!App.find(this.key)) this.close(); else this.draw(false); } },
  draw(force) {
    const box = $("#inspIn"), x = App.find(this.key); if (!x) return;
    const ta = $("textarea", box);
    if (!force && ta && document.activeElement === ta && box.dataset.k === this.key) return;   // 正在写备注：不打断
    // 内容没变就不重画：重画会把鼠标下面的按钮换掉（按钮闪、点了没反应），附件列表也会重新读一遍
    const html = ItemDetail.html(x, { close: true });
    if (!force && box.dataset.k === this.key && this._html === html) return;
    box.dataset.k = this.key; this._html = html;
    box.innerHTML = html;
    ItemDetail.bind(box, x, () => this.close());
  },
};

// ---------- 记一件事 / 编辑我的事项 / 改成我自己的版本（班级事项） ----------
// preset：{ day, time, kind: "作业", from: "c123"（「编辑（仅自己）」） }
editItem = function (x, preset) {
  preset = preset || {};
  const from = preset.from || "", isNew = !x || !!from;
  const v = x ? { subject: x.title, day: x.day, time: x.time, location: x.location, note: from ? x.full || [x.summary, x.prepare ? "要准备：" + x.prepare : ""].filter(Boolean).join("\n") : x.note, list: from ? "" : MemoCore.listToText(x.list || []), rep: from ? "" : x.rep || "", pin: !from && !!x.pin, kind: from ? (x.type === "作业" ? "作业" : "") : x.kind || "" }
    : { subject: "", day: preset.day || "", time: preset.time || "", location: "", note: "", list: "", rep: "", pin: false, kind: preset.kind || (App.view === "homework" ? "作业" : "") };
  const title = from ? "改成我自己的版本" : !x ? (v.kind === "作业" ? "记一项自己的作业" : "记一件事") : "编辑事项";
  const d = h(`<form class="dialog" role="dialog">
    <h3>${title}</h3>
    <div class="dbody">
      ${from ? `<div class="muted" style="font-size:12.5px">班级事项只有老师和班委能改。这里改的是你自己的一份：保存后原来那条替你隐藏，在「我的」事项里删掉这条就恢复。</div>` : ""}
      <label class="field">要做什么<input name="subject" maxlength="200" placeholder="比如：交实验报告　（可以直接写「明天下午3点交实验报告 @B302」）" value="${esc(v.subject)}" required></label>
      <div class="row"><label class="field" style="flex:1.3">日期<input name="day" type="date" value="${esc(v.day)}"></label><label class="field" style="flex:1">时间<input name="time" type="time" value="${esc(v.time)}"></label><label class="field" style="flex:1.4">地点<input name="location" maxlength="200" value="${esc(v.location)}" placeholder="可不填"></label></div>
      <div class="row"><span class="field" style="flex:none">这是<span class="seg" id="eiKind"><button type="button" data-kind=""${v.kind ? "" : ' class="on"'}>普通事项</button><button type="button" data-kind="作业"${v.kind === "作业" ? ' class="on"' : ""}>作业</button></span></span><small class="muted" style="align-self:flex-end;padding-bottom:6px">选「作业」会出现在作业页，完成了给云宠更多养料</small></div>
      <label class="field">备注<textarea name="note" rows="4" maxlength="5000" placeholder="可不填，想写多少写多少（最多 5000 字）">${esc(v.note)}</textarea></label>
      <label class="field">清单 <small class="muted">每行一项，可以一项项勾；已经做完的行首加 ✓</small><textarea name="list" rows="3" maxlength="8000" placeholder="比如：&#10;买牛奶&#10;打印签到表">${esc(v.list)}</textarea></label>
      <div class="row"><label class="field" style="flex:1">重复<select name="rep">${MemoCore.REPS.map(([k, t]) => `<option value="${k}"${v.rep === k ? " selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="ei-local" style="flex:1.4;align-self:flex-end"><input type="checkbox" name="pin"${v.pin ? " checked" : ""}><span>📌 置顶<small>一直显示在今天页最上面</small></span></label></div>
      ${from ? "" : `<label class="ei-local"><input type="checkbox" name="local"${x && x.local ? " checked" : ""}><span>🔒 只存在这台设备<small>不上传云端；同一账号的手机、电脑连着同一个 Wi-Fi 时局域网直接互传</small></span></label>`}
    </div>
    <div class="dfoot">${isNew ? '<span class="muted grow" style="font-size:12px">Enter 保存 · Esc 取消</span>' : '<button type="button" class="btn danger" data-a="del">' + icon("trash") + '删除</button><span class="grow"></span>'}<button type="button" class="btn" data-a="cancel">取消</button><button class="btn primary">保存</button></div>
  </form>`);
  const f = d.elements; let kind = v.kind;
  $("#eiKind", d).onclick = (e) => { const b = e.target.closest("[data-kind]"); if (!b) return; kind = b.dataset.kind; $$("#eiKind button", d).forEach((n) => n.classList.toggle("on", n === b)); };
  // 新建时：标题里写了日期时间，就自动填到下面
  if (!x) f.subject.addEventListener("input", () => {
    const p = P.parse(f.subject.value, App.now());
    f.subject.dataset.parsed = JSON.stringify(p);
    if (p.date && !f.day.dataset.touched) f.day.value = p.date;
    if (p.time && !f.time.dataset.touched) f.time.value = p.time;
    if (p.location && !f.location.dataset.touched) f.location.value = p.location;
  });
  for (const n of ["day", "time", "location"]) f[n].addEventListener("input", () => (f[n].dataset.touched = 1));
  d.onsubmit = async (e) => {
    e.preventDefault();
    let subject = f.subject.value.trim();
    if (!x && f.subject.dataset.parsed) { const p = JSON.parse(f.subject.dataset.parsed); if (p.subject && (p.date || p.time || p.location)) subject = p.subject; }
    if (!subject) return f.subject.focus();
    const rec = { subject, event_time: f.day.value ? f.day.value + (f.time.value ? " " + f.time.value : "") : "", location: f.location.value.trim(), note: f.note.value.trim(), kind: kind || undefined,
      rep: f.rep.value || undefined, pin: f.pin.checked || undefined };
    // 6.2 清单：每行一项（原来勾过的保留）；备忘录粘进备注的「□ xxx」多行自动变成清单
    let lt = f.list.value;
    if (!lt.trim() && MemoCore.looksLikeList(rec.note)) { lt = rec.note; rec.note = ""; }
    rec.list = MemoCore.listFromText(lt, x && !from ? x.list || [] : []);
    if (rec.rep && !rec.event_time) rec.event_time = M.dayKey(App.now());   // 重复的事要有起始日期，没填就从今天开始
    if (!from) rec.local = !!(f.local && f.local.checked);
    if (from) { await call("item:override", from, rec); closeOverlay(); toast("已存成你自己的版本，原来那条替你隐藏了"); return; }
    if (x) { const raw = (App.S.mine || []).find((r) => r.id === x.key) || {}; Object.assign(rec, { ...raw, ...rec, id: x.key }); if (!kind) delete rec.kind; if (!rec.rep) delete rec.rep; if (!rec.pin) delete rec.pin; }
    await call("mine:upsert", rec);
    closeOverlay(); toast(rec.local ? (x && x.local ? "已保存（只在这台设备）" : "已记下，只存在这台设备") : !x ? "已记下" : "已保存");
  };
  d.onclick = async (e) => {
    const a = e.target.closest("[data-a]"); if (!a) return;
    if (a.dataset.a === "cancel") closeOverlay();
    if (a.dataset.a === "del") { closeOverlay(); deleteMine(x.key); }
  };
  openOverlay(d);
  f.subject.focus(); if (x) f.subject.select();
};

// 右键菜单补上：详情、「编辑（仅自己）」、推迟删除
const _itemMenu1 = itemMenu;
itemMenu = function (e, x) {
  e.preventDefault();
  const can = !x.mine && App.canEditIn(x.gid), del = App.canDelItem(x);
  menu(e.clientX, e.clientY, [
    { label: x.done ? "标记为没完成" : "标记完成", icon: "tasks", fn: () => toggleDone(x.key, !x.done) },
    { label: "看详情", icon: "eye", fn: () => Insp.open(x.key) },
    x.study ? { label: "在课内学习里打开", icon: "study", fn: () => App.go("study", { item: x }) }
      : x.mine ? { label: "编辑", icon: "edit", fn: () => editItem(x) } : can ? { label: "修改这条班级事项", icon: "edit", fn: () => editClassItem(x) } : { label: "编辑（仅自己）", icon: "edit", fn: () => editItem(x, { from: x.key }) },
    !x.mine && !x.study && App.S.groupsOk && x.updated ? { label: "修改记录", icon: "history", fn: () => showItemHistory(x) } : null,
    { label: "专注做这件事", icon: "focus", fn: () => App.go("focus", { task: x.title }) },
    Autodel.soon(x) ? { label: "推迟自动删除（多留 3 天）", icon: "clock", fn: () => Autodel.keep(x.key) } : null,
    "-",
    x.study ? null : x.mine ? { label: x.from ? "删掉我的版本（恢复班级原来那条）" : "删除", icon: "trash", danger: true, fn: () => deleteMine(x.key) } : { label: x.hidden ? "取消隐藏" : "隐藏这条", icon: "eye", fn: () => hideItem(x.key, !x.hidden) },
    del && !x.study ? { label: "从班级里删除", icon: "trash", danger: true, fn: () => deleteClassItem(x) } : null,
  ]);
};
