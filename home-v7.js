// 首页 v7：首屏「群消息 → 课表」演示，打开时播一次（看得见时才播；减少动态效果时直接显示结果）
(function () {
  "use strict";
  var m = document.getElementById("v7Machine"); if (!m) return;
  var spans = m.querySelectorAll(".v7-msg span[data-k]"), evs = m.querySelectorAll(".v7-c.ev");
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function showAll() { evs.forEach(function (e) { e.classList.add("in"); }); m.classList.add("done"); }
  if (reduce) { showAll(); return; }
  m.classList.add("ready");
  var played = false;
  function play() {
    if (played) return; played = true;
    m.classList.add("play");
    [0, 1, 2].forEach(function (k) {
      setTimeout(function () {
        if (spans[k]) spans[k].classList.add("hit");
        var e = m.querySelector('.v7-c.ev[data-k="' + k + '"]'); if (e) setTimeout(function () { e.classList.add("in"); }, 380);
      }, 500 + k * 820);
    });
    setTimeout(function () { m.classList.add("done"); m.classList.remove("play"); }, 500 + 3 * 820 + 300);
  }
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) { if (es.some(function (x) { return x.isIntersecting; })) { io.disconnect(); setTimeout(play, 350); } }, { threshold: .35 });
    io.observe(m);
  } else setTimeout(play, 600);
})();

// 顶栏下拉菜单（三大板块、下载）+ 手机上的菜单按钮
(function () {
  "use strict";
  var head = document.querySelector(".s-header"); if (!head) return;
  var dds = Array.prototype.slice.call(head.querySelectorAll(".v7-dd"));
  function closeAll(except) { dds.forEach(function (d) { if (d !== except) { d.classList.remove("open"); d.querySelector(".v7-dd-btn").setAttribute("aria-expanded", "false"); } }); }
  dds.forEach(function (d) {
    var b = d.querySelector(".v7-dd-btn");
    b.addEventListener("click", function (e) { e.stopPropagation(); var on = !d.classList.contains("open"); closeAll(d); d.classList.toggle("open", on); b.setAttribute("aria-expanded", String(on)); if (on) { var f = d.querySelector(".v7-menu a"); if (f && e.detail === 0) f.focus(); } });
    d.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeAll(); b.focus(); } });
  });
  var burger = head.querySelector(".v7-burger");
  if (burger) burger.addEventListener("click", function (e) { e.stopPropagation(); var on = !head.classList.contains("nav-open"); head.classList.toggle("nav-open", on); burger.setAttribute("aria-expanded", String(on)); if (!on) closeAll(); });
  document.addEventListener("click", function (e) {
    if (!head.contains(e.target)) { closeAll(); head.classList.remove("nav-open"); if (burger) burger.setAttribute("aria-expanded", "false"); return; }
    if (e.target.closest(".s-nav a")) { closeAll(); head.classList.remove("nav-open"); if (burger) burger.setAttribute("aria-expanded", "false"); }   // 点了菜单里的链接：收起
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeAll(); head.classList.remove("nav-open"); } });
})();
