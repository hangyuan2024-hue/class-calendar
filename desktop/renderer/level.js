// 6.9 电脑版：账号等级（经验）、班级位置签到（查看 / 名单 / 结束）、首页点课程看课表截图
// 经验在服务器上算（level.sql 的 xp_*）：同一件事只算一次，取消完成会扣回来，刷不出经验。
"use strict";
const Lv = {
  TITLES: [[1, "新同学"], [2, "小学徒"], [3, "见习生"], [4, "进阶者"], [5, "好学者"], [6, "行动派"], [8, "学霸"], [10, "卷王"], [13, "大神"], [16, "传说"]],
  title(l) { let t = this.TITLES[0][1]; for (const [n, s] of this.TITLES) if (l >= n) t = s; return t; },
  me() { return App.S && App.S.xp ? App.S.xp : null; },
  chip(L, cls) { return L ? `<span class="lv-chip ${cls || ""}" title="账号等级 · 经验 ${L.xp}">Lv.${L.level}<i>${esc(this.title(L.level))}</i></span>` : ""; },
  bar(L) {
    if (!L) return "";
    const pct = Math.max(0, Math.min(100, Math.round(((L.xp - L.from) / Math.max(1, L.to - L.from)) * 100)));
    return `<div class="lv-bar"><i style="width:${pct}%"></i></div><small class="lv-next">${L.xp} / ${L.to} 经验 · 再攒 ${Math.max(0, L.to - L.xp)} 升到 Lv.${L.level + 1}</small>`;
  },
  card() {
    const x = this.me(), L = x && x.level;
    if (!L) return `<div class="card lv-card"><b>账号等级</b><span class="muted">完成事项、打卡、专注都能攒经验升级，在「排行榜 → 等级」里和同学比一比。（服务器还没升级时这里先空着）</span></div>`;
    return `<div class="card lv-card"><div class="lv-top"><span class="lv-big">Lv.${L.level}</span><span class="lv-t"><b>${esc(this.title(L.level))}</b><small>今天 +${x.today || 0} 经验 · 一共 ${L.xp}</small></span>
      <span class="grow"></span><button class="btn sm" data-lvboard>🏆 等级榜</button><button class="btn sm" data-ckpanel>📋 班级签到</button></div>${this.bar(L)}
      <details class="lv-rules"><summary>经验怎么攒？</summary><ul>
        <li>完成班级作业 <b>+10</b>，其它班级事项 <b>+5</b></li><li>完成自己记的事项 <b>+2</b>（每天最多 5 件）</li>
        <li>习惯打卡 <b>+3</b>（每天 5 次），番茄钟 <b>+2</b>（每天 12 个），位置签到 <b>+5</b></li>
        <li>同一件事只算一次；取消完成会把经验扣回来，再勾上也不会多给</li></ul></details></div>`;
  },
  boardHtml(d) {
    const rows = d.rows || [], mine = d.me && d.me.level;
    const av = (r) => `<span class="av sm" style="background:${r.anon && !d.teacher && !r.me ? "#9aa5b5" : avColor(r.name)}">${esc([...(r.name || "?")][0])}</span>`;
    return `${mine ? `<div class="card lv-card"><div class="lv-top"><span class="lv-big">Lv.${mine.level}</span><span class="lv-t"><b>我 · ${esc(this.title(mine.level))}</b><small>一共 ${mine.xp} 经验</small></span></div>${this.bar(mine)}</div>` : ""}
      ${rows.length ? `<div class="card rk-list">${rows.map((r) => `<div class="rk-row${r.me ? " me" : ""}"><span class="rk-n">${r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</span>${av(r)}
        <div class="rk-m"><b>${esc(r.name)} ${this.chip({ level: r.level, xp: r.xp })}</b></div><b class="rk-p">${r.xp}<small> 经验</small></b></div>`).join("")}</div>`
        : `<div class="card empty"><b>⭐</b>班里还没有人攒经验。完成一项作业就能上榜！</div>`}
      <div class="muted" style="margin-top:8px">等级跟着账号走（换班、换设备都在），按总经验排；在「本周」那页选了「匿名」「不参加」，这里也一样。</div>`;
  },
  onXp(p) {
    if (!p || !p.points) return;
    if (p.up) { toast(`🎉 升级了！Lv.${p.level.level} ${this.title(p.level.level)}`, { ms: 3600 }); if (!matchMedia("(prefers-reduced-motion: reduce)").matches) confetti(60); }
    else toast(`⭐ 经验 +${p.points} · Lv.${p.level.level} ${p.level.xp}/${p.level.to}`);
  },
  paint() {
    const s = $("#meLv"); if (s) s.innerHTML = this.chip(this.me() && this.me().level, "sm");
    const c = $("#lvCard"); if (c) { const html = this.card(); if (c._h !== html) { c.innerHTML = html; c._h = html; } }
  },
};
if (window.cc) window.cc.on("xp", (p) => { try { Lv.onXp(p); } catch (e) {} });

