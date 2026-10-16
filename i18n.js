/* =========================================================================
 * 捞捞课程表 · 中英文切换（5.7.0）
 *   · 默认跟浏览器语言：中文浏览器显示中文，其他显示英文；点「EN / 中文」切换后记住选择
 *   · 英文时加载 i18n-en.js 词典，把页面上的中文按词典换成英文（包括后来动态出现的内容）
 *   · 网址加 ?lang=en / ?lang=zh 可以直接指定
 *   · 不翻译输入框里的内容、用户写的文字里没有收进词典的部分保持原样
 *   放在 <head> 最前面（在其他脚本之前）
 * ========================================================================= */
(function () {
  "use strict";
  var LS = "cc_lang", VER = "20261016-v582";
  function pick() {
    try {
      var q = (location.search.match(/[?&]lang=(en|zh)\b/) || [])[1];
      if (q) { localStorage.setItem(LS, q); return q; }
      var v = localStorage.getItem(LS);
      if (v === "en" || v === "zh") return v;
    } catch (e) {}
    var n = (navigator.languages && navigator.languages[0]) || navigator.language || "zh";
    return /^zh/i.test(n) ? "zh" : "en";
  }
  var lang = pick();
  var api = window.CCLang = {
    lang: lang,
    set: function (l) { try { localStorage.setItem(LS, l); } catch (e) {} location.reload(); },
    toggle: function () { api.set(lang === "en" ? "zh" : "en"); },
    t: function (s) { return s; },
  };
  // 页面上 data-lang-toggle 的按钮：点一下切换
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-lang-toggle]");
    if (b) { e.preventDefault(); api.toggle(); }
  });
  function paintToggles(root) {
    var list = (root || document).querySelectorAll ? (root || document).querySelectorAll("[data-lang-toggle]") : [];
    for (var i = 0; i < list.length; i++) { list[i].textContent = lang === "en" ? "中文" : "EN"; list[i].setAttribute("data-noi18n", ""); list[i].title = lang === "en" ? "切换到中文" : "Switch to English"; }
  }
  document.addEventListener("DOMContentLoaded", function () { paintToggles(); });
  var css = document.createElement("style");
  css.textContent = "button.lang-btn{cursor:pointer;font:inherit;font-weight:700;letter-spacing:.3px}" +
    ".s-header-actions button.lang-btn{background:none;border:1px solid var(--edge,#dedfd7);border-radius:8px;padding:6px 11px;color:inherit}" +
    ".lg-lang{margin-left:auto;background:none;border:1px solid rgba(127,127,127,.35);border-radius:8px;padding:5px 10px;color:inherit;font-size:13px}";
  (document.head || document.documentElement).appendChild(css);
  if (lang !== "en") return;

  document.documentElement.lang = "en";
  document.documentElement.classList.add("lang-en");
  // 词典到了、第一遍翻译做完之前先不显示，免得中文闪一下（最多等 1.5 秒）
  var hide = document.createElement("style");
  hide.textContent = "body{visibility:hidden!important}";
  document.head.appendChild(hide);
  var reveal = function () { if (hide.parentNode) hide.parentNode.removeChild(hide); };
  setTimeout(reveal, 1500);
  document.write('<script src="i18n-en.js?v=' + VER + '"><\/script>');

  var CJK = /[一-鿿]/;
  var X = null, P = null, cache = new Map();
  var DAY = { "一": "Mon", "二": "Tue", "三": "Wed", "四": "Thu", "五": "Fri", "六": "Sat", "日": "Sun", "天": "Sun" };
  // 词典里没有的：把日期、星期、第几周 / 节、常见量词换掉，全部换完没有中文了才用
  var TOKENS = [
    [/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, "$2/$3/$1"],
    [/(\d{4})\s*年\s*(\d{1,2})\s*月/g, "$2/$1"],
    [/(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, "$1/$2"],
    [/(\d{1,2})\s*月/g, "M$1"],
    [/(?:星期|周)([一二三四五六日天])/g, function (m, d) { return DAY[d]; }],
    [/(^|[\s(（])([一二三四五六日])(?=\s*[·)）,，]|\s*$)/g, function (m, p, d) { return p + DAY[d]; }],
    [/第\s*(\d+)\s*[-–~]\s*(\d+)\s*节/g, "P$1–$2"],
    [/第\s*(\d+)\s*节/g, "P$1"],
    [/第\s*(\d+)\s*周/g, "Wk $1"],
    [/第\s*(\d+)\s*名/g, "#$1"],
    [/(\d+)\s*门课?/g, "$1 courses"], [/(\d+)\s*节课/g, "$1 classes"], [/(\d+)\s*节/g, "$1 periods"],
    [/(\d+)\s*项/g, "$1 items"], [/(\d+)\s*件事?/g, "$1 things"], [/(\d+)\s*条/g, "$1"], [/(\d+)\s*个/g, "$1"],
    [/(\d+)\s*分钟/g, "$1 min"], [/(\d+)\s*小时/g, "$1 h"], [/(\d+)\s*天/g, "$1 days"], [/(\d+)\s*秒/g, "$1 s"], [/(\d+)\s*周/g, "$1 wk"],
    [/(\d+)\s*人/g, "$1 people"], [/(\d+)\s*分(?![数钟])/g, "$1 min"], [/(\d+)\s*次/g, "$1×"],
    [/今天/g, "Today"], [/明天/g, "Tomorrow"], [/昨天/g, "Yesterday"], [/后天/g, "In 2 days"], [/本周/g, "This week"], [/下周/g, "Next week"], [/上周/g, "Last week"],
    [/上午/g, "AM "], [/下午/g, "PM "], [/晚上/g, "Evening "], [/中午/g, "Noon "], [/全天/g, "All day"], [/截止/g, " due"], [/已过期/g, "overdue"], [/过期/g, "overdue"],
    [/作业/g, "Homework"], [/通知/g, "Notice"], [/会议/g, "Meeting"], [/活动/g, "Event"], [/考试/g, "Exam"], [/课程/g, "Course"], [/地点/g, "Place"], [/老师/g, "Teacher"],
    [/更新/g, " updated"], [/单周?/g, " odd"], [/双周?/g, " even"], [/至/g, "–"], [/到/g, "–"],
    [/，/g, ", "], [/；/g, "; "], [/：/g, ": "], [/、/g, ", "], [/。/g, ". "], [/（/g, " ("], [/）/g, ")"], [/「|」|『|』/g, "\""], [/！/g, "!"], [/？/g, "?"],
  ];
  function tokens(s) {
    var o = s;
    for (var i = 0; i < TOKENS.length; i++) o = o.replace(TOKENS[i][0], TOKENS[i][1]);
    o = o.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?)])/g, "$1").trim();
    return CJK.test(o) ? null : o;
  }
  function compile() {
    P = (window.CC_EN.p || []).map(function (p) {
      var order = [];
      var src = p[0].replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{(\d+)\}/g, function (m, a) { order.push(a); return "([\\s\\S]+?)"; });
      return { re: new RegExp("^" + src + "$"), order: order, out: p[1] };
    });
  }
  function tr(core) {
    if (!core || !CJK.test(core)) return null;
    var v = X[core];
    if (v != null) return v;
    if (cache.has(core)) return cache.get(core);
    var res = null;
    for (var i = 0; i < P.length && res == null; i++) {
      var m = P[i].re.exec(core);
      if (!m) continue;
      var map = {};
      for (var k = 0; k < P[i].order.length; k++) { var g = m[k + 1]; map[P[i].order[k]] = CJK.test(g) ? (tr(g.trim()) || tokens(g) || g) : g; }
      res = P[i].out.replace(/\{(\d+)\}/g, function (mm, n) { return map[n] != null ? map[n] : mm; });   // 填进去的名字、课程名可以是中文
    }
    if (res == null) { var pm = /^([\s\S]*?)([.。!！?？:：…]+)$/.exec(core); if (pm && pm[1] && X[pm[1]] != null) res = X[pm[1]] + pm[2].replace(/。/g, ".").replace(/！/g, "!").replace(/？/g, "?").replace(/：/g, ":"); }
    // 前面带符号 / 表情（「＋ 阅读 30 分钟」「🎯 四象限法」）：只翻后面的中文
    if (res == null) { var px = /^([^\w\u4e00-\u9fff]+)([\s\S]+)$/.exec(core); if (px && px[1].trim()) { var r2 = X[px[2]] != null ? X[px[2]] : null; if (r2 != null) res = px[1] + r2; } }
    // 由几段拼起来的提示（「同步失败：…（稍后自动重试）」）：按标点拆开，每段都认得才用
    if (res == null && /[：；（）]/.test(core)) {
      var segs = core.split(/(：|；|（[^）]*）)/), ok = true, outp = "";
      for (var s = 0; s < segs.length && ok; s++) {
        var seg = segs[s]; if (!seg) continue;
        if (seg === "：") { outp += ": "; continue; }
        if (seg === "；") { outp += "; "; continue; }
        var inner = /^（([^）]*)）$/.exec(seg);
        var t2 = inner ? (X[inner[1]] != null ? X[inner[1]] : X[seg] != null ? X[seg].replace(/^\(|\)$/g, "") : null) : (X[seg.trim()] != null ? X[seg.trim()] : (X[seg.trim() + "："] != null ? X[seg.trim() + "："].replace(/:\s*$/, "") : null));
        if (t2 == null && !CJK.test(seg)) t2 = seg;
        if (t2 == null) ok = false; else outp += inner ? " (" + t2 + ")" : t2;
      }
      if (ok && outp) res = outp.replace(/:\s*:\s*/g, ": ").replace(/\s{2,}/g, " ").trim();
    }
    if (res == null) res = tokens(core);
    if (cache.size > 6000) cache.clear();
    cache.set(core, res);
    return res;
  }
  api.t = function (s) {
    if (!X || s == null) return s;
    var str = String(s), m = /^(\s*)([\s\S]*?)(\s*)$/.exec(str), core = m[2].replace(/\s+/g, " ");
    var o = tr(core);
    if (o != null) return m[1] + o + m[3];
    // 多行的提示（alert / confirm）：一行行翻
    if (/\n/.test(str)) return str.split("\n").map(function (l) { var c = l.trim(); var x = c && tr(c.replace(/\s+/g, " ")); return x != null && x !== false && c ? l.replace(c, x) : l; }).join("\n");
    return str;
  };

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1, TITLE: 0 };
  var done = new WeakMap();   // 文本节点 → 我们写进去的英文（下次看到一样的就跳过）
  function skipEl(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
      if (SKIP[e.tagName] || e.isContentEditable || e.hasAttribute("data-noi18n")) return true;
      if (e.classList && (e.classList.contains("av") || e.classList.contains("mavatar") || e.classList.contains("cb-badge") || e.classList.contains("h6-av"))) return true;   // 头像里的字是名字的第一个字
    }
    return false;
  }
  function doText(n) {
    var d = n.data;
    if (!d || !CJK.test(d) || done.get(n) === d) return;
    if (skipEl(n.parentNode)) return;
    var o = api.t(d);
    if (o !== d) { done.set(n, o); n.data = o; }
  }
  var ATTRS = ["placeholder", "title", "aria-label", "alt", "data-tip"];
  function doAttrs(el) {
    if (el.hasAttribute("data-noi18n")) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute(ATTRS[i]);
      if (v && CJK.test(v)) { var o = api.t(v); if (o !== v) el.setAttribute(ATTRS[i], o); }
    }
    if (el.tagName === "INPUT" && /^(button|submit|reset)$/i.test(el.type) && CJK.test(el.value)) el.value = api.t(el.value);
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (SKIP[root.tagName]) return; doAttrs(root); }
    var tw = document.createTreeWalker(root, 5 /* 元素 + 文字 */, null);
    var n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) doText(n);
      else if (!SKIP[n.tagName]) doAttrs(n);
    }
  }
  function doTitle() { if (CJK.test(document.title)) { var o = api.t(document.title); if (o !== document.title) document.title = o; } }

  var pending = new Set(), queued = false;
  function flush() {
    queued = false;
    var list = Array.from(pending); pending.clear();
    for (var i = 0; i < list.length; i++) if (list[i].isConnected !== false) walk(list[i]);
    doTitle();
  }
  function queue(n) { pending.add(n); if (!queued) { queued = true; Promise.resolve().then(flush); } }

  api._start = function () {
    X = (window.CC_EN && window.CC_EN.x) || {};
    compile();
    // 弹窗里的提示也翻
    var A = window.alert, C = window.confirm, PR = window.prompt;
    window.alert = function (m) { return A.call(window, api.t(m)); };
    window.confirm = function (m) { return C.call(window, api.t(m)); };
    window.prompt = function (m, d) { return PR.call(window, api.t(m), d); };
    var go = function () {
      walk(document.body); doTitle(); paintToggles(); reveal();
      new MutationObserver(function (ms) {
        for (var i = 0; i < ms.length; i++) {
          var m = ms[i];
          if (m.type === "characterData") queue(m.target);
          else if (m.type === "attributes") queue(m.target);
          else for (var k = 0; k < m.addedNodes.length; k++) queue(m.addedNodes[k]);
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(["value"]) });
      var t = document.querySelector("title");
      if (t) new MutationObserver(doTitle).observe(t, { childList: true, characterData: true, subtree: true });
    };
    if (document.body && document.readyState !== "loading") go();
    else document.addEventListener("DOMContentLoaded", go);
  };
})();
