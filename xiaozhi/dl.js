/* 捞小智电脑版的下载按钮：读 download/xiaozhi-version.json；在国内（中国时区）有国内地址就走国内，没有就走 GitHub */
(function () {
  "use strict";
  var go = document.getElementById("xzPcGo"), meta = document.getElementById("xzPcMeta");
  if (!go) return;
  var cn = false;
  try { cn = /^Asia\/(Shanghai|Chongqing|Chungking|Harbin|Urumqi|Kashgar)$|^PRC$/.test(Intl.DateTimeFormat().resolvedOptions().timeZone || ""); } catch (e) {}
  fetch("../download/xiaozhi-version.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (v) {
    if (!v) return;
    if (cn && /^https:\/\//.test(v.cn || "")) go.href = v.cn;
    else if (/^https:\/\//.test(v.url || "")) go.href = v.url;
    if (meta && v.version) meta.textContent = "第 " + v.version + " 版" + (v.size ? " · 约 " + Math.round(v.size / 1048576) + " MB" : "") + " · Windows 10 / 11 · 64 位";
  }).catch(function () {});
})();
