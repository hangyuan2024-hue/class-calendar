// 电脑版 3.3：和网站 5.8 同步的新功能
//   1. 导入手机备忘录（拆分规则和网站同一份 web/memo.js）
//   2. 作业页：已读人数 + 已读名单（发布人 / 老师 / 班委）+ 图片附件直接显示小图
//   3. 老师 / 自己建了班的人：「班级情况」页（谁没看、谁没完成、每个同学的情况）+ 教师组
//   4. 职场版：单位类型是「职场人员」时，界面里的 班级→团队、作业→任务、班委→负责人…
// 数据库函数在网站的 5.8.0 SQL：item_seen item_view_counts item_viewers item_files_many file_thumb teacher_classes teacher_overview create_class_kind my_class_kinds
"use strict";
ICON.teach = '<path d="M4 20V11M9.3 20V6M14.7 20v-6M20 20V9"/>';
ICON.memo = '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h5"/>';

const P58 = {
  me: () => (App.S && App.S.me) || {},
  teacher() { return this.me().role === "teacher"; },
  owner() { return this.teacher() || ((App.S && App.S.classes) || []).some((c) => c.is_teacher); },
  work() { return this.me().org_type === "work" && !this.teacher(); },
  noDb: (e) => notFound(e),
};

// ================= 1. 导入手机备忘录 =================
const Memo58 = {
  rows: [],
  open(text) {
    if (!window.CCMemo) { toast("导入功能还没加载好，稍后再试", { bad: true }); return; }
    const d = h(`<div class="dialog wide memo58" role="dialog"><h3>📝 导入手机备忘录</h3>
      <div class="dbody">
        <div class="muted" style="font-size:13px">把备忘录里的待办一次搬进来：<b>一行一条</b>，日期和时间会自动认出来；单独一行的「周三：」「10月20日」算作下面几行的日期。</div>
        <details class="m58-how"><summary>怎么从手机备忘录里拿出来？</summary><p>iPhone：打开那条备忘录 → 右上角「···」→「拷贝」，在电脑上粘贴（用微信「文件传输助手」发到电脑最方便）。</p><p>安卓：打开那条 → 分享 →「复制文本」或导出 txt 文件。微信收藏的笔记也一样：打开 → 复制 → 粘贴。</p></details>
        <textarea id="m58Text" rows="7" placeholder="粘贴备忘录内容，例如：&#10;周三：&#10;交高数作业第三章&#10;下午3点 社团例会 A201&#10;10月20日 牙医 上午9:30&#10;- [ ] 买牛奶"></textarea>
        <div class="row"><label class="btn">📄 选 txt 文件<input type="file" id="m58File" accept=".txt,.md,.csv,text/plain" hidden></label><button class="btn" id="m58Paste">📋 从剪贴板粘贴</button><span class="grow"></span><button class="btn primary" id="m58Go">拆成事项</button></div>
        <div id="m58St" class="muted" style="font-size:13px"></div>
        <div id="m58List" class="m58-list"></div>
      </div>
      <div class="dfoot"><label class="m58-ck"><input type="checkbox" id="m58All" checked> 全选</label><label class="m58-ck"><input type="checkbox" id="m58Skip" checked> 已勾完的不导入</label><span class="grow"></span><button class="btn" data-a="no">取消</button><button class="btn primary" id="m58Save" disabled>加到我的事项</button></div></div>`);
    const $d = (s) => $(s, d);
    const say = (t, bad) => { $d("#m58St").textContent = t || ""; $d("#m58St").style.color = bad ? "var(--bad, #c0392b)" : ""; };
    const run = () => {
      const t = $d("#m58Text").value;
      if (!t.trim()) { say("先粘贴备忘录内容", true); return; }
      this.rows = window.CCMemo.parse(t, App.now()).map((x) => ({ on: true, subject: x.subject, note: x.note, done: x.done, kind: x.kind, date: x.event_time.slice(0, 10), time: x.event_time.slice(11, 16) }));
      say(this.rows.length ? `拆出 ${this.rows.length} 条，其中 ${this.rows.filter((r) => r.date).length} 条认出了日期。不对的地方直接改。` : "没拆出事项，看看内容是不是空的", !this.rows.length);
      paint();
    };
    const paint = () => {
      const skip = $d("#m58Skip").checked;
      $d("#m58List").innerHTML = this.rows.map((r, i) => `<div class="m58-r${!r.on || (skip && r.done) ? " off" : ""}" data-i="${i}">
        <input type="checkbox" data-f="on"${r.on ? " checked" : ""} title="导入这条"><input class="m58-s" data-f="subject" value="${esc(r.subject)}" maxlength="60">
        <input type="date" data-f="date" value="${esc(r.date)}"><input type="time" data-f="time" value="${esc(r.time)}">
        <label class="m58-k" title="勾上会显示在作业页"><input type="checkbox" data-f="kind"${r.kind === "作业" ? " checked" : ""}>作业</label>${r.done ? `<span class="tag" style="--c:var(--ok)">已勾完</span>` : ""}</div>`).join("");
      const n = this.rows.filter((r) => r.on && !(skip && r.done)).length;
      $d("#m58Save").disabled = !n; $d("#m58Save").textContent = n ? `加到我的事项（${n} 条）` : "加到我的事项";
    };
    $d("#m58Go").onclick = run;
    $d("#m58Text").addEventListener("paste", () => setTimeout(run, 30));
    $d("#m58File").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; if (f.size > 2 * 1048576) return say("文件太大了（最多 2MB）", true); const r = new FileReader(); r.onload = () => { $d("#m58Text").value = String(r.result || ""); run(); }; r.readAsText(f, "utf-8"); };
    $d("#m58Paste").onclick = async () => { let t = ""; try { t = await call("clip:read"); } catch (e) { try { t = await navigator.clipboard.readText(); } catch (e2) {} } if (t) { $d("#m58Text").value = t; run(); } else say("剪贴板是空的", true); };
    $d("#m58All").onchange = (e) => { this.rows.forEach((r) => (r.on = e.target.checked)); paint(); };
    $d("#m58Skip").onchange = paint;
    $d("#m58List").addEventListener("change", (e) => {
      const row = e.target.closest("[data-i]"), r = row && this.rows[+row.dataset.i]; if (!r) return;
      const f = e.target.dataset.f;
      if (f === "on") { r.on = e.target.checked; paint(); } else if (f === "subject") r.subject = e.target.value.trim(); else if (f === "date") r.date = e.target.value; else if (f === "time") r.time = e.target.value; else if (f === "kind") r.kind = e.target.checked ? "作业" : undefined;
    });
    $d("[data-a=no]").onclick = () => closeOverlay();
    $d("#m58Save").onclick = async () => {
      const skip = $d("#m58Skip").checked, have = new Set((App.S.mine || []).map((m) => (m.subject || "") + "|" + (m.event_time || "")));
      const btn = $d("#m58Save"); btn.disabled = true; let n = 0, i = 0; const stamp = Date.now();
      for (const r of this.rows) {
        i++;
        if (!r.on || (skip && r.done) || !r.subject) continue;
        const et = r.date ? r.date + (r.time ? " " + r.time : "") : "";
        if (have.has(r.subject + "|" + et)) continue;
        try { await call("mine:upsert", { id: "p" + stamp + "_m" + i, subject: r.subject, event_time: et, location: "", note: r.note || "", done: !!r.done, ...(r.kind ? { kind: r.kind } : {}), src: "memo" }); n++; } catch (e) {}
      }
      closeOverlay(); toast(n ? `已导入 ${n} 条到「我的事项」，有日期的会显示在日历和首页` : "没有新的事项（可能都导入过了）");
    };
    openOverlay(d);
    if (text) { $d("#m58Text").value = text; run(); } else $d("#m58Text").focus();
  },
};
// 「记一件事」窗口里加一个入口
{
  const edit0 = editItem;
  editItem = function (x, preset) {
    edit0(x, preset);
    if (x) return;
    const d = $("#overlay .dialog"); if (!d || $(".m58-entry", d)) return;
    const b = h(`<button type="button" class="btn ghost sm m58-entry" title="把手机备忘录里的待办一次导入">📝 从备忘录导入</button>`);
    b.onclick = () => { closeOverlay(); Memo58.open(); };
    const h3 = $("h3", d); if (h3) { h3.classList.add("m58-h3"); h3.append(b); }
  };
}