// ---------- 班级签到：动态码（投屏二维码）/ 位置 / 两个都要 ----------
// 电脑上：班委 / 老师发起「动态码签到」并投屏二维码（同学微信扫一扫就签上），看名单、结束；
// 位置签到要手机定位，电脑上能看、能投屏名单，签到和发起位置签到请用手机
const CK_MODE = { geo: "📍 位置签到", code: "🔢 动态码签到", both: "📍 位置 + 🔢 动态码" };
const CK_SITE = "https://www.laolaokechengbiao.cn/ck/";
const Ck = {
  list: [], cid: "", at: 0, one: null, timer: 0, code: "",
  // 能发起签到：老师（建班的）或有发布 / AI 整理权限的班委
  canMgr(c) { return !!(c && (c.is_teacher || (c.member_role === "monitor" && (c.can_edit || c.can_ingest)))); },
  clsOf(id) { return (App.S.classes || []).find((x) => x.id === id) || null; },
  mgr(cid) { return this.canMgr(this.clsOf(cid || this.pcid || App.S.cid)); },
  // 能不能签：班里的同学（班委也要签）；老师不用签。老的服务器没有 can_sign 时按以前的规则
  signable(x) { return x.can_sign != null ? x.can_sign && !x.is_teacher : !x.can_manage; },
  pcid: null,
  needCode: (x) => x.mode === "code" || x.mode === "both",
  needGeo: (x) => x.mode !== "code",
  hhmm(iso) { const d = new Date(iso); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); },
  async load(force) {
    const cid = App.S && App.S.cid; if (!cid) { this.list = []; this.cid = ""; this.paint(); return; }
    const open = this.list.some((x) => x.open);
    if (!force && cid === this.cid && Date.now() - this.at < (open ? 30000 : 120000)) return;
    this.at = Date.now();
    try { const r = await api("checkin_list", { cid }, true); this.list = Array.isArray(r) ? r : []; this.cid = cid; }
    catch (e) { this.list = []; this.cid = cid; }
    this.paint();
  },
  left(x) { const m = Math.max(0, Math.round((new Date(x.ends_at).getTime() - Date.now()) / 60000)); return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`; },
  paint() {
    const b = $("#tdCk"); if (!b) return;
    const open = this.list.filter((x) => x.open);
    const html = open.map((x) => `<div class="ck-banner${x.mine ? " done" : ""}" data-ckone="${x.id}"><b>${this.needCode(x) ? "🔢" : "📍"} ${esc(x.title || "签到")}</b><span>${esc(CK_MODE[x.mode] || CK_MODE.geo)}${x.place ? " · " + esc(x.place) : ""} · 还剩 ${this.left(x)} · 已签 ${x.signed}/${x.members}</span>
      <em>${x.mine ? "✓ 已签到" : x.can_manage ? (this.needCode(x) ? "投屏二维码 ›" : "看名单 ›") : this.needGeo(x) ? "📱 用手机签到" : "输入签到码 ›"}</em></div>`).join("");
    if (b._h !== html) { b.innerHTML = html; b._h = html; }
  },
  close() { clearInterval(this.timer); this.one = null; this.code = ""; if (App.view === "checkin" && App.views.checkin.el) setTimeout(() => App.views.checkin.load(), 50); },
  // 列表 + 发起
  async panel(cid) {
    this.close();
    if (cid !== undefined) this.pcid = cid && cid !== App.S.cid ? cid : null;
    const pc = this.pcid || App.S.cid;
    if (this.pcid) { try { const r = await api("checkin_list", { cid: pc }, true); this.plist = Array.isArray(r) ? r : []; } catch (e) { this.plist = []; } }
    else await this.load(true);
    const list = this.pcid ? this.plist : this.list;
    const mgr = this.mgr(pc);
    const mine = (App.S.classes || []).filter((x) => x.is_teacher || x.status === "approved" || !x.status);
    const d = h(`<div class="dialog wide ck-dlg" role="dialog"><h3>📋 班级签到 ${mine.length > 1 ? `<select class="input ck-cls" id="ckCls">${mine.map((x) => `<option value="${esc(x.id)}"${x.id === pc ? " selected" : ""}>${esc(x.nickname || x.name)}${x.is_teacher ? "（我带的）" : x.member_role === "monitor" ? "（班委）" : ""}</option>`).join("")}</select>` : ""}</h3><div class="dbody">
      ${mgr ? `<details class="ck-new card" ${list.some((x) => x.open) ? "" : "open"}><summary>＋ 发起动态码签到（投屏二维码）</summary>
        <div class="ck-form"><input class="input" id="ckT" maxlength="40" placeholder="名称，比如：周三高数课签到" value="${esc(new Date().getMonth() + 1 + "月" + new Date().getDate() + "日签到")}">
          <input class="input" id="ckP" maxlength="60" placeholder="地点（选填），比如：B302">
          <select class="input" id="ckM"><option value="5">5 分钟</option><option value="10" selected>10 分钟</option><option value="15">15 分钟</option><option value="30">30 分钟</option><option value="60">1 小时</option><option value="120">2 小时</option></select>
          <button class="btn primary" id="ckGo">发起并投屏</button></div>
        <div class="muted">二维码每 20 秒换一次，同学用微信「扫一扫」就签上了；没带手机扫的可以输入屏幕上的 4 位码。要按位置签到（到了现场才算），请用手机上的捞捞发起。</div></details>` : ""}
      <div id="ckList">${list.length ? list.map((x) => `<div class="ck-row${x.open ? " open" : ""}" data-ckone="${x.id}">
          <div><b>${esc(x.title || "签到")}</b> ${x.open ? `<span class="tag" style="--c:#ff7a45">进行中 · 还剩 ${this.left(x)}</span>` : `<span class="tag" style="--c:#9aa5b5">已结束</span>`}
          <div class="muted">${esc(CK_MODE[x.mode] || CK_MODE.geo)}${x.place ? " · " + esc(x.place) : ""} · ${this.hhmm(x.starts_at)} · ${esc(x.by || "")}发起 · 已签 ${x.signed}/${x.members}</div>
          <div class="muted">${x.mine ? `✓ 我 ${this.hhmm(x.mine.at)} 签到了` : x.open ? "我还没签到" : "我没签到"}</div></div>
          <span class="ck-go">${this.signable(x) && x.open && !x.mine ? "签到" : x.can_manage ? (x.open && this.needCode(x) ? "投屏" : "名单") : "查看"} ›</span></div>`).join("")
        : `<div class="empty"><b>📋</b>班里最近 7 天没有签到。${mgr ? "点上面「发起动态码签到」，把二维码投到屏幕上就行。" : ""}</div>`}</div></div>
      <div class="dfoot"><span class="grow"></span><button class="btn" data-a="re">刷新</button><button class="btn primary" data-a="no">关闭</button></div></div>`);
    d.addEventListener("click", async (e) => {
      const a = e.target.closest("[data-a]");
      if (a && a.dataset.a === "no") return closeOverlay();
      if (a && a.dataset.a === "re") return this.panel();
      const o = e.target.closest("[data-ckone]"); if (o) return this.openOne(+o.dataset.ckone);
      if (e.target.closest("#ckGo")) {
        const b = e.target.closest("#ckGo"); b.disabled = true;
        try {
          const r = await api("checkin_create", { cid: pc, title: $("#ckT", d).value.trim() || "签到", place: $("#ckP", d).value.trim(), minutes: +$("#ckM", d).value, mode: "code" });
          await this.load(true); this.openOne(r.id);
        } catch (err) { b.disabled = false; }
      }
    });
    const sel = $("#ckCls", d); if (sel) sel.onchange = () => this.panel(sel.value);
    openOverlay(d, () => this.close());
  },
  // 一条签到：信息、地图、投屏二维码、名单 / 输码签到
  async openOne(id) {
    let x; try { x = await api("checkin_get", { id: +id }); } catch (e) { return; }
    this.close(); this.one = x;
    const pct = x.members ? Math.round(x.signed * 100 / x.members) : 0;
    const amap = x.lat != null ? `https://uri.amap.com/marker?position=${x.lng},${x.lat}&name=${encodeURIComponent(x.place || x.title)}&coordinate=wgs84&callnative=0` : "";
    const proj = x.can_manage && x.open && this.needCode(x);
    const d = h(`<div class="dialog wide ck-dlg" role="dialog"><h3>${this.needCode(x) ? "🔢" : "📍"} ${esc(x.title || "签到")} <span class="tag" style="--c:${x.open ? "#ff7a45" : "#9aa5b5"}">${x.open ? "进行中" : "已结束"}</span></h3><div class="dbody">
      <div class="ck-info"><div><span>方式</span><b>${esc(CK_MODE[x.mode] || CK_MODE.geo)}</b></div><div><span>班级</span><b>${esc(x.class_name || "")}</b></div>
        <div><span>发起人</span><b>${esc(x.by || "班委")}</b></div><div><span>时间</span><b>${this.hhmm(x.starts_at)} – ${this.hhmm(x.ends_at)}${x.open ? `（还剩 ${this.left(x)}）` : ""}</b></div>
        ${this.needGeo(x) ? `<div><span>地点</span><b>${esc(x.place || "签到点")} · ${x.radius} 米内</b></div>` : ""}<div><span>已签到</span><b id="ckN">${x.signed} / ${x.members} 人</b></div></div>
      <div class="lv-bar"><i style="width:${pct}%"></i></div>
      ${amap ? `<div class="ck-mapline">📍 签到点：${esc(x.place || "签到点")}（半径 ${x.radius} 米）<span class="grow"></span><button class="btn sm" data-ext="${esc(amap)}">在高德地图里看</button></div>` : ""}
      ${proj ? `<div class="ck-proj" id="ckProj"><div class="ck-qrbox" id="ckQr"></div><div class="ck-proj-r"><div class="ck-proj-t" id="ckQrT">微信扫一扫签到</div><div class="ck-code" id="ckCode">····</div>
        <div class="muted" id="ckLeft">每 20 秒换一次码</div><div class="muted">没带手机扫码的同学：打开捞捞「签到」，输入这 4 位码</div><button class="btn sm" id="ckFull">⛶ 全屏投屏</button></div></div>` : ""}
      ${this.signable(x) || x.mine ? `<div class="ck-me">${x.mine ? `<b class="ck-ok">✓ 你 ${this.hhmm(x.mine.at)} 签到了</b>` : !x.open ? `<span class="muted">签到已经结束了</span>`
        : this.needGeo(x) ? `<span class="muted">📱 这是位置签到，要到现场用手机上的捞捞签（网页、小程序、安卓都行）</span>`
        : `<input class="input ck-in" id="ckIn" maxlength="4" inputmode="numeric" placeholder="4 位签到码"><button class="btn primary" id="ckSign">签到</button>`}</div>` : ""}
      ${x.can_manage ? `<div class="ck-names" id="ckNames"><span class="muted">加载名单…</span></div>` : ""}</div>
      <div class="dfoot">${x.can_manage && x.open ? `<button class="btn danger" id="ckClose">结束签到</button>` : ""}<span class="grow"></span><button class="btn" data-a="list">‹ 全部签到</button><button class="btn primary" data-a="no">关闭</button></div></div>`);
    d.addEventListener("click", async (e) => {
      const a = e.target.closest("[data-a]");
      if (a && a.dataset.a === "no") return closeOverlay();
      if (a && a.dataset.a === "list") return this.panel(x.class_id || undefined);
      const ext = e.target.closest("[data-ext]"); if (ext) return call("open:external", ext.dataset.ext).catch(() => window.open(ext.dataset.ext));
      if (e.target.closest("#ckFull")) { const p = $("#ckProj", d); if (document.fullscreenElement) document.exitFullscreen(); else p.requestFullscreen().catch(() => p.classList.toggle("max")); return; }
      if (e.target.closest("#ckClose")) {
        if (!(await confirmBox("结束这次签到？", "结束后同学就不能再签了。", "结束", true))) return this.openOne(x.id);
        try { await api("checkin_close", { id: x.id }); toast("签到已结束"); } catch (err) {}
        await this.load(true); return this.openOne(x.id);
      }
      if (e.target.closest("[data-ckcopy]")) { try { await navigator.clipboard.writeText(e.target.closest("[data-ckcopy]").dataset.ckcopy); toast("已复制没签到的名单"); } catch (err) {} return; }
      if (e.target.closest("#ckSign")) {
        const v = ($("#ckIn", d).value || "").trim(); if (!/^\d{4}$/.test(v)) return toast("输入 4 位签到码", { bad: true });
        try { const r = await api("checkin_sign", { id: x.id, code: v }); if (r && r.ok === false) toast(r.why || "没签上", { bad: true, ms: 4000 }); else { toast("✓ 签到成功" + (r && r.points ? "，经验 +" + r.points : "")); await this.load(true); this.openOne(x.id); } } catch (err) {}
      }
    });
    openOverlay(d, () => this.close());
    if (x.can_manage) this.names(x.id);
    if (proj) { this.tick(); this.timer = setInterval(() => this.tick(), 2500); }
  },
  async tick() {
    const x = this.one, q = $("#ckQr"); if (!x || !q) { clearInterval(this.timer); return; }
    try {
      const r = await api("checkin_code", { id: x.id }, true); if (!r || !r.code) return;
      // 有小程序码就投小程序码（微信扫一扫直接进小程序签到）；还没生成好就先用普通二维码
      const key = (r.img ? "m" : "u") + r.code;
      if (key !== this.code) {
        this.code = key; $("#ckCode").textContent = r.code;
        q.innerHTML = r.img ? `<img src="${r.img}" alt="签到小程序码">` : QRLite.svg(CK_SITE + "?i=" + x.id + "&k=" + r.code, { level: "M" });
        if ($("#ckQrT")) $("#ckQrT").textContent = r.img ? "微信扫一扫签到" : "手机扫码签到";
      }
      $("#ckLeft").textContent = `${r.left} 秒后换码 · 已签 ${r.signed} / ${x.members}`;
      if ($("#ckN")) $("#ckN").textContent = `${r.signed} / ${x.members} 人`;
      this._n = (this._n || 0) + 1; if (this._n % 6 === 0) this.names(x.id);
    } catch (e) {}
  },
  async names(id) {
    const box = $("#ckNames"); if (!box) return;
    try {
      const r = await api("checkin_detail", { id }, true), miss = r.missing || [];
      if (!$("#ckNames")) return;
      box.innerHTML = `<div><b>已签 ${(r.signed || []).length} 人</b> ${(r.signed || []).map((s) => `<span class="ck-nm ok">${esc(s.name)}<small> ${this.hhmm(s.at)} ${s.via === "code" ? "码" : s.dist != null ? s.dist + "米" : ""}</small></span>`).join("") || `<span class="muted">还没有</span>`}</div>
        <div><b>没签 ${miss.length} 人</b> ${miss.map((n) => `<span class="ck-nm">${esc(n)}</span>`).join("") || `<span class="muted">全到了 🎉</span>`} ${miss.length ? `<button class="btn ghost sm" data-ckcopy="${esc(miss.join("、"))}">复制名单</button>` : ""}</div>`;
    } catch (e) { box.innerHTML = `<span class="muted">名单打不开：${esc(cleanErr(e))}</span>`; }
  },
  // 绑了地点的习惯：电脑上验不了位置，提醒用手机打
  habitBlocked(id, day) {
    const hb = (KV("habits_v1") || []).find((x) => x.id === id);
    if (!hb || !hb.place) return false;
    if (day && day !== todayKey()) return false;
    if (((KV("habit_log_v1") || {})[id] || {})[todayKey()]) return false;   // 取消打卡不用定位
    toast(`「${hb.name}」要到「${hb.place.name}」${hb.place.r} 米内打卡，电脑上没法定位，请用手机打卡`, { bad: true, ms: 4200 });
    return true;
  },
};
setInterval(() => { if (App.S && App.S.loggedIn) Ck.load(); }, 5000);

