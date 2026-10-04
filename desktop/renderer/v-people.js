// 成员（同学录）和个人主页：头像、签名、成长足迹热力图、在班级墙的发言；老师可以给同学重置密码
"use strict";
const COVERS = { sky: ["天空", "linear-gradient(135deg,#7cc8ff 0%,#3a8dff 55%,#6a5cff 100%)"], sakura: ["樱花", "linear-gradient(135deg,#ffd1dc 0%,#ff8fb0 50%,#ff5f8f 100%)"],
  ocean: ["深海", "linear-gradient(135deg,#5ee7df 0%,#2a9fd6 50%,#1d4fb8 100%)"], sunset: ["落日", "linear-gradient(135deg,#ffd27a 0%,#ff8a5c 50%,#e8487a 100%)"],
  forest: ["森林", "linear-gradient(135deg,#c6f1a8 0%,#4fc58a 50%,#1f8a6e 100%)"], galaxy: ["星空", "linear-gradient(135deg,#a18cff 0%,#5b4bd6 50%,#1d1660 100%)"],
  peach: ["蜜桃", "linear-gradient(135deg,#ffe3c2 0%,#ffb199 50%,#ff7a8a 100%)"], mono: ["素白", "linear-gradient(135deg,#f3f5f9 0%,#d9dee8 100%)"] };
