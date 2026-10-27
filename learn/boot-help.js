/* boot-help.js —— 捞捞学习（思维导图、课内学习）打不开时的说明卡片（7.6.1）
 * 网页版要用浏览器的 Service Worker 在本机跑后台、存数据。下面几种情况会打不开，这里说清楚原因和怎么办：
 *   nosw   浏览器不支持：最常见的是 iPhone 上微信 / QQ / 夸克 / UC 等 App 里直接打开的网页，还有无痕模式、很旧的浏览器
 *   stuck  第一次准备很久还没好（网络慢，组件约 1MB）
 *   loop   刷新了好几次还是没生效（有的国产浏览器的极速 / 省流 / 广告过滤模式会拦）
 *   error  注册失败（带浏览器给的原因）
 *   broken 30 秒还没加载完、有文件没下载下来、或者页面一片空白（带诊断信息 + 「修复后重试」）
 * 由 mindmap/js/web-boot.js 和 courses/site-pre.js 按需加载：window.LearnBootHelp.show({ tool, why, err }) */
(function () {
  "use strict";
  var ua = navigator.userAgent || "";
  var IOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var APP = /MicroMessenger/i.test(ua) ? "微信" : /\bQQ\//i.test(ua) ? "QQ" : /DingTalk/i.test(ua) ? "钉钉" : /Weibo/i.test(ua) ? "微博" : /AlipayClient/i.test(ua) ? "支付宝"
    : /baiduboxapp/i.test(ua) ? "百度" : /Quark/i.test(ua) ? "夸克" : /UCBrowser/i.test(ua) ? "UC 浏览器" : /MQQBrowser/i.test(ua) && IOS ? "QQ 浏览器" : "";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var CSS = ".lbh{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:#f4f6fb;font:15px/1.75 -apple-system,'PingFang SC','Microsoft YaHei',system-ui,sans-serif;color:#1d2a3a;visibility:visible!important}" +
    ".lbh-card{width:min(460px,100%);box-sizing:border-box;padding:26px 24px 22px;border-radius:20px;background:#fff;box-shadow:0 24px 60px -30px #1d2a5a66;border:1px solid #e4e9f2}" +
    ".lbh h2{margin:0 0 10px;font-size:19px;line-height:1.4}.lbh p{margin:0 0 10px;color:#46566b}.lbh ol{margin:0 0 12px;padding-left:1.3em;color:#46566b}.lbh b{color:#1d2a3a}" +
    ".lbh small{display:block;margin-top:6px;color:#8a97a8;font-size:12px;word-break:break-all}.lbh-act{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}" +
    ".lbh-act button,.lbh-act a{flex:1 1 auto;min-height:44px;padding:0 16px;border-radius:12px;border:1px solid #d5ddeb;background:#fff;color:#1d2a3a;font:inherit;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}" +
    ".lbh-act .pri{background:#4c6fff;border-color:transparent;color:#fff}";

  function show(o) {
    o = o || {};
    var tool = o.tool || "捞捞学习", why = o.why || "error", err = o.err ? String(o.err && o.err.message || o.err) : "";
    var title = "", body = "", act = '<button type="button" class="pri" data-lbh="retry">重试</button><a href="' + esc(new URL("../", location.href).href) + '">回到捞捞学习</a>';
    if (why === "nosw" && APP) {
      title = "请在浏览器里打开" + tool;
      body = "<p>在<b>" + APP + "</b>里直接打开的网页不能在手机上保存数据，" + tool + "没法使用。</p>" +
        "<ol><li>点右上角的 <b>「···」</b></li><li>选 <b>「在浏览器打开」</b>" + (IOS ? "（iPhone 会用 Safari 打开）" : "") + "</li></ol>" +
        "<p>也可以复制链接，粘贴到 Safari、Chrome 或 Edge 里打开。</p>";
      act = '<button type="button" class="pri" data-lbh="copy">复制链接</button>';
    } else if (why === "nosw") {
      title = "这个浏览器用不了" + tool;
      body = "<p>" + tool + "要在浏览器里保存数据，这个浏览器不支持（可能是<b>无痕 / 隐私模式</b>，或者浏览器版本太旧）。</p>" +
        "<p>请关掉无痕模式，或者换用新版 <b>Chrome、Edge、Safari</b> 打开。</p>";
      act = '<button type="button" class="pri" data-lbh="copy">复制链接</button>';
    } else if (why === "stuck") {
      title = "还在准备" + tool + "……";
      body = "<p>第一次打开要下载约 1MB 的组件，网络慢的时候会久一点。可以再等一会儿，或者点「重试」。</p>" +
        "<p>一直卡在这里的话：检查一下是不是开了<b>省流量 / 极速模式</b>或广告过滤，关掉后再试；也可以换用 Chrome、Edge、Safari。</p>";
    } else if (why === "loop") {
      title = tool + "的存储组件没能生效";
      body = "<p>页面已经刷新了几次，浏览器还是没让组件接管页面。有的浏览器的<b>极速 / 省流量 / 广告过滤</b>模式，或者<b>禁止网站存储数据</b>的设置会这样。</p>" +
        "<ol><li>关掉上面这些模式或设置，再点「重试」</li><li>还不行就换用新版 <b>Chrome、Edge、Safari</b></li></ol>";
    } else if (why === "broken") {
      var d = o.diag || {}, secs = Math.round((Date.now() - (d.t0 || Date.now())) / 1000);
      title = tool + "没能完整加载";
      body = "<p>页面的一部分文件没下载下来，或者运行出错了，所以是一片空白。常见原因：<b>网络连网站服务器（在海外）不稳定</b>，或者浏览器里还留着旧版本的组件。</p>" +
        "<ol><li>先点「修复后重试」（会清掉旧组件，<b>不会删你的导图和资料</b>）</li><li>还不行：换个网络（比如手机热点）再试</li></ol>";
      var info = [];
      info.push("已等 " + secs + " 秒 · 页面状态 " + document.readyState);
      try { var c = navigator.serviceWorker && navigator.serviceWorker.controller; info.push("组件 " + (c ? c.scriptURL.replace(location.origin, "") : "未接管")); } catch (x) {}
      (d.fails || []).slice(0, 6).forEach(function (f) { info.push("没加载出来：" + f); });
      (d.errs || []).slice(0, 4).forEach(function (f) { info.push("出错：" + f); });
      info.push(navigator.userAgent.replace(/^Mozilla\/5\.0 /, "").slice(0, 140));
      body += '<small>截图发给我们可以帮你查原因：<br>' + info.map(esc).join("<br>") + "</small>";
      act = '<button type="button" class="pri" data-lbh="repair">修复后重试</button><button type="button" data-lbh="retry">直接刷新</button>';
    } else {
      title = tool + "没能准备好";
      body = "<p>浏览器没能装好" + tool + "的存储组件。请刷新重试；无痕 / 隐私模式下用不了。</p>";
    }
    if (err) body += "<small>浏览器给的原因：" + esc(err) + "</small>";
    if (!document.getElementById("lbhCss")) { var st = document.createElement("style"); st.id = "lbhCss"; st.textContent = CSS; (document.head || document.documentElement).appendChild(st); }
    var old = document.getElementById("lbh"); if (old) old.remove();
    var box = document.createElement("div"); box.id = "lbh"; box.className = "lbh"; box.setAttribute("role", "alertdialog"); box.setAttribute("aria-labelledby", "lbhT");
    box.innerHTML = '<div class="lbh-card"><h2 id="lbhT">' + esc(title) + "</h2>" + body + '<div class="lbh-act">' + act + "</div></div>";
    var mount = function () { (document.body || document.documentElement).appendChild(box); };
    if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-lbh]"); if (!b) return;
      var k = b.getAttribute("data-lbh");
      if (k === "retry") { try { sessionStorage.removeItem("learn_boot_n"); } catch (x) {} location.reload(); }
      if (k === "repair") {
        b.disabled = true; b.textContent = "正在修复…";
        // 只注销捞捞学习的组件、清掉网页缓存；浏览器里的导图和课内数据（IndexedDB）不动
        var jobs = [];
        try { if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.filter(function (r) { return /\/learn\//.test(r.scope); }).map(function (r) { return r.unregister(); })); })); } catch (x) {}
        try { if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (n) { return !/^laolao-promo/.test(n); }).map(function (n) { return caches.delete(n); })); })); } catch (x) {}
        try { sessionStorage.removeItem("learn_boot_n"); } catch (x) {}
        Promise.all(jobs).catch(function () {}).then(function () { location.reload(); });
      }
      if (k === "copy") {
        var done = function () { b.textContent = "已复制，去浏览器里粘贴打开"; };
        var url = location.href;
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { fallback(url); done(); });
        else { fallback(url); done(); }
      }
    });
  }
  function fallback(t) {
    try { var a = document.createElement("textarea"); a.value = t; a.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(a); a.select(); document.execCommand("copy"); a.remove(); } catch (e) {}
  }
  window.LearnBootHelp = { show: show, inApp: APP };
})();
