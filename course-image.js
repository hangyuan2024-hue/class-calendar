// 课程表 → 一张图片（小程序和网页共用同一份文件：网页在 course-image.js，小程序在 lib/course-image.js）
// 用法：
//   const M = CourseImage.model({ title, sub, times, courses, days: 7, foot })   // courses: [{ name, day 0-6, start, end, location, teacher, weeks, color: { bg, fg, bar } }]
//   const { width, height } = CourseImage.size(M)
//   canvas 设成 width × height（再乘像素比），CourseImage.draw(ctx, M)
// 只用 Canvas 2D 最基础的接口（fillRect / arcTo / fillText / measureText），小程序的 type="2d" 画布和浏览器都能画。
(function (root) {
  "use strict";
  var DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  var W = 1080, PAD = 40, HEAD = 176, DAYH = 64, PCOL = 104, ROW = 112, FOOT = 72;
  var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif';

  function model(o) {
    o = o || {};
    var courses = (o.courses || []).filter(function (c) { return c && c.name && c.day >= 0 && c.day <= 6 && c.start >= 1; });
    var weekend = courses.some(function (c) { return +c.day >= 5; });
    var ndays = o.days || (weekend ? 7 : 5);
    var times = o.times || [];
    var nper = Math.max(times.length >= 4 ? times.length : 0, 8);
    courses.forEach(function (c) { nper = Math.max(nper, +c.end || +c.start); });
    nper = Math.min(nper, 16);
    return {
      title: String(o.title || "课程表").slice(0, 30), sub: String(o.sub || "").slice(0, 60), foot: String(o.foot || "").slice(0, 60),
      times: times, nper: nper, ndays: ndays, dates: o.dates || [], today: o.today == null ? -1 : o.today,
      hl: o.hl || null,   // 6.9 要标出来的那门课 { name, day, start }：首页点课程时用
      courses: courses.filter(function (c) { return +c.day < ndays; }),
    };
  }
  function size(m) { return { width: W, height: HEAD + DAYH + m.nper * ROW + FOOT + PAD }; }

  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function font(ctx, px, bold) { ctx.font = (bold ? "bold " : "") + px + "px " + FONT; }
  // 按宽度折行（中文逐字、英文按词也只是逐字，够用），最多 maxLines 行，超出加省略号
  function wrap(ctx, text, maxW, maxLines) {
    var out = [], line = "", s = String(text || "");
    for (var i = 0; i < s.length; i++) {
      var t = line + s[i];
      if (ctx.measureText(t).width > maxW && line) {
        out.push(line); line = s[i];
        if (out.length === maxLines) break;
      } else line = t;
    }
    if (out.length < maxLines && line) out.push(line);
    else if (out.length === maxLines && (line || out.join("").length < s.length)) {
      var last = out[maxLines - 1];
      while (last.length > 1 && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
      out[maxLines - 1] = last + "…";
    }
    return out;
  }

  function draw(ctx, m) {
    var sz = size(m), H = sz.height;
    var gx = PAD + PCOL, gy = HEAD + DAYH, gw = W - PAD - gx, cw = gw / m.ndays, gh = m.nper * ROW;
    // 背景
    ctx.fillStyle = "#f6f5f1"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ffffff"; rr(ctx, PAD - 16, HEAD - 8, W - 2 * PAD + 32, DAYH + gh + 24, 28); ctx.fill();
    // 标题
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.fillStyle = "#5366e8"; rr(ctx, PAD, 52, 10, 64, 5); ctx.fill();
    ctx.fillStyle = "#1d2433"; font(ctx, 52, true); ctx.fillText(m.title, PAD + 30, 100);
    if (m.sub) { ctx.fillStyle = "#7d898e"; font(ctx, 26); ctx.fillText(m.sub, PAD + 30, 142); }
    // 隔行底色
    for (var p0 = 0; p0 < m.nper; p0++) { ctx.fillStyle = p0 % 2 ? "#fbfbfa" : "#ffffff"; ctx.fillRect(gx, gy + p0 * ROW, gw, ROW); }
    // 表头：星期（今天那一列整列淡淡标出来）
    ctx.textAlign = "center";
    for (var d = 0; d < m.ndays; d++) {
      var cx = gx + d * cw + cw / 2;
      if (d === m.today) { ctx.fillStyle = "rgba(83,102,232,0.08)"; rr(ctx, gx + d * cw + 4, HEAD + 4, cw - 8, DAYH + gh - 8, 18); ctx.fill(); }
      ctx.fillStyle = d === m.today ? "#5366e8" : d >= 5 ? "#a0a8ad" : "#1d2433";
      font(ctx, 28, true); ctx.fillText(DAYS[d], cx, HEAD + (m.dates[d] ? 34 : 42));
      if (m.dates[d]) { font(ctx, 20); ctx.fillStyle = "#a0a8ad"; ctx.fillText(m.dates[d], cx, HEAD + 58); }
    }
    // 节次 + 横线
    for (var p = 0; p < m.nper; p++) {
      var y = gy + p * ROW;
      if (p === 4 || p === 8) { ctx.fillStyle = "#e3e6ea"; ctx.fillRect(PAD, y - 1, W - 2 * PAD, 2); }
      ctx.fillStyle = "#4a5560"; font(ctx, 24, true); ctx.fillText(String(p + 1), PAD + PCOL / 2, y + (m.times[p] ? 46 : 64));
      var t = String(m.times[p] || "");
      if (t) { ctx.fillStyle = "#a0a8ad"; font(ctx, 18); var tt = t.split("-"); ctx.fillText(tt[0] || "", PAD + PCOL / 2, y + 72); if (tt[1]) ctx.fillText(tt[1], PAD + PCOL / 2, y + 94); }
    }
    // 竖线
    ctx.fillStyle = "#eef0f2";
    for (var v = 0; v <= m.ndays; v++) ctx.fillRect(gx + v * cw - 1, HEAD + 10, 2, DAYH + gh - 20);
    // 课程卡片（同一格有两门课：并排）
    var placed = [];
    m.courses.slice().sort(function (a, b) { return a.day - b.day || a.start - b.start || b.end - a.end; }).forEach(function (c) {
      var lane = 0;
      while (placed.some(function (q) { return q.day === +c.day && q.lane === lane && q.start <= +c.end && +c.start <= q.end; })) lane++;
      placed.push({ c: c, day: +c.day, start: +c.start, end: Math.max(+c.start, +c.end || +c.start), lane: lane });
    });
    placed.forEach(function (q) {
      var n = 1 + Math.max.apply(null, placed.filter(function (o) { return o.day === q.day && o.start <= q.end && q.start <= o.end; }).map(function (o) { return o.lane; }));
      var col = q.c.color || { bg: "#e6eefc", fg: "#2e5fa8", bar: "#5b8def" };
      var x = gx + q.day * cw + 6 + q.lane * (cw - 12) / n, w = (cw - 12) / n - (n > 1 ? 4 : 0);
      var y0 = gy + (q.start - 1) * ROW + 5, h = (q.end - q.start + 1) * ROW - 10;
      var hit = m.hl && q.c.name === m.hl.name && +q.c.day === +m.hl.day && (m.hl.start == null || +q.c.start === +m.hl.start);
      ctx.globalAlpha = m.hl && !hit ? 0.45 : 1;
      if (hit) { ctx.fillStyle = "#ff7a45"; rr(ctx, x - 6, y0 - 6, w + 12, h + 12, 20); ctx.fill(); }
      ctx.fillStyle = col.bg; rr(ctx, x, y0, w, h, 16); ctx.fill();
      ctx.fillStyle = col.bar; rr(ctx, x, y0, 7, h, 3.5); ctx.fill();
      ctx.textAlign = "left";
      var inner = w - 22, lh = 30, yy = y0 + 36, lines = Math.max(1, Math.floor((h - 16) / lh));
      ctx.fillStyle = col.fg; font(ctx, n > 1 ? 22 : 25, true);
      var nameLines = wrap(ctx, q.c.name, inner, Math.min(3, lines));
      nameLines.forEach(function (l) { ctx.fillText(l, x + 16, yy); yy += lh; });
      font(ctx, n > 1 ? 18 : 20); ctx.fillStyle = col.fg; ctx.globalAlpha = m.hl && !hit ? 0.35 : 0.78;
      [q.c.location ? "@" + q.c.location : "", q.c.teacher || "", q.c.weeks || ""].filter(Boolean).forEach(function (s) {
        if (yy - y0 > h - 8) return;
        var ls = wrap(ctx, s, inner, 1); if (ls[0]) { ctx.fillText(ls[0], x + 16, yy - 4); yy += 26; }
      });
      ctx.globalAlpha = 1;
    });
    // 页脚
    ctx.textAlign = "center"; ctx.fillStyle = "#a0a8ad"; font(ctx, 22);
    ctx.fillText(m.foot || "捞捞课程表 · laolaokechengbiao.cn", W / 2, H - PAD - 6);
    return sz;
  }

  var api = { model: model, size: size, draw: draw, DAYS: DAYS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CourseImage = api;
})(typeof window !== "undefined" ? window : this);
