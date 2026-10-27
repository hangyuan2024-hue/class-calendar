/* 7.6 首页「作品展映」里的宣传视频（数据库 site_videos，见扣子 7.6-promo-video.sql）
 *   · 谁都能看：读 promo_list，交给 home-v6.js（window.H6Show.setPromo）放在轮播最前面；
 *     轮到它时一块一块（每块 1MB）下载、拼好再播放；看过的存在浏览器缓存里，下次直接放
 *   · 只有 hangyuan 账号：作品展映标题旁边多一个「管理宣传视频」按钮 —— 上传（断了能续传）、改标题、排序、隐藏、删除
 *   依赖 auth.js（CCAuth）、config.js（APP_CONFIG） */
(function () {
  "use strict";
  if (!window.CCAuth || typeof CCAuth.rpc !== "function") return;
  var PART = 1048576, CACHE = "laolao-promo-v1";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var mb = function (n) { n = +n || 0; return n >= 1048576 ? (n / 1048576).toFixed(n >= 104857600 ? 0 : 1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; };
  var dur = function (s) { s = Math.round(+s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  // ---------- 接口：视频一块就有 1MB，用比 CCAuth.rpc 更长的等待时间（2 分钟），失败自己重试 ----------
  async function call(fn, args, ms) {
    var s = null; try { s = await CCAuth.session(); } catch (e) {}
    var key = (window.APP_CONFIG || {}).SUPABASE_ANON_KEY;
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, ms || 120000) : 0;
    try {
      var r = await fetch(CCAuth.base() + "/rest/v1/rpc/" + fn, {
        method: "POST", signal: ctl ? ctl.signal : undefined, body: JSON.stringify(args || {}),
        headers: { apikey: key, Authorization: "Bearer " + ((s && s.access_token) || key), "Content-Type": "application/json" },
      });
      var txt = await r.text(), j = null;
      try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
      if (!r.ok) {
        var m = j && (j.message || j.hint || j.details) || "";
        var err = new Error(/[一-龥]/.test(m) ? m : r.status === 429 ? "请求太频繁，稍等一下" : "服务器没响应（" + r.status + "）");
        err.status = r.status; err.fatal = r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429; throw err;
      }
      return j;
    } catch (e) {
      if (e && e.name === "AbortError") { var te = new Error("网络太慢，这一块超时了"); te.status = 0; throw te; }
      throw e;
    } finally { clearTimeout(t); }
  }
  // 网络抖动、服务器忙：最多试 6 次（等 1、2、4、8、15 秒）；权限、参数错误不重试
  async function retry(fn, args, ms, stop) {
    for (var k = 0; ; k++) {
      try { return await call(fn, args, ms); }
      catch (e) {
        if ((e && e.fatal) || k >= 5 || (stop && stop())) throw e;
        await sleep([1000, 2000, 4000, 8000, 15000][k] + Math.random() * 500);
      }
    }
  }

  // ---------- 看视频：下载 → 拼好 → 缓存 ----------
  var cachedKeys = {}, urls = {};
  var keyOf = function (x) { return location.origin + "/__laolao_promo/" + (+x.id) + "-" + (+x.size); };
  async function cacheInit(list) {
    if (!("caches" in window)) return;
    try {
      var c = await caches.open(CACHE), keys = await c.keys(), want = {};
      list.forEach(function (x) { want[keyOf(x)] = 1; });
      for (var i = 0; i < keys.length; i++) {
        if (want[keys[i].url]) cachedKeys[keys[i].url] = 1;
        else c.delete(keys[i]);   // 已经删掉 / 换掉的视频，不占地方
      }
    } catch (e) {}
  }
  function b64bytes(b) {
    var s = atob(b), n = s.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  async function download(x, onp) {
    var k = keyOf(x);
    if (cachedKeys[k]) {
      try { var c0 = await caches.open(CACHE), hit = await c0.match(k); if (hit) { var bl = await hit.blob(); if (bl.size === +x.size) return bl; } } catch (e) {}
      delete cachedKeys[k];
    }
    var parts = new Array(x.parts), got = 0, next = 0, fail = null;
    async function worker() {
      while (!fail && next < x.parts) {
        var i = next++;
        try {
          var b = await retry("promo_part", { vid: x.id, i: i }, 120000);
          if (typeof b !== "string" || !b) throw new Error("视频不完整");
          parts[i] = b64bytes(b); got += parts[i].length; if (onp) onp(got, x.size);
        } catch (e) { fail = e; }
      }
    }
    var ws = []; for (var w = 0; w < Math.min(3, x.parts); w++) ws.push(worker());
    await Promise.all(ws);
    if (fail) throw fail;
    var blob = new Blob(parts, { type: x.mime || "video/mp4" });
    if ("caches" in window) try {
      var c = await caches.open(CACHE);
      await c.put(k, new Response(blob, { headers: { "Content-Type": blob.type, "Content-Length": String(blob.size) } }));
      cachedKeys[k] = 1;
    } catch (e) {}   // 浏览器空间不够：不缓存，照样能放
    return blob;
  }
  window.LaoPromo = {
    cached: function (x) { return !!cachedKeys[keyOf(x)]; },
    url: function (x, onp) {
      var k = keyOf(x);
      if (!urls[k]) urls[k] = download(x, onp).then(function (b) { return URL.createObjectURL(b); }, function (e) { delete urls[k]; throw e; });
      return urls[k];
    },
  };

  var shown = false;
  async function refreshPublic() {
    var list = [];
    try { list = await CCAuth.rpc("promo_list"); } catch (e) { list = []; }
    list = Array.isArray(list) ? list : [];
    await cacheInit(list);
    // 排第一的：全屏放在首页最上面；其余的放进作品展映轮播
    hero(list[0] || null);
    var rest = list.slice(1);
    if ((rest.length || shown) && window.H6Show) { shown = shown || rest.length > 0; window.H6Show.setPromo(rest); }
  }

  // =====================================================================
  // 7.6 首页第一屏：全屏宣传视频（背景静音循环播放；点「观看」全屏带声音看）
  // =====================================================================
  var H = null, player = null;
  var reduceMotion = false; try { reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  var lowData = function () { var c = navigator.connection; return !!(c && (c.saveData || /(^|-)2g|3g/.test(c.effectiveType || ""))); };
  var isEn = function () { return /^en/i.test(document.documentElement.lang || ""); };
  var ARROW = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3 10h13M11 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"/></svg>';
  function dateText(at) {
    var d = new Date(at); if (isNaN(d)) return "";
    if (isEn()) return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }).toUpperCase();
    return d.getFullYear() + " 年 " + (d.getMonth() + 1) + " 月 " + d.getDate() + " 日";
  }
  function hero(x) {
    var sec = document.getElementById("promoHero");
    if (!x) { if (sec) sec.remove(); if (H && H.io) H.io.disconnect(); H = null; document.documentElement.classList.remove("has-ph", "ph-top"); return; }
    var poster = /^data:image\/(jpeg|png|webp);base64,/.test(x.poster || "") ? x.poster : "";
    if (H && H.x.id === x.id && H.x.ver === x.ver) return;
    if (H && H.io) H.io.disconnect();
    var main = document.getElementById("main");
    if (!main) return;
    if (!sec) { sec = document.createElement("section"); sec.id = "promoHero"; sec.className = "ph"; main.insertBefore(sec, main.firstChild); }
    sec.setAttribute("aria-label", x.title || "宣传视频");
    // 7.6.1 影院式：视频完整显示在中间（宣传片里常有字幕、界面录屏，铺满裁切或者叠字都会挡住），
    // 两边用模糊放大的封面填满；标题、日期、「观看」放在视频下面的一条，不压在画面上
    sec.innerHTML =
      '<div class="ph-bg"' + (poster ? ' style="background-image:url(\'' + esc(poster) + '\')"' : "") + '></div>' +
      '<div class="ph-shade" aria-hidden="true"></div>' +
      '<div class="ph-stage"><div class="ph-frame"' + (x.width && x.height ? ' style="aspect-ratio:' + (+x.width) + ' / ' + (+x.height) + '"' : "") + '>' +
        '<video class="ph-v" muted loop playsinline preload="none" aria-hidden="true" tabindex="-1"' + (poster ? ' poster="' + esc(poster) + '"' : "") + '></video>' +
        '<div class="ph-bar" aria-hidden="true"><i></i></div></div></div>' +
      '<div class="ph-cap"><div class="ph-txt">' +
        '<p class="ph-kick"><span>' + esc(dateText(x.at)) + '</span><span>' + esc(x.tag || "宣传视频") + '</span></p>' +
        '<h2 class="ph-t">' + esc(x.title || "宣传视频") + '</h2>' +
        (x.desc ? '<p class="ph-d">' + esc(x.desc) + '</p>' : "") +
      '</div><button type="button" class="ph-watch"><span>观看完整视频</span>' + ARROW + '</button></div>';
    document.documentElement.classList.add("has-ph");
    topWatch();
    H = { x: x, sec: sec, v: sec.querySelector(".ph-v"), st: "" };
    // 视频框按中间那块的大小等比放到最大（宽屏横着顶满，窄高的屏竖着顶满）
    var frame = sec.querySelector(".ph-frame"), stage = sec.querySelector(".ph-stage"), ratio = x.width && x.height ? x.width / x.height : 16 / 9;
    var fit = function () {
      if (!frame.isConnected) { window.removeEventListener("resize", fit); return; }
      if (window.innerWidth <= 760) { frame.style.width = frame.style.height = ""; return; }
      var cs = getComputedStyle(stage);
      var W = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), Hh = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      var w = Math.max(0, Math.min(W, Hh * ratio));
      frame.style.width = w + "px"; frame.style.height = w / ratio + "px";
    };
    fit(); window.addEventListener("resize", fit);
    sec.querySelector(".ph-watch").onclick = function () { watch(x); };
    // 背景视频：看得见才下载 / 播放；省流量、减少动画时只放封面
    if (reduceMotion || (lowData() && !window.LaoPromo.cached(x))) return;
    var h = H;
    if ("IntersectionObserver" in window) {
      h.io = new IntersectionObserver(function (es) { h.vis = es[0].isIntersecting; bgTick(h); }, { threshold: 0.2 });
      h.io.observe(sec);
    } else { h.vis = true; bgTick(h); }
    document.addEventListener("visibilitychange", function () { if (H === h) bgTick(h); });
  }
  // 停在第一屏：顶栏变透明盖在视频上
  var topBound = false;
  function topWatch() {
    var f = function () {
      var sec = document.getElementById("promoHero"), hh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hh")) || 60;
      document.documentElement.classList.toggle("ph-top", !!sec && sec.getBoundingClientRect().bottom > hh + 40);
    };
    f();
    if (topBound) return; topBound = true;
    window.addEventListener("scroll", f, { passive: true }); window.addEventListener("resize", f);
  }
  function bgTick(h) {
    if (H !== h) return;
    var on = h.vis && !document.hidden && !(player && player.open);
    if (!on) { if (h.v.src) h.v.pause(); return; }
    if (h.st === "ready") { var p = h.v.play(); if (p && p.catch) p.catch(function () {}); return; }
    if (h.st) return;
    h.st = "loading";
    var bar = h.sec.querySelector(".ph-bar"), bi = bar.querySelector("i");
    var showBar = setTimeout(function () { bar.classList.add("on"); }, 600);   // 有缓存的话一下就好，不闪进度条
    window.LaoPromo.url(h.x, function (got, all) { bi.style.width = (all ? Math.min(100, got * 100 / all) : 0) + "%"; }).then(function (u) {
      clearTimeout(showBar); bar.classList.remove("on");
      if (H !== h) return;
      h.st = "ready"; h.v.src = u;
      h.v.addEventListener("playing", function () { h.sec.classList.add("is-playing"); }, { once: true });
      bgTick(h);
    }, function () { clearTimeout(showBar); bar.classList.remove("on"); h.st = "err"; });
  }

  // 「观看」：全屏播放器，有声音、能拖进度
  function watch(x) {
    if (!player) {
      player = document.createElement("dialog");
      player.className = "ph-player";
      player.innerHTML = '<button type="button" class="ph-close" aria-label="关闭">×</button><video class="ph-pv" controls playsinline></video>' +
        '<div class="ph-pload"><div class="ph-bar on"><i></i></div><p></p></div>';
      document.body.appendChild(player);
      player.querySelector(".ph-close").onclick = function () { player.close(); };
      player.addEventListener("close", function () { var v = player.querySelector(".ph-pv"); try { v.pause(); } catch (e) {} if (H) bgTick(H); });
      player.addEventListener("click", function (e) { if (e.target === player) player.close(); });
    }
    var v = player.querySelector(".ph-pv"), ld = player.querySelector(".ph-pload"), bi = ld.querySelector("i"), t = ld.querySelector("p");
    v.removeAttribute("src"); v.hidden = true; ld.hidden = false; bi.style.width = "0%"; t.textContent = "正在加载视频…";
    try { player.showModal(); } catch (e) { player.setAttribute("open", ""); }
    if (H && H.v) H.v.pause();
    window.LaoPromo.url(x, function (got, all) {
      var pc = all ? Math.min(100, Math.round(got * 100 / all)) : 0;
      bi.style.width = pc + "%"; t.textContent = "正在加载视频 " + pc + "%（" + mb(got) + " / " + mb(all) + "）";
    }).then(function (u) {
      if (!player.open) return;
      ld.hidden = true; v.hidden = false; v.src = u; v.muted = false;
      var p = v.play(); if (p && p.catch) p.catch(function () {});
    }, function () { t.textContent = "视频没加载出来，关掉再点一次「观看」试试"; });
  }
  // 首页第一屏要用：马上去读（不等空闲），免得页面先显示原来的开头再跳
  setTimeout(function () { refreshPublic(); }, 0);
  if ("requestIdleCallback" in window) requestIdleCallback(function () { setupAdmin(); }, { timeout: 2500 }); else setTimeout(setupAdmin, 800);

  // =====================================================================
  // 管理（只有 hangyuan 账号；服务器也会检查）
  // =====================================================================
  var dlg = null, admin = null, job = null;
  async function setupAdmin() {
    var me = null; try { me = await CCAuth.me(); } catch (e) {}
    if (!me || me.account !== "hangyuan") return;
    try { if (!(await CCAuth.rpc("promo_can"))) return; } catch (e) { return; }
    var head = document.querySelector("#showcase .h6-show-head");
    if (!head) return;
    var b = document.createElement("button");
    b.type = "button"; b.className = "pm-open"; b.setAttribute("data-noi18n", "");
    b.innerHTML = '<span aria-hidden="true">🎬</span> 管理宣传视频';
    b.onclick = open;
    head.appendChild(b);
    window.addEventListener("beforeunload", function (e) { if (job && job.running) { e.preventDefault(); e.returnValue = ""; } });
  }

  function open() {
    if (!dlg) build();
    if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); } }
    loadAdmin();
  }
  function $q(sel) { return dlg.querySelector(sel); }
  function build() {
    dlg = document.createElement("dialog");
    dlg.className = "pm-dlg"; dlg.setAttribute("data-noi18n", ""); dlg.setAttribute("aria-labelledby", "pmTitle");
    dlg.innerHTML =
      '<div class="pm-head"><h3 id="pmTitle">🎬 宣传视频</h3><span class="pm-used"></span><button type="button" class="pm-x" aria-label="关闭">×</button></div>' +
      '<div class="pm-body">' +
        '<section class="pm-up">' +
          '<label class="pm-drop"><input type="file" class="pm-file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"><b>＋ 选择视频文件</b>' +
            '<span>mp4（H.264）各种浏览器都能放，也可以 webm / mov。单个 ≤ 300MB，建议压到 50MB 以内，大家打开更快。<br>上传断了不要紧：再选一次同一个文件，会接着传。</span></label>' +
          '<div class="pm-new" hidden>' +
            '<video class="pm-prev" controls muted playsinline preload="metadata"></video>' +
            '<div class="pm-form">' +
              '<label>标题<input class="pm-in-title" maxlength="40" placeholder="例如：捞捞宣传片"></label>' +
              '<label>介绍<textarea class="pm-in-desc" maxlength="200" rows="2" placeholder="一两句话，显示在视频旁边"></textarea></label>' +
              '<div class="pm-row"><label>标签<input class="pm-in-tag" maxlength="12" value="宣传视频"></label><label class="pm-chk"><input type="checkbox" class="pm-in-sound" checked> 有声音（显示「打开声音」按钮）</label></div>' +
              '<label>封面：拖动选一帧<input type="range" class="pm-in-at" min="0" max="100" step="0.1" value="0"></label>' +
              '<p class="pm-info"></p>' +
              '<div class="pm-act"><button type="button" class="pm-go">开始上传</button><button type="button" class="pm-cancel">换一个文件</button></div>' +
            '</div>' +
          '</div>' +
          '<div class="pm-prog" hidden><div class="pm-bar"><i></i></div><p class="pm-pt"></p><div class="pm-act"><button type="button" class="pm-stop">暂停</button></div></div>' +
          '<p class="pm-msg" role="status" aria-live="polite"></p>' +
        '</section>' +
        '<section><h4>已经上传的 <small>排第一的全屏放在首页最上面，其余的放进作品展映轮播</small></h4><ul class="pm-list"></ul></section>' +
      '</div>';
    document.body.appendChild(dlg);
    $q(".pm-x").onclick = function () { dlg.close(); };
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    $q(".pm-file").onchange = function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) pick(f); };
    $q(".pm-cancel").onclick = function () { reset(); };
    $q(".pm-go").onclick = function () { startUpload(); };
    $q(".pm-stop").onclick = function () { if (!job) return; if (job.running) { job.stop = true; $q(".pm-stop").disabled = true; $q(".pm-pt").textContent = "正在暂停…"; } else startUpload(); };
    $q(".pm-in-at").oninput = function () { var v = $q(".pm-prev"); if (v.duration) try { v.currentTime = +this.value; } catch (e) {} };
    $q(".pm-prev").addEventListener("seeked", function () { if (job && !job.running && !job.started) job.poster = grab(this); });
    $q(".pm-list").addEventListener("click", onList);
    // 拖文件进来
    var drop = $q(".pm-drop");
    drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("on"); });
    drop.addEventListener("dragleave", function () { drop.classList.remove("on"); });
    drop.addEventListener("drop", function (e) { e.preventDefault(); drop.classList.remove("on"); var f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) pick(f); });
  }
  function msg(t, bad) { var m = $q(".pm-msg"); m.textContent = t || ""; m.classList.toggle("bad", !!bad); }

  // ---------- 列表 ----------
  async function loadAdmin() {
    try { admin = await CCAuth.rpc("promo_admin_list"); } catch (e) { msg(e.message || "读不到视频列表", true); return; }
    var vs = admin.videos || [];
    $q(".pm-used").textContent = "已用 " + mb(admin.used) + " / " + mb(admin.quota) + " · " + vs.length + " / " + admin.max_count + " 个";
    var box = $q(".pm-list");
    if (!vs.length) { box.innerHTML = '<li class="pm-empty">还没有上传视频。首页现在放的是 site-config.js 里写好的介绍。</li>'; return; }
    box.innerHTML = vs.map(function (v, i) {
      var st = v.status === "uploading" ? '<em class="pm-st up">传了 ' + (v.have || 0) + " / " + v.parts + " 块 · 再选一次这个文件接着传</em>"
        : v.status === "hidden" ? '<em class="pm-st hid">已隐藏</em>' : '<em class="pm-st ok">首页显示中</em>';
      return '<li class="pm-item" data-id="' + v.id + '">' +
        '<span class="pm-thumb"' + (/^data:image\//.test(v.poster || "") ? ' style="background-image:url(\'' + esc(v.poster) + '\')"' : "") + '></span>' +
        '<div class="pm-meta"><b>' + esc(v.title || "（没有标题）") + '</b><span>' + esc(v.tag) + " · " + mb(v.size) + (v.duration ? " · " + dur(v.duration) : "") + (v.width ? " · " + v.width + "×" + v.height : "") + (v.sound === false ? " · 无声" : "") + "</span>" + st + "</div>" +
        '<div class="pm-ops">' +
          (v.status !== "uploading" ? '<button type="button" data-act="up"' + (i ? "" : " disabled") + ' aria-label="上移">↑</button><button type="button" data-act="down"' + (i < vs.length - 1 ? "" : " disabled") + ' aria-label="下移">↓</button>' +
            '<button type="button" data-act="edit">编辑</button><button type="button" data-act="toggle">' + (v.status === "hidden" ? "显示" : "隐藏") + "</button>" : "") +
          '<button type="button" data-act="del" class="pm-del">删除</button>' +
        "</div></li>";
    }).join("");
  }
  async function onList(e) {
    var b = e.target.closest("button[data-act]"); if (!b) return;
    var li = b.closest(".pm-item"), id = +li.getAttribute("data-id"), act = b.getAttribute("data-act");
    var vs = (admin && admin.videos) || [], v = vs.filter(function (x) { return +x.id === id; })[0];
    if (!v) return;
    try {
      if (act === "del") {
        if (b.getAttribute("data-sure") !== "1") { b.setAttribute("data-sure", "1"); b.textContent = "确定删除？"; setTimeout(function () { if (b.isConnected) { b.removeAttribute("data-sure"); b.textContent = "删除"; } }, 4000); return; }
        b.disabled = true; await CCAuth.rpc("promo_delete", { vid: id }); msg("已删除「" + (v.title || "视频") + "」");
      } else if (act === "toggle") {
        await CCAuth.rpc("promo_update", { vid: id, p_meta: { status: v.status === "hidden" ? "ready" : "hidden" } });
      } else if (act === "up" || act === "down") {
        var ids = vs.filter(function (x) { return x.status !== "uploading"; }).map(function (x) { return +x.id; }), k = ids.indexOf(id), j = act === "up" ? k - 1 : k + 1;
        if (k < 0 || j < 0 || j >= ids.length) return;
        ids[k] = ids[j]; ids[j] = id;
        await CCAuth.rpc("promo_order", { ids: ids });
      } else if (act === "edit") {
        if (li.querySelector(".pm-edit")) return;
        var f = document.createElement("div"); f.className = "pm-edit";
        f.innerHTML = '<label>标题<input class="e-title" maxlength="40"></label><label>介绍<textarea class="e-desc" maxlength="200" rows="2"></textarea></label>' +
          '<div class="pm-row"><label>标签<input class="e-tag" maxlength="12"></label><label class="pm-chk"><input type="checkbox" class="e-sound"> 有声音</label></div>' +
          '<div class="pm-act"><button type="button" class="e-save">保存</button><button type="button" class="e-no">取消</button></div>';
        li.appendChild(f);
        f.querySelector(".e-title").value = v.title || ""; f.querySelector(".e-desc").value = v.desc || ""; f.querySelector(".e-tag").value = v.tag || ""; f.querySelector(".e-sound").checked = v.sound !== false;
        f.querySelector(".e-no").onclick = function () { f.remove(); };
        f.querySelector(".e-save").onclick = async function () {
          this.disabled = true;
          try {
            await CCAuth.rpc("promo_update", { vid: id, p_meta: { title: f.querySelector(".e-title").value, desc: f.querySelector(".e-desc").value, tag: f.querySelector(".e-tag").value, sound: f.querySelector(".e-sound").checked } });
            msg("已保存"); await loadAdmin(); refreshPublic();
          } catch (er) { this.disabled = false; msg(er.message || "没保存上", true); }
        };
        f.querySelector(".e-title").focus();
        return;
      }
      await loadAdmin(); refreshPublic();
    } catch (er) { msg(er.message || "操作失败", true); b.disabled = false; }
  }

  // ---------- 选文件 ----------
  var TYPES = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
  function mimeOf(f) {
    var t = String(f.type || "").toLowerCase(), ext = (String(f.name).split(".").pop() || "").toLowerCase();
    if (t === "video/mp4" || t === "video/webm" || t === "video/quicktime") return t;
    return TYPES[ext] || "";
  }
  function reset() {
    if (job && job.running) return;
    if (job && job.local) URL.revokeObjectURL(job.local);
    job = null;
    $q(".pm-new").hidden = true; $q(".pm-prog").hidden = true; $q(".pm-drop").hidden = false;
    var v = $q(".pm-prev"); v.removeAttribute("src"); try { v.load(); } catch (e) {}
    msg("");
  }
  function pick(f) {
    if (job && job.running) { msg("正在上传，先等它传完或者暂停", true); return; }
    reset();
    var mime = mimeOf(f);
    if (!mime) { msg("只能上传 mp4 / webm / mov 视频", true); return; }
    var max = (admin && admin.max_size) || 314572800;
    if (f.size > max) { msg("这个视频 " + mb(f.size) + "，超过了 " + mb(max) + "。请先压缩一下（剪映、必剪导出时选 1080P、码率低一些）", true); return; }
    if (admin && admin.used + f.size > admin.quota && !(admin.videos || []).some(function (x) { return x.status === "uploading" && +x.size === f.size; })) { msg("空间不够了：先删掉不用的视频", true); return; }
    job = { file: f, mime: mime, local: URL.createObjectURL(f), poster: "", meta: {} };
    var v = $q(".pm-prev");
    v.onloadedmetadata = function () {
      job.meta = { duration: +v.duration.toFixed(1) || null, width: v.videoWidth || null, height: v.videoHeight || null };
      var r = $q(".pm-in-at"); r.max = String(Math.max(0.1, v.duration - 0.1)); r.value = String(Math.min(1, v.duration / 3));
      try { v.currentTime = +r.value; } catch (e) {}
      info();
    };
    v.onerror = function () { msg("这个浏览器放不了这个视频（编码不支持）。还能上传，但别的同学可能也放不了，建议转成 mp4（H.264）再传", true); info(); };
    v.src = job.local;
    $q(".pm-in-title").value = String(f.name).replace(/\.[^.]+$/, "").slice(0, 40);
    $q(".pm-in-desc").value = ""; $q(".pm-in-sound").checked = true;
    $q(".pm-drop").hidden = true; $q(".pm-new").hidden = false;
    info();
    if (f.size > 52428800) msg("提示：视频比较大（" + mb(f.size) + "），同学们打开首页要多等一会儿。能压缩的话建议压到 50MB 以内。");
  }
  function info() {
    var f = job.file, m = job.meta || {};
    $q(".pm-info").textContent = f.name + " · " + mb(f.size) + (m.duration ? " · " + dur(m.duration) : "") + (m.width ? " · " + m.width + "×" + m.height : "") + " · 分 " + Math.ceil(f.size / PART) + " 块上传";
  }
  // 截一帧当封面（最宽 1280，JPEG，控制在 380KB 以内）
  function grab(v) {
    try {
      if (!v.videoWidth) return "";
      var w = Math.min(1280, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth);
      for (var q = 0.82; q > 0.3; q -= 0.12) {
        var c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(v, 0, 0, w, h);
        var d = c.toDataURL("image/jpeg", q);
        if (d.length <= 380000) return d;
        w = Math.round(w * 0.8); h = Math.round(h * 0.8);
      }
    } catch (e) {}
    return "";
  }
  // 文件指纹：名字 + 大小 + 修改时间 + 开头和结尾各 1MB 的 SHA-256（续传时认出是同一个文件）
  async function fingerprint(f) {
    var head = await f.slice(0, PART).arrayBuffer(), tail = await f.slice(Math.max(0, f.size - PART)).arrayBuffer();
    var meta = new TextEncoder().encode(f.name + "|" + f.size + "|" + (f.lastModified || 0) + "|");
    var all = new Uint8Array(meta.length + head.byteLength + tail.byteLength);
    all.set(meta, 0); all.set(new Uint8Array(head), meta.length); all.set(new Uint8Array(tail), meta.length + head.byteLength);
    var h = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
    return Array.from(h.slice(0, 16), function (b) { return b.toString(16).padStart(2, "0"); }).join("") + "-" + f.size;
  }
  function b64of(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result || ""); res(s.slice(s.indexOf(",") + 1)); };
      r.onerror = function () { rej(r.error || new Error("读不了这个文件")); };
      r.readAsDataURL(blob);
    });
  }

  // ---------- 上传 ----------
  async function startUpload() {
    if (!job || job.running) return;
    var f = job.file, parts = Math.ceil(f.size / PART);
    if (!job.poster) job.poster = grab($q(".pm-prev"));
    job.running = true; job.started = true; job.stop = false;
    $q(".pm-new").hidden = true; $q(".pm-prog").hidden = false; $q(".pm-stop").disabled = false; $q(".pm-stop").textContent = "暂停";
    var bar = $q(".pm-bar i"), pt = $q(".pm-pt");
    msg("");
    try {
      pt.textContent = "准备上传…";
      if (!job.fp) job.fp = await fingerprint(f);
      var meta = { title: $q(".pm-in-title").value, desc: $q(".pm-in-desc").value, tag: $q(".pm-in-tag").value, sound: $q(".pm-in-sound").checked, poster: job.poster || "" };
      if (job.meta) { meta.duration = job.meta.duration; meta.width = job.meta.width; meta.height = job.meta.height; }
      var r = await retry("promo_begin", { p_fp: job.fp, p_mime: job.mime, p_size: f.size, p_parts: parts, p_meta: meta }, 60000);
      job.id = r.id;
      var have = {}; (r.have || []).forEach(function (i) { have[i] = 1; });
      var todo = []; for (var i = 0; i < parts; i++) if (!have[i]) todo.push(i);
      var done = parts - todo.length, sent = 0, t0 = Date.now(), fail = null;
      var paint = function () {
        var pc = Math.floor(done * 100 / parts), sp = sent / Math.max(1, (Date.now() - t0) / 1000);
        bar.style.width = pc + "%";
        var left = sp > 0 ? (parts - done) * PART / sp : 0;
        pt.textContent = "已上传 " + pc + "%（" + done + " / " + parts + " 块）" + (sent ? " · " + mb(sp) + "/秒" + (left > 0 ? " · 还要大约 " + (left > 90 ? Math.ceil(left / 60) + " 分钟" : Math.ceil(left) + " 秒") : "") : "") +
          (r.have && r.have.length && !sent ? " · 接着上次的传" : "");
      };
      paint();
      var q = todo.slice();
      async function worker() {
        while (!fail && !job.stop && q.length) {
          var i = q.shift();
          try {
            var b64 = await b64of(f.slice(i * PART, Math.min(f.size, (i + 1) * PART)));
            await retry("promo_put", { vid: job.id, i: i, b64: b64 }, 180000, function () { return job.stop; });
            done++; sent += Math.min(PART, f.size - i * PART); paint();
          } catch (e) { fail = e; }
        }
      }
      var ws = []; for (var w = 0; w < Math.min(3, todo.length); w++) ws.push(worker());
      await Promise.all(ws);
      if (fail) throw fail;
      if (job.stop && done < parts) { job.running = false; pt.textContent = "已暂停（" + done + " / " + parts + " 块）。点「继续」接着传；关掉网页也没关系，下次选同一个文件接着传"; $q(".pm-stop").disabled = false; $q(".pm-stop").textContent = "继续"; loadAdmin(); return; }
      pt.textContent = "检查文件…";
      var fin = await retry("promo_finish", { vid: job.id }, 60000);
      if (!fin || !fin.ok) throw new Error("有几块没传上去，点「继续」补传");
      bar.style.width = "100%";
      job.running = false;
      var name = (fin.video && fin.video.title) || "视频";
      reset();
      msg("「" + name + "」传好了，已经放到首页了 🎉");
      await loadAdmin(); refreshPublic();
    } catch (e) {
      job.running = false;
      $q(".pm-stop").disabled = false; $q(".pm-stop").textContent = "继续";
      pt.textContent = "上传中断了";
      msg((e && e.message) || "上传失败", true);
      if (e && e.fatal && !job.id) { $q(".pm-prog").hidden = true; $q(".pm-new").hidden = false; }
      loadAdmin();
    }
  }
})();
