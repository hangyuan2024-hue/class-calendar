/* ui-icons.js —— 捞捞自己画的一套线性图标（24×24，线宽 1.8，圆角端点），替换页面里当图标用的系统表情（emoji）
 * 系统表情在不同电脑、手机上长得不一样，也不是我们自己的设计；这里的图标全部手写 SVG 路径，可以随便用。
 * 用法：在图标位置放 <span class="ic" data-icon="settings"></span>，或者原来写着表情的图标位置，会自动换成同义的图标。
 * window.ccIcon(name) 返回 SVG 字符串。 */
(function () {
  "use strict";
  var P = {
    home: "M4 11.2 12 4.5l8 6.7V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.2H9v5.2H5.5A1.5 1.5 0 0 1 4 19z",
    user: "M12 12.2a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2zM4.5 20.3c.9-3.6 3.9-5.6 7.5-5.6s6.6 2 7.5 5.6",
    users: "M9 11.5a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM2.8 19.8c.7-3.1 3.2-4.9 6.2-4.9s5.5 1.8 6.2 4.9M15.6 4.6a3.4 3.4 0 0 1 0 6.6M17.4 14.9c2 .5 3.4 2.2 3.9 4.6",
    settings: "M12 8.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6zM10.3 3.2h3.4l.5 2.4 1.7 1 2.3-.8 1.7 2.9-1.8 1.6v2l1.8 1.6-1.7 2.9-2.3-.8-1.7 1-.5 2.4h-3.4l-.5-2.4-1.7-1-2.3.8-1.7-2.9 1.8-1.6v-2L4.1 8.7l1.7-2.9 2.3.8 1.7-1z",
    sliders: "M5 6h9M18 6h1M5 12h3M12 12h7M5 18h11M20 18h-1M16 4v4M10 10v4M18 16v4",
    palette: "M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.9-.8 1.9-1.7 0-1.2-1-1.6-1-2.6 0-.9.7-1.6 1.7-1.6h2.1a3.8 3.8 0 0 0 3.8-3.8C20.5 6.8 16.7 3.5 12 3.5zM7.6 12.3h.01M9.4 8.1h.01M14 7.4h.01M17 10.3h.01",
    sun: "M12 16.2a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4zM12 2.8v1.8M12 19.4v1.8M2.8 12h1.8M19.4 12h1.8M5.5 5.5l1.3 1.3M17.2 17.2l1.3 1.3M5.5 18.5l1.3-1.3M17.2 6.8l1.3-1.3",
    moon: "M19.6 14.6A8 8 0 0 1 9.4 4.4a8 8 0 1 0 10.2 10.2z",
    monitor: "M3.8 5.5h16.4v10.3H3.8zM9 20h6M12 15.8V20",
    help: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.6M12 16.6h.01",
    logout: "M14 4.5H6.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5H14M10 12h10M16.5 8.5 20 12l-3.5 3.5",
    chart: "M4 19.5h16M6.5 15.5l4-4.5 3 2.6 5-6.1M15.5 7.5h3v3",
    bars: "M4 19.5h16M7 16.5V11M11.5 16.5V6.5M16 16.5v-4",
    pet: "M12 20.3c3.6 0 6.3-2.7 6.3-6.6C18.3 8.9 15.6 3.8 12 3.8S5.7 8.9 5.7 13.7c0 3.9 2.7 6.6 6.3 6.6zM9.6 12.4h.01M14.4 12.4h.01M10.6 15.4c.8.6 2 .6 2.8 0M6 10.5l2.3.8M18 10.5l-2.3.8",
    trophy: "M8 4.5h8v4.8a4 4 0 0 1-8 0zM8 6.2H5.2c0 2.6 1.2 4.1 3.1 4.4M16 6.2h2.8c0 2.6-1.2 4.1-3.1 4.4M12 13.3v3.2M8.8 20h6.4M9.8 16.5h4.4l.6 3.5H9.2z",
    medal: "M8.5 3.8 12 9.5l3.5-5.7M6.4 3.8h4M13.6 3.8h4M12 20.5a5.3 5.3 0 1 0 0-10.6 5.3 5.3 0 0 0 0 10.6zM12 12.6l.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z",
    target: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 16.2a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4zM12 12h.01M12 12l7-7M16.5 4.5H19.5v3",
    books: "M4.5 5h4v14.5h-4zM8.5 5h4v14.5h-4zM13.3 5.6l3.8-1 3.6 13.6-3.8 1zM4.5 8.5h4M8.5 8.5h4M8.5 16h4",
    book: "M4.5 5.5c2.6-1.3 5.2-1.1 7.5.6 2.3-1.7 4.9-1.9 7.5-.6v13c-2.6-1.3-5.2-1.1-7.5.6-2.3-1.7-4.9-1.9-7.5-.6zM12 6.1v13",
    notebook: "M6.5 3.8h11a1.5 1.5 0 0 1 1.5 1.5v13.4a1.5 1.5 0 0 1-1.5 1.5h-11zM6.5 3.8v16.4M4.5 7.5h3M4.5 12h3M4.5 16.5h3M10 8h6M10 11.5h4",
    brain: "M9.3 4.3A3 3 0 0 0 5.7 7a3.2 3.2 0 0 0-1.3 5.4 3.3 3.3 0 0 0 2.4 5 3 3 0 0 0 5.2 1.8V5.6a2.6 2.6 0 0 0-2.7-1.3zM14.7 4.3A3 3 0 0 1 18.3 7a3.2 3.2 0 0 1 1.3 5.4 3.3 3.3 0 0 1-2.4 5 3 3 0 0 1-5.2 1.8M8.6 9.4c.9.2 1.6.8 1.9 1.7M15.4 9.4c-.9.2-1.6.8-1.9 1.7M8.4 14.6h1.8M13.8 14.6h1.8",
    puzzle: "M10 4.5h2.5a1.6 1.6 0 1 1 3.2 0H18v4.2a1.6 1.6 0 1 0 0 3.2v4.6h-4.2a1.6 1.6 0 1 1-3.2 0H6.5v-4.4a1.6 1.6 0 1 0 0-3.2V4.5z",
    cloud: "M7.5 18.5a4 4 0 0 1-.6-7.9 5.4 5.4 0 0 1 10.4-1.4 4.6 4.6 0 0 1-.4 9.3z",
    wifi: "M3.5 9.4a12.2 12.2 0 0 1 17 0M6.4 12.5a8 8 0 0 1 11.2 0M9.3 15.6a3.9 3.9 0 0 1 5.4 0M12 18.9h.01",
    refresh: "M19.5 12a7.5 7.5 0 0 1-13.2 4.9M4.5 12a7.5 7.5 0 0 1 13.2-4.9M17.7 3.8v3.3h-3.3M6.3 20.2v-3.3h3.3",
    globe: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM3.5 12h17M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5s-1.1 6.2-3.3 8.5c-2.2-2.3-3.3-5.1-3.3-8.5s1.1-6.2 3.3-8.5z",
    image: "M4.5 5h15v14h-15zM4.5 15.5l4.3-4.2 3.6 3.4 2.3-2.2 4.8 4.4M15 9.2h.01",
    party: "M4.5 19.5 9 7.5l7.5 7.5zM6.3 14.6l3.1 3.1M7.8 10.8l5.4 5.4M14 4.5c.6 1.4.4 2.6-.6 3.6M17.5 6.5l1.7-1M19.5 10c-1.3-.5-2.6-.3-3.7.6M18.2 3.5h.01M20.5 13.5h.01M11.2 3.8h.01",
    compass: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM15.4 8.6l-2 4.8-4.8 2 2-4.8z",
    sparkle: "M12 3.8l1.7 4.6 4.6 1.7-4.6 1.7L12 16.4l-1.7-4.6-4.6-1.7 4.6-1.7zM18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7zM5.5 15.8l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z",
    ring: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 3.5a8.5 8.5 0 0 1 8.5 8.5",
    flame: "M12 20.5c3.4 0 6-2.4 6-5.9 0-3.8-3-5.8-3.6-9.6-1.9 1.3-3 3.2-3.1 5.4-.9-.7-1.5-1.8-1.6-3.1C7.4 9.1 6 11.5 6 14.6c0 3.5 2.6 5.9 6 5.9zM12 20.5c-1.5 0-2.6-1.1-2.6-2.6 0-1.7 1.4-2.6 2.6-4.3 1.2 1.7 2.6 2.6 2.6 4.3 0 1.5-1.1 2.6-2.6 2.6z",
    robot: "M5.5 9h13v9.5h-13zM12 9V5.5M12 5.5h.01M9.3 13.2h.01M14.7 13.2h.01M9.6 15.9h4.8M3.5 12.5v3M20.5 12.5v3",
    folder: "M3.8 6.3a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2h7.2a1.5 1.5 0 0 1 1.5 1.5v9.2a1.5 1.5 0 0 1-1.5 1.5H5.3a1.5 1.5 0 0 1-1.5-1.5z",
    school: "M2.8 9.2 12 4.8l9.2 4.4L12 13.6zM6.5 11v4.8c1.6 1.5 3.4 2.2 5.5 2.2s3.9-.7 5.5-2.2V11M21.2 9.2v5",
    shield: "M12 3.6 19 6.3v5.3c0 4.3-2.9 7.6-7 8.8-4.1-1.2-7-4.5-7-8.8V6.3zM9 12l2.1 2.1L15.2 10",
    key: "M14.6 9.4a3.9 3.9 0 1 1-1.1-1.1M13.5 8.3 20 2M17 5l2.2 2.2M15.2 6.8l1.6 1.6",
    lock: "M6 10.5h12v9.5H6zM8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7M12 14.3v2.4",
    doc: "M6.5 3.8h7.3l4.2 4.2v12.2h-11.5zM13.8 3.8V8h4.2M9 12h6M9 15.5h6",
    note: "M5.5 4.5h13v15h-13zM8.5 8.5h7M8.5 12h7M8.5 15.5h4",
    heart: "M12 19.5s-7.5-4.4-7.5-9.8A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.4c0 5.4-7.5 9.8-7.5 9.8z",
    mail: "M3.8 6h16.4v12H3.8zM4.2 6.5 12 12.5l7.8-6",
    bell: "M6.2 16.5V11a5.8 5.8 0 0 1 11.6 0v5.5l1.5 1.7H4.7zM10 20.3h4",
    calendar: "M4.5 6h15v14h-15zM4.5 10h15M8.5 3.8v3.6M15.5 3.8v3.6",
    calplus: "M4.5 6h15v14h-15zM4.5 10h15M8.5 3.8v3.6M15.5 3.8v3.6M12 12.6v5M9.5 15.1h5",
    download: "M12 4v11M7.5 10.8 12 15.3l4.5-4.5M5 19.5h14",
    upload: "M12 15.3V4.3M7.5 8.5 12 4l4.5 4.5M5 19.5h14",
    eye: "M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12zM12 14.7a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4z",
    phone: "M7.5 3h9v18h-9zM11 18h2",
    laptop: "M5 5.5h14v9.5H5zM2.8 18.5h18.4l-1.2-3.5H4z",
    pencil: "M15.3 4.7l4 4L8.6 19.4l-4.6.6.6-4.6zM13.4 6.6l4 4",
    pin: "M12 20.8s6.2-5.7 6.2-10.6a6.2 6.2 0 0 0-12.4 0c0 4.9 6.2 10.6 6.2 10.6zM12 12.5a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z",
    clipboard: "M8.5 4.8H6.5v15.5h11V4.8h-2M8.5 3.5h7v3h-7zM9 11.5l2 2 4-4M9 16.5h6",
    timer: "M12 20.5a7.3 7.3 0 1 0 0-14.6 7.3 7.3 0 0 0 0 14.6zM12 9.5v3.8l2.3 1.6M10 2.8h4M18.4 6.2l1.4-1.4",
    hourglass: "M7 3.8h10M7 20.2h10M8 3.8c0 4.6 4 5.6 4 8.2s-4 3.6-4 8.2M16 3.8c0 4.6-4 5.6-4 8.2s4 3.6 4 8.2",
    megaphone: "M4 10v4h3l8 4.5V5.5L7 10zM18 9.5a3.5 3.5 0 0 1 0 5M8 14l1.2 5.2h2.5L10.6 14.5",
    news: "M4.5 5.5h12v13h-10.5a1.5 1.5 0 0 1-1.5-1.5zM16.5 9h3v8.5a1.5 1.5 0 0 1-3 0zM7.5 9h6M7.5 12.5h6M7.5 16h4",
    coin: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM14.6 8.8c-.5-.8-1.5-1.3-2.6-1.3-1.5 0-2.6.8-2.6 2s1.2 1.6 2.6 1.9 2.7.8 2.7 2.1-1.2 2-2.7 2c-1.2 0-2.2-.5-2.7-1.4M12 6v1.5M12 16.5V18",
    dice: "M5 5h14v14H5zM9 9h.01M15 9h.01M12 12h.01M9 15h.01M15 15h.01",
    check: "M5 12.5l4.3 4.3L19 7.2",
    plus: "M12 5v14M5 12h14",
    x: "M6 6l12 12M18 6 6 18",
    steps: "M4 19.5h4.5V15H13v-4.5h4.5V6H21M4 19.5V21M3 21h18",
    grad: "M2.5 9 12 4.5 21.5 9 12 13.5zM6.5 11v4.5c0 1.6 2.5 3 5.5 3s5.5-1.4 5.5-3V11M21.5 9v5",
    arrow: "M5 12h13M13 7l5 5-5 5",
    chevron: "M9 5.5l6.5 6.5L9 18.5",
    info: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 11v5.5M12 7.8h.01",
    rainbow: "M3.5 17.5a8.5 8.5 0 0 1 17 0M6.8 17.5a5.2 5.2 0 0 1 10.4 0M10 17.5a2 2 0 0 1 4 0",
    rocket: "M14.8 4.2c2.4-.6 4.4-.5 5 .1.6.6.7 2.6.1 5L13 16.1 7.9 11zM7.9 11 4.6 10.3l2.6-2.6 4.1-.2M13 16.1l.7 3.3 2.6-2.6.2-4.1M15.5 8.5h.01M6.8 17.2c-1 0-2.2.2-3 1 .8-.8 1-2 1-3"
  };
  // 系统表情 → 图标名（只认当图标用的那几个）
  var E = { "🏠": "home", "👤": "user", "👥": "users", "⚙️": "settings", "⚙": "settings", "🎛️": "sliders", "🎛": "sliders", "🎨": "palette", "🌞": "sun", "☀️": "sun", "🌙": "moon", "🖥️": "monitor", "❓": "help",
    "⎋": "logout", "📈": "chart", "📊": "bars", "🐣": "pet", "🏆": "trophy", "🏅": "medal", "🎯": "target", "📚": "books", "📖": "book", "📓": "notebook", "🧠": "brain", "🧩": "puzzle",
    "☁️": "cloud", "☁": "cloud", "📶": "wifi", "⟳": "refresh", "↻": "refresh", "🌐": "globe", "🖼": "image", "🖼️": "image", "🎉": "party", "🧭": "compass", "✨": "sparkle", "⭕": "ring", "🔥": "flame",
    "🤖": "robot", "🗂️": "folder", "🗂": "folder", "🏫": "school", "🛡️": "shield", "🛡": "shield", "🔑": "key", "🔒": "lock", "📄": "doc", "📝": "note", "💛": "heart", "📧": "mail", "✉️": "mail", "🔔": "bell",
    "📅": "calendar", "🗓️": "calendar", "📲": "calplus", "⤓": "download", "⤒": "upload", "👁": "eye", "👁️": "eye", "📱": "phone", "💻": "laptop", "✏️": "pencil", "📍": "pin", "📋": "clipboard",
    "🍅": "timer", "⏳": "hourglass", "📣": "megaphone", "📰": "news", "💰": "coin", "🎲": "dice", "🌈": "rainbow", "🚀": "rocket", "🪜": "steps", "🎓": "grad", "＋": "plus", "➕": "plus", "🔮": "sparkle", "📮": "mail", "📌": "pin", "⬇️": "download", "⬇": "download" };
  function svg(name, cls) {
    var d = P[name]; if (!d) return "";
    return '<svg class="cc-i' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  }
  window.ccIcon = svg;
  window.ccIconFor = function (emoji) { return E[String(emoji || "").trim()] || ""; };

  // 整个元素就是一个表情的图标位置
  var SLOT = ".ic, .ti, .qi, .kn-ei, .re-i, .pi, .store-item .icon, .v9-quick .ic, .lai-ic, .tile-ic, .wico, .t-ic";
  // 文字前面带一个表情的按钮 / 标题（把开头的表情换成图标）
  var LEAD = ".v9-set-btn, .rail-foot button, .cc-chip, #classBar button, #classBar .cb-sub > *, .cc-k, .cc-flow b, .cc-more, .t-home-h b, .t-home-h button, .sec-h b, .widget h4, .rank-entry b, #meCard button, .studio-top-actions .btn";
  var leadRe = /^\s*([←-⯿　-〿＋]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD00-\uDFFF])️?\s*/;
  function fix(root) {
    (root || document).querySelectorAll(SLOT).forEach(function (el) {
      if (el.dataset.icon && !el.dataset.iconDone) { el.innerHTML = svg(el.dataset.icon); el.dataset.iconDone = "1"; el.classList.add("cc-islot"); return; }
      if (el.children.length) return;
      var n = E[el.textContent.trim()];
      if (n) { el.innerHTML = svg(n); el.dataset.iconDone = "1"; el.classList.add("cc-islot"); }
    });
    (root || document).querySelectorAll(LEAD).forEach(function (el) {
      var t = el.firstChild;
      while (t && t.nodeType === 1 && t.tagName === "SVG") t = t.nextSibling;
      if (!t || t.nodeType !== 3) return;
      var m = leadRe.exec(t.nodeValue); if (!m) return;
      var n = E[m[1]] || E[m[1] + "️"]; if (!n) return;
      t.nodeValue = t.nodeValue.slice(m[0].length);
      var span = document.createElement("span"); span.className = "cc-lead"; span.innerHTML = svg(n);
      el.insertBefore(span, t);
    });
  }
  var timer = 0;
  function later() { if (!timer) timer = setTimeout(function () { timer = 0; fix(); }, 60); }
  function start() { fix(); new MutationObserver(later).observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();

  var css = document.createElement("style");
  css.textContent = ".cc-i{width:1.25em;height:1.25em;display:inline-block;vertical-align:-.25em;flex:none}" +
    ".cc-islot{display:inline-grid!important;place-items:center;color:var(--accent,#5366e8)}.cc-islot .cc-i{width:58%;height:58%;min-width:16px;min-height:16px}" +
    "[data-skin=fresh] .qbtn .qi.cc-islot,[data-skin=fresh] .ic.cc-islot,[data-skin=fresh] .ti.cc-islot,[data-skin=fresh] .pi.cc-islot{color:var(--accent,#157568)!important;opacity:1!important}.cc-islot .cc-i{stroke-width:2}" +
    ".cc-lead{display:inline-flex;margin-right:.3em;color:var(--accent,#5366e8)}.cc-lead .cc-i{width:1.1em;height:1.1em}";
  document.head.appendChild(css);
})();
