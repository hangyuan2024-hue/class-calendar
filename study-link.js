/* study-link.js —— 课程表里的「学习」搬到了捞捞学习（learn/courses/，合作队伍「课内」的最新版）
 * 这里只留两件事：
 *   1. 点「学习」/「课内学习」在本页里打开捞捞学习的课内学习（iframe，不跳出去）
 *   2. 课内学习里有截止日期的考核，照旧出现在首页、日历和作业提醒里（课内学习同步到账号的 /meta/due.json）
 * 依赖 app.js 里的 currentUser、renderAll、load、save（和原来的 study.js 一样）。 */
(function () {
  "use strict";
  var LS = "learn_due_cache_v1", URL_COURSES = "learn/courses/";
  var cache = (function () { try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) { return null; } })();
  var me = function () { return typeof currentUser !== "undefined" && currentUser ? currentUser : null; };
  var mine = function () { return !!(cache && me() && cache.uid === me().id); };
  var lastFetch = 0, loading = false;

  window.studyItems = function () {
    if (!mine()) return [];
    return (cache.items || []).map(function (a) {
      return { _key: "kn" + a.course_id + "_" + a.id, _study: a.course_id + ":" + a.id, id: "kn" + a.course_id + "_" + a.id, msg_type: "考核",
        subject: (a.course ? a.course + " · " : "") + a.title, summary: a.requirement || "", event_time: String(a.deadline).slice(0, 10), location: "", _studyCourse: a.course || "" };
    });
  };
  // 课内学习嵌在「学习」这一页里（iframe，和思维导图一样），不再跳出去
  var SRC = URL_COURSES + "index.html?host=app", frame = null, wantHash = "";
  function ensure() {
    var box = document.getElementById("studyBox"); if (!box) return null;
    if (!frame) {
      frame = document.createElement("iframe");
      frame.className = "study-frame"; frame.title = "课内学习";
      frame.setAttribute("allow", "clipboard-read; clipboard-write; camera");
      frame.src = SRC + (wantHash ? "#" + wantHash : ""); wantHash = "";
      box.innerHTML = ""; box.appendChild(frame);
    }
    return frame;
  }
  window.openStudyItem = function (ref) {
    var h = /^\d+:\d+$/.test(String(ref || "")) ? "open=assessment:" + ref : "";
    if (frame && h) { try { frame.contentWindow.location.hash = h; } catch (e) { frame.src = SRC + "#" + h; } }
    else if (!frame) wantHash = h;
    if (typeof showView === "function") showView("study"); else ensure();
  };
  window.renderStudy = function () { ensure(); };

  async function refresh() {
    var u = me(); if (!u || loading || typeof CCAuth === "undefined") return;
    loading = true;
    try {
      var got = (await CCAuth.rpc("learn_fs_get", { p_paths: ["/meta/due.json"] })) || [];
      var data = { items: [] };
      if (got[0] && got[0].data) {
        var bin = atob(got[0].data), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        data = JSON.parse(new TextDecoder().decode(bytes)) || { items: [] };
      }
      var next = { uid: u.id, at: Date.now(), items: Array.isArray(data.items) ? data.items : [] };
      var changed = !cache || cache.uid !== next.uid || JSON.stringify(cache.items) !== JSON.stringify(next.items);
      cache = next; lastFetch = Date.now();
      try { localStorage.setItem(LS, JSON.stringify(cache)); } catch (e) {}
      if (changed) { try { renderAll(); } catch (e) {} }
    } catch (e) { /* 服务器还没开通账号备份（learn_files.sql）：没有考核可显示，不打扰 */ lastFetch = Date.now(); }
    finally { loading = false; }
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && me() && Date.now() - lastFetch > 60000) refresh(); });
  var lastUid = null;
  setInterval(function () {
    var u = me() ? me().id : null;
    if (u !== lastUid) { lastUid = u; if (u) refresh(); else { try { renderAll(); } catch (e) {} } }
  }, 1500);
})();