// ================= 2. 作业页：已读 + 图片小图 =================
const HW58 = {
  counts: null, cid: null, at: 0, files: {}, filesAt: {}, seen: new Set(), ok: true, blobs: new Map(),
  fail(e) { if (notFound(e)) this.ok = false; },
  on() { return this.ok && App.S && App.S.me; },
  seenIds(ids) {
    const cid = App.S.cid; if (!cid || !this.on()) return;
    const want = ids.map(Number).filter((x) => x && !this.seen.has(cid + ":" + x));
    if (!want.length) return;
    want.forEach((x) => this.seen.add(cid + ":" + x));
    api("item_seen", { cid, ids: want.slice(0, 200) }, true).catch((e) => this.fail(e));
  },
  rowHtml(x) {
    if (!App.S.me || x.plugin || x.study) return "";
    let read = "";
    const c = this.counts;
    if (!x.mine && c && this.cid === App.S.cid) {
      const id = String(x.id), v = (c.views || {})[id] || 0, dn = (c.done || {})[id] || 0, can = c.can_list || (c.mine || []).map(String).includes(id);
      const t = `👀 已读 ${v}/${c.total}${dn ? ` · ✓ 完成 ${dn}` : ""}`;
      read = can ? `<button class="hw58-read link" data-hw58v="${esc(id)}" data-t="${esc(x.title)}" title="看看谁看过、谁还没看">${t} ›</button>` : `<span class="hw58-read">${t}</span>`;
    }
    const n = CloudFiles.count(x.key);
    const th = n ? `<div class="hw58-th" data-hw58k="${esc(x.key)}">${this.thumbs(x.key)}</div>` : "";
    return th || read ? `<div class="hw58">${th}${read}</div>` : "";
  },
  thumbs(key) {
    const l = this.files[key]; if (!l) return `<span class="muted" style="font-size:12px">📎 附件加载中…</span>`;
    return l.map((f) => /^image\//.test(f.mime)
      ? `<button class="hw58-img${f._src ? "" : " ph"}" data-hw58i="${esc(f.id)}" data-k="${esc(key)}" title="${esc(f.name)}">${f._src ? `<img src="${f._src}" alt="">` : "🖼"}</button>`
      : `<button class="hw58-f" data-hw58o="${esc(key)}" title="${esc(f.name)}">${CloudFiles.icon(f.mime)} ${esc(f.name.length > 14 ? f.name.slice(0, 6) + "…" + f.name.slice(-6) : f.name)}</button>`).join("");
  },
  decorate(el) {
    $$(".hw-row[data-k]", el).forEach((row) => {
      const x = App.find(row.dataset.k), m = $(".hw-m", row); if (!x || !m) return;
      const old = $(".hw58", m), html = this.rowHtml(x);
      if (old) old.outerHTML = html || ""; else if (html) m.insertAdjacentHTML("beforeend", html);
    });
  },
  async after(el) {
    if (!this.on()) return;
    const keys = $$(".hw-row[data-k]", el).map((r) => App.find(r.dataset.k)).filter(Boolean);
    const cls = keys.filter((x) => !x.mine && !x.study && !x.plugin), cid = App.S.cid;
    this.seenIds(cls.map((x) => x.id));
    let changed = false;
    if (cid && cls.length && (this.cid !== cid || Date.now() - this.at > 60000)) {
      this.at = Date.now();
      try { this.counts = await api("item_view_counts", { cid }, true); this.cid = cid; changed = true; } catch (e) { this.fail(e); }
    }
    const want = (l) => l.filter((x) => CloudFiles.count(x.key) > 0 && (!this.files[x.key] || Date.now() - (this.filesAt[x.key] || 0) > 300000));
    for (const [c, l] of [[cid, cid ? want(cls) : []], [null, want(keys.filter((x) => x.mine && !x.local))]]) {
      if (!l.length) continue;
      try {
        const m = await api("item_files_many", { cid: c, keys: l.slice(0, 60).map((x) => x.mine ? x.key : String(x.id)) }, true);
        l.forEach((x) => { const f = (m && m[x.mine ? x.key : String(x.id)]) || []; f.forEach((y) => { if (y.thumb) y._src = "data:image/jpeg;base64," + y.thumb; }); this.files[x.key] = f; this.filesAt[x.key] = Date.now(); });
        changed = true;
      } catch (e) { this.fail(e); l.forEach((x) => (this.files[x.key] = [])); }
    }
    if (changed) this.decorate(el);
    this.fill(el);
  },
  async blob(f) {
    if (this.blobs.has(f.id)) return this.blobs.get(f.id);
    const b64 = await CloudFiles.b64(f.id, f.parts), bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const b = new Blob([u], { type: f.mime }); this.blobs.set(f.id, b); return b;
  },
  async thumbOf(b) {
    try {
      const bmp = await createImageBitmap(b), s = Math.min(1, 360 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
      for (const q of [0.72, 0.55, 0.4]) { const u = c.toDataURL("image/jpeg", q); if (u.length < 150000) return u; }
    } catch (e) {}
    return null;
  },
  // 以前传的图片没有小图：小的下载下来做一张，能写的顺便存回云端
  async fill(el) {
    if (this.filling) return; this.filling = true;
    try {
      for (const key of Object.keys(this.files)) for (const f of this.files[key]) {
        if (f._src || f._tried || !/^image\/(jpeg|png|webp|gif)/.test(f.mime) || f.parts > 3 || f.size > 2000000) continue;
        f._tried = true;
        const box = $(`[data-hw58k="${CSS.escape(key)}"]`, el); if (!box) continue;
        try {
          const t = await this.thumbOf(await this.blob(f)); if (!t) continue;
          f._src = t;
          if (f.can_thumb) api("file_thumb", { fid: f.id, b64: t }, true).catch(() => {});
          const b2 = $(`[data-hw58k="${CSS.escape(key)}"]`, el); if (b2) b2.innerHTML = this.thumbs(key);
        } catch (e) {}
      }
    } finally { this.filling = false; }
  },
  async view(key, fid) {
    const imgs = (this.files[key] || []).filter((f) => /^image\//.test(f.mime));
    let i = Math.max(0, imgs.findIndex((f) => f.id === fid));
    const d = h(`<div class="dialog wide hw58-lb" role="dialog"><h3><span id="lbN"></span><span class="grow"></span></h3><div class="dbody"><div class="hw58-lbi" id="lbImg"></div></div>
      <div class="dfoot">${imgs.length > 1 ? `<button class="btn" data-lb="-1">‹ 上一张</button><button class="btn" data-lb="1">下一张 ›</button>` : ""}<span class="grow"></span><button class="btn" data-lb="save">另存为</button><button class="btn primary" data-lb="x">关闭</button></div></div>`);
    const show = async () => {
      const f = imgs[i]; $("#lbN", d).textContent = f.name + (imgs.length > 1 ? `（${i + 1}/${imgs.length}）` : "");
      $("#lbImg", d).innerHTML = (f._src ? `<img src="${f._src}" class="blur">` : "") + `<span class="muted">加载原图…</span>`;
      try { const b64 = await CloudFiles.b64(f.id, f.parts); if (imgs[i] !== f) return; $("#lbImg", d).innerHTML = `<img src="data:${esc(f.mime)};base64,${b64}" alt="">`; }
      catch (e) { $("#lbImg", d).innerHTML = `<span class="muted">原图没加载出来：${esc(cleanErr(e))}</span>`; }
    };
    d.onclick = async (e) => {
      const b = e.target.closest("[data-lb]"); if (!b) return;
      const a = b.dataset.lb;
      if (a === "x") closeOverlay();
      else if (a === "save") { const f = imgs[i]; try { const p = await call("file:save", f.name, await CloudFiles.b64(f.id, f.parts)); if (p) toast("已保存到 " + p); } catch (err) { toast(cleanErr(err), { bad: true }); } }
      else { i = (i + +a + imgs.length) % imgs.length; show(); }
    };
    openOverlay(d); show();
  },
  async viewers(id, title, cid) {
    cid = cid || App.S.cid;
    const d = h(`<div class="dialog hw58-vd" role="dialog"><h3>👀 ${esc(title || "已读名单")}</h3><div class="dbody"><div class="muted">加载中…</div></div><div class="dfoot"><span class="muted grow" style="font-size:12px">只有发布人、老师、班委能看到这个名单</span><button class="btn primary" data-a="x">关闭</button></div></div>`);
    d.onclick = (e) => {
      if (e.target.closest("[data-a=x]")) closeOverlay();
      const t = e.target.closest("[data-vt]"); if (t) { $$("[data-vt]", d).forEach((b) => b.classList.toggle("on", b === t)); $$("[data-vp]", d).forEach((p) => p.classList.toggle("hidden", p.dataset.vp !== t.dataset.vt)); }
      const c = e.target.closest("[data-vc]"); if (c) { navigator.clipboard.writeText(c.dataset.vc).then(() => toast("已复制，去群里粘贴提醒")).catch(() => toast("复制失败", { bad: true })); }
    };
    openOverlay(d);
    try {
      const l = await api("item_viewers", { cid, iid: Number(id) });
      const no = l.filter((x) => !x.seen_at && !x.done), yes = l.filter((x) => x.seen_at || x.done), done = l.filter((x) => x.done), sn = yes.filter((x) => !x.done);   // 6.3 完成了就算看过
      const who = (x) => `<span class="hw58-p${x.done ? " ok" : ""}">${avHtml(x.name || x.account || "?", "sm")}${esc(x.name || x.account)}${x.role === "monitor" ? "<i>班委</i>" : ""}${x.seen_at ? `<small>${esc(ago(x.seen_at))}</small>` : ""}${x.done ? "<b>✓</b>" : ""}</span>`;
      const pane = (k, list, empty, copy) => `<div data-vp="${k}" class="hw58-pane${k === "no" ? "" : " hidden"}">${list.length ? list.map(who).join("") : `<div class="muted">${empty}</div>`}${copy && list.length ? `<div style="width:100%"><button class="btn sm" data-vc="${esc(list.map((x) => "@" + (x.name || x.account)).join(" "))}">复制名字（发到群里提醒）</button></div>` : ""}</div>`;
      $(".dbody", d).innerHTML = `<div class="hw58-sum"><div><b>${yes.length}</b><span>看过</span></div><div><b>${no.length}</b><span>还没看</span></div><div><b>${done.length}</b><span>标记完成</span></div></div>
        <div class="seg"><button class="on" data-vt="no">还没看（${no.length}）</button><button data-vt="seen">看过没完成（${sn.length}）</button><button data-vt="done">已完成（${done.length}）</button></div>
        ${pane("no", no, "全班都看过了 🎉", true)}${pane("seen", sn, "没有", true)}${pane("done", done, "还没有人标记完成")}
        <div class="muted" style="font-size:12px">「看过」= 打开过作业页或点开过这条；老师自己看不算。「完成」= 同学自己勾了完成。</div>`;
    } catch (e) { $(".dbody", d).innerHTML = `<div class="muted">${esc(cleanErr(e))}</div>`; }
  },
  reset(key) { if (key) { delete this.files[key]; delete this.filesAt[key]; } else { this.files = {}; this.filesAt = {}; this.at = 0; } },
};
{
  const hw = App.views.homework, up0 = hw.update;
  hw.update = function () { up0.call(this); try { HW58.decorate(this.el); HW58.after(this.el).catch(() => {}); } catch (e) { console.error(e); } };
  const mount0 = hw.mount;
  hw.mount = function (el) {
    mount0.call(this, el);
    el.addEventListener("click", (e) => {
      const v = e.target.closest("[data-hw58v]"); if (v) { e.stopPropagation(); HW58.viewers(v.dataset.hw58v, v.dataset.t); return; }
      const i = e.target.closest("[data-hw58i]"); if (i) { e.stopPropagation(); HW58.view(i.dataset.k, i.dataset.hw58i); return; }
      const o = e.target.closest("[data-hw58o]"); if (o) { e.stopPropagation(); Insp.open(o.dataset.hw58o); }
    }, true);
  };
  // 在别的页面点开一条班级事项，也算看过
  const open0 = Insp.open.bind(Insp);
  Insp.open = function (key) { try { if (/^c\d+$/.test(String(key))) HW58.seenIds([String(key).slice(1)]); } catch (e) {} return open0(key); };
  // 传了新附件、删了附件：清掉这条的缓存，下次自动做小图
  const upl0 = CloudFiles.upload.bind(CloudFiles);
  CloudFiles.upload = async function (x, files, say) { const n = await upl0(x, files, say); HW58.reset(x.key); return n; };
}

// ================= 3. 班级情况（老师 / 自己建了班的人）+ 教师组 =================
const KIND58 = { staff: "教师组", team: "团队" };
App.views.teach = {
  title: "班级情况", icon: "teach", cid: null, days: 14, tab: "stu", filter: "all", ov: null, classes: null, at: 0, err: "",
  navOn() { return P58.owner(); },
  mount(el) {
    el.innerHTML = `<div class="vhead"><div><h1>班级情况</h1><div class="sub">谁还没看、谁还没完成，一眼看清；只统计你管理的班</div></div><span class="grow"></span>
      <select id="tDays" class="t58-days"><option value="7">最近 7 天</option><option value="14" selected>最近 14 天</option><option value="30">最近 30 天</option></select><button class="btn" id="tRef">↻ 刷新</button></div>
      <div class="vbody"><div class="t58" id="tBody"></div></div>`;
    $("#tRef", el).onclick = () => this.load(true);
    $("#tDays", el).onchange = (e) => { this.days = +e.target.value; this.load(false); };
    el.addEventListener("click", (e) => {
      const q = (s) => e.target.closest(s); let b;
      if ((b = q("[data-tc]"))) { this.cid = b.dataset.tc; this.filter = "all"; this.load(false); }
      else if ((b = q("[data-tt]"))) { this.tab = b.dataset.tt; this.draw(); }
      else if ((b = q("[data-tf]"))) { this.filter = b.dataset.tf; this.draw(); }
      else if ((b = q("[data-tv]"))) HW58.viewers(b.dataset.tv, b.dataset.t, this.cid);
      else if ((b = q("[data-tcopy]"))) navigator.clipboard.writeText(b.dataset.tcopy).then(() => toast("已复制")).catch(() => {});
      else if ((b = q("[data-tnew]"))) this.newStaff();
      else if ((b = q("[data-tg]"))) this.enter(b.dataset.tg);
      else if ((b = q("[data-tpend]"))) App.go("classes");
    });
  },
  show() { this.load(false); },
  update() { this.draw(); },
  async load(force) {
    if (force || !this.classes || Date.now() - this.at > 60000) {
      try { this.classes = await api("teacher_classes", {}, true); this.at = Date.now(); this.err = ""; }
      catch (e) { this.classes = this.classes || []; this.err = notFound(e) ? "数据库还没升级到 5.8.0，请先在扣子执行 5.8.0 的 SQL" : cleanErr(e); }
    }
    const cl = this.classes.filter((c) => c.kind !== "staff");
    if (!this.cid || !cl.some((c) => c.id === this.cid)) this.cid = (cl.some((c) => c.id === App.S.cid) ? App.S.cid : cl[0] && cl[0].id) || null;
    this.loading = true; this.draw();
    if (this.cid && (force || !this.ov || this.ov.class.id !== this.cid || this.ov._d !== this.days)) {
      try { this.ov = await api("teacher_overview", { cid: this.cid, days: this.days }, true); this.ov._d = this.days; this.err = ""; } catch (e) { this.ov = null; this.err = cleanErr(e); }
    }
    this.loading = false; this.draw();
  },
  draw() {
    const box = this.el && $("#tBody", this.el); if (!box) return;
    const cl = (this.classes || []).filter((c) => c.kind !== "staff"), o = this.ov && this.ov.class && this.ov.class.id === this.cid ? this.ov : null;
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0), since = (t) => (t ? Math.floor((Date.now() - new Date(t).getTime()) / 86400000) : null);
    let html = `<div class="t58-cls">${cl.map((c) => `<button class="t58-chip${c.id === this.cid ? " on" : ""}" data-tc="${esc(c.id)}">${KIND58[c.kind] ? KIND58[c.kind] + " · " : ""}${esc(c.name)}${c.pending ? `<em>${c.pending}</em>` : ""}<small>${c.total} 人</small></button>`).join("")}<button class="t58-chip add" data-tpend>＋ 建班 / 管理</button></div>`;
    if (!this.classes) html += `<div class="card empty">加载中…</div>`;
    else if (this.err && !o) html += `<div class="card empty">${esc(this.err)}</div>`;
    else if (!cl.length) html += `<div class="card empty">你还没有自己管理的班。到「班级」页创建一个，把班级码发给同学。</div>`;
    if (o) {
      const st = o.students || [], hwN = o.hw_count || 0, sum = st.reduce((a, s) => a + Math.min(s.hw_done, hwN || s.hw_done), 0);
      const lazy = st.filter((s) => hwN && s.hw_done < hwN), quiet = st.filter((s) => { const d = since(s.last_active); return d == null || d >= 7; });
      const list = this.filter === "lazy" ? lazy : this.filter === "quiet" ? quiet : st;
      html += `<div class="card t58-ov"><div class="t58-ovh"><b>${esc(o.class.name)}</b>${o.class.code ? `<button class="btn ghost sm" data-tcopy="${esc(o.class.code)}">班级码 ${esc(o.class.code)} ⧉</button>` : ""}${this.loading ? `<span class="muted">更新中…</span>` : ""}</div>
        <div class="t58-kpi"><div><b>${o.total}</b><span>学生</span></div><div><b>${hwN}</b><span>已到期作业</span></div><div><b>${hwN && st.length ? pct(sum, hwN * st.length) + "%" : "–"}</b><span>作业完成率</span></div><button data-tpend class="${o.pending ? "warn" : ""}"><b>${o.pending}</b><span>待审批 ›</span></button></div></div>
        <div class="seg t58-tabs"><button data-tt="stu" class="${this.tab === "stu" ? "on" : ""}">👥 每个同学</button><button data-tt="items" class="${this.tab === "items" ? "on" : ""}">📋 发布的事项（谁看了）</button><button data-tt="staff" class="${this.tab === "staff" ? "on" : ""}">🧑‍🏫 教师组</button></div>`;
      if (this.tab === "stu") {
        html += `<div class="row t58-filter"><div class="seg"><button data-tf="all" class="${this.filter === "all" ? "on" : ""}">全部 ${st.length}</button><button data-tf="lazy" class="${this.filter === "lazy" ? "on" : ""}">作业没做完 ${lazy.length}</button><button data-tf="quiet" class="${this.filter === "quiet" ? "on" : ""}">7 天没打开 ${quiet.length}</button></div><span class="grow"></span>
          ${list.length && this.filter !== "all" ? `<button class="btn sm" data-tcopy="${esc(list.map((s) => "@" + (s.name || s.account)).join(" "))}">复制名字（发到群里提醒）</button>` : ""}</div>
          <div class="card t58-stu">${list.length ? list.map((s) => { const d = since(s.last_active), p = hwN ? pct(Math.min(s.hw_done, hwN), hwN) : 0;
            return `<div class="t58-s">${avHtml(s.name || s.account || "?", "sm")}<div class="t58-sn"><b>${esc(s.name || s.account)}${s.role === "monitor" ? "<i>班委</i>" : ""}</b><small>${d == null ? "还没打开过" : d === 0 ? "今天打开过" : d + " 天前打开过"} · 看过 ${s.seen} 条</small></div>
              <div class="t58-sp"><div class="t58-bar"><i class="${p >= 80 ? "ok" : p < 40 ? "low" : ""}" style="width:${p}%"></i></div><small>作业 ${s.hw_done}${hwN ? "/" + hwN : ""}</small></div></div>`; }).join("")
            : `<div class="muted" style="padding:14px 0">${this.filter === "all" ? "还没有同学加入。把班级码发到班级群，同学输入班级码就能加入。" : "没有 🎉"}</div>`}</div>
          <div class="muted" style="font-size:12px;margin-top:8px">「作业」= 最近 ${o.days} 天到期的作业里，同学自己勾了完成的项数；「看过」= 打开过作业页或点开过事项。老师自己看不算。</div>`;
      } else if (this.tab === "items") {
        const it = o.items || [];
        html += `<div class="card t58-stu">${it.length ? it.map((x) => `<div class="t58-it"><div class="t58-ith">${tagHtml(x.type)}<b>${esc(x.subject || x.summary || x.type)}</b><span class="grow"></span><button class="btn ghost sm" data-tv="${esc(x.id)}" data-t="${esc(x.subject || x.summary || x.type)}">名单 ›</button></div>
            <div class="muted" style="font-size:12px">${esc(x.time || "时间待定")}${x.by ? " · " + esc(x.by) + " 发布" : ""}</div>
            <div class="t58-ib"><span>已读</span><div class="t58-bar"><i style="width:${pct(x.views, o.total)}%"></i></div><small>${x.views}/${o.total}</small></div>
            ${x.type === "作业" ? `<div class="t58-ib"><span>完成</span><div class="t58-bar"><i class="ok" style="width:${pct(x.done, o.total)}%"></i></div><small>${x.done}/${o.total}</small></div>` : ""}</div>`).join("")
          : `<div class="muted" style="padding:14px 0">最近 ${o.days} 天没有事项</div>`}</div>`;
      }
    }
    if (this.tab === "staff" || !o) html += this.staffHtml();
    box.innerHTML = html;
  },
  staffHtml() {
    const own = (this.classes || []).filter((c) => c.kind === "staff");
    const joined = (App.S.classes || []).filter((c) => Kinds58.of(c) === "staff" && !own.some((o) => o.id === c.id));
    const can = P58.teacher() || P58.me().role === "admin";
    return `<div class="card t58-staff"><div class="t58-ovh"><b>🧑‍🏫 教师组</b><span class="grow"></span>${can ? `<button class="btn sm" data-tnew>＋ 新建教师组</button>` : ""}<button class="btn ghost sm" data-tpend>输入组码加入</button></div>
      ${own.concat(joined).length ? own.map((c) => `<button class="t58-g" data-tg="${esc(c.id)}"><b>${esc(c.name)}</b><small>我建的 · ${c.total || 0} 位老师${c.code ? " · 组码 " + esc(c.code) : ""}</small><span>进入 ›</span></button>`).join("")
        + joined.map((c) => `<button class="t58-g" data-tg="${esc(c.id)}"><b>${esc(c.name)}</b><small>我加入的</small><span>进入 ›</span></button>`).join("")
        : `<div class="muted">教研组、年级组、备课组……建一个教师组，把组码发给同事。只有老师身份能加入。</div>`}
      <div class="muted" style="font-size:12px;margin-top:8px">教师组和班级一样：可以发通知、共享日程（教研活动、监考安排）、在班级墙讨论。</div></div>`;
  },
  async newStaff() {
    const r0 = await formBox("新建教师组", [{ name: "n", label: "名字", placeholder: "例如：高一数学备课组、初二年级组", required: true, max: 40 }], "创建");
    if (!r0 || !r0.n) return;
    try {
      const r = await api("create_class_kind", { cname: r0.n, ckind: "staff" });
      call("refresh").catch(() => {});
      infoBox("建好了", `「${esc(r.name)}」的组码：<b style="font-size:20px;letter-spacing:2px">${esc(r.code)}</b><br><br>把组码发给同事，他们在「班级」页输入组码就能加入（只有老师身份能加入）。`);
      this.load(true);
    } catch (e) { toast(cleanErr(e), { bad: true }); }
  },
  async enter(cid) {
    if (!(App.S.classes || []).some((c) => c.id === cid)) { toast("这个组还没同步过来，稍等几秒再点"); call("refresh").catch(() => {}); return; }
    await call("class:switch", cid); App.go("wall");
  },
};
// 班级的类型（班级 / 教师组 / 团队）
const Kinds58 = {
  map: (() => { try { return JSON.parse(localStorage.getItem("class_kinds_v1")) || {}; } catch (e) { return {}; } })(), at: 0,
  of(c) { return (c && (c.kind || this.map[c.id])) || "class"; },
  async refresh() {
    if (!App.S || !App.S.me || Date.now() - this.at < 120000) return;
    this.at = Date.now();
    try { const k = await api("my_class_kinds", {}, true); if (k) { this.map = k; try { localStorage.setItem("class_kinds_v1", JSON.stringify(k)); } catch (e) {} } } catch (e) {}
  },
};

// ================= 4. 职场版用词 =================
const Work58 = {
  MAP: [["班级管理", "团队管理"], ["班级码", "团队码"], ["班级墙", "团队墙"], ["班级群", "团队群"], ["班级成员", "团队成员"], ["班级课表", "团队日程表"], ["班级事项", "团队事项"],
    ["加入班级", "加入团队"], ["创建班级", "创建团队"], ["切换班级", "切换团队"], ["班级情况", "团队情况"], ["建班", "建团队"], ["全班", "全团队"], ["本班", "本团队"], ["班级", "团队"],
    ["班委", "负责人"], ["课代表", "负责人"], ["交作业", "交付任务"], ["作业", "任务"], ["同学们", "同事们"], ["同学", "同事"], ["老师", "管理员"], ["学生", "成员"], ["学习工作台", "工作台"]],
  on: false, obs: null,
  SKIP: "input,textarea,select,option,[contenteditable],script,style,.selectable,.dt-orig,.wp-body,#lgAcct",
  init() {
    this.RE = new RegExp(this.MAP.map((m) => m[0]).join("|"), "g"); this.TO = Object.fromEntries(this.MAP);
  },
  sub(s) { return s.replace(this.RE, (m) => this.TO[m]); },
  node(n) {
    const test = (v) => { this.RE.lastIndex = 0; const r = this.RE.test(v); this.RE.lastIndex = 0; return r; };
    if (n.nodeType === 3) { if (test(n.nodeValue) && !(n.parentElement && n.parentElement.closest(this.SKIP))) n.nodeValue = this.sub(n.nodeValue); return; }
    if (n.nodeType !== 1 || n.closest(this.SKIP)) return;
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: (x) => (x.nodeType === 1 && x.matches(this.SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    for (const a of ["title", "placeholder"]) { const v = n.getAttribute(a); if (v && test(v)) n.setAttribute(a, this.sub(v)); }
    let x; while ((x = w.nextNode())) {
      if (x.nodeType === 3) { if (test(x.nodeValue)) x.nodeValue = this.sub(x.nodeValue); }
      else for (const a of ["title", "placeholder"]) { const v = x.getAttribute(a); if (v && test(v)) x.setAttribute(a, this.sub(v)); }
    }
  },
  start() {
    if (this.on) return; this.on = true; this.init();
    this.node(document.body);
    this.obs = new MutationObserver((ms) => { for (const m of ms) { if (m.type === "characterData") this.node(m.target); else m.addedNodes.forEach((n) => this.node(n)); } });
    this.obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  },
};

// 每次界面刷新（App.S 变了）：检查模式
{
  const tick = () => {
    if (!App.S || !App.S.loggedIn) return;
    if (P58.work()) Work58.start();
    Kinds58.refresh();
    document.documentElement.classList.toggle("is-teacher", P58.teacher());
  };
  setInterval(tick, 3000); setTimeout(tick, 800);
}
// 工具页的「常用」里加一个入口；命令面板也能搜到（Ctrl+K →「导入」）
document.addEventListener("click", (e) => { const b = e.target.closest("[data-goq=memo]"); if (b) { e.preventDefault(); e.stopPropagation(); Memo58.open(); } }, true);

// ================= 5. 登录设备管理（和网站「我的 → 安全」同一套，后端 5.4.0） =================
// 这台电脑每次打开、之后每 2 分钟报到一次；在别的设备上被「踢出」后，这里马上退出登录（本机的个人记录还在）
const Dev58 = {
  list: [], err: "", at: 0, hook: null, kicking: false, lastTouch: 0,
  id() { return (App.S && App.S.dev) || ""; },
  name() { return "Windows 电脑版" + (navigator.userAgent.includes("Windows NT 10") ? "" : ""); },
  async touch(force) {
    if (!App.S || !App.S.loggedIn || !this.id() || this.kicking || (!force && Date.now() - this.lastTouch < 120000)) return;
    this.lastTouch = Date.now();
    try {
      const r = await api("device_touch", { p_device: this.id(), p_name: this.name(), p_platform: "desktop" }, true);
      if (r && r.revoked) return this.kicked();
      this.hook = !!(r && r.hook);
    } catch (e) { /* 后台没开通设备管理：不影响使用 */ }
  },
  async alive() {
    if (this.hook !== false || !App.S || !App.S.loggedIn || this.kicking) return;
    try { const r = await api("device_alive", { p_device: this.id() }, true); if (r && r.revoked) this.kicked(); } catch (e) { if (notFound(e)) this.hook = true; }
  },
  async kicked() {
    if (this.kicking) return; this.kicking = true;
    try { await call("logout"); } catch (e) {}
    infoBox("这台电脑已退出登录", "你的账号在另一台设备上把这台电脑退出了登录。本机的个人记录还在，重新登录就能继续用。<br><br>如果不是你本人操作，请登录后立刻修改密码。");
    setTimeout(() => (this.kicking = false), 5000);
  },
  async load(force) {
    if (!force && Date.now() - this.at < 30000) return;
    this.at = Date.now();
    await this.touch(true);
    try { this.list = (await api("device_list", { p_device: this.id() }, true)) || []; this.err = ""; }
    catch (e) { this.list = []; this.err = notFound(e) ? "后台还没开通设备管理（网站数据库要先执行 5.4.0 的 SQL）" : cleanErr(e); }
    this.paint();
  },
  html() {
    const ic = { web: "💻", android: "📱", wechat: "💬", desktop: "🖥️", ios: "📱" };
    const when = (t) => { const m = Math.round((Date.now() - Date.parse(t)) / 60000); return isNaN(m) ? "" : m < 2 ? "刚刚" : m < 60 ? m + " 分钟前" : m < 1440 ? Math.round(m / 60) + " 小时前" : Math.round(m / 1440) + " 天前"; };
    return `<section class="card st-card" id="st-dev" data-st="登录设备"><h3>登录设备 <small>你的账号现在在哪些设备上登录着。看到不认识的设备，点「踢出」再改密码</small></h3>
      <div id="devList">${this.err ? `<div class="muted" style="padding:8px 0">${esc(this.err)}</div>` : !this.at ? `<div class="muted" style="padding:8px 0">加载中…</div>`
        : this.list.map((d) => `<div class="st-row"><div><b>${ic[d.platform] || "📱"} ${esc(d.name || "设备")}${d.current ? ` <span class="tag" style="--c:var(--ok)">这台电脑</span>` : ""}</b><small>最近使用 ${esc(when(d.last_seen))}</small></div>
          <div class="st-ctl">${d.current ? "" : `<button class="btn sm danger" data-devkick="${esc(d.id)}">踢出</button>`}</div></div>`).join("") || `<div class="muted" style="padding:8px 0">只有这台电脑</div>`}</div>
      <div class="st-row"><div><small>踢出后，那台设备会立刻退出登录，正在进行的操作也会失效；它本机的记录不会被删。</small></div><div class="st-ctl"><button class="btn sm" data-devref>刷新</button>${this.list.filter((d) => !d.current).length > 1 ? `<button class="btn sm danger" data-devall>退出其他所有设备</button>` : ""}</div></div></section>`;
  },
  paint() {
    const v = App.views.settings, el = v && v.el && $("#st-dev", v.el); if (!el) return;
    el.outerHTML = this.html();
  },
  async kick(id, all) {
    const d = this.list.find((x) => x.id === id);
    if (!(await confirmBox(all ? "退出其他所有设备？" : `把「${d ? d.name : "这台设备"}」退出登录？`, "那台设备会立刻退出登录。", "踢出", true))) return;
    try { await api("device_revoke", { p_id: all ? null : id, p_all: !!all, p_device: this.id() }); }
    catch (e) { toast("没踢出：" + cleanErr(e), { bad: true }); return; }
    await this.load(true);
    if (await confirmBox("已退出登录", "如果那不是你的设备，说明密码可能被别人知道了。现在去改密码吗？", "去改密码")) App.views.me.changePw && App.views.me.changePw();
  },
};
{
  const st = App.views.settings, up0 = st.update, mount0 = st.mount;
  st.update = function () {
    up0.call(this);
    const wrap = $("#stWrap", this.el), acct = wrap && $("#st-acct", wrap); if (!acct) return;
    acct.insertAdjacentHTML("afterend", Dev58.html());
    const idx = $("#stIdx", this.el);
    if (idx && !$('[data-st-go="st-dev"]', idx)) { const b = h(`<button data-st-go="st-dev">登录设备</button>`); const a = $('[data-st-go="st-acct"]', idx); a ? a.after(b) : idx.append(b); }
    Dev58.load(false);
  };
  st.mount = function (el) {
    mount0.call(this, el);
    el.addEventListener("click", (e) => {
      const k = e.target.closest("[data-devkick]"); if (k) { Dev58.kick(k.dataset.devkick, false); return; }
      if (e.target.closest("[data-devall]")) { Dev58.kick(null, true); return; }
      if (e.target.closest("[data-devref]")) Dev58.load(true);
    });
  };
  setInterval(() => { Dev58.touch(false); Dev58.alive(); }, 15000);
  setTimeout(() => Dev58.touch(true), 3000);
}
