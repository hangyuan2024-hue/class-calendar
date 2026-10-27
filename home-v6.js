/* 5.6.0 首页：作品展映轮播 + 团队 + 开源仓库链接。内容来自 site-config.js（window.LAOLAO_SITE） */
(function () {
  "use strict";
  var C = window.LAOLAO_SITE || {};
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var safeUrl = function (u) { u = String(u || "").trim(); return /^(https:\/\/|media\/|\.\/media\/)[^"'<>\s]*$/i.test(u) && !/\.\./.test(u) ? u : ""; };
  var reduce = false; try { reduce = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  // ---------- 卡片插画（纯 HTML/CSS，不用图片） ----------
  var ART = {
    ingest: '<div class="ha ha-ingest"><div class="ha-phone"><p class="o">晚上有人去图书馆吗？</p><p class="m"><b>学委</b>高数第三章习题 周五 22:00 前交</p><p class="o">收到</p><p class="m"><b>班长</b>明天 15:00 A201 开班会</p></div><span class="ha-arrow">→</span><div class="ha-out"><div><i class="hw">作业</i><b>高数第三章习题</b><small>周五 22:00</small></div><div><i class="mt">会议</i><b>班会</b><small>明天 15:00 · A201</small></div><em>过滤闲聊 2 条</em></div></div>',
    ocr: '<div class="ha ha-ocr"><div class="ha-shot"><span class="scan"></span>' + Array(12).join("<i></i>") + '</div><span class="ha-arrow">→</span><div class="ha-grid"><b>周一</b><b>周二</b><b>周三</b><span class="c1">高等数学<small>A302</small></span><span></span><span class="c2">大学英语<small>B105</small></span><span class="c3">程序设计<small>实验楼</small></span><span class="c1">线性代数<small>A110</small></span><span></span></div></div>',
    mindmap: '<div class="ha ha-mm"><svg viewBox="0 0 360 200" aria-hidden="true"><g fill="none" stroke-width="2.5" stroke-linecap="round"><path d="M180 100 C230 100 230 40 280 40" stroke="#4f8df5"/><path d="M180 100 C230 100 230 100 280 100" stroke="#2bb98a"/><path d="M180 100 C230 100 230 160 280 160" stroke="#f2a20c"/><path d="M180 100 C130 100 130 55 80 55" stroke="#8a6cf0"/><path d="M180 100 C130 100 130 145 80 145" stroke="#f2724b"/></g></svg><span class="n r">高等数学</span><span class="n a">函数与极限</span><span class="n b">导数 ⭐</span><span class="n c">积分 ⚠️</span><span class="n d">微分方程</span><span class="n e">级数 ❓</span></div>',
    remind: '<div class="ha ha-remind"><div class="ha-wx"><small>服务通知</small><div class="card"><b>作业快截止</b><p><span>作业名称</span>高数第三章习题</p><p><span>截止时间</span>今天 22:00</p><p><span>备注</span>还剩 3 小时</p></div><div class="card dim"><b>明天的课</b><p><span>课程</span>大学英语 等 3 节</p></div></div></div>',
    wall: '<div class="ha ha-wall"><span>🎉 运动会报名开始啦</span><span>📢 周三停课一次</span><span>📝 实验报告模板</span></div>',
    team: '<div class="ha ha-team"><div class="ring"><span>🎨</span><span>📱</span><span>🧠</span><span>🛡️</span><b>捞捞调度</b></div><p>全国高校开发者招募中</p></div>',
  };

  // 视频格式：大多数浏览器放 mp4；放不了 mp4 的（少数安卓 / Linux 浏览器）有 webm 就换 webm
  var probe = document.createElement("video");
  function pickSrc(x) {
    var mp4 = safeUrl(x.src), webm = safeUrl(x.webm);
    if (webm && !(probe.canPlayType && probe.canPlayType('video/mp4; codecs="avc1.640028"')) && probe.canPlayType('video/webm; codecs="vp9"')) return webm;
    return mp4;
  }

  // ---------- 作品展映 ----------
  // 7.6 除了 site-config.js 里写好的，还有 hangyuan 账号在网站上传的宣传视频（home-promo.js 读到后调用 window.H6Show.setPromo 放到最前面）
  (function showcase() {
    var track = $("h6Track"), dotsBox = $("h6Dots"), stage = $("h6Stage"), sec = $("showcase");
    if (!track) return;
    var base = (Array.isArray(C.showcase) ? C.showcase : []).filter(function (x) { return x && (x.type === "video" ? safeUrl(x.src) : ART[x.art]); });
    var list = [], slides = track.children, dots = dotsBox.children, cur = -1, timer = 0, paused = reduce, hover = false;
    // 7.6 滚到这里之前算「看不见」：上传的视频等看得见了再下载（不支持检测的老浏览器当作看得见）
    var visible = !("IntersectionObserver" in window);
    var DUR = 6500;
    var mb = function (n) { return n >= 1048576 ? (n / 1048576).toFixed(n >= 104857600 ? 0 : 1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; };
    // 流量少 / 网速慢（省流量模式、2G / 3G）：上传的视频不自动下载，点一下再看
    var lowData = function () { var c = navigator.connection; return !!(c && (c.saveData || /(^|-)2g|3g/.test(c.effectiveType || ""))); };

    function render() {
      if (!list.length) { if (sec) sec.hidden = true; return; }
      if (sec) sec.hidden = false;
      track.innerHTML = list.map(function (x, i) {
        var promo = x.type === "promo", poster = promo ? (/^data:image\/(jpeg|png|webp);base64,/.test(x.poster || "") ? x.poster : "") : safeUrl(x.poster);
        var isVid = x.type === "video" || promo;
        var media = x.type === "video"
          ? '<video class="h6-video" muted playsinline preload="' + (i ? "none" : "metadata") + '" data-src="' + esc(pickSrc(x)) + '"' + (poster ? ' poster="' + esc(poster) + '"' : "") + '></video>' + (x.sound === false ? "" : '<button class="h6-sound" type="button" aria-label="打开声音">🔇</button>')
          : promo
            ? '<video class="h6-video" muted playsinline preload="none" data-promo="' + (+x.id) + '"' + (poster ? ' poster="' + esc(poster) + '"' : "") + '></video>' + (x.sound === false ? "" : '<button class="h6-sound" type="button" aria-label="打开声音">🔇</button>') +
              '<div class="h6-load" hidden><button type="button" class="h6-load-go">▶ 播放视频<small>' + esc(mb(x.size || 0)) + '</small></button><div class="h6-load-bar"><i></i></div><span class="h6-load-t"></span></div>'
            : ART[x.art];
        return '<figure class="h6-slide' + (isVid ? " is-video" : "") + (i === 0 ? " on" : "") + '" role="group" aria-roledescription="作品" aria-label="' + (i + 1) + ' / ' + list.length + '" data-i="' + i + '">' +
          // 6.10 视频放不出来（浏览器不支持、微信里被拦、网络慢）时，底下垫着封面图，不会空白一片
          '<div class="h6-media"' + (isVid && poster ? ' style="background-image:url(\'' + esc(poster) + '\')"' : "") + '>' + media + '</div>' +
          '<figcaption><span class="h6-tag">' + esc(x.tag || (isVid ? "视频" : "功能")) + '</span><h3>' + esc(x.title) + '</h3><p>' + esc(x.desc) + '</p></figcaption></figure>';
      }).join("");
      dotsBox.innerHTML = list.map(function (x, i) { return '<button type="button" role="tab" aria-label="' + esc(x.title || "视频") + '" data-i="' + i + '"><i></i></button>'; }).join("");
      cur = -1;
    }

    function vidOf(i) { return slides[i] && slides[i].querySelector("video"); }
    var touched = false;
    function go(i, user) {
      if (!list.length) return;
      if (user && cur >= 0) touched = true;
      i = (i + list.length) % list.length;
      if (i === cur && !user) return;
      var old = vidOf(cur); if (old) try { old.pause(); } catch (e) {}
      cur = i;
      for (var k = 0; k < slides.length; k++) {
        slides[k].classList.toggle("on", k === i);
        slides[k].setAttribute("aria-hidden", k === i ? "false" : "true");
        dots[k].setAttribute("aria-selected", k === i ? "true" : "false");
        dots[k].classList.toggle("on", k === i);
      }
      track.style.transform = "translateX(" + (-100 * i) + "%)";
      schedule(user);
    }
    // 7.6 上传的视频：轮到它时才一块一块下载（看过的存在浏览器里，下次直接放）
    function loadPromo(v, user) {
      var box = v.parentNode.querySelector(".h6-load"), id = +v.getAttribute("data-promo");
      var item = list.filter(function (x) { return x.type === "promo" && +x.id === id; })[0];
      if (!box || !item || !window.LaoPromo) return false;
      if (v._st === "ready") return false;
      box.hidden = false;
      if (v._st === "loading") return true;
      if (v._st !== "go" && !user && lowData() && !window.LaoPromo.cached(item)) { box.className = "h6-load ask"; return true; }
      v._st = "loading"; box.className = "h6-load ing";
      var bar = box.querySelector(".h6-load-bar i"), t = box.querySelector(".h6-load-t");
      t.textContent = "正在加载视频…";
      window.LaoPromo.url(item, function (got, all) {
        var pc = all ? Math.min(100, Math.round(got * 100 / all)) : 0;
        bar.style.width = pc + "%"; t.textContent = "正在加载视频 " + pc + "%（" + mb(got) + " / " + mb(all) + "）";
      }).then(function (u) {
        v._st = "ready"; box.hidden = true; v.src = u;
        if (vidOf(cur) === v) schedule();
      }, function () {
        v._st = "err"; box.className = "h6-load err"; t.textContent = "视频没加载出来，点一下重试";
        if (vidOf(cur) === v && !paused && !hover) { clearTimeout(timer); timer = setTimeout(function () { go(cur + 1); }, 4000); }
      });
      return true;
    }
    function schedule(user) {
      clearTimeout(timer);
      stage.classList.toggle("is-paused", paused);
      dotsBox.style.setProperty("--dur", DUR + "ms");
      var v = vidOf(cur);
      if (v) {
        stage.classList.add("on-video");
        if (v.hasAttribute("data-promo") && !v.src) {
          // 首页还没滚到这里：先不下载
          if (!visible && !user) return;
          // 还在加载：先停在这一页（最多 90 秒），加载好了自动播放
          var waiting = loadPromo(v, user);
          if (!paused && !hover && visible) timer = setTimeout(function () { go(cur + 1); }, waiting && v._st === "loading" ? 90000 : DUR + 4000);
          return;
        }
        if (!v.src) v.src = v.getAttribute("data-src");
        if (!paused && visible) { v.currentTime = 0; var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        // 视频：播完再换下一个（太长的最多放 60 秒；上传的宣传视频放完为止，最多 5 分钟）
        if (!paused && !hover && visible) timer = setTimeout(function () { go(cur + 1); }, v.hasAttribute("data-promo") ? 300000 : 60000);
        v.onended = function () { if (!paused && !hover) go(cur + 1); };
        // 放不了（浏览器不支持、网络断了）：3 秒后跳到下一个，不卡住轮播
        v.onerror = function () { if (vidOf(cur) === v) { clearTimeout(timer); timer = setTimeout(function () { go(cur + 1); }, 3000); } };
        return;
      }
      stage.classList.remove("on-video");
      // 重启小圆点上的进度条动画
      var d = dots[cur]; if (d) { d.classList.remove("on"); void d.offsetWidth; d.classList.add("on"); }
      if (!paused && !hover && visible) timer = setTimeout(function () { go(cur + 1); }, DUR);
    }
    list = base.slice(); render();
    // 6.16 先把第一张亮出来，后面绑事件哪一步出错（老浏览器、网络慢导致的异常）也不会整块空白
    try { go(0, true); } catch (e) {}
    // 7.6 放上传的宣传视频（排在最前面）。重复调用会整体换掉
    window.H6Show = {
      setPromo: function (items) {
        var pv = (Array.isArray(items) ? items : []).filter(function (x) { return x && x.id && x.parts; }).map(function (x) {
          return { type: "promo", id: x.id, size: x.size, parts: x.parts, mime: x.mime, poster: x.poster, sound: x.sound, title: x.title || "宣传视频", desc: x.desc || "", tag: x.tag || "宣传视频" };
        });
        var keep = touched && cur >= 0 && list[cur] ? list[cur] : null;   // 还没人动过轮播：直接从宣传视频开始
        clearTimeout(timer);
        var old = vidOf(cur); if (old) try { old.pause(); } catch (e) {}
        list = pv.concat(base); render();
        // 正在看（自己点过 / 滑过）的那一张还在：停在它上面；不然从第一张开始
        var at = 0;
        if (keep) list.forEach(function (x, i) { if (x === keep || (keep.type === "promo" && x.type === "promo" && +x.id === +keep.id)) at = i; });
        try { go(at, false); } catch (e) {}
      },
    };
    try {
    $("h6Prev").onclick = function () { go(cur - 1, true); };
    $("h6Next").onclick = function () { go(cur + 1, true); };
    dotsBox.onclick = function (e) { var b = e.target.closest("button"); if (b) go(+b.getAttribute("data-i"), true); };
    var pb = $("h6Pause");
    function setPaused(p) { paused = p; pb.textContent = p ? "▶" : "❚❚"; pb.setAttribute("aria-label", p ? "继续自动播放" : "暂停自动播放"); var v = vidOf(cur); if (v && v.src) try { p ? v.pause() : v.play().catch(function () {}); } catch (e) {} schedule(); }
    pb.onclick = function () { setPaused(!paused); };
    track.addEventListener("click", function (e) {
      var g = e.target.closest(".h6-load");
      if (g) { var gv = g.parentNode.querySelector("video"); if (gv && gv._st !== "loading") { gv._st = "go"; if (vidOf(cur) === gv) schedule(true); } return; }
      var s = e.target.closest(".h6-sound"); if (!s) return;
      var v = s.parentNode.querySelector("video"); v.muted = !v.muted; s.textContent = v.muted ? "🔇" : "🔊"; s.setAttribute("aria-label", v.muted ? "打开声音" : "关闭声音");
    });
    stage.addEventListener("mouseenter", function () { hover = true; if (!vidOf(cur)) clearTimeout(timer); });
    stage.addEventListener("mouseleave", function () { hover = false; schedule(); });
    stage.addEventListener("keydown", function (e) { if (e.key === "ArrowLeft") go(cur - 1, true); else if (e.key === "ArrowRight") go(cur + 1, true); });
    // 手机左右滑
    var sx = 0, sy = 0, sw = false;
    stage.addEventListener("touchstart", function (e) { var t = e.touches[0]; sx = t.clientX; sy = t.clientY; sw = true; }, { passive: true });
    stage.addEventListener("touchend", function (e) {
      if (!sw) return; sw = false; var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) go(cur + (dx < 0 ? 1 : -1), true);
    }, { passive: true });
    // 滚出屏幕 / 切到别的标签页：暂停，省电
    document.addEventListener("visibilitychange", function () { visible = !document.hidden; var v = vidOf(cur); if (v && !visible) v.pause(); schedule(); });
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting && !document.hidden; var v = vidOf(cur); if (v && !visible) v.pause(); schedule();
    }, { threshold: 0.25 }).observe(stage);
    if (reduce) { pb.textContent = "▶"; pb.setAttribute("aria-label", "继续自动播放"); }
    } catch (e) {}
    if (cur < 0) try { go(0, true); } catch (e) {}
  })();

  // ---------- 团队 ----------
  (function team() {
    var t = C.team || {}, box = $("h6TeamCards");
    if (!box) return;
    if (t.name) $("h6TeamName").textContent = t.name;
    if (t.slogan) $("h6TeamSlogan").textContent = t.slogan;
    $("h6TeamStory").textContent = t.story || "";
    var mem = (Array.isArray(t.members) ? t.members : []).filter(function (m) { return m && m.name; });
    if (mem.length) {
      box.classList.add("is-members");
      box.innerHTML = mem.map(function (m) {
        var av = safeUrl(m.avatar) ? '<img src="' + esc(safeUrl(m.avatar)) + '" alt="" loading="lazy">' : esc(String(m.name).slice(0, 1));
        return '<div class="h6-mem"><span class="h6-av">' + av + '</span><div><b>' + esc(m.name) + '</b><span>' + esc(m.role || "") + '</span>' + (m.school ? '<small>' + esc(m.school) + '</small>' : "") + '</div></div>';
      }).join("");
    } else {
      box.innerHTML = (Array.isArray(t.roles) ? t.roles : []).map(function (r) {
        return '<div class="h6-role"><span class="h6-role-ic">' + esc(r.icon || "✦") + '</span><div><b>' + esc(r.t) + '</b><p>' + esc(r.d) + '</p></div></div>';
      }).join("") + '<a class="h6-role h6-role-join" href="join.html"><span class="h6-role-ic">＋</span><div><b>下一个可能是你</b><p>各高校的同学都可以加入，一起把捞捞做好 →</p></div></a>';
    }
  })();

  // ---------- 开源仓库 ----------
  (function repo() {
    var a = $("h6Repo"), u = safeUrl(C.repo);
    if (a && u && /^https:/.test(u)) { a.href = u; a.target = "_blank"; a.rel = "noopener"; a.textContent = "查看开源仓库 ↗"; }
  })();
})();