// ---------- 首页点课程：课表里标出这门课 / 截图导入时的原图 ----------
const CourseView = {
  shot: null, shotAt: 0, st: null,
  async getShot() {
    if (this.shot && Date.now() - this.shotAt < 300000) return this.shot;
    try { const r = await api("course_shot_get", {}, true); this.shot = r && r.img ? r : null; this.shotAt = Date.now(); } catch (e) {}
    return this.shot;
  },
  setShot(rec) { this.shot = rec; this.shotAt = Date.now(); },
  colorOf(name) {   // 和网页版课表图片同一套颜色
    const P = [["#e6eefc", "#2e5fa8", "#5b8def"], ["#fdecef", "#b04a5a", "#e68a97"], ["#e6f7ee", "#2e7d55", "#5fc491"], ["#fff3e2", "#b06a2a", "#eda35c"], ["#f2ecfc", "#6b4aa8", "#9d7be0"],
      ["#e4f4f9", "#2b6f86", "#5fb7d4"], ["#fdeef7", "#ab4a82", "#e587bd"], ["#f3f1e7", "#7d6a38", "#c2ab62"], ["#eef3e1", "#5d7730", "#9cb85c"], ["#fdefe9", "#a95c3d", "#e0936f"]];
    let h = 0; const t = String(name || ""); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0; const c = P[h % P.length]; return { bg: c[0], fg: c[1], bar: c[2] };
  },
  png(day, dk, c) {
    if (typeof CourseImage === "undefined") return "";
    const S = App.S, meta = S.courses.meta || {}, times = M.periodTimes(meta), d0 = M.fromKey(dk), mon = M.addDays(d0, -M.weekday0(d0));
    const list = [], dates = [];
    for (let i = 0; i < 7; i++) {
      const d = M.addDays(mon, i); dates.push(`${d.getMonth() + 1}/${d.getDate()}`);
      for (const x of M.coursesOn(S.courses, d)) list.push({ name: x.name, day: i, start: +x.start, end: +(x.end || x.start), location: x.location || "", teacher: x.teacher || "", color: this.colorOf(x.name) });
    }
    const wk = M.weekOf(meta, d0), tw = M.dayKey(App.now());
    const m = CourseImage.model({ title: "我的课程表", sub: (wk >= 1 ? `第 ${wk} 周 · ` : "") + `${dates[0]} – ${dates[6]}`, times, dates, today: tw >= M.dayKey(mon) && tw <= M.dayKey(M.addDays(mon, 6)) ? M.weekday0(App.now()) : -1, courses: list });
    m.hl = { name: c.name, day, start: +c.start };
    const sz = CourseImage.size(m), cv = document.createElement("canvas"); cv.width = sz.width; cv.height = sz.height;
    CourseImage.draw(cv.getContext("2d"), m);
    return cv.toDataURL("image/png");
  },
  async open(name, dk, start) {
    const S = App.S, d0 = M.fromKey(dk), day = M.weekday0(d0), list = M.coursesOn(S.courses, d0);
    const c = list.find((x) => x.name === name && (start == null || +x.start === +start)) || list.find((x) => x.name === name) || (S.courses.courses || []).find((x) => x.name === name);
    if (!c) return App.go("week");
    const src = await this.getShot();
    const box = src && src.items && (src.items[c.id] || Object.values(src.items).find((m) => m.name === c.name));
    this.st = { c, dk, day, src, box, tab: this.st && this.st.tab === "src" && src ? "src" : "table" };
    this.draw();
  },
  draw() {
    const { c, dk, day, src, box, tab } = this.st;
    const times = M.periodTimes(App.S.courses.meta || {}), t0 = (times[c.start - 1] || "").split("-")[0], t1 = (times[(c.end || c.start) - 1] || "").split("-")[1] || "";
    const info = [`周${"一二三四五六日"[day]} 第 ${c.start}${+c.end > +c.start ? "–" + c.end : ""} 节${t0 ? `（${t0}–${t1}）` : ""}`, c.location ? "📍 " + c.location : "", c.teacher ? "👤 " + c.teacher : ""].filter(Boolean);
    let body;
    if (tab === "table") { const u = this.png(day, dk, c); body = u ? `<img class="cv-img" src="${u}" alt="课程表里的${esc(c.name)}">` : `<div class="empty">课表图片画不出来</div>`; }
    else body = `<div class="cv-src"><img src="${src.img}" alt="课表原图">${box && box.box ? `<span class="csbox on" style="left:${box.box[0] * 100}%;top:${box.box[1] * 100}%;width:${(box.box[2] - box.box[0]) * 100}%;height:${(box.box[3] - box.box[1]) * 100}%"></span>` : ""}</div>
      <small class="muted">${new Date(src.at || Date.now()).toLocaleDateString("zh-CN")} 截图导入时的原图${box && box.box ? "，框出来的就是这门课" : ""}</small>`;
    const d = h(`<div class="dialog wide cv-dlg" role="dialog"><h3 style="--c:${M.colorFor(c.name)}"><i class="cv-dot"></i>${esc(c.name)}</h3>
      <div class="muted cv-info">${info.map(esc).join("　")}</div>
      <div class="seg cv-tabs"><button data-cvt="table" class="${tab === "table" ? "on" : ""}">在课表里</button><button data-cvt="src" class="${tab === "src" ? "on" : ""}"${src ? "" : ` disabled title="用「截图导入」导入课表后，这里能看原图"`}>📷 截图原图</button></div>
      <div class="dbody cv-body">${body}</div>
      <div class="dfoot"><span class="grow"></span><button class="btn" data-a="week">打开课程表</button><button class="btn primary" data-a="no">关闭</button></div></div>`);
    d.addEventListener("click", (e) => {
      const t = e.target.closest("[data-cvt]"); if (t && !t.disabled) { this.st.tab = t.dataset.cvt; return this.draw(); }
      const a = e.target.closest("[data-a]"); if (!a) return;
      closeOverlay(); if (a.dataset.a === "week") App.go("week");
    });
    openOverlay(d);
  },
  // 截图导入成功后：原图缩小存到账号里（换电脑、手机也能看）
  keep(b64, fresh, picked) {
    const img = new Image();
    img.onload = () => {
      try {
        const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), cv = document.createElement("canvas");
        cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
        const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
        const items = {}; fresh.forEach((x, i) => { if (picked[i] && Array.isArray(picked[i].box)) items[x.id] = { box: picked[i].box, name: x.name }; });
        let u = cv.toDataURL("image/jpeg", 0.8); if (u.length > 2300000) u = cv.toDataURL("image/jpeg", 0.55);
        const rec = { img: u, w: cv.width, h: cv.height, at: Date.now(), items };
        this.setShot(rec);
        api("course_shot_set", { d: rec }, true).catch(() => {});
      } catch (e) {}
    };
    img.src = "data:image/jpeg;base64," + b64;
  },
};

