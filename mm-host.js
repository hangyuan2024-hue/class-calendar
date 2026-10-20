// 6.5 捞捞思维导图：用「捞捞学习」里队友做的新版（learn/mindmap/），嵌在网页版的「思维导图」页面里。
// 新版在 iframe 里跑，账号、云同步都借网页版这一层：它要调 mm_* 接口、问现在是谁，都经过这里（见 learn/mindmap/js/host-bridge.js）。
// 替换原来的 mindmap.js：外面要用的 renderMindmap / mmLeave / Mindmap.create 名字不变。
(function () {
  "use strict";
  var SRC = "learn/mindmap/index.html?host=app&v=20261020-mm3";
  var ALLOW = /^mm_(list|get|save|rename|del)$/;
  var frame = null, lastUid = "", backTo = "tools", pendingCreate = false;
  function box() { return document.getElementById("mmBox"); }
  function who() {
    var u = typeof currentUser !== "undefined" && currentUser ? currentUser : null;
    return u && u.id ? { id: u.id, name: u.display_name || u.account || "" } : null;
  }
  function post(o) { if (frame && frame.contentWindow) { o.mmb = 1; frame.contentWindow.postMessage(o, location.origin); } }
  function sendUser() { var u = who(); lastUid = u ? u.id : ""; post({ t: "user", user: u, back: true }); }
  function ensure() {
    if (frame) return;
    var b = box(); if (!b) return;
    frame = document.createElement("iframe");
    frame.className = "mm-frame"; frame.title = "捞捞思维导图"; frame.src = SRC;
    frame.setAttribute("allow", "clipboard-read; clipboard-write");
    b.innerHTML = ""; b.appendChild(frame);
  }
  window.addEventListener("message", function (ev) {
    if (!frame || ev.source !== frame.contentWindow || ev.origin !== location.origin) return;
    var d = ev.data || {};
    if (d.mmb !== 1) return;
    if (d.t === "hello") {
      sendUser();
      if (pendingCreate) { pendingCreate = false; post({ t: "create" }); }
    } else if (d.t === "rpc") {
      var id = String(d.id || "").slice(0, 40);
      if (!ALLOW.test(String(d.fn || ""))) { post({ t: "rpc-r", id: id, ok: false, error: "不支持的操作" }); return; }
      if (!who()) { post({ t: "rpc-r", id: id, ok: false, error: "请先登录" }); return; }
      CCAuth.rpc(d.fn, d.args || {}).then(function (r) { post({ t: "rpc-r", id: id, ok: true, data: r }); }, function (e) { post({ t: "rpc-r", id: id, ok: false, error: (e && e.message) || "请求失败" }); });
    } else if (d.t === "rev") {
      try { save("mm_rev_v1", { t: Date.now() }); } catch (e) {}   // 记进账号同步：手机、电脑上的捞捞就知道导图改过了
    } else if (d.t === "back") {
      if (typeof showView === "function") showView(backTo || "tools");
    }
  });
  // 别的设备改了导图
  try { Sync.onChange(function (set) { if (set && set.has && set.has("mm_rev_v1")) post({ t: "changed" }); }); } catch (e) {}
  // 登录 / 退出 / 换账号
  setInterval(function () { var u = who(), id = u ? u.id : ""; if (frame && id !== lastUid) sendUser(); }, 2000);

  window.renderMindmap = function () {
    ensure();
  };
  window.mmLeave = function () { post({ t: "leave" }); };
  window.Mindmap = { create: function () { if (frame) post({ t: "create" }); else { pendingCreate = true; ensure(); } } };
  // 记住从哪进来的，返回时回到那里
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest('[data-tab="mindmap"]');
    if (t && typeof currentView === "function") { var c = currentView(); if (c && c !== "mindmap") backTo = c; }
  }, true);
})();
