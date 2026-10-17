/* 5.9.0 「下次上课前」：记一件事 / 发布班级事项的日期下面，按课程表列出「下次××课前 · 周一 08:00」，点一下就填好截止时间。
 * 标题里写了哪门课（「数学作业」→「高等数学」），那门课排第一个。没导入课程表就不显示。
 * 依赖：nextclass.js（CCNext）、courses.js（CourseKit）、app.js（ccDate esc） */
(function () {
  "use strict";
  if (typeof CCNext === "undefined") return;
  function ctx() {
    try {
      if (typeof CourseKit === "undefined" || !CourseKit.data || !(CourseKit.data.courses || []).length) return null;
      if (CourseKit.on && !CourseKit.on()) return null;
      return { names: CourseKit.data.courses.map(function (c) { return c.name; }), coursesOn: function (k) { return CourseKit.coursesOn(k); }, now: typeof ccDate === "function" ? ccDate() : new Date() };
    } catch (e) { return null; }
  }
  window.ccNextCtx = ctx;

  var css = document.createElement("style");
  css.textContent = ".nc-chips{display:flex;gap:6px;overflow-x:auto;margin:0 0 12px;padding-bottom:2px;scrollbar-width:none}.nc-chips::-webkit-scrollbar{display:none}" +
    ".nc-chips button{flex:none;border:1px solid var(--line,#e4e6e3);background:var(--card,#fff);color:var(--text);border-radius:999px;padding:5px 11px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}" +
    ".nc-chips button.on{border-color:var(--accent,#5366e8);background:color-mix(in srgb,var(--accent,#5366e8) 12%,transparent);color:var(--accent,#5366e8)}" +
    ".nc-chips .nc-l{flex:none;align-self:center;font-size:12px;color:var(--sub);margin-right:2px}" +
    ".memo-nx{max-width:150px;font-size:12px}.memo-auto{font-size:11.5px;color:var(--accent,#5366e8);white-space:nowrap}";
  document.head.appendChild(css);

  // 一个表单：标题框、日期框、时间框，点了以后顺便把类型设成作业
  function hook(modalId, titleId, dateId, timeId, setHw) {
    var modal = document.getElementById(modalId), title = document.getElementById(titleId), date = document.getElementById(dateId), time = document.getElementById(timeId);
    if (!modal || !title || !date || !time) return;
    var box = document.createElement("div");
    box.className = "nc-chips hidden";
    (date.closest(".row") || date.parentNode).insertAdjacentElement("afterend", box);
    function paint() {
      var c = window.ccNextCtx();
      var list = c ? CCNext.choices(title.value, c, 6) : [];
      box.classList.toggle("hidden", !list.length);
      if (!list.length) { box.innerHTML = ""; return; }
      box.innerHTML = '<span class="nc-l">截止：</span>' + list.map(function (n, i) {
        var on = date.value === n.day && time.value === n.time;
        return '<button type="button" data-i="' + i + '" class="' + (on ? "on" : "") + '">📚 下次' + esc(n.name.slice(0, 8)) + "课前 · " + esc(n.text) + "</button>";
      }).join("");
      box._list = list;
    }
    box.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-i]"); if (!b || !box._list) return;
      var n = box._list[+b.dataset.i];
      date.value = n.day; time.value = n.time;
      ["input", "change"].forEach(function (t) { date.dispatchEvent(new Event(t, { bubbles: true })); time.dispatchEvent(new Event(t, { bubbles: true })); });
      if (setHw) setHw();
      paint();
    });
    var tmr = 0;
    title.addEventListener("input", function () { clearTimeout(tmr); tmr = setTimeout(paint, 200); });
    date.addEventListener("change", paint); time.addEventListener("change", paint);
    new MutationObserver(function () { if (modal.classList.contains("open")) paint(); }).observe(modal, { attributes: true, attributeFilter: ["class"] });
  }
  function init() {
    hook("modal", "fTitle", "fDate", "fTime", function () { var k = document.getElementById("fKind"); if (k) k.value = "作业"; });
    hook("cmodal", "cSubject", "cDate", "cTime", function () { var k = document.getElementById("cType"); if (k) k.value = "作业"; });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