const coverOf = (c, g) => (COVERS[c] || COVERS[g === "f" ? "sakura" : g === "m" ? "sky" : "ocean"])[1];
const gIco = (g) => (g === "m" ? '<i class="gico m" title="男生">♂</i>' : g === "f" ? '<i class="gico f" title="女生">♀</i>' : "");
App.views.people = {
  title: "成员", icon: "people", uid: null, q: "", data: null,
  mount(el) {
    el.innerHTML = `<div class="vhead"><button class="btn ghost iconbtn hidden" id="ppBack" title="返回成员列表">${icon("left")}</button><div><h1 id="ppTitle">班级成员</h1><div class="sub" id="ppSub"></div></div><span class="grow"></span>
        <div class="tk-search pp-q" id="ppQw">${icon("search")}<input id="ppQ" placeholder="搜索名字、签名" spellcheck="false"></div>
        <button class="btn" id="ppMe">${icon("me")}我的主页</button></div>
      <div class="vbody"><div id="ppBox"></div></div>`;
    $("#ppBack", el).onclick = () => { this.uid = null; this.update(); this.loadList(); };
    $("#ppMe", el).onclick = () => this.open(App.S.me && App.S.me.id);
    let t = 0; $("#ppQ", el).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { this.q = e.target.value.trim(); this.drawList(); }, 200); };
    el.addEventListener("click", async (e) => {
      const u = e.target.closest("[data-user]"); if (u && u.dataset.user) { this.open(u.dataset.user); return; }
      if (e.target.closest("[data-prof]")) { App.views.me.editProfile().then(() => this.uid && this.open(this.uid)); return; }
      const p = e.target.closest("[data-goto-post]"); if (p) { App.go("wall"); setTimeout(() => { const n = document.getElementById("post-" + p.dataset.gotoPost); if (n) n.scrollIntoView({ behavior: "smooth", block: "center" }); }, 600); return; }
      const rs = e.target.closest("[data-reset]");
      if (rs) {
        if (!(await confirmBox(`给「${rs.dataset.name}」重置密码？`, "会生成一个临时密码，TA 用临时密码登录后必须马上改成自己的新密码。原来的密码立刻失效。", "重置", true))) return;
        try { const r = await api("pw_reset_by_staff", { uid: rs.dataset.reset }); infoBox("已重置密码", `把账号和临时密码告诉 <b>${esc(r.name)}</b>：<div class="pw-box selectable">账号 <b>${esc(r.account)}</b>　临时密码 <b>${esc(r.temp)}</b></div><button class="btn sm" id="pwCopy">复制</button>`).querySelector("#pwCopy").onclick = () => navigator.clipboard.writeText(`账号 ${r.account}　临时密码 ${r.temp}`).then(() => toast("已复制")); } catch (err) {}
      }
    });
  },
  show(arg) { if (arg && arg.uid) this.open(arg.uid); else if (!this.uid) this.loadList(); },
  update() {
    const el = this.el, list = !this.uid;
    $("#ppBack", el).classList.toggle("hidden", list); $("#ppQw", el).classList.toggle("hidden", !list);
    if (list) { $("#ppTitle", el).textContent = "班级成员"; $("#ppSub", el).textContent = App.className() || ""; if (this.data && this.data.cid !== App.S.cid) this.loadList(); else this.drawList(); }
  },
  async loadList() {
    const S = App.S, box = $("#ppBox", this.el);
    if (!S.cid) { box.innerHTML = `<div class="empty"><b>👥</b>加入班级后就能看到班级成员。<br><br><button class="btn primary" data-go-classes>加入班级</button></div>`; box.querySelector("[data-go-classes]").onclick = () => App.go("classes"); return; }
    if (!this.data) box.innerHTML = `<div class="empty">加载中…</div>`;
    try { const r = await api("class_people", { cid: S.cid }, true); this.data = { cid: S.cid, ...r }; }
    catch (e) { box.innerHTML = `<div class="empty">加载失败：${esc(cleanErr(e))}</div>`; return; }
    if (!this.uid) this.drawList();
  },
  drawList() {
    const box = $("#ppBox", this.el); if (!this.data || this.uid) return;
    const all = this.data.people || [], q = this.q, show = q ? all.filter((p) => (p.name + (p.bio || "")).includes(q)) : all;
    const card = (p) => `<div class="card pc" role="button" tabindex="0" data-user="${esc(p.id)}"><span class="pc-cv" style="background:${coverOf(p.cover, p.gender)}"></span>${avHtml(p.name, "lg pc-av")}
      <b>${esc(p.name)}${gIco(p.gender)}</b><span class="tag">${ROLE_CN[p.role] || "同学"}</span><small>${p.bio ? esc(p.bio) : "　"}</small></div>`;
    const groups = [["老师", show.filter((p) => p.role === "teacher")], ["班委", show.filter((p) => p.role === "monitor")], ["同学", show.filter((p) => p.role !== "teacher" && p.role !== "monitor")]];
    box.innerHTML = groups.filter(([, l]) => l.length).map(([n, l]) => `<div class="sec-h"><b>${n}</b><span>${l.length} 人</span></div><div class="pc-grid">${l.map(card).join("")}</div>`).join("")
      + (show.length ? "" : `<div class="empty">没有找到「${esc(q)}」</div>`)
      + (this.data.full ? "" : `<div class="muted" style="margin-top:14px">只显示了老师、班委和你自己。完整名单需要老师给你开「看成员名单」权限。</div>`);
  },
  async open(uid) {
    if (!uid) return;
    this.uid = uid; if (App.view !== "people") App.go("people"); this.update();
    const box = $("#ppBox", this.el);
    box.innerHTML = `<div class="empty">加载中…</div>`;
    try { const d = await api("user_page", { uid, cid: App.S.cid || null }, true); if (this.uid === uid) this.drawUser(d); }
    catch (e) { box.innerHTML = `<div class="empty">打不开这个主页：${esc(cleanErr(e))}</div>`; }
  },
  drawUser(d) {
    const el = this.el, g = d.gender, isT = d.class_role === "teacher";
    const role = d.class_role === "teacher" ? "老师" : d.class_role === "monitor" ? "班委" : d.class_role === "student" ? "同学" : "";
    const days = Math.max(1, Math.round((Date.now() - new Date(d.joined)) / 86400000));
    $("#ppTitle", el).textContent = d.me ? "我的主页" : d.name; $("#ppSub", el).textContent = d.class_name || "";
    const stat = (v, l, ic) => `<div class="stat"><span>${ic} ${l}</span><b>${v == null ? "—" : v}</b></div>`;
    $("#ppBox", el).innerHTML = `
      <div class="card up-hero"><div class="up-cover" style="background:${coverOf(d.cover, g)}">${d.me ? `<button class="btn sm up-cv" data-prof>🎨 装扮主页</button>` : ""}</div>
        <div class="up-head">${avHtml(d.name, "xl")}<div class="up-id"><div class="up-name">${esc(d.name)}${gIco(g)}</div>
          <div class="up-sub">${role ? `<span class="tag" style="--c:var(--brand)">${role}</span>` : ""}${d.class_name ? `<span>🏫 ${esc(d.class_name)}</span>` : ""}${d.account ? `<span>@${esc(d.account)}</span>` : ""}<span>加入 ${days} 天</span></div></div>
          <span class="grow"></span>${d.me ? `<button class="btn" data-prof>✏️ 编辑资料</button>` : ""}${d.can_reset ? `<button class="btn" data-reset="${esc(d.id)}" data-name="${esc(d.name)}">🔑 重置密码</button>` : ""}</div>
        <blockquote class="up-bio${d.bio ? "" : " muted"}">${d.bio ? esc(d.bio) : d.me ? "写一句个性签名，让同学更了解你 ✍️" : "这个人很低调，还没有写签名"}</blockquote></div>
      ${isT ? "" : `<div class="stats up-stats">${stat(d.week_points, "本周成长值", "⚡")}${stat(d.total_points, "累计成长值", "🏆")}${stat(d.show_points ? d.streak : null, "连续活跃天", "🔥")}${stat((d.post_count || 0) + (d.comment_count || 0), "发言和评论", "💬")}</div>`}
      ${!isT && d.show_points ? `<div class="sec-h"><b>成长足迹</b><span>最近 16 周 · 完成 ${d.done || 0} 件事 · 打卡 ${d.habits || 0} 次 · 专注 ${d.pomos || 0} 个番茄</span></div><div class="card up-heat">${heatHtml(d.days)}${heatSide(d.days)}</div>`
        : !isT ? `<div class="card empty">TA 在排行榜里设置了不公开，成长记录只有自己和老师能看到 🔒</div>` : ""}
      <div class="sec-h"><b>${d.me ? "我" : isT ? "老师" : "TA"}的班级墙</b><span>${d.post_count || 0} 条发言</span></div>
      ${(d.posts || []).length ? `<div class="up-posts">${d.posts.map((p) => `<button class="card up-post" data-goto-post="${p.id}">${p.is_notice ? `<span class="tag" style="--c:var(--bad)">📢 通知</span>` : ""}${p.title ? `<b>${esc(p.title)}</b>` : ""}<span>${esc(p.body)}</span><small class="muted">${ago(p.created_at)}${p.comments ? ` · 💬 ${p.comments}` : ""}</small></button>`).join("")}</div>`
        : `<div class="card empty">${d.me ? "你还没在班级墙发过言，去打个招呼吧 👋" : "还没有发过言"}</div>`}`;
  },
};
function heatSide(days) {
  const e = Object.entries(days || {}).filter(([, v]) => v > 0).sort((a, b) => a[0].localeCompare(b[0]));
  if (!e.length) return `<div class="up-hs muted">还没有成长记录。完成事项、打卡、专注都会点亮格子。</div>`;
  const best = e.reduce((a, b) => (b[1] > a[1] ? b : a)), md = (k) => `${+k.slice(5, 7)}月${+k.slice(8)}日`;
  return `<div class="up-hs"><div><b>${e.length}</b><span>活跃的天数</span></div><div><b>${best[1]}</b><span>最多的一天（${md(best[0])}）</span></div><div><b>${md(e[e.length - 1][0])}</b><span>最近一次</span></div></div>`;
}
function heatHtml(days) {
  const t = M.fromKey(todayKey()), end = M.addDays(t, 6 - M.weekday0(t)), cols = 16, start = M.addDays(end, -cols * 7 + 1);
  const max = Math.max(1, ...Object.values(days || {}));
  let cells = "", months = "", lastM = -1;
  for (let c = 0; c < cols; c++) {
    const cs = M.addDays(start, c * 7);
    months += `<span>${cs.getMonth() !== lastM ? cs.getMonth() + 1 + "月" : ""}</span>`; lastM = cs.getMonth();
    for (let r = 0; r < 7; r++) { const d = M.addDays(cs, r), k = M.dayKey(d), v = (days || {})[k] || 0, fut = d > t; const lv = fut ? -1 : v === 0 ? 0 : Math.min(4, Math.ceil(v / max * 4)); cells += `<i class="h${lv}" title="${k}${fut ? "" : " · " + (v ? v + " 成长值" : "没有记录")}"></i>`; }
  }
  return `<div class="heat"><div class="heat-m">${months}</div><div class="heat-g">${cells}</div><div class="heat-l"><span>少</span><i class="h0"></i><i class="h1"></i><i class="h2"></i><i class="h3"></i><i class="h4"></i><span>多</span></div></div>`;
}
