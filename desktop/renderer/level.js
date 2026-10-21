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
      <span class="grow"></span><button class="btn sm" data-lvboard>🏆 等级榜</button><button class="btn sm" data-ckpanel>📍 班级签到</button></div>${this.bar(L)}
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

// ---------- 位置签到：电脑上没有定位，只能看、看名单、结束；签到 / 发起用手机 ----------
const Ck = {
  list: [], cid: "", at: 0,
  mgr() { const c = (App.S.classes || []).find((x) => x.id === App.S.cid); return !!(c && (c.is_teacher || c.can_edit || c.can_ingest)); },
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
    const html = open.length ? open.map((x) => `<div class="ck-banner${x.mine ? " done" : ""}" data-ckpanel><b>📍 ${esc(x.title || "位置签到")}</b><span>${esc(x.place || "")} · ${x.radius} 米内 · 还剩 ${this.left(x)}${x.can_manage ? ` · 已签 ${x.signed}/${x.members}` : ""}</span>
      <em>${x.mine ? `✓ 已签到（离 ${x.mine.dist} 米）` : "📱 请用手机打开捞捞签到"}</em></div>`).join("") : "";
    if (b._h !== html) { b.innerHTML = html; b._h = html; }
  },
  async panel() {
    await this.load(true);
    const d = h(`<div class="dialog wide ck-dlg" role="dialog"><h3>📍 班级位置签到</h3><div class="dbody" id="ckBody"></div>
      <div class="dfoot"><span class="muted">电脑没有定位：发起签到和签到请用手机上的捞捞（网页、小程序、安卓都行）</span><span class="grow"></span><button class="btn" data-a="re">刷新</button><button class="btn primary" data-a="no">关闭</button></div></div>`);
    const draw = () => {
      $("#ckBody", d).innerHTML = this.list.length ? this.list.map((x) => `<div class="ck-row${x.open ? " open" : ""}">
          <div><b>${esc(x.title || "位置签到")}</b> ${x.open ? `<span class="tag" style="--c:var(--brand)">进行中 · 还剩 ${this.left(x)}</span>` : `<span class="tag" style="--c:#9aa5b5">已结束</span>`}
          <div class="muted">${esc(x.place || "")} · ${x.radius} 米内 · ${new Date(x.starts_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}${x.can_manage ? ` · 已签 ${x.signed}/${x.members}` : ""}</div>
          <div class="muted">${x.mine ? `✓ 我 ${new Date(x.mine.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 签到了（离 ${x.mine.dist} 米）` : x.open ? "我还没签到：用手机打开捞捞签到" : "我没签到"}</div></div>
          ${x.can_manage ? `<div class="ck-act"><button class="btn sm" data-ckd="${x.id}">名单</button>${x.open ? `<button class="btn sm danger" data-ckc="${x.id}">结束</button>` : ""}</div>` : ""}
          <div class="ck-names hidden" id="ckN${x.id}"></div></div>`).join("")
        : `<div class="empty"><b>📍</b>班里还没有位置签到。${this.mgr() ? "班委 / 老师在手机上点「📍 签到」就能发起：选好地点和范围，同学到了现场才能签。" : ""}</div>`;
    };
    draw();
    d.addEventListener("click", async (e) => {
      const a = e.target.closest("[data-a]");
      if (a && a.dataset.a === "no") return closeOverlay();
      if (a && a.dataset.a === "re") { await this.load(true); return draw(); }
      const dd = e.target.closest("[data-ckd]");
      if (dd) {
        const box = $("#ckN" + dd.dataset.ckd, d); if (!box.classList.contains("hidden")) return box.classList.add("hidden");
        box.classList.remove("hidden"); box.textContent = "加载中…";
        try {
          const r = await api("checkin_detail", { id: +dd.dataset.ckd });
          const miss = r.missing || [];
          box.innerHTML = `<div><b>已签 ${(r.signed || []).length} 人</b>：${(r.signed || []).map((s) => `${esc(s.name)}<small>（${new Date(s.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} · ${s.dist} 米）</small>`).join("、") || "还没有"}</div>
            <div><b>没签 ${miss.length} 人</b>：${miss.map(esc).join("、") || "全到了 🎉"} ${miss.length ? `<button class="btn ghost sm" data-ckcopy="${esc(miss.join("、"))}">复制名单</button>` : ""}</div>`;
        } catch (err) { box.textContent = "名单打不开：" + cleanErr(err); }
        return;
      }
      const cp = e.target.closest("[data-ckcopy]"); if (cp) { try { await navigator.clipboard.writeText(cp.dataset.ckcopy); toast("已复制没签到的名单"); } catch (err) {} return; }
      const cc = e.target.closest("[data-ckc]");
      if (cc) {
        if (!(await confirmBox("结束这次签到？", "结束后同学就不能再签了。", "结束", true))) return this.panel();
        try { await api("checkin_close", { id: +cc.dataset.ckc }); toast("签到已结束"); } catch (err) {}
        return this.panel();
      }
    });
    openOverlay(d);
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
