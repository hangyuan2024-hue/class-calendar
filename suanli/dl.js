/* 捞捞算力通用版的下载按钮：读 download/grid-open-version.json；在国内（中国时区）有国内地址就走国内，没有就走 GitHub */
(function () {
  "use strict";
  var cn = false;
  try { cn = /^Asia\/(Shanghai|Chongqing|Chungking|Harbin|Urumqi|Kashgar)$|^PRC$/.test(Intl.DateTimeFormat().resolvedOptions().timeZone || ""); } catch (e) {}
  var pick = function (x) { return x ? (cn && /^https:\/\//.test(x.cn || "") ? x.cn : /^https:\/\//.test(x.url || "") ? x.url : null) : null; };
  var mb = function (n) { return n ? " · 约 " + Math.max(1, Math.round(n / 1048576)) + " MB" : ""; };
  fetch("../download/grid-open-version.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (v) {
    if (!v) return;
    var c = document.getElementById("slClient"), s = document.getElementById("slServer"), u;
    if (c && (u = pick(v))) c.href = u;
    if (s && (u = pick(v.server))) s.href = u;
    var cm = document.getElementById("slClientMeta"), sm = document.getElementById("slServerMeta");
    if (cm && v.version) cm.textContent = "第 " + v.version + " 版" + mb(v.size) + " · Windows 10 / 11 · 64 位。安装时如果 Windows 提示「已保护你的电脑」，点「更多信息 → 仍要运行」。";
    if (sm && v.version && v.server) sm.textContent = "LaolaoGrid-Open-Server.zip · 第 " + v.version + " 版" + mb(v.server.size);
  }).catch(function () {});
})();
