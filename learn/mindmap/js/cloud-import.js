/* cloud-import.js —— 把旧版存在账号里的导图搬到新版（6.8）
 * 旧版思维导图登录后把导图存在账号里（mm_list / mm_get）。新版暂时只存在本浏览器，
 * 所以登录过的同学第一次打开新版时，把账号里有、这台设备上没有正文的导图下载下来，放进本浏览器的「本地导图」，
 * 打开后按 Ctrl+S 就会存成新版的导图文件。每个账号在每个浏览器只做一次；账号里的原件不动。 */
(function () {
  "use strict";
  if (!window.MM_WEB || window.MM_BOOTING) return;
  var LS_IDX = "mm_index_v1", mapKey = function (id) { return "mm_map_" + id; };
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function count(m) { var n = 0; (function walk(x) { if (!x) return; n++; (x.children || []).forEach(walk); })(m && m.root); (m && m.nodes || []).forEach(function walk(x) { if (!x) return; n++; (x.children || []).forEach(walk); }); return n; }

  // 怎么问账号：嵌在课程表网页版 / 电脑版里时问外面（同一套消息协议），单独打开时直接用网站登录
  var host = (new URLSearchParams(location.search).get("host") || "").toLowerCase();
  var embedded = (host === "app" || host === "desktop") && window.parent !== window;
  function viaParent() {
    var seq = 0, waits = {}, userWait = null, origin = host === "app" ? location.origin : "*";
    window.addEventListener("message", function (ev) {
      if (ev.source !== window.parent) return;
      var d = ev.data || {}; if (d.mmb !== 1) return;
      if (d.t === "create") { var nb = document.querySelector('[data-mm="new"]'); if (nb) nb.click(); return; }   // 外面点了「新建导图」
      if (d.t === "user" && userWait) { var f = userWait; userWait = null; f(d.user && d.user.id ? d.user : null); }
      else if (d.t === "rpc-r" && waits[d.id]) { var w = waits[d.id]; delete waits[d.id]; d.ok ? w[0](d.data) : w[1](new Error(d.error || "请求失败")); }
    });
    return {
      me: function () { return new Promise(function (resolve) { userWait = resolve; window.parent.postMessage({ mmb: 1, t: "hello" }, origin); setTimeout(function () { if (userWait) { userWait = null; resolve(null); } }, 5000); }); },
      rpc: function (fn, args) { return new Promise(function (resolve, reject) { var id = "i" + (++seq); waits[id] = [resolve, reject]; window.parent.postMessage({ mmb: 1, t: "rpc", id: id, fn: fn, args: args || {} }, origin); setTimeout(function () { if (waits[id]) { delete waits[id]; reject(new Error("超时")); } }, 20000); }); },
    };
  }
  var api = embedded ? viaParent() : window.MM_CCAUTH && window.MM_CCAUTH.me ? { me: function () { return window.MM_CCAUTH.me(); }, rpc: function (f, a) { return window.MM_CCAUTH.rpc(f, a); } } : null;
  if (!api) return;

  async function run() {
    var me = null; try { me = await api.me(); } catch (e) {}
    if (!me || !me.id) return;
    var done = "mm_cloud_import_v1_" + me.id; if (lsGet(done, false)) return;
    var rows; try { rows = await api.rpc("mm_list"); } catch (e) { return; }      // 网络不好：下次打开再试
    if (!Array.isArray(rows)) return;
    var index = lsGet(LS_IDX, []), got = 0, failed = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i]; if (!r || !r.id) continue;
      if (lsGet(mapKey(r.id), null)) continue;                                   // 这台设备上已经有正文
      try {
        var x = await api.rpc("mm_get", { p_id: r.id }), m = x && x.data;
        if (!m || !(m.root || Array.isArray(m.nodes))) { failed++; continue; }
        m.id = x.id || r.id; m.title = x.title || r.title || m.title || "未命名导图";
        if (!lsSet(mapKey(m.id), m)) { failed++; break; }
        var e = { id: m.id, title: m.title, updated: Date.parse(r.updated_at) || Date.now(), nodes: count(m) || r.nodes || 0, local: true, imported: true };
        var j = index.findIndex(function (y) { return y.id === m.id; });
        if (j >= 0) index[j] = Object.assign({}, index[j], e, { fileBacked: false, fileMissing: false }); else index.push(e);
        got++;
      } catch (err) { failed++; }
    }
    index.sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
    lsSet(LS_IDX, index);
    if (!failed) lsSet(done, true);
    if (got) {
      try { sessionStorage.setItem("mm_import_note", String(got)); } catch (e) {}
      // 还在首页列表时刷新一下让它们显示出来；正在编辑就等下次打开
      var box = document.getElementById("mmBox");
      if (!box || !box.classList.contains("edit")) location.reload();
    }
  }
  window.addEventListener("load", function () {
    try { var n = sessionStorage.getItem("mm_import_note"); if (n) { sessionStorage.removeItem("mm_import_note"); if (window.showBanner) { window.showBanner("已把账号里的 " + n + " 张旧导图放进「本地导图」。打开后按 Ctrl+S 保存成新版文件。"); setTimeout(function () { window.showBanner(""); }, 9000); } } } catch (e) {}
    setTimeout(run, 1500);
  });
})();
