// 6.9 签到 · 网页版（位置签到、动态码投屏签到、习惯绑地点）
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
  // 三种方式（level.sql）：geo 位置签到 / code 动态码（投屏二维码 + 4 位码，每 20 秒换）/ both 两个都要
  // 二维码里是 https://www.laolaokechengbiao.cn/ck/?i=编号&k=码：微信扫一扫打开小程序直接签；手机相机扫打开这个网站直接签
  const MODE = { geo: "📍 位置签到", code: "🔢 动态码签到", both: "📍 位置 + 🔢 动态码" };
  const SITE = "https://www.laolaokechengbiao.cn/ck/";
  const needCode = (x) => x.mode === "code" || x.mode === "both", needGeo = (x) => x.mode !== "code";
  const amap = (x) => `https://uri.amap.com/marker?position=${x.lng},${x.lat}&name=${encodeURIComponent(x.place || x.title)}&coordinate=wgs84&callnative=1`;
  const hhmm = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  let one = null, codeTimer = 0, lastCode = "", pendingScan = null;

  async function load() {
    const c = cls();
    if (!logged() || !c) { list = []; listFor = ""; paint(); return; }
    try { list = (await CCAuth.rpc("checkin_list", { cid: c.id })) || []; listFor = c.id; } catch (e) { list = []; listFor = c.id; }
    paint();
  }
  // 首页顶上：正在进行的签到（点一下打开）
  function paint() {
    const b = $("ckBanner"), btn = $("cbCheckin"), c = cls();
    if (btn) btn.classList.toggle("hidden", !c || !logged());
    if (!b) return;
    const open = c && listFor === c.id ? list.filter((x) => x.open && (!x.mine || mgr())) : [];
    b.innerHTML = open.map((x) => `<div class="ck-banner surface" data-ckone="${x.id}"><span class="ck-ic">${needCode(x) ? "🔢" : "📍"}</span><span class="ck-t"><b>${esc(x.title)}</b><small>${esc(MODE[x.mode] || MODE.geo)}${x.place ? " · " + esc(x.place) : ""} · ${left(x.ends_at)}${x.can_manage ? ` · 已签 ${x.signed}/${x.members}` : ""}</small></span>
      ${x.mine ? `<span class="ck-ok">✓ 已签到</span>` : `<button class="btn ink sm" data-ckone="${x.id}">${x.can_manage ? "投屏 / 名单" : "签到"}</button>`}</div>`).join("");
  }
  async function sign(x, code, btn) {
    if (btn) { btn.disabled = true; btn.textContent = needGeo(x) ? "定位中…" : "签到中…"; }
    try {
      const a = { id: +x.id };
      if (needCode(x)) { a.code = String(code || "").trim(); if (!/^\d{4}$/.test(a.code)) throw new Error("输入 4 位签到码（投屏上那 4 个数字），或者用手机扫二维码"); }
      if (needGeo(x)) { const p = await getPos(); a.lat = p.lat; a.lng = p.lng; a.accuracy = p.acc; if (btn) btn.textContent = "签到中…"; }
      const r = await CCAuth.rpc("checkin_sign", a);
      if (r && r.ok) {
        say(r.already ? "已经签过了" : `✓ 签到成功${r.dist != null ? `（离签到点 ${r.dist} 米）` : ""}${r.points ? "，经验 +" + r.points : ""}`, "ok");
        if (r.points && window.LaoLevel) LaoLevel.refresh();
        await load(); if (one && one.id === x.id) openOne(x.id);
      } else say((r && r.why) || "签到没成功", "bad");
    } catch (e) { say(e.message, "bad"); }
    finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = "签到"; } }
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
      d.addEventListener("close", () => { one = null; clearInterval(codeTimer); lastCode = ""; });
    }
    return d;
  }
  // 签到列表：所有人能看最近 7 天的签到；班委 / 老师能发起
  async function openPanel() {
    const c = cls(); if (!c) return;
    if (!logged()) { location.href = "login.html?next=index.html"; return; }
    one = null; clearInterval(codeTimer);
    const d = dlg();
    if (listFor !== c.id) await load();
    d.innerHTML = `<h3>📋 签到<small>${esc(c.nickname || c.name)}</small></h3>
      ${mgr() ? `<details class="ck-new" ${list.some((x) => x.open) ? "" : "open"}><summary>＋ 发起签到</summary>
        <div class="ck-modes">${[["code", "🔢 动态码", "投屏二维码，扫一扫就签，不用定位"], ["geo", "📍 位置", "到了现场范围内才能签"], ["both", "📍+🔢 都要", "扫码 + 在现场，最严格"]].map(([k, t, dd], i) =>
          `<label class="ck-mode"><input type="radio" name="ckMode" value="${k}"${i ? "" : " checked"}><b>${t}</b><small>${dd}</small></label>`).join("")}</div>
        <div class="row"><input id="ckTitle" maxlength="40" placeholder="名称，比如：周三高数课签到" value="${esc(new Date().getMonth() + 1 + "月" + new Date().getDate() + "日签到")}"></div>
        <div class="row"><input id="ckPlace" maxlength="60" placeholder="地点，比如：教三 201（动态码签到可以不填）"></div>
        <div class="row ck-opts"><label class="ck-geo-only">范围<select id="ckR"><option value="100">100 米（一间教室）</option><option value="200" selected>200 米（一栋楼）</option><option value="500">500 米（操场、院区）</option><option value="1000">1 公里</option></select></label>
          <label>时长<select id="ckM"><option value="5">5 分钟</option><option value="10" selected>10 分钟</option><option value="15">15 分钟</option><option value="30">30 分钟</option><option value="60">1 小时</option><option value="120">2 小时</option></select></label></div>
        <p class="meta ck-geo-only">位置签到以你<b>现在所在的位置</b>为中心，请站在教室 / 场地里再发起（电脑一般定位不准，位置签到建议用手机发起）。</p>
        <div class="row"><span class="spacer"></span><button class="btn ink sm" id="ckCreate">发起</button></div>
        <div class="ck-st" id="ckSt"></div></details>` : ""}
      <div class="ck-list">${list.length ? list.map((x) => `<div class="ck-row${x.open ? " open" : ""}" data-ckone="${x.id}" tabindex="0">
          <span class="ck-t"><b>${esc(x.title)}</b><small>${esc(MODE[x.mode] || MODE.geo)}${x.place ? " · " + esc(x.place) : ""} · ${x.open ? left(x.ends_at) : "已结束 · " + hm(x.starts_at)} · ${esc(x.by || "")}发起 · 已签 ${x.signed}/${x.members}</small></span>
          ${x.mine ? `<span class="ck-ok">✓ 已签</span>` : x.open ? `<span class="ck-go">${x.can_manage ? "投屏" : "签到"} ›</span>` : `<span class="ck-miss">未签</span>`}</div>`).join("")
        : `<div class="empty">最近 7 天没有签到。${mgr() ? "点上面「发起签到」试试。" : "班委发起签到后，这里和首页顶上都会出现。"}</div>`}</div>
      <div class="row"><input id="ckCodeQuick" inputmode="numeric" maxlength="4" placeholder="有 4 位签到码？输在这里" class="ck-quick"><button class="small" id="ckQuickGo">签到</button><span class="spacer"></span><button class="small" data-ckx="close">关闭</button></div>`;
    const syncMode = () => { const m = (d.querySelector("input[name=ckMode]:checked") || {}).value; d.querySelectorAll(".ck-geo-only").forEach((el) => el.classList.toggle("hidden", m === "code")); };
    d.querySelectorAll("input[name=ckMode]").forEach((r) => r.addEventListener("change", syncMode)); syncMode();
    if (!d.open) d.showModal();
  }
  // 一条签到：信息、地图、签到；班委 / 老师：投屏二维码 + 名单
  async function openOne(id, code) {
    if (!logged()) { pendingScan = { i: id, k: code }; location.href = "login.html?next=" + encodeURIComponent("index.html#ck=" + id + (code ? "&k=" + code : "")); return; }
    const d = dlg();
    let x;
    try { x = await CCAuth.rpc("checkin_get", { id: +id }); } catch (e) { say("签到打不开：" + e.message, "bad"); return; }
    one = x;
    const pct = x.members ? Math.round(x.signed * 100 / x.members) : 0;
    d.innerHTML = `<h3>${needCode(x) ? "🔢" : "📍"} ${esc(x.title)}<small>${x.open ? "进行中" : "已结束"}</small></h3>
      <div class="ck-info">
        <div><span>方式</span><b>${esc(MODE[x.mode] || MODE.geo)}</b></div><div><span>班级</span><b>${esc(x.class_name || "")}</b></div>
        <div><span>发起人</span><b>${esc(x.by || "班委")}</b></div><div><span>时间</span><b>${hhmm(x.starts_at)} – ${hhmm(x.ends_at)}${x.open ? `（${left(x.ends_at)}）` : ""}</b></div>
        ${needGeo(x) ? `<div><span>地点</span><b>${esc(x.place || "签到点")} · ${x.radius} 米内</b></div>` : ""}<div><span>已签到</span><b>${x.signed} / ${x.members} 人</b></div>
      </div>
      <div class="lv-bar"><i style="width:${pct}%"></i></div>
      ${needGeo(x) && x.lat != null ? `<div class="ck-mapline"><span>📍 签到点：${esc(x.place || "签到点")}（半径 ${x.radius} 米）</span><a class="small btn-like" href="${amap(x)}" target="_blank" rel="noopener">在高德地图里看 ›</a></div>` : ""}
      ${x.can_manage && x.open && needCode(x) ? `<div class="ck-proj" id="ckProj"><div class="ck-qrbox" id="ckQr"></div><div class="ck-proj-r"><div class="ck-proj-t" id="ckQrT">微信扫一扫签到</div><div class="ck-code" id="ckCode">····</div>
          <div class="meta" id="ckLeft">每 20 秒换一次码</div><div class="meta">没带手机扫码的同学：打开捞捞「签到」，输入这 4 位码</div>
          <button class="small" id="ckFull">⛶ 全屏投屏</button></div></div>` : ""}
      ${!x.can_manage || x.mine ? `<div class="ck-me">${x.mine ? `<div class="ck-ok big">✓ 你 ${hhmm(x.mine.at)} 签到了${x.mine.dist != null ? `（离签到点 ${x.mine.dist} 米）` : ""}</div>`
        : x.open ? `<div class="row">${needCode(x) ? `<input id="ckCodeIn" class="ck-quick big" inputmode="numeric" maxlength="4" placeholder="4 位签到码" value="${esc(code || "")}">` : ""}<button class="btn ink" id="ckSignOne">${needGeo(x) ? "📍 我到了，签到" : "✓ 签到"}</button></div>
          <p class="meta">${needCode(x) ? "手机上用微信扫投屏的二维码最快。" : ""}${needGeo(x) ? "签到时会定位一次，确认你在范围里（电脑一般定位不准，请用手机）。" : ""}</p>` : `<p class="meta">签到已经结束了。</p>`}</div>` : ""}
      ${x.can_manage ? `<div class="ck-detail" id="ckDetail"><div class="meta">加载名单…</div></div>` : ""}
      <div class="row">${x.can_manage && x.open ? `<button class="small" data-ckclose="${x.id}">结束签到</button>` : ""}<span class="spacer"></span><button class="small" data-ckx="list">‹ 全部签到</button><button class="small" data-ckx="close">关闭</button></div>`;
    if (!d.open) d.showModal();
    clearInterval(codeTimer); lastCode = "";
    if (x.can_manage) {
      detail(x.id);
      if (x.open && needCode(x)) { tickCode(); codeTimer = setInterval(tickCode, 2500); }
    }
    // 扫码进来带着码：直接签
    if (code && x.open && !x.mine && !x.can_manage) sign(x, code, $("ckSignOne"));
  }
  let tn = 0;
  async function tickCode() {
    if (!one || !$("ckQr")) { clearInterval(codeTimer); return; }
    try {
      const r = await CCAuth.rpc("checkin_code", { id: one.id });
      if (!r || !r.code) return;
      // 有小程序码就投小程序码（微信扫一扫直接进小程序签到）；还没生成好 / 后端没配好就先用普通二维码
      const key = (r.img ? "m" : "u") + r.code;
      if (key !== lastCode) {
        lastCode = key; $("ckCode").textContent = r.code;
        $("ckQr").innerHTML = r.img ? `<img src="${r.img}" alt="签到小程序码">` : QRLite.svg(SITE + "?i=" + one.id + "&k=" + r.code, { level: "M" });
        $("ckQrT").textContent = r.img ? "微信扫一扫签到" : "手机扫码签到";
      }
      $("ckLeft").textContent = `${r.left} 秒后换码 · 已签 ${r.signed} / ${one.members}`;
      if (++tn % 6 === 0) detail(one.id);
    } catch (e) {}
  }
  async function create() {
    const c = cls(), st = $("ckSt"), b = $("ckCreate"), mode = ($("ckDlg").querySelector("input[name=ckMode]:checked") || {}).value || "code";
    b.disabled = true; st.className = "ck-st"; st.textContent = mode === "code" ? "正在发起…" : "正在定位…";
    try {
      const a = { cid: c.id, title: $("ckTitle").value.trim() || "签到", place: $("ckPlace").value.trim(), radius: +$("ckR").value, minutes: +$("ckM").value, mode };
      if (mode !== "code") { const p = await getPos(); if (p.acc > 200) st.textContent = `定位精度只有 ${p.acc} 米，可能不太准…`; a.lat = p.lat; a.lng = p.lng; }
      const r = await CCAuth.rpc("checkin_create", a);
      await load(); openOne(r.id); say(mode === "code" ? "签到已发起：把二维码投到屏幕上，同学微信一扫就签上" : "签到已发起，同学们首页顶上会出现「签到」", "ok");
    } catch (e) { st.className = "ck-st bad"; st.textContent = "没发起成功：" + e.message; b.disabled = false; }
  }
  async function detail(id) {
    const el = $("ckDetail"); if (!el) return;
    try {
      const r = await CCAuth.rpc("checkin_detail", { id: +id });
      if (!$("ckDetail")) return;
      el.innerHTML = `<div class="ck-names"><b>已签 ${r.signed.length} 人</b>${r.signed.map((s) => `<span class="ck-name ok" title="${hm(s.at)}">${esc(s.name)}<small>${hhmm(s.at)} ${s.via === "code" ? "码" : s.dist != null ? s.dist + " 米" : ""}</small></span>`).join("") || `<span class="meta">还没有人签</span>`}</div>
        <div class="ck-names"><b>没签 ${r.missing.length} 人</b>${r.missing.map((n) => `<span class="ck-name">${esc(n)}</span>`).join("") || `<span class="meta">全部签到了 🎉</span>`}</div>
        ${r.missing.length ? `<button class="small" data-ckcopy="${id}">复制没签的名单</button>` : ""}`;
      el.dataset.missing = r.missing.join("、");
    } catch (e) { el.innerHTML = `<div class="meta">名单打不开：${esc(e.message)}</div>`; }
  }
  document.addEventListener("click", async (e) => {
    const t = e.target;
    const o = t.closest("[data-ckone]"); if (o) { e.preventDefault(); openOne(+o.dataset.ckone); return; }
    const cl = t.closest("[data-ckclose]"); if (cl) { if (!confirm("提前结束这个签到？结束后同学就签不了了。")) return; try { await CCAuth.rpc("checkin_close", { id: +cl.dataset.ckclose }); await load(); openOne(+cl.dataset.ckclose); } catch (err) { say(err.message, "bad"); } return; }
    const cp = t.closest("[data-ckcopy]"); if (cp) { const m = $("ckDetail").dataset.missing || ""; try { await navigator.clipboard.writeText(m); say("已复制：" + (m || "（没有）"), "ok"); } catch (err) { prompt("复制下面的名单", m); } return; }
    if (t.closest("#ckCreate")) { create(); return; }
    if (t.closest("#ckSignOne")) { sign(one, ($("ckCodeIn") || {}).value, t.closest("#ckSignOne")); return; }
    if (t.closest("#ckFull")) { const p = $("ckProj"); if (document.fullscreenElement) document.exitFullscreen(); else if (p && p.requestFullscreen) p.requestFullscreen().catch(() => p.classList.toggle("max")); else if (p) p.classList.toggle("max"); return; }
    if (t.closest("#ckQuickGo")) {   // 列表下面直接输码：在进行中的「动态码」签到里找
      const v = ($("ckCodeQuick").value || "").trim(), cand = list.filter((x) => x.open && !x.mine && needCode(x));
      if (!cand.length) { say("现在没有要输签到码的签到", "bad"); return; }
      if (cand.length > 1) { openOne(cand[0].id, v); return; }
      await openOne(cand[0].id); sign(cand[0], v, $("ckSignOne")); return;
    }
    if (t.closest("[data-ckx=list]")) { openPanel(); return; }
    if (t.closest("[data-ckx=close]")) { $("ckDlg").close(); return; }
    if (t.closest("#cbCheckin")) { openPanel(); return; }
  });
  // 扫码进来：https://www.laolaokechengbiao.cn/ck/?i=编号&k=码 会跳到 index.html#ck=编号&k=码
  function fromHash() {
    const m = /[#&]ck=(\d+)(?:&k=(\d{4}))?/.exec(location.hash || "");
    if (!m) return null;
    history.replaceState(null, "", location.pathname + location.search);
    return { i: +m[1], k: m[2] || "" };
  }
  const scanned = fromHash();
  if (scanned) {
    const go = () => { if (logged()) openOne(scanned.i, scanned.k); else if (Date.now() - t0 < 15000) setTimeout(go, 400); else openOne(scanned.i, scanned.k); };
    const t0 = Date.now(); setTimeout(go, 600);
  }
  void pendingScan;

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

  window.LaoCheckin = { load, paint, openPanel, openOne, sign, getPos, dist, bindHabit, checkHabit };
  // 换班、登录后刷新；有进行中的签到时每 30 秒刷新一次（倒计时、已签人数）
  setInterval(() => {
    const c = cls(); if (!logged() || !c) { if (listFor) { list = []; listFor = ""; paint(); } return; }
    if (listFor !== c.id || (Date.now() - timer > (list.some((x) => x.open) ? 30000 : 120000) && document.visibilityState === "visible")) { timer = Date.now(); load(); }
    else paint();
  }, 5000);
})();