// ---------- 6.9.2 侧栏「签到」：所有人都能找到（同学签到、老师 / 班委发起和投屏） ----------
App.views.checkin = {
  title: "签到", icon: "checkin", cid: null, data: null,
  count() { const n = (Ck.list || []).filter((x) => x.open && !x.mine && Ck.signable(x)).length; return n ? { n, hot: true } : null; },
  mount(el) {
    el.innerHTML = `<div class="vhead"><div><h1>签到</h1><div class="sub">课堂动态码签到、位置签到；老师和班委能发起、投屏二维码、看谁没签</div></div><span class="grow"></span>
      <select class="input" id="ckvCls" style="width:auto"></select><button class="btn" id="ckvRe">${icon("sync")}刷新</button><button class="btn primary" id="ckvNew">＋ 发起签到</button></div>
      <div class="vbody"><div class="ckv" id="ckvBody"></div></div>`;
    $("#ckvRe", el).onclick = () => this.load();
    $("#ckvNew", el).onclick = () => Ck.panel(this.cid);
    $("#ckvCls", el).onchange = (e) => { this.cid = e.target.value; this.load(); };
    el.addEventListener("click", (e) => { const o = e.target.closest("[data-ckone]"); if (o) Ck.openOne(+o.dataset.ckone); });
  },
  show() { this.load(); },
  update() { this.draw(); },
  async load() {
    const mine = (App.S.classes || []).filter((x) => x.is_teacher || x.status === "approved" || !x.status);
    if (!this.cid || !mine.some((x) => x.id === this.cid)) this.cid = mine.some((x) => x.id === App.S.cid) ? App.S.cid : (mine[0] && mine[0].id) || null;
    const sel = $("#ckvCls", this.el);
    if (sel) { sel.innerHTML = mine.map((x) => `<option value="${esc(x.id)}"${x.id === this.cid ? " selected" : ""}>${esc(x.nickname || x.name)}${x.is_teacher ? "（我带的）" : x.member_role === "monitor" ? "（班委）" : ""}</option>`).join(""); sel.classList.toggle("hidden", mine.length < 2); }
    if (!this.cid) { this.data = { list: [] }; return this.draw(); }
    try { const r = await api("checkin_list", { cid: this.cid }, true); this.data = { cid: this.cid, list: Array.isArray(r) ? r : [] }; }
    catch (e) { this.data = { cid: this.cid, list: [], err: notFound(e) ? "服务器还没升级（需要在扣子执行 level.sql）" : cleanErr(e) }; }
    this.draw();
  },
  draw() {
    const box = this.el && $("#ckvBody", this.el); if (!box) return;
    $("#ckvNew", this.el).classList.toggle("hidden", !Ck.mgr(this.cid));
    if (!this.cid) { box.innerHTML = `<div class="empty"><b>📋</b>先加入一个班级，才能签到</div>`; return; }
    const d = this.data; if (!d) { box.innerHTML = `<div class="empty">加载中…</div>`; return; }
    if (d.err) { box.innerHTML = `<div class="empty"><b>📋</b>${esc(d.err)}</div>`; return; }
    box.innerHTML = d.list.length ? d.list.map((x) => `<div class="card ck-row${x.open ? " open" : ""}" data-ckone="${x.id}">
        <div><b>${esc(x.title || "签到")}</b> ${x.open ? `<span class="tag" style="--c:#ff7a45">进行中 · 还剩 ${Ck.left(x)}</span>` : `<span class="tag" style="--c:#9aa5b5">已结束</span>`}
        <div class="muted">${esc(CK_MODE[x.mode] || CK_MODE.geo)}${x.place ? " · " + esc(x.place) : ""} · ${Ck.hhmm(x.starts_at)} · ${esc(x.by || "")}发起 · 已签 ${x.signed}/${x.members}</div>
        <div class="muted">${x.mine ? `✓ 我 ${Ck.hhmm(x.mine.at)} 签到了` : !Ck.signable(x) ? "" : x.open ? "<b style='color:#d4561e'>我还没签到</b>" : "我没签到"}</div></div>
        <span class="ck-go">${Ck.signable(x) && x.open && !x.mine ? "签到" : x.can_manage ? (x.open && Ck.needCode(x) ? "投屏 / 名单" : "名单") : "查看"} ›</span></div>`).join("")
      : `<div class="empty"><b>📋</b>最近 7 天没有签到。${Ck.mgr(this.cid) ? "点右上角「发起签到」，课堂上投屏动态码，同学微信一扫就签上。" : "老师或班委发起后会出现在这里。"}</div>`;
  },
};
