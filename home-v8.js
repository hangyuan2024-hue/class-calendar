/* 6.10 介绍页：下载区先选板块（捞捞课程表 / 捞捞编程）；地址带 #get-code 直接打开捞捞编程 */
(function () {
  "use strict";
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".v8-get-tabs [data-gt]"));
  if (!tabs.length) return;
  function pick(k, focus) {
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-gt") === k;
      t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1;
      var panel = document.getElementById(t.getAttribute("aria-controls")); if (panel) panel.hidden = !on;
      if (on && focus) t.focus();
    });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { pick(t.getAttribute("data-gt")); });
    t.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault(); var n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; pick(n.getAttribute("data-gt"), true);
    });
  });
  function fromHash() {
    if (location.hash === "#get-code") { pick("code"); var g = document.getElementById("get"); if (g) g.scrollIntoView(); }
  }
  window.addEventListener("hashchange", fromHash); fromHash();
})();

/* 6.11 首屏：班级群消息像瀑布一样往上刷，经过中间的扫描带时，重要的那几条被「捞」出来（亮起薄荷绿）；
 *      右边的周课表是立体的，跟着鼠标轻轻转。减少动态效果时只显示静止的画面 */
(function () {
  "use strict";
  var hero = document.querySelector(".v7-hero"), river = hero && hero.querySelector(".v9-river");
  if (!river) return;
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  // 群里的消息：大部分是闲聊，k 是真正要记下来的事
  var MSG = [
    ["收到"], ["+1"], ["班长", "@全体成员 明天早八点名，别迟到", 1], ["[图片]"], ["有人带伞吗"], ["收到收到"],
    ["学委", "高数第三章习题 周四 22:00 前交", 1], ["哈哈哈哈哈"], ["[表情]"], ["B302 还是 B203？"], ["1"],
    ["体委", "体测改到周五下午 2 点，东操场", 1], ["好的"], ["谁有线代笔记"], ["收到～"], ["晚上有人去图书馆吗"],
    ["辅导员", "下周一、周二晚上不上晚自习", 1], ["[语音] 0:12"], ["收到谢谢班长"], ["老师说明天交吗？"],
    ["班委", "运动会报名周三 18:00 截止", 1], ["[链接] 四六级报名入口"], ["笑死"], ["收到"], ["组长", "实验报告模板发群文件了，周日前交", 1],
    ["明天几点集合"], ["👍"], ["收到+1"],
  ];
  var cols = river.querySelectorAll(".v9-col");
  cols.forEach(function (col, ci) {
    var track = document.createElement("div"); track.className = "v9-track";
    // 每一列从不同的位置开始，看起来不重复；内容放两遍，往上滚一半正好接上
    var list = MSG.slice(ci * 9).concat(MSG.slice(0, ci * 9));
    var html = list.map(function (m) {
      return '<p class="v9-b' + (m[2] ? " key" : "") + '">' + (m.length > 1 ? "<b>" + m[0] + "</b>" + m[1] : m[0]) + (m[2] ? '<i>✓ 已整理</i>' : "") + "</p>";
    }).join("");
    track.innerHTML = html + html;
    col.appendChild(track);
  });
  if (reduce) { hero.classList.add("v9-still"); return; }

  // 经过扫描带的重要消息：亮起来
  var band = river.querySelector(".v9-band"), keys = river.querySelectorAll(".v9-b.key"), visible = true, timer = 0;
  function check() {
    var r = band.getBoundingClientRect(), top = r.top - 6, bot = r.bottom + 6;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i].getBoundingClientRect(), mid = (k.top + k.bottom) / 2;
      if (mid > top && mid < bot) keys[i].classList.add("hit");
      else if (k.bottom < top) keys[i].classList.add("past");
      if (k.top > bot && keys[i].classList.contains("past")) keys[i].classList.remove("hit", "past");   // 转了一圈回到下面：重新来
    }
  }
  function run(on) { clearInterval(timer); hero.classList.toggle("v9-pause", !on); if (on) timer = setInterval(check, 140); }
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; run(visible && !document.hidden); }).observe(hero);
  document.addEventListener("visibilitychange", function () { run(visible && !document.hidden); });
  run(true);

  // 鼠标移动：课表跟着轻轻转（只在有鼠标的设备上）
  if (window.matchMedia && matchMedia("(pointer: fine)").matches) {
    var raf = 0, tx = 0, ty = 0;
    hero.addEventListener("pointermove", function (e) {
      var r = hero.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 2; ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; hero.style.setProperty("--px", tx.toFixed(3)); hero.style.setProperty("--py", ty.toFixed(3)); });
    });
    hero.addEventListener("pointerleave", function () { hero.style.setProperty("--px", 0); hero.style.setProperty("--py", 0); });
  }
})();
