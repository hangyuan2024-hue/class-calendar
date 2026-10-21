// 6.9 位置打卡 · 网页版
//   1. 班级位置签到：班委 / 老师在教室、操场发起签到（以自己现在的位置为中心，半径、时长自己选），
//      同学在范围内才能签上（服务器按坐标算距离，level.sql 的 checkin_*）；班委能看谁签了、谁没签。
//   2. 习惯打卡绑地点：比如「去图书馆」绑在图书馆，到了那里才能打卡（在这台设备上判断）。
// 坐标一律用 GPS 的 WGS-84（浏览器、小程序 type:"wgs84"、安卓都一样），不同设备算出来的距离才对得上。
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let list = [], listFor = "", timer = 0;
  const cls = () => (typeof currentClass !== "undefined" ? currentClass : null);
  const mgr = () => { const c = cls(); return !!(c && (c.is_teacher || c.can_edit || c.can_ingest)); };
  const logged = () => typeof currentUser !== "undefined" && !!currentUser;

  // ---------- 定位 ----------
  function getPos() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("这个浏览器不能定位。请用手机打开，或者用捞捞小程序 / 安卓 App 签到"));
      if (!window.isSecureContext) return reject(new Error("要用 https 打开网站才能定位"));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0) }),
        (e) => reject(new Error(e.code === 1 ? "没有定位权限：请在浏览器 / 微信设置里允许这个网站使用位置，再试一次" : e.code === 3 ? "定位超时了，到窗边或室外再试一次" : "定位失败，请打开手机的定位（GPS）再试")),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    });
  }
  function dist(a, b) {
    const R = 6371000, r = (x) => (x * Math.PI) / 180, dl = r(b.lat - a.lat), dn = r(b.lng - a.lng);
    const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dn / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const left = (iso) => { const m = Math.round((new Date(iso) - Date.now()) / 60000); return m <= 0 ? "马上结束" : m < 60 ? `还剩 ${m} 分钟` : `还剩 ${Math.floor(m / 60)} 小时 ${m % 60} 分`; };
  const hm = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

  // ---------- 班级签到 ----------
  async function load() {
    const c = cls();
    if (!logged() || !c) { list = []; listFor = ""; paint(); return; }
    try { list = (await CCAuth.rpc("checkin_list", { cid: c.id })) || []; listFor = c.id; } catch (e) { list = []; listFor = c.id; }
    paint();
  }
  // 首页顶上：正在进行、我还没签的签到
  function paint() {
    const b = $("ckBanner"), btn = $("cbCheckin"), c = cls();
    if (btn) btn.classList.toggle("hidden", !c || !logged());
    if (!b) return;
    const open = c && listFor === c.id ? list.filter((x) => x.open && (!x.mine || mgr())) : [];
    b.innerHTML = open.map((x) => `<div class="ck-banner surface"><span class="ck-ic">📍</span><span class="ck-t"><b>${esc(x.title)}</b><small>${x.place ? esc(x.place) + " · " : ""}${left(x.ends_at)}${x.can_manage && x.signed != null ? ` · 已签 ${x.signed}/${x.members}` : ""}</small></span>
      ${x.mine ? `<span class="ck-ok">✓ 已签到</span>` : `<button class="btn ink sm" data-cksign="${x.id}">签到</button>`}${x.can_manage ? `<button class="small" data-ckdetail="${x.id}">名单</button>` : ""}</div>`).join("");
  }
  async function sign(id, btn) {
    const x = list.find((y) => String(y.id) === String(id));
    if (btn) { btn.disabled = true; btn.textContent = "定位中…"; }
    try {
      const p = await getPos();
      if (btn) btn.textContent = "签到中…";
      const r = await CCAuth.rpc("checkin_sign", { id: +id, lat: p.lat, lng: p.lng, accuracy: p.acc });
      if (r && r.ok) {
        say(r.already ? "已经签过了" : `✓ 签到成功（离签到点 ${r.dist} 米）`, "ok");
        if (r.points && window.LaoLevel) { LaoLevel.refresh(); }
        await load(); if ($("ckDlg") && $("ckDlg").open) openPanel();
      } else say((r && r.why) || "签到没成功", "bad");
    } catch (e) { say(e.message, "bad"); }
    finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = "签到"; } }
    return x;
  }
  function say(t, kind) {
    let el = $("ckToast");
    if (!el) { el = document.createElement("div"); el.id = "ckToast"; el.className = "lv-toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = t; el.className = "lv-toast on" + (kind === "bad" ? " bad" : "");
    clearTimeout(say.t); say.t = setTimeout(() => el.classList.remove("on"), 4200);
  }
  function dlg() {
    let d = $("ckDlg");
    if (!d) {
      d = document.createElement("dialog"); d.id = "ckDlg"; d.className = "dlg ck-dlg"; document.body.appendChild(d);
      d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    }
    return d;
  }
  // 签到面板：所有人能看最近 7 天的签到；班委 / 老师能发起、看名单、提前结束
  async function openPanel() {
    const c = cls(); if (!c) return;
    if (!logged()) { location.href = "login.html?next=index.html"; return; }
    const d = dlg();
    if (listFor !== c.id) await load();
    d.innerHTML = `<h3>📍 位置签到<small>${esc(c.nickname || c.name)}</small></h3>
      ${mgr() ? `<details class="ck-new" ${list.some((x) => x.open) ? "" : "open"}><summary>＋ 发起一个签到</summary>
        <p class="meta">以你<b>现在所在的位置</b>为中心，同学要在半径范围内才能签上。请站在教室 / 场地里再发起。</p>
        <div class="row"><input id="ckTitle" maxlength="40" placeholder="名称，比如：周三班会签到" value="${esc(new Date().getMonth() + 1 + "月" + new Date().getDate() + "日签到")}"></div>
        <div class="row"><input id="ckPlace" maxlength="60" placeholder="地点，比如：教三 201（选填）"></div>
        <div class="row ck-opts"><label>范围<select id="ckR"><option value="100">100 米（一间教室）</option><option value="200" selected>200 米（一栋楼）</option><option value="500">500 米（操场、院区）</option><option value="1000">1 公里</option></select></label>
          <label>时长<select id="ckM"><option value="5">5 分钟</option><option value="10">10 分钟</option><option value="15" selected>15 分钟</option><option value="30">30 分钟</option><option value="60">1 小时</option><option value="120">2 小时</option></select></label></div>
        <div class="row"><span class="spacer"></span><button class="btn ink sm" id="ckCreate">定位并发起</button></div>
        <div class="ck-st" id="ckSt"></div></details>` : ""}
      <div class="ck-list">${list.length ? list.map((x) => `<div class="ck-row${x.open ? " open" : ""}">
          <span class="ck-t"><b>${esc(x.title)}</b><small>${x.place ? esc(x.place) + " · " : ""}${x.open ? left(x.ends_at) : "已结束 · " + hm(x.starts_at)} · 范围 ${x.radius} 米${x.can_manage && x.signed != null ? ` · 已签 ${x.signed}/${x.members}` : ""}</small></span>
          ${x.mine ? `<span class="ck-ok">✓ 已签</span>` : x.open ? `<button class="btn ink sm" data-cksign="${x.id}">签到</button>` : `<span class="ck-miss">未签</span>`}
          ${x.can_manage ? `<button class="small" data-ckdetail="${x.id}">名单</button>${x.open ? `<button class="small" data-ckclose="${x.id}">结束</button>` : ""}` : ""}</div>`).join("")
        : `<div class="empty">最近 7 天没有签到。${mgr() ? "点上面「发起一个签到」试试。" : "班委发起签到后，这里和首页顶上都会出现「签到」按钮。"}</div>`}</div>
      <div class="ck-detail" id="ckDetail"></div>
      <p class="meta ck-foot">签到用手机的定位（GPS）。网页版在手机浏览器、微信里打开都能签；电脑一般没有 GPS，定位不准，建议用手机。</p>
      <div class="row"><span class="spacer"></span><button class="small" data-ckx="close">关闭</button></div>`;
    if (!d.open) d.showModal();
  }
  async function create() {
    const c = cls(), st = $("ckSt"), b = $("ckCreate");
    b.disabled = true; st.className = "ck-st"; st.textContent = "正在定位…";
    try {
      const p = await getPos();
      if (p.acc > 200) st.textContent = `定位精度只有 ${p.acc} 米，可能不太准…`;
      await CCAuth.rpc("checkin_create", { cid: c.id, title: $("ckTitle").value.trim() || "签到", place: $("ckPlace").value.trim(), lat: p.lat, lng: p.lng, radius: +$("ckR").value, minutes: +$("ckM").value });
      await load(); openPanel(); say("签到已发起，同学们首页顶上会出现「签到」按钮", "ok");
    } catch (e) { st.className = "ck-st bad"; st.textContent = "没发起成功：" + e.message; b.disabled = false; }
  }
  async function detail(id) {
    const box = $("ckDetail"); if (!$("ckDlg").open) await openPanel();
    const el = $("ckDetail"); el.innerHTML = `<div class="meta">加载名单…</div>`;
    try {
      const r = await CCAuth.rpc("checkin_detail", { id: +id });
      el.innerHTML = `<h4>${esc(r.checkin.title)} · 名单</h4>
        <div class="ck-names"><b>已签 ${r.signed.length} 人</b>${r.signed.map((s) => `<span class="ck-name ok" title="${hm(s.at)}">${esc(s.name)}<small>${s.dist} 米</small></span>`).join("") || `<span class="meta">还没有人签</span>`}</div>
        <div class="ck-names"><b>没签 ${r.missing.length} 人</b>${r.missing.map((n) => `<span class="ck-name">${esc(n)}</span>`).join("") || `<span class="meta">全部签到了 🎉</span>`}</div>
        <button class="small" data-ckcopy="${id}">复制没签的名单</button>`;
      el.dataset.missing = r.missing.join("、");
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) { el.innerHTML = `<div class="meta">名单打不开：${esc(e.message)}</div>`; }
    void box;
  }
  document.addEventListener("click", async (e) => {
    const t = e.target;
    const s = t.closest("[data-cksign]"); if (s) { e.preventDefault(); sign(s.dataset.cksign, s); return; }
    const dt = t.closest("[data-ckdetail]"); if (dt) { e.preventDefault(); detail(dt.dataset.ckdetail); return; }
    const cl = t.closest("[data-ckclose]"); if (cl) { if (!confirm("提前结束这个签到？结束后同学就签不了了。")) return; try { await CCAuth.rpc("checkin_close", { id: +cl.dataset.ckclose }); await load(); openPanel(); } catch (err) { say(err.message, "bad"); } return; }
    const cp = t.closest("[data-ckcopy]"); if (cp) { const m = $("ckDetail").dataset.missing || ""; try { await navigator.clipboard.writeText(m); say("已复制：" + (m || "（没有）"), "ok"); } catch (err) { prompt("复制下面的名单", m); } return; }
    if (t.closest("#ckCreate")) { create(); return; }
    if (t.closest("[data-ckx=close]")) { $("ckDlg").close(); return; }
    if (t.closest("#cbCheckin")) { openPanel(); return; }
  });

  // ---------- 习惯绑地点 ----------
  // 习惯里多一个 place：{ name, lat, lng, r }。打卡时在范围内（再放宽定位误差，最多 100 米）才算
  async function bindHabit(h, save) {
    if (h.place && !confirm(`「${h.name}」现在绑在「${h.place.name}」（${h.place.r} 米内）。\n点「确定」改成你现在的位置，点「取消」可以解除绑定。`)) {
      if (confirm(`解除「${h.name}」的地点？解除后在哪都能打卡。`)) { delete h.place; save(); }
      return;
    }
    const name = prompt(`把「${h.name}」绑在你现在所在的地方。\n给这个地点起个名字：`, h.place ? h.place.name : "图书馆");
    if (name == null) return;
    const r = +(prompt("多大范围内能打卡？（米，50~2000）", h.place ? h.place.r : 200) || 200);
    say("正在定位…");
    try {
      const p = await getPos();
      h.place = { name: name.trim().slice(0, 20) || "打卡地点", lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6), r: Math.max(50, Math.min(2000, r || 200)) };
      save(); say(`✓「${h.name}」以后要在「${h.place.name}」${h.place.r} 米内才能打卡`, "ok");
    } catch (e) { say(e.message, "bad"); }
  }
  // 打卡前检查位置：返回 true 可以打卡
  async function checkHabit(h) {
    if (!h.place) return true;
    say(`「${h.name}」要在「${h.place.name}」打卡，正在定位…`);
    try {
      const p = await getPos(), d = dist(p, h.place), slack = Math.min(100, p.acc || 0);
      if (d <= h.place.r + slack) return true;
      say(`你离「${h.place.name}」还有 ${Math.round(d - h.place.r)} 米，到了再打卡吧`, "bad");
      return false;
    } catch (e) { say(e.message, "bad"); return false; }
  }

  window.LaoCheckin = { load, paint, openPanel, sign, getPos, dist, bindHabit, checkHabit };
  // 换班、登录后刷新；有进行中的签到时每 30 秒刷新一次（倒计时、已签人数）
  setInterval(() => {
    const c = cls(); if (!logged() || !c) { if (listFor) { list = []; listFor = ""; paint(); } return; }
    if (listFor !== c.id || (Date.now() - timer > (list.some((x) => x.open) ? 30000 : 120000) && document.visibilityState === "visible")) { timer = Date.now(); load(); }
    else paint();
  }, 5000);
})();
