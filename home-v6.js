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
    team: '<div class="ha ha-team"><div class="ring"><span>🎨</span><span>📱</span><span>🧠</span><span>🛡️</span><b>捞捞</b></div><p>全国高校开发者招募中</p></div>',
  };

  // 视频格式：大多数浏览器放 mp4；放不了 mp4 的（少数安卓 / Linux 浏览器）有 webm 就换 webm
  var probe = document.createElement("video");
  function pickSrc(x) {
    var mp4 = safeUrl(x.src), webm = safeUrl(x.webm);
    if (webm && !(probe.canPlayType && probe.canPlayType('video/mp4; codecs="avc1.640028"')) && probe.canPlayType('video/webm; codecs="vp9"')) return webm;
    return mp4;
  }

  // ---------- 作品展映 ----------
  (function showcase() {
    var track = $("h6Track"), dotsBox = $("h6Dots"), stage = $("h6Stage");
    if (!track) return;
    var list = (Array.isArray(C.showcase) ? C.showcase : []).filter(function (x) { return x && (x.type === "video" ? safeUrl(x.src) : ART[x.art]); });
    if (!list.length) { var sec = $("showcase"); if (sec) sec.hidden = true; return; }
    track.innerHTML = list.map(function (x, i) {
      var media = x.type === "video"
        ? '<video class="h6-video" muted playsinline preload="' + (i ? "none" : "metadata") + '" data-src="' + esc(pickSrc(x)) + '"' + (safeUrl(x.poster) ? ' poster="' + esc(safeUrl(x.poster)) + '"' : "") + '></video>' + (x.sound === false ? "" : '<button class="h6-sound" type="button" aria-label="打开声音">🔇</button>')
        : ART[x.art];
      return '<figure class="h6-slide' + (x.type === "video" ? " is-video" : "") + '" role="group" aria-roledescription="作品" aria-label="' + (i + 1) + ' / ' + list.length + '" data-i="' + i + '">' +
        '<div class="h6-media">' + media + '</div>' +
        '<figcaption><span class="h6-tag">' + esc(x.tag || (x.type === "video" ? "视频" : "功能")) + '</span><h3>' + esc(x.title) + '</h3><p>' + esc(x.desc) + '</p></figcaption></figure>';
    }).join("");
    dotsBox.innerHTML = list.map(function (x, i) { return '<button type="button" role="tab" aria-label="' + esc(x.title) + '" data-i="' + i + '"><i></i></button>'; }).join("");
    var slides = track.children, dots = dotsBox.children, cur = -1, timer = 0, paused = reduce, hover = false, visible = true;
    var DUR = 6500;

    function vidOf(i) { return slides[i] && slides[i].querySelector("video"); }
    function go(i, user) {
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
      schedule();
    }
    function schedule() {
      clearTimeout(timer);
      stage.classList.toggle("is-paused", paused);
      dotsBox.style.setProperty("--dur", DUR + "ms");
      var v = vidOf(cur);
      if (v) {
        if (!v.src) v.src = v.getAttribute("data-src");
        if (!paused && visible) { v.currentTime = 0; var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        // 视频：播完再换下一个（太长的最多放 60 秒）
        if (!paused && !hover && visible) timer = setTimeout(function () { go(cur + 1); }, 60000);
        v.onended = function () { if (!paused && !hover) go(cur + 1); };
        // 放不了（浏览器不支持、网络断了）：3 秒后跳到下一个，不卡住轮播
        v.onerror = function () { if (vidOf(cur) === v) { clearTimeout(timer); timer = setTimeout(function () { go(cur + 1); }, 3000); } };
        stage.classList.add("on-video");
        return;
      }
      stage.classList.remove("on-video");
      // 重启小圆点上的进度条动画
      var d = dots[cur]; if (d) { d.classList.remove("on"); void d.offsetWidth; d.classList.add("on"); }
      if (!paused && !hover && visible) timer = setTimeout(function () { go(cur + 1); }, DUR);
    }
    $("h6Prev").onclick = function () { go(cur - 1, true); };
    $("h6Next").onclick = function () { go(cur + 1, true); };
    dotsBox.onclick = function (e) { var b = e.target.closest("button"); if (b) go(+b.getAttribute("data-i"), true); };
    var pb = $("h6Pause");
    function setPaused(p) { paused = p; pb.textContent = p ? "▶" : "❚❚"; pb.setAttribute("aria-label", p ? "继续自动播放" : "暂停自动播放"); var v = vidOf(cur); if (v) try { p ? v.pause() : v.play().catch(function () {}); } catch (e) {} schedule(); }
    pb.onclick = function () { setPaused(!paused); };
    track.addEventListener("click", function (e) {
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
    go(0, true);
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
