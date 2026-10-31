// 6.9 签到 · 网页版（位置签到、动态码投屏签到、习惯绑地点）
//   1. 班级位置签到：班委 / 老师在教室、操场发起签到（以自己现在的位置为中心，半径、时长自己选），
//      同学在范围内才能签上（服务器按坐标算距离，level.sql 的 checkin_*）；班委能看谁签了、谁没签。
//   2. 习惯打卡绑地点：比如「去图书馆」绑在图书馆，到了那里才能打卡（在这台设备上判断）。
// 坐标一律用 GPS 的 WGS-84（浏览器、小程序 type:"wgs84"、安卓都一样），不同设备算出来的距离才对得上。
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let list = [], listFor = "", timer = 0, panelCls = null;
  const cur = () => (typeof currentClass !== "undefined" ? currentClass : null);
  // 签到面板看的是哪个班：默认当前班；「班级情况」里点某个班的签到时换成那个班
  const cls = () => panelCls || cur();
  const byId = (id) => (typeof myClasses !== "undefined" ? (myClasses || []).find((c) => c.id === id) : null);
  const canMgr = (c) => !!(c && (c.is_teacher || (c.member_role === "monitor" && (c.can_edit || c.can_ingest))));
  const mgr = () => canMgr(cls());
  // 能不能签：班里的同学（班委也要签）；老师不用签。老的服务器没有 can_sign 时按以前的规则
  // 1.24.7（7.29 SQL）：签到码、投屏小程序码只给发起人和他指定的人；服务器没给 can_ctl 时只认发起人
  const ctl = (x) => (x.can_ctl != null ? !!x.can_ctl : !!x.is_creator);
  const signable = (x) => (x.can_sign != null ? x.can_sign && !x.is_teacher : !x.can_manage);
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
  const MODE = { geo: "📍 位置签到", code: "🔢 动态码签到", both: "📍 位置 + 🔢 动态码", photo: "📷 拍照签到" };   // 7.3 photo：拍一张现场照片就签
  const modeName = (x) => (MODE[x.mode] || MODE.geo) + (x.need_photo && x.mode !== "photo" ? " + 📷 拍照" : "");
  const SITE = "https://www.laolaokechengbiao.cn/ck/";
  const needCode = (x) => x.mode === "code" || x.mode === "both", needGes = (x) => !!x.gesture, needGeo = (x) => x.mode === "geo" || x.mode === "both" || !x.mode;
  const amap = (x) => `https://uri.amap.com/marker?position=${x.lng},${x.lat}&name=${encodeURIComponent(x.place || x.title)}&coordinate=wgs84&callnative=1`;
  const hhmm = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  let one = null, codeTimer = 0, lastCode = "", pendingScan = null;
  // 7.4 照片墙：拉过的缩略图记在这里（只拉新签的）；pending = 拍了但没传上去的照片（再点直接重传，不用重拍）
  let wall = null, wallTab = "wall", pending = null;

  async function load() {
    const c = cur();
    if (!logged() || !c) { list = []; listFor = ""; paint(); return; }
    try { list = (await CCAuth.rpc("checkin_list", { cid: c.id })) || []; listFor = c.id; } catch (e) { list = []; listFor = c.id; }
    paint();
  }
  // 首页顶上：正在进行的签到（点一下打开）
  function paint() {
    const b = $("ckBanner"), btn = $("cbCheckin"), c = cur();
    if (btn) btn.classList.toggle("hidden", !c || !logged());
    if (!b) return;
    const open = c && listFor === c.id ? list.filter((x) => x.open && (!x.mine || mgr())) : [];
    b.innerHTML = open.map((x) => `<div class="ck-banner surface" data-ckone="${x.id}"><span class="ck-ic">${needCode(x) ? "🔢" : "📍"}</span><span class="ck-t"><b>${esc(x.title)}</b><small>${esc(modeName(x))}${x.place ? " · " + esc(x.place) : ""} · ${left(x.ends_at)}${x.can_manage ? ` · 已签 ${x.signed}/${x.members}` : ""}</small></span>
      ${x.mine ? `<span class="ck-ok">✓ 已签到</span>` : `<button class="btn ink sm" data-ckone="${x.id}">${signable(x) ? "签到" : "投屏 / 名单"}</button>`}</div>`).join("");
  }
  async function sign(x, code, btn) {
    if (btn) { btn.disabled = true; btn.textContent = needGeo(x) ? "定位中…" : "签到中…"; }
    try {
      const a = { id: +x.id };
      if (needGes(x)) { a.code = String(code || "").trim(); if (a.code.length < 4) throw new Error("输入 4 位签到码，或者在九宫格里画出投屏上的手势"); }   // 7.43 手势签到：码和手势都能签
      else if (needCode(x)) { a.code = String(code || "").trim(); if (!/^\d{4}$/.test(a.code)) throw new Error("输入 4 位签到码（投屏上那 4 个数字），或者用手机扫二维码"); }
      if (x.need_photo) {
        if (!(pending && pending.id === x.id)) { if (btn) btn.textContent = "拍照中…"; pending = { id: x.id, p: await takePhoto() }; }
        a.photo = pending.p.photo; if (pending.p.thumb) a.thumb = pending.p.thumb;
        if (btn) btn.textContent = needGeo(x) ? "定位中…" : "上传照片…";
      }
      if (needGeo(x)) { const p = await getPos(); a.lat = p.lat; a.lng = p.lng; a.accuracy = p.acc; if (btn) btn.textContent = "签到中…"; }
      let r;
      try { r = await CCAuth.rpc("checkin_sign", a); }
      catch (e) {
        if (a.thumb && /thumb|Could not find|PGRST202|schema cache/i.test(e.message)) { delete a.thumb; r = await CCAuth.rpc("checkin_sign", a); }   // 数据库还没执行 7.4
        else throw e;
      }
      if (r && (r.ok || r.already)) pending = null;
      if (r && r.ok) {
        say(r.already ? "已经签过了" : `✓ 签到成功${r.dist != null ? `（离签到点 ${r.dist} 米）` : ""}${r.points ? "，经验 +" + r.points : ""}`, "ok");
        if (r.points && window.LaoLevel) LaoLevel.refresh();
        await load(); if (one && one.id === x.id) openOne(x.id);
      } else say(r && r.need === "photo" && !x.need_photo ? "这次签到要拍照：请刷新一下再签" : (r && r.why) || "签到没成功", "bad");
    } catch (e) { say(e.message + (pending && pending.id === x.id ? "。照片已经拍好了，再点一次会直接重新上传" : ""), "bad"); }
    finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = x.need_photo ? (pending && pending.id === x.id ? "⟳ 重新上传照片签到" : "📷 拍照签到") : "签到"; } }
  }
  // 7.3 拍照签到：打开相机（手机）/ 选一张照片（电脑），压成 JPEG
  // 7.4 原图不超过 20 万字（全班同时上传也不卡）+ 一张长边 300 的缩略图（照片墙用）；返回 { photo, thumb }
  function takePhoto() {
    return new Promise((ok, no) => {
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.setAttribute("capture", "environment");
      inp.style.cssText = "position:fixed;left:-9999px"; document.body.appendChild(inp);
      let done = false;
      inp.onchange = async () => {
        done = true; const f = inp.files && inp.files[0]; inp.remove();
        if (!f) { no(new Error("没拍照，签到取消了")); return; }
        try {
          const bmp = await createImageBitmap(f);
          const jpg = (side, q) => {
            const s = Math.min(1, side / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
            c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
            const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
            return c.toDataURL("image/jpeg", q);
          };
          let photo = "";
          for (const [side, q] of [[1080, 0.62], [900, 0.55], [720, 0.5], [560, 0.45]]) { const u = jpg(side, q); if (u.length < 200000) { photo = u; break; } }
          if (!photo) { no(new Error("照片太大了，换一张试试")); return; }
          let thumb = jpg(300, 0.55); if (thumb.length > 58000) thumb = jpg(220, 0.4); if (thumb.length > 58000) thumb = "";
          ok({ photo, thumb });
        } catch (e) { no(new Error("这张照片读不了，换一张试试")); }
      };
      window.addEventListener("focus", () => setTimeout(() => { if (!done && !inp.files.length) { inp.remove(); no(new Error("没拍照，签到取消了")); } }, 1200), { once: true });
      inp.click();
    });
  }
  // 发起人、班委看签到照片
  async function showPhotos(id, uid, name) {
    let v = $("ckPhotoDlg");
    if (!v) { v = document.createElement("dialog"); v.id = "ckPhotoDlg"; v.className = "dlg ck-dlg"; document.body.appendChild(v); v.addEventListener("click", (e) => { if (e.target === v || e.target.closest("[data-phx]")) v.close(); }); }
    v.innerHTML = `<h3>📷 ${esc(name || "签到照片")}</h3><div class="meta">加载中…</div>`;
    if (!v.open) v.showModal();
    try {
      const l = (await CCAuth.rpc("checkin_photos", { id: +id, uid: uid || null })) || [];
      v.innerHTML = `<h3>📷 ${esc(name || "签到照片")}<small>${l.length} 张 · 照片 24 小时后自动删除</small></h3>
        <div class="ck-photos">${l.map((p) => `<figure><img src="${p.img}" alt="${esc(p.name)}" loading="lazy"><figcaption>${esc(p.name)} · ${hhmm(p.at)}</figcaption></figure>`).join("") || `<div class="meta">还没有照片</div>`}</div>
        <div class="row"><span class="spacer"></span><button class="small" data-phx>关闭</button></div>`;
    } catch (e) { v.innerHTML = `<h3>📷 签到照片</h3><div class="meta">${esc(e.message)}</div><div class="row"><span class="spacer"></span><button class="small" data-phx>关闭</button></div>`; }
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
  async function openPanel(cid) {
    if (!logged()) { location.href = "login.html?next=index.html"; return; }
    if (cid !== undefined) panelCls = cid && (!cur() || cid !== cur().id) ? (byId(cid) || { id: cid, name: "", is_teacher: false }) : null;
    const c = cls();
    if (!c) { say("先加入一个班级，才能签到", "bad"); return; }
    one = null; clearInterval(codeTimer);
    const d = dlg();
    if (panelCls) { try { list = (await CCAuth.rpc("checkin_list", { cid: c.id })) || []; } catch (e) { list = []; } listFor = c.id; }
    else if (listFor !== c.id) await load();
    const others = (typeof myClasses !== "undefined" ? myClasses || [] : []).filter((x) => x.status === "approved" || x.is_teacher);
    d.innerHTML = `<h3>📋 签到<small>${others.length > 1 ? `<select id="ckCls" aria-label="哪个班">${others.map((x) => `<option value="${esc(x.id)}"${x.id === c.id ? " selected" : ""}>${esc(x.nickname || x.name)}${x.is_teacher ? "（我带的）" : x.member_role === "monitor" ? "（班委）" : ""}</option>`).join("")}</select>` : esc(c.nickname || c.name)}</small></h3>
      ${mgr() ? `<details class="ck-new" ${list.some((x) => x.open) ? "" : "open"}><summary>＋ 发起签到</summary>
        <div class="ck-modes">${[["code", "🔢 动态码", "投屏二维码，扫一扫就签，不用定位"], ["geo", "📍 位置", "到了现场范围内才能签"], ["both", "📍+🔢 都要", "扫码 + 在现场，最严格"], ["photo", "📷 拍照", "拍一张现场照片就签，你能看到每张照片"], ["gesture", "🔢+✍️ 码或手势", "动态码照样能签，也可以照投屏的手势画"]].map(([k, t, dd], i) =>
          `<label class="ck-mode"><input type="radio" name="ckMode" value="${k}"${i ? "" : " checked"}><b>${t}</b><small>${dd}</small></label>`).join("")}</div>
        <label class="ck-photo-opt"><input type="checkbox" id="ckPhoto"> 📷 同时要拍一张现场照片（签到时拍照，你能看到每个人的照片）</label>
        <div class="row"><input id="ckTitle" maxlength="40" placeholder="名称，比如：周三高数课签到" value="${esc(new Date().getMonth() + 1 + "月" + new Date().getDate() + "日签到")}"></div>
        <div class="row"><input id="ckPlace" maxlength="60" placeholder="地点，比如：教三 201（动态码签到可以不填）"></div>
        <div class="row ck-opts"><label class="ck-geo-only">范围<select id="ckR"><option value="100">100 米（一间教室）</option><option value="200" selected>200 米（一栋楼）</option><option value="500">500 米（操场、院区）</option><option value="1000">1 公里</option></select></label>
          <label>时长<select id="ckM"><option value="5">5 分钟</option><option value="10" selected>10 分钟</option><option value="15">15 分钟</option><option value="30">30 分钟</option><option value="60">1 小时</option><option value="120">2 小时</option></select></label></div>
        <p class="meta ck-geo-only">位置签到以你<b>现在所在的位置</b>为中心，请站在教室 / 场地里再发起（电脑一般定位不准，位置签到建议用手机发起）。</p>
        <div class="row"><span class="spacer"></span><button class="btn ink sm" id="ckCreate">发起</button></div>
        <div class="ck-st" id="ckSt"></div></details>` : ""}
      <div class="ck-list">${list.length ? list.map((x) => `<div class="ck-row${x.open ? " open" : ""}" data-ckone="${x.id}" tabindex="0">
          <span class="ck-t"><b>${esc(x.title)}</b><small>${esc(modeName(x))}${x.place ? " · " + esc(x.place) : ""} · ${x.open ? left(x.ends_at) : "已结束 · " + hm(x.starts_at)} · ${esc(x.by || "")}发起 · 已签 ${x.signed}/${x.members}</small></span>
          ${x.mine ? `<span class="ck-ok">✓ 已签</span>` : x.open ? `<span class="ck-go">${ctl(x) ? "投屏" : "签到"} ›</span>` : `<span class="ck-miss">未签</span>`}</div>`).join("")
        : `<div class="empty">最近 7 天没有签到。${mgr() ? "点上面「发起签到」试试。" : "班委发起签到后，这里和首页顶上都会出现。"}</div>`}</div>
      <div class="row"><input id="ckCodeQuick" inputmode="numeric" maxlength="4" placeholder="有 4 位签到码？输在这里" class="ck-quick"><button class="small" id="ckQuickGo">签到</button><span class="spacer"></span><button class="small" data-ckx="close">关闭</button></div>`;
    const syncMode = () => { const m = (d.querySelector("input[name=ckMode]:checked") || {}).value; d.querySelectorAll(".ck-geo-only").forEach((el) => el.classList.toggle("hidden", m === "code" || m === "photo")); const po = d.querySelector(".ck-photo-opt"); if (po) po.classList.toggle("hidden", m === "photo"); };
    d.querySelectorAll("input[name=ckMode]").forEach((r) => r.addEventListener("change", syncMode)); syncMode();
    const sel = d.querySelector("#ckCls"); if (sel) sel.onchange = () => openPanel(sel.value);
    if (!d.open) d.showModal();
  }
  // 一条签到：信息、地图、签到；班委 / 老师：投屏二维码 + 名单
  // 7.41 手势签到：九宫格（数字 1~9），按住拖动连线；只认点的中间，斜着划过去不会误碰
  let gesCode = "", showGes = true;
  try { const st = document.createElement("style"); st.textContent = `.ck-gp{display:grid;grid-template-columns:repeat(3,1fr);width:240px;height:240px;margin:10px auto;border-radius:16px;background:rgba(127,127,127,.08);touch-action:none;user-select:none}
.ck-gp i{display:flex;align-items:center;justify-content:center;font-style:normal;font-weight:800;color:#fff;position:relative}
.ck-gp i::before{content:"";position:absolute;width:22px;height:22px;border-radius:50%;border:2px solid rgba(127,127,127,.45);z-index:-1}
.ck-gp i.on::before{width:44px;height:44px;background:var(--accent,#3a7afe);border-color:var(--accent,#3a7afe)}
.ck-gp i{z-index:1}.ck-gp.show{width:210px;height:210px;flex-shrink:0}:fullscreen .ck-gp.show{width:60vh;height:60vh;font-size:5vh}`; document.head.appendChild(st); } catch (e) {}
  const gcells = (p) => { const a = []; for (let i = 1; i <= 9; i++) { const k = String(p || "").indexOf(String(i)); a.push(k >= 0 ? k + 1 : 0); } return a; };
  const randGes = () => { const d = [1, 2, 3, 4, 5, 6, 7, 8, 9]; for (let i = 8; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d.slice(0, 5).join(""); };
  function gesPad(el, done) {
    if (!el) return;
    let seq = "", down = false;
    const cells = [...el.children];
    const hit = (e) => { const r = el.getBoundingClientRect(), w = r.width / 3, x = e.clientX - r.left, y = e.clientY - r.top, c = Math.floor(x / w), rw = Math.floor(y / w);
      if (c < 0 || c > 2 || rw < 0 || rw > 2) return 0; const dx = x - (c + .5) * w, dy = y - (rw + .5) * w; return dx * dx + dy * dy < (w * .36) ** 2 ? rw * 3 + c + 1 : 0; };
    const add = (n) => { if (!n || seq.includes(String(n))) return; seq += n; cells[n - 1].className = "on"; cells[n - 1].textContent = seq.length; };
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); down = true; seq = ""; cells.forEach((c) => { c.className = ""; c.textContent = ""; }); el.setPointerCapture && el.setPointerCapture(e.pointerId); add(hit(e)); });
    el.addEventListener("pointermove", (e) => { if (down) add(hit(e)); });
    const up = () => { if (!down) return; down = false; if (seq.length >= 4) done(seq); else if (seq) say("至少连 4 个点", "bad"); };
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  }
  async function openOne(id, code, scan) {
    if (!logged()) { pendingScan = { i: id, k: code }; location.href = "login.html?next=" + encodeURIComponent("index.html#ck=" + id + (code ? "&k=" + code : "")); return; }
    const d = dlg();
    let x;
    try { x = await CCAuth.rpc("checkin_get", { id: +id }); } catch (e) { say("签到打不开：" + e.message, "bad"); return; }
    if (!one || one.id !== x.id) showGes = true;   // 换了一场签到：默认展示手势
    one = x;
    if (!wall || wall.id !== x.id) { wall = { id: x.id, since: null, src: {}, at: {}, full: {} }; wallTab = "wall"; }
    const pct = x.members ? Math.round(x.signed * 100 / x.members) : 0;
    d.innerHTML = `<h3>${x.mode === "photo" ? "📷" : needCode(x) ? "🔢" : "📍"} ${esc(x.title)}<small>${x.open ? "进行中" : "已结束"}</small></h3>
      <div class="ck-info">
        <div><span>方式</span><b>${esc(modeName(x))}</b></div><div><span>班级</span><b>${esc(x.class_name || "")}</b></div>
        <div><span>发起人</span><b>${esc(x.by || "班委")}</b></div><div><span>时间</span><b>${hhmm(x.starts_at)} – ${hhmm(x.ends_at)}${x.open ? `（${left(x.ends_at)}）` : ""}</b></div>
        ${needGeo(x) ? `<div><span>地点</span><b>${esc(x.place || "签到点")} · ${x.radius} 米内</b></div>` : ""}<div><span>已签到</span><b>${x.signed} / ${x.members} 人</b></div>
      </div>
      <div class="lv-bar"><i style="width:${pct}%"></i></div>
      ${needGeo(x) && x.lat != null ? `<div class="ck-mapline"><span>📍 签到点：${esc(x.place || "签到点")}（半径 ${x.radius} 米）</span><a class="small btn-like" href="${amap(x)}" target="_blank" rel="noopener">在高德地图里看 ›</a></div>` : ""}
      ${x.is_teacher === false && ctl(x) && x.is_creator === false && !x.mine && x.open ? `<p class="meta">你也是这个班的同学：先在下面签到，再帮班里投屏 / 看名单。</p>` : ""}
      ${ctl(x) && x.open && needGes(x) && showGes ? `<div class="ck-proj" id="ckProj"><div class="ck-gp show">${gcells(x.gesture_pat).map((n) => `<i class="${n ? "on" : ""}">${n || ""}</i>`).join("")}</div><div class="ck-proj-r"><div class="ck-proj-t">照着画这个手势签到</div>
          <div class="meta">从 1 连到 ${String(x.gesture_pat || "").length}，同学在捞捞「签到」里画一遍就签上了。</div><div class="meta">已签 ${x.signed} / ${x.members}</div><button class="small" id="ckRegest">换一个手势</button> <button class="small" id="ckShowCode">展示签到码</button> <button class="small" id="ckFull">⛶ 全屏投屏</button></div></div>`
      : ctl(x) && x.open ? `<div class="ck-proj" id="ckProj"><div class="ck-qrbox" id="ckQr"></div><div class="ck-proj-r"><div class="ck-proj-t" id="ckQrT">${needCode(x) ? "微信扫一扫签到" : "微信扫一扫，打开签到页"}</div>${needCode(x) ? `<div class="ck-code" id="ckCode">····</div>
          <div class="meta" id="ckLeft">每 20 秒换一次码</div><div class="meta">没带手机扫码的同学：打开捞捞「签到」，输入这 4 位码</div>` : `<div class="meta" id="ckLeft">已签 ${x.signed} / ${x.members}</div><div class="meta">${needGeo(x) ? `同学扫码后会自动定位，在 ${x.radius} 米内就签上了。` : "同学扫码打开签到页，拍一张现场照片就签上了。"}这张码整场不变，可以截图发到班级群。</div>`}
          ${needGes(x) ? `<button class="small" id="ckShowGes">展示手势</button> ` : ""}<button class="small" id="ckFull">⛶ 全屏投屏</button></div></div>` : ""}
      ${signable(x) || x.mine ? `<div class="ck-me">${x.mine ? `<div class="ck-ok big">✓ 你 ${hhmm(x.mine.at)} 签到了${x.mine.dist != null ? `（离签到点 ${x.mine.dist} 米）` : ""}${x.mine.photo ? " · 📷 照片已交" : ""}</div>`
        : x.open ? `${needGes(x) ? `<p class="meta">输签到码，或者照投屏上的手势在下面九宫格里一笔连起来（按住拖动）${x.need_photo || needGeo(x) ? "，再点按钮" : "，松开就签到"}</p><div class="ck-gp" id="ckGp">${"<i></i>".repeat(9)}</div>` : ""}<div class="row">${needCode(x) ? `<input id="ckCodeIn" class="ck-quick big" inputmode="numeric" maxlength="4" placeholder="4 位签到码" value="${esc(code || "")}">` : ""}<button class="btn ink" id="ckSignOne">${x.need_photo ? (pending && pending.id === x.id ? "⟳ 重新上传照片签到" : "📷 拍照签到") : needGeo(x) ? "📍 我到了，签到" : "✓ 签到"}</button></div>
          <p class="meta">${needCode(x) ? "手机上用微信扫投屏的二维码最快。" : ""}${needGeo(x) ? "签到时会定位一次，确认你在范围里（电脑一般定位不准，请用手机）。" : ""}${x.need_photo ? "要拍一张现场照片（手机会打开相机），发起签到的同学和老师能看到，24 小时后自动删除。" : ""}</p>` : `<p class="meta">签到已经结束了。</p>`}</div>` : ""}
      ${x.can_manage ? `<div class="ck-detail" id="ckDetail"><div class="meta">加载名单…</div></div>` : ""}
      <div class="row">${x.can_manage && x.open ? `<button class="small" data-ckclose="${x.id}">结束签到</button>` : ""}<span class="spacer"></span><button class="small" data-ckx="list">‹ 全部签到</button><button class="small" data-ckx="close">关闭</button></div>`;
    if (!d.open) d.showModal();
    clearInterval(codeTimer); lastCode = "";
    if (needGes(x)) {   // 7.41 手势签到（7.43 码和手势都能签；投屏时发起人选展示哪个）
      gesCode = "";
      gesPad($("ckGp"), (pat) => { gesCode = pat; if (!x.need_photo && !needGeo(x)) sign(x, pat, $("ckSignOne")); });
      if ($("ckRegest")) $("ckRegest").onclick = async () => { try { await CCAuth.rpc("checkin_set_gesture", { p_id: x.id, p_pat: randGes() }); openOne(x.id); } catch (e) { say(e.message, "bad"); } };
      if ($("ckShowCode")) $("ckShowCode").onclick = () => { showGes = false; openOne(x.id); };
      if ($("ckShowGes")) $("ckShowGes").onclick = () => { showGes = true; openOne(x.id); };
      if (showGes && ctl(x)) { if (x.can_manage) detail(x.id); return; }
    }
    if (x.can_manage) detail(x.id);
    if (ctl(x)) {
      // 动态码每 20 秒换；6.9.6 位置签到整场一张码，只刷新人数
      // 7.4.1 位置 / 拍照签到的码只带编号：先画普通二维码，不等服务器；小程序码没做好时每秒问一次，做好了 2.5 / 5 秒问一次
      // 1.24.7 只投小程序码：还没生成好先显示「正在生成」，生成失败或 8 秒还没有才用普通二维码
      if (x.open && $("ckQr")) { $("ckQr").innerHTML = WAIT; lastCode = "w"; qrT0 = Date.now(); }
      if (x.open) { qrAt = 0; qrImg = false; detAt = 0; tn = 0; tickCode(); codeTimer = setInterval(() => { if (Date.now() - qrAt >= (qrImg ? (needCode(x) ? 2500 : 5000) : 1000)) tickCode(); }, 500); }
    }
    // 扫码进来：带着码的直接签；位置签到的码只带编号，直接定位签到
    if (x.open && !x.mine && signable(x) && !x.need_photo && (code || (scan && !needCode(x)))) sign(x, code, $("ckSignOne"));   // 要拍照的得自己点一下（浏览器只让点按钮时开相机）
  }
  let tn = 0, qrAt = 0, qrImg = false, detAt = 0, qrT0 = 0;
  const WAIT = `<div class="ck-qrwait">正在生成小程序码…</div>`;
  async function tickCode() {
    if (!one || !$("ckQr")) { clearInterval(codeTimer); return; }
    qrAt = Date.now();
    if (Date.now() - detAt > 15000) { detAt = Date.now(); if (tn++) detail(one.id); }   // 名单 15 秒刷新一次（第一次打开时已经拉过）
    try {
      const r = await CCAuth.rpc("checkin_code", { id: one.id });
      if (r && r.geo) {   // 6.9.6 位置签到：码只带编号
        const fb = !r.img && (r.img_err || Date.now() - qrT0 > 8000), key = r.img ? "mg" : fb ? "ug" : "w";
        qrImg = !!r.img;
        if (key !== lastCode) { lastCode = key; $("ckQr").innerHTML = r.img ? `<img src="${r.img}" alt="签到小程序码">` : fb ? QRLite.svg(SITE + "?i=" + one.id, { level: "M" }) : WAIT; $("ckQrT").textContent = r.img || !fb ? "微信扫一扫，打开签到页" : "手机扫码打开签到页"; }
        $("ckLeft").textContent = `已签 ${r.signed} / ${one.members}`;
        return;
      }
      if (!r || !r.code) return;
      qrImg = !!r.img;
      // 有小程序码就投小程序码（微信扫一扫直接进小程序签到）；还没生成好 / 后端没配好就先用普通二维码
      const fb = !r.img && (r.img_err || Date.now() - qrT0 > 8000), key = (r.img ? "m" : fb ? "u" : "w") + r.code;
      $("ckCode").textContent = r.code;
      if (key !== lastCode) {
        lastCode = key;
        $("ckQr").innerHTML = r.img ? `<img src="${r.img}" alt="签到小程序码">` : fb ? QRLite.svg(SITE + "?i=" + one.id + "&k=" + r.code, { level: "M" }) : WAIT;
        $("ckQrT").textContent = r.img || !fb ? "微信扫一扫签到" : "手机扫码签到";
      }
      $("ckLeft").textContent = `${r.left} 秒后换码 · 已签 ${r.signed} / ${one.members}`;
    } catch (e) {}
  }
  async function create() {
    const c = cls(); if (!canMgr(c)) { say("只有老师和班委能发起签到", "bad"); return; }
    const st = $("ckSt"), b = $("ckCreate"), pick = ($("ckDlg").querySelector("input[name=ckMode]:checked") || {}).value || "code", ges = pick === "gesture", mode = ges ? "code" : pick;
    const geo = mode === "geo" || mode === "both", photo = mode !== "photo" && $("ckPhoto") && $("ckPhoto").checked;
    b.disabled = true; st.className = "ck-st"; st.textContent = geo ? "正在定位…" : "正在发起…";
    try {
      const a = { cid: c.id, title: $("ckTitle").value.trim() || "签到", place: $("ckPlace").value.trim(), radius: +$("ckR").value, minutes: +$("ckM").value, mode };
      if (photo) a.photo = true;   // 7.3 老的数据库没有这个参数：只在勾了的时候带上
      if (geo) { const p = await getPos(); if (p.acc > 200) st.textContent = `定位精度只有 ${p.acc} 米，可能不太准…`; a.lat = p.lat; a.lng = p.lng; }
      const r = await CCAuth.rpc("checkin_create", a);
      if (ges) { try { await CCAuth.rpc("checkin_set_gesture", { p_id: r.id, p_pat: randGes() }); } catch (e2) { say("手势签到要先在数据库执行 7.41 的 SQL，这次先按动态码发起了", "bad"); } }   // 7.41
      if (panelCls) list = (await CCAuth.rpc("checkin_list", { cid: c.id })) || []; else await load();
      openOne(r.id); say(mode === "code" ? "签到已发起：把二维码投到屏幕上，同学微信一扫就签上" : "签到已发起，同学们首页顶上会出现「签到」", "ok");
    } catch (e) { st.className = "ck-st bad"; st.textContent = "没发起成功：" + (/photo|mode|check constraint|签到方式不对/i.test(e.message) && (mode === "photo" || photo) ? "拍照签到要先在数据库执行 7.3 的 SQL" : e.message); b.disabled = false; }
  }
  async function detail(id) {
    const el = $("ckDetail"); if (!el) return;
    try {
      const r = await CCAuth.rpc("checkin_detail", { id: +id });
      if (!$("ckDetail")) return;
      // 6.9.6 补签：点没签的名字补签，点已签名字后面的 × 撤销（老服务器没有 missing_u，只能看）
      const mk = Array.isArray(r.missing_u), miss = mk ? r.missing_u : r.missing.map((n) => ({ name: n }));
      const ph = r.signed.filter((s) => s.photo).length;
      el.dataset.missing = miss.map((m) => m.name).join("、");
      if (one && one.need_photo && one.id === +id) { await paintWall(el, r, miss, mk); return; }
      el.innerHTML = `${ph ? `<div class="row"><button class="small" data-ckph="${id}">📷 看全部签到照片（${ph} 张）</button></div>` : ""}<div class="ck-names"><b>已签 ${r.signed.length} 人</b>${r.signed.map((s) => `<span class="ck-name ok" title="${hm(s.at)}">${esc(s.name)}<small>${hhmm(s.at)} ${s.via === "manual" ? "补签" + (s.by ? "·" + esc(s.by) : "") : s.via === "code" ? "码" : s.dist != null ? s.dist + " 米" : ""}</small>${s.photo ? `<button class="ck-x" data-ckph="${id}" data-uid="${esc(s.uid)}" data-n="${esc(s.name)}" title="看照片">📷</button>` : ""}${mk && s.uid ? `<button class="ck-x" data-ckun="${esc(s.uid)}" data-n="${esc(s.name)}" title="撤销这个人的签到">×</button>` : ""}</span>`).join("") || `<span class="meta">还没有人签</span>`}</div>
        <div class="ck-names"><b>没签 ${miss.length} 人</b>${miss.map((m) => mk ? `<button class="ck-name mk" data-ckmk="${esc(m.uid)}" data-n="${esc(m.name)}" title="点一下补签">${esc(m.name)}<small>补签</small></button>` : `<span class="ck-name">${esc(m.name)}</span>`).join("") || `<span class="meta">全部签到了 🎉</span>`}</div>
        ${miss.length ? `<button class="small" data-ckcopy="${id}">复制没签的名单</button>` : ""}${mk ? `<span class="meta">　点没签的名字补签（没带手机、定位不准、请假）；补错了点已签名字后面的 × 撤销。</span>` : ""}`;
      el.dataset.missing = miss.map((m) => m.name).join("、");
    } catch (e) { el.innerHTML = `<div class="meta">名单打不开：${esc(e.message)}</div>`; }
  }
  // ---------- 7.4 拍照签到照片墙 ----------
  async function paintWall(el, r, miss, mk) {
    const w = wall, id = w.id;
    const stale = (s) => s.photo && (!(s.uid in w.src) || (s.photo_until && w.at[s.uid] && Math.abs(Date.parse(s.photo_until) - 864e5 - Date.parse(w.at[s.uid])) > 2000));
    if (r.signed.some(stale) && !w.old) {
      try {
        for (let page = 0; page < 10; page++) {
          const l = (await CCAuth.rpc("checkin_thumbs", { id, since: w.since })) || [];
          l.forEach((x) => { w.src[x.uid] = x.thumb || ""; w.at[x.uid] = x.at; delete w.full[x.uid]; });
          if (l.length) w.since = l[l.length - 1].at;
          if (l.length < 60) break;
        }
      } catch (e) { if (/checkin_thumbs|Could not find|PGRST202/.test(e.message)) w.old = true; }
    }
    if (!$("ckDetail")) return;
    const now = Date.now(); let until = 0;
    w.tiles = r.signed.slice().reverse().map((s) => { if (s.photo_until) until = Math.max(until, Date.parse(s.photo_until)); return s; });
    // 名单和照片都没变就不重画（每 15 秒刷新一次，避免照片闪）
    const key = wallTab + "|" + r.signed.map((s) => s.uid + s.at + (s.photo ? 1 : 0) + (w.src[s.uid] ? 1 : 0)).join() + "|" + miss.map((m) => m.name).join() + "|" + Math.floor(now / 6e4);
    if (el._cw === key) return; el._cw = key;
    const nPh = r.signed.filter((s) => s.photo).length, keep = until ? Math.max(0, Math.ceil((until - now) / 36e5)) : 24;
    el.innerHTML = `<div class="cw-top"><div class="cw-num ok"><b>${r.signed.length}</b><span>已签</span></div><div class="cw-num${miss.length ? " warn" : ""}"><b>${miss.length}</b><span>还没签</span></div><div class="cw-num"><b>${nPh}</b><span>照片</span></div>
        <span class="spacer"></span><div class="cw-seg" role="tablist"><button role="tab" aria-selected="${wallTab === "wall"}" class="${wallTab === "wall" ? "on" : ""}" data-cwtab="wall">▦ 照片墙</button><button role="tab" aria-selected="${wallTab === "list"}" class="${wallTab === "list" ? "on" : ""}" data-cwtab="list">☰ 名单</button></div></div>
      ${miss.length ? `<div class="cw-miss"><div class="cw-miss-h">还没签 ${miss.length} 人${mk ? " · 点名字补签" : ""}<span class="spacer"></span><button class="small" data-ckcopy="${id}">复制名单</button></div>
        <div class="cw-miss-l">${miss.map((m) => mk ? `<button class="cw-chip" data-ckmk="${esc(m.uid)}" data-n="${esc(m.name)}">${esc(m.name)}</button>` : `<span class="cw-chip">${esc(m.name)}</span>`).join("")}</div></div>` : ""}
      ${wallTab === "wall" ? (w.tiles.length ? `<div class="cw-grid">${w.tiles.map((s, i) => {
          const src = s.photo ? w.src[s.uid] : "", fresh = now - Date.parse(s.at) < 9e4;
          return `<button class="cw-tile" data-cwi="${i}" title="${esc(s.name)} ${hhmm(s.at)}${s.photo ? " · 点开看大图" : s.via === "manual" ? " · 补签" : ""}">
            <span class="cw-ph${fresh ? " fresh" : ""}">${src ? `<img src="${src}" alt="${esc(s.name)} 的签到照片" loading="lazy">` : `<span class="cw-none">${s.photo ? "📷" : "✓"}</span>`}${fresh ? `<i class="cw-dot" title="刚签"></i>` : s.via === "manual" ? `<i class="cw-tag">补签</i>` : ""}</span>
            <b class="cw-n">${esc(s.name)}</b><small class="cw-t">${hhmm(s.at)}</small></button>`; }).join("")}</div>`
          : `<div class="meta cw-empty">${one && one.open ? "还没有人签到，签上的同学的照片会出现在这里" : "没有人签到"}</div>`)
        + `<div class="meta cw-foot">🕒 照片 24 小时后自动删除${w.tiles.length ? `（还剩约 ${keep} 小时）` : ""} · 点照片看大图，可以用 ← → 翻看</div>`
      : `<div class="ck-names"><b>已签 ${r.signed.length} 人</b>${r.signed.map((s) => `<span class="ck-name ok" title="${hm(s.at)}">${esc(s.name)}<small>${hhmm(s.at)} ${s.via === "manual" ? "补签" + (s.by ? "·" + esc(s.by) : "") : ""}</small>${mk && s.uid ? `<button class="ck-x" data-ckun="${esc(s.uid)}" data-n="${esc(s.name)}" title="撤销这个人的签到">×</button>` : ""}</span>`).join("") || `<span class="meta">还没有人签</span>`}</div>`}`;
    w.mk = mk;
  }
  // 大图：点开是原图（拉一次记住），← → 翻看全班的
  async function openTile(i) {
    const w = wall; if (!w || !w.tiles) return;
    const list = w.tiles.filter((s) => s.photo); const s0 = w.tiles[i]; if (!s0) return;
    if (!s0.photo) { if (w.mk && confirm(`「${s0.name}」没有照片（${s0.via === "manual" ? "补签的" : "老版本签的"}）。撤销他的签到？`)) mark(s0.uid, false); return; }
    let lb = $("ckLb");
    if (!lb) {
      lb = document.createElement("dialog"); lb.id = "ckLb"; lb.className = "ck-lb"; document.body.appendChild(lb);
      lb.addEventListener("click", (e) => { if (e.target === lb || e.target.closest("[data-lbx]")) lb.close(); else if (e.target.closest("[data-lbgo]")) show(lb._k + +e.target.closest("[data-lbgo]").dataset.lbgo); else if (e.target.closest("[data-lbun]")) { const s = lb._l[lb._k]; if (confirm(`撤销「${s.name}」的签到？`)) { lb.close(); mark(s.uid, false); } } });
      lb.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") show(lb._k - 1); if (e.key === "ArrowRight") show(lb._k + 1); });
    }
    async function show(k) {
      const l = lb._l; if (k < 0 || k >= l.length) return; lb._k = k; const s = l[k];
      lb.innerHTML = `<figure><div class="ck-lb-img">${w.full[s.uid] || w.src[s.uid] ? `<img src="${w.full[s.uid] || w.src[s.uid]}" alt="${esc(s.name)} 的签到照片">` : `<span class="meta">加载中…</span>`}</div>
        <figcaption><b>${esc(s.name)}</b> · ${hhmm(s.at)} 签到<span class="meta">　${k + 1} / ${l.length}</span><span class="spacer"></span>${w.mk ? `<button class="small" data-lbun>撤销签到</button>` : ""}<button class="small" data-lbx>关闭</button></figcaption></figure>
        <button class="ck-lb-go l" data-lbgo="-1" aria-label="上一张" ${k ? "" : "disabled"}>‹</button><button class="ck-lb-go r" data-lbgo="1" aria-label="下一张" ${k < l.length - 1 ? "" : "disabled"}>›</button>`;
      if (!w.full[s.uid]) {
        try {
          const r = (await CCAuth.rpc("checkin_photos", { id: w.id, uid: s.uid })) || [];
          if (r[0]) { w.full[s.uid] = r[0].img; if (lb._k === k && lb.open) { const box = lb.querySelector(".ck-lb-img"); box.innerHTML = `<img src="${r[0].img}" alt="${esc(s.name)} 的签到照片">`; } }
          else if (lb._k === k) lb.querySelector(".ck-lb-img").innerHTML = `<span class="meta">照片已经删了（签到照片只保留 24 小时）</span>`;
        } catch (e) { if (lb._k === k) lb.querySelector(".ck-lb-img").innerHTML = `<span class="meta">${esc(e.message)}</span>`; }
      }
    }
    lb._l = list;
    if (!lb.open) lb.showModal();
    show(list.indexOf(s0));
  }
  async function mark(uid, on) {
    try { await CCAuth.rpc("checkin_mark", { id: one.id, uid, signed: on }); say(on ? "已补签" : "已撤销", "ok"); detail(one.id); } catch (err) { say(err.message, "bad"); }
  }
  document.addEventListener("click", async (e) => {
    const t = e.target;
    const cwt = t.closest("[data-cwtab]"); if (cwt && one) { wallTab = cwt.dataset.cwtab; detail(one.id); return; }
    const cwi = t.closest("[data-cwi]"); if (cwi) { openTile(+cwi.dataset.cwi); return; }
    const o = t.closest("[data-ckone]"); if (o) { e.preventDefault(); openOne(+o.dataset.ckone); return; }
    const cl = t.closest("[data-ckclose]"); if (cl) { if (!confirm("提前结束这个签到？结束后同学就签不了了。")) return; try { await CCAuth.rpc("checkin_close", { id: +cl.dataset.ckclose }); await load(); openOne(+cl.dataset.ckclose); } catch (err) { say(err.message, "bad"); } return; }
    const mk = t.closest("[data-ckmk],[data-ckun]");
    if (mk && one) {
      const on = !!mk.dataset.ckmk, uid = mk.dataset.ckmk || mk.dataset.ckun;
      if (!confirm(on ? `给「${mk.dataset.n}」补签？` : `撤销「${mk.dataset.n}」的签到？`)) return;
      try { await CCAuth.rpc("checkin_mark", { id: one.id, uid, signed: on }); say(on ? "已补签" : "已撤销", "ok"); detail(one.id); } catch (err) { say(err.message, "bad"); }
      return;
    }
    const ph = t.closest("[data-ckph]"); if (ph) { e.preventDefault(); showPhotos(ph.dataset.ckph, ph.dataset.uid, ph.dataset.n ? ph.dataset.n + " 的签到照片" : ""); return; }
    const cp = t.closest("[data-ckcopy]"); if (cp) { const m = $("ckDetail").dataset.missing || ""; try { await navigator.clipboard.writeText(m); say("已复制：" + (m || "（没有）"), "ok"); } catch (err) { prompt("复制下面的名单", m); } return; }
    if (t.closest("#ckCreate")) { create(); return; }
    if (t.closest("#ckSignOne")) { sign(one, needGes(one) && !/^\d{4}$/.test(($("ckCodeIn") || {}).value || "") ? gesCode : ($("ckCodeIn") || {}).value, t.closest("#ckSignOne")); return; }
    if (t.closest("#ckFull")) { const p = $("ckProj"); if (document.fullscreenElement) document.exitFullscreen(); else if (p && p.requestFullscreen) p.requestFullscreen().catch(() => p.classList.toggle("max")); else if (p) p.classList.toggle("max"); return; }
    if (t.closest("#ckQuickGo")) {   // 列表下面直接输码：在进行中的「动态码」签到里找
      const v = ($("ckCodeQuick").value || "").trim(), cand = list.filter((x) => x.open && !x.mine && needCode(x));
      if (!cand.length) { say("现在没有要输签到码的签到", "bad"); return; }
      if (cand.length > 1) { openOne(cand[0].id, v); return; }
      await openOne(cand[0].id); sign(cand[0], v, $("ckSignOne")); return;
    }
    if (t.closest("[data-ckx=list]")) { openPanel(); return; }
    if (t.closest("[data-ckx=close]")) { $("ckDlg").close(); return; }
    if (t.closest("#cbCheckin")) { openPanel(null); return; }
    const pn = t.closest("[data-ckpanel]"); if (pn) { e.preventDefault(); openPanel(pn.dataset.ckcid || null); return; }
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
    const go = () => { if (logged()) openOne(scanned.i, scanned.k, true); else if (Date.now() - t0 < 15000) setTimeout(go, 400); else openOne(scanned.i, scanned.k, true); };
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
