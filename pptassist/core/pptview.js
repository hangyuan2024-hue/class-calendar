// 捞捞PPT助手 · 一页 PPT 画成 SVG：界面上的缩略图和大图（不用装 PowerPoint 就能看到做成什么样、改了哪里）
// 读的是 .pptx 里这一页现在的 XML：形状（矩形 / 圆角 / 圆）、填充色（主题色、透明度）、文字（字号、粗细、颜色、底色、行距、对齐）、
// 表格、图片、公式（显示成一行文字）。捞小智排的页画得和 PowerPoint 里基本一样；老师自己的 PPT 尽量画（占位符的位置去版式 / 母版里找），
// 动画、渐变、艺术字这些画不出来——这只是预览，以 PowerPoint 里打开的为准。
"use strict";
const X = require("./pptx");
const { attr, unesc } = X;

const PX = 9525;                                              // 1 像素 = 9525 EMU（96 dpi）
const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MAP = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };

// <a:solidFill> 里的颜色 → { c: "#RRGGBB", a: 0～1 }
function colorOf(xml, colors) {
  if (!xml) return null;
  const m = /<a:(srgbClr|schemeClr|sysClr)\b([^>]*?)(\/>|>([\s\S]*?)<\/a:\1>)/.exec(xml);
  if (!m) return null;
  const val = attr("<x" + m[2] + ">", m[1] === "sysClr" ? "lastClr" : "val") || "";
  let c = m[1] === "schemeClr" ? colors[MAP[val] || val] : val;
  if (!/^[0-9a-f]{6}$/i.test(c || "")) return null;
  const inner = m[4] || "", al = /<a:alpha val="(\d+)"/.exec(inner), lm = /<a:lumMod val="(\d+)"/.exec(inner), lo = /<a:lumOff val="(\d+)"/.exec(inner);
  if (lm || lo) { const k = lm ? +lm[1] / 100000 : 1, o = lo ? (+lo[1] / 100000) * 255 : 0; c = [0, 2, 4].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(c.slice(i, i + 2), 16) * k + o))).toString(16).padStart(2, "0")).join(""); }
  return { c: "#" + c.toUpperCase(), a: al ? Math.max(0, Math.min(1, +al[1] / 100000)) : 1 };
}
const fillOf = (xml, colors) => { const m = /<a:solidFill>([\s\S]*?)<\/a:solidFill>/.exec(xml || ""); return m ? colorOf(m[1], colors) : null; };
const css = (col) => (col ? (col.a < 1 ? `rgba(${[1, 3, 5].map((i) => parseInt(col.c.slice(i, i + 2), 16)).join(",")},${col.a})` : col.c) : null);
const xfrmOf = (xml) => { const m = /<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/.exec(xml || ""); return m ? { x: +m[1] / PX, y: +m[2] / PX, w: +m[3] / PX, h: +m[4] / PX } : null; };
const first = (re, s) => { const m = re.exec(s || ""); return m ? m[0] : ""; };

// 一个框里的字 → HTML（放进 <foreignObject>）。def：这个框不写的时候用的字号、粗细、颜色
function textHtml(sp, colors, def, no) {
  const body = /<p:txBody>([\s\S]*)<\/p:txBody>|<a:txBody>([\s\S]*)<\/a:txBody>/.exec(sp);
  if (!body) return "";
  const inner = body[1] != null ? body[1] : body[2], bp = first(/<a:bodyPr\b[^>]*\/?>/, inner);
  const ins = ["lIns", "tIns", "rIns", "bIns"].map((k, i) => { const v = attr(bp, k); return (v == null ? (i % 2 ? 45720 : 91440) : +v) / PX; });
  const anchor = attr(bp, "anchor") || def.anchor || "t", nowrap = attr(bp, "wrap") === "none";
  const lst = first(/<a:lstStyle>[\s\S]*?<\/a:lstStyle>/, inner), levels = {};
  for (const m of lst.matchAll(/<a:lvl(\d)pPr\b([^>]*)>([\s\S]*?)<\/a:lvl\dpPr>/g)) {
    const d = first(/<a:defRPr\b[^>]*\/>|<a:defRPr\b[^>]*>[\s\S]*?<\/a:defRPr>/, m[3]), tag = "<x" + m[2] + ">";
    levels[+m[1] - 1] = { al: attr(tag, "algn"), lh: (/<a:lnSpc><a:spcPts val="(\d+)"/.exec(m[3]) || [])[1], after: (/<a:spcAft><a:spcPts val="(\d+)"/.exec(m[3]) || [])[1], bu: /<a:buChar\b/.test(m[3]), buC: fillOf((/<a:buClr>([\s\S]*?)<\/a:buClr>/.exec(m[3]) || [])[1] ? `<a:solidFill>${/<a:buClr>([\s\S]*?)<\/a:buClr>/.exec(m[3])[1]}</a:solidFill>` : "", colors),
      sz: attr(d, "sz"), b: attr(d, "b"), c: fillOf(d, colors), mono: /<a:latin typeface="(Consolas|Courier|Menlo|Monaco)/i.test(d) };
  }
  const out = [];
  for (const p of inner.matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p ([^>]*)>([\s\S]*?)<\/a:p>/g)) {
    const pi = p[1] != null ? p[1] : p[3], ppr = first(/<a:pPr\b[^>]*\/?>/, pi), lv = levels[+(attr(ppr, "lvl") || 0)] || levels[0] || {};
    const al = { ctr: "center", r: "right", just: "justify" }[attr(ppr, "algn") || lv.al || def.al] || "left";
    let maxSz = 0; const spans = [];
    for (const m of pi.matchAll(/<a:r>([\s\S]*?)<\/a:r>|<a:fld\b([^>]*)>([\s\S]*?)<\/a:fld>|<a:br\b[^>]*\/>|<a:br\b[^>]*>[\s\S]*?<\/a:br>/g)) {
      if (m[0].startsWith("<a:br")) { spans.push("<br/>"); continue; }
      const r = m[1] != null ? m[1] : m[3], pr = first(/<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/, r), tag = first(/<a:rPr\b[^>]*>/, pr);
      let t = [...r.matchAll(/<a:t>([^<]*)<\/a:t>|<a:t [^>]*>([^<]*)<\/a:t>/g)].map((x) => unesc(x[1] != null ? x[1] : x[2])).join("");
      if (m[2] != null && /type="slidenum"/.test(m[2])) t = String(no || "");
      const sz = +(attr(tag, "sz") || lv.sz || def.sz) / 100, b = attr(tag, "b") != null ? attr(tag, "b") === "1" : lv.b != null ? lv.b === "1" : !!def.b;
      const c = fillOf(pr.replace(/<a:highlight>[\s\S]*?<\/a:highlight>/, ""), colors) || lv.c || def.c, hl = colorOf((/<a:highlight>([\s\S]*?)<\/a:highlight>/.exec(pr) || [])[1], colors);
      maxSz = Math.max(maxSz, sz);
      const st = [`font-size:${(sz * 4 / 3).toFixed(2)}px`, b ? "font-weight:700" : "font-weight:400", c ? `color:${css(c)}` : "", hl ? `background:${css(hl)}` : "", attr(tag, "i") === "1" ? "font-style:italic" : "", attr(tag, "u") && attr(tag, "u") !== "none" ? "text-decoration:underline" : "", /<a:latin typeface="Cambria Math"/.test(pr) ? "font-family:'Cambria Math','Times New Roman',serif" : ""].filter(Boolean).join(";");
      spans.push(`<span style="${st}">${h(t)}</span>`);
    }
    const sz = maxSz || +(lv.sz || def.sz) / 100, lh = lv.lh ? (+lv.lh / 100) * 4 / 3 : sz * 1.2 * 4 / 3, pad = lv.bu ? sz * 1.2 * 4 / 3 : 0;
    out.push(`<div style="text-align:${al};line-height:${lh.toFixed(2)}px;min-height:${lh.toFixed(2)}px;margin:0 0 ${(lv.after ? (+lv.after / 100) * 4 / 3 : 0).toFixed(2)}px 0;${pad ? `padding-left:${pad.toFixed(1)}px;text-indent:-${pad.toFixed(1)}px;` : ""}${lv.mono ? "font-family:Consolas,'Courier New',monospace;" : ""}">${lv.bu ? `<span style="font-size:${(sz * 4 / 3).toFixed(1)}px;color:${css(lv.buC || lv.c || def.c) || "inherit"};display:inline-block;width:${pad.toFixed(1)}px;text-indent:0">•</span>` : ""}${spans.join("")}</div>`);
  }
  if (!out.length) return "";
  return `<div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:100%;height:100%;padding:${ins[1].toFixed(1)}px ${ins[2].toFixed(1)}px ${ins[3].toFixed(1)}px ${ins[0].toFixed(1)}px;display:flex;flex-direction:column;justify-content:${{ ctr: "center", b: "flex-end" }[anchor] || "flex-start"};white-space:${nowrap ? "pre" : "pre-wrap"};overflow-wrap:anywhere;word-break:break-word;font-family:'Microsoft YaHei','PingFang SC','Noto Sans CJK SC','Noto Sans SC',sans-serif;overflow:visible">${out.join("")}</div>`;
}

// o：{ xml 这一页, W H（EMU）, colors 主题色, images { rId: data-url }, no 页码, inherit { layout, master }（老师自己的 PPT 才有）, shapeList }
function svg(o) {
  const W = o.W / PX, H = o.H / PX, colors = o.colors || {}, out = [];
  const bgm = /<p:bg>([\s\S]*?)<\/p:bg>/.exec(o.xml);
  const bg = (bgm && fillOf(bgm[1], colors)) || (o.inherit && fillOf((/<p:bg>([\s\S]*?)<\/p:bg>/.exec(o.inherit.layout) || /<p:bg>([\s\S]*?)<\/p:bg>/.exec(o.inherit.master) || [])[1], colors)) || { c: "#" + (colors.lt1 || "FFFFFF"), a: 1 };
  out.push(`<rect width="${W}" height="${H}" fill="${css(bg)}"/>`);
  const dark = [1, 3, 5].reduce((a, i) => a + parseInt(bg.c.slice(i, i + 2), 16), 0) < 330, ink = { c: dark && !o.inherit ? "#FFFFFF" : "#" + (colors.dk1 || "000000"), a: 1 };
  // 占位符没写位置：去版式、母版里找同一个占位符
  const inherited = (sh) => { if (!o.inherit || !sh.ph) return null; const tag = first(/<p:ph\b[^>]*\/?>/, sh.xml), idx = attr(tag, "idx");
    for (const src of [o.inherit.layout, o.inherit.master]) for (const x of o.shapeList(src || "")) { const t2 = first(/<p:ph\b[^>]*\/?>/, x.xml); if (!t2) continue;
      const ty = attr(t2, "type") || "body", same = (idx != null && attr(t2, "idx") === idx) || ty === sh.ph || (["title", "ctrTitle"].includes(ty) && ["title", "ctrTitle"].includes(sh.ph));
      if (same) { const b = xfrmOf(x.xml); if (b) return b; } }
    return null; };
  let clip = 0;
  for (const sh of o.shapeList(o.xml)) {
    let x = sh.xml;
    if (x.startsWith("<mc:")) x = (/<mc:Fallback>([\s\S]*?)<\/mc:Fallback>/.exec(x) || [])[1] || "";
    if (sh.kind === "table") {
      const b = (() => { const m = /<p:xfrm>\s*<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/.exec(x); return m ? { x: +m[1] / PX, y: +m[2] / PX, w: +m[3] / PX, h: +m[4] / PX } : null; })();
      if (!b) continue;
      const cols = [...x.matchAll(/<a:gridCol w="(\d+)"/g)].map((m) => +m[1] / PX); let y = b.y;
      for (const tr of x.matchAll(/<a:tr\b([^>]*)>([\s\S]*?)<\/a:tr>/g)) { const rh = +(attr("<x" + tr[1] + ">", "h") || 370840) / PX; let cx = b.x, j = 0;
        for (const tc of tr[2].matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)) { const w = cols[j++] || 0, f = fillOf(first(/<a:tcPr\b[^>]*>[\s\S]*?<\/a:tcPr>/, tc[1]).replace(/<a:ln[LRTB]\b[\s\S]*?<\/a:ln[LRTB]>/g, ""), colors);
          out.push(`<rect x="${cx.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${rh.toFixed(1)}" fill="${css(f) || "none"}" stroke="${css(bg)}" stroke-width="1"/>`);
          const t = textHtml(tc[1].replace(/<a:bodyPr\s*\/>/, '<a:bodyPr lIns="110000" rIns="110000" tIns="40000" bIns="40000" anchor="ctr"/>'), colors, { sz: 1800, c: ink, anchor: "ctr" }, o.no);
          if (t) out.push(`<foreignObject x="${cx.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${rh.toFixed(1)}">${t}</foreignObject>`);
          cx += w; }
        y += rh; }
      continue;
    }
    const sp = first(/<p:spPr\b[^>]*>[\s\S]*?<\/p:spPr>/, x), b = xfrmOf(sp) || inherited(sh);
    if (!b || b.w <= 0 || b.h <= 0) continue;
    const at = `x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}"`;
    if (sh.kind === "picture") {
      const rid = attr(first(/<a:blip\b[^>]*>/, x), "r:embed"), src = rid && o.images ? o.images[rid] : null, round = /prst="roundRect"/.test(sp);
      if (src) { const id = `lzc${o.no || 0}_${clip++}`; out.push(`${round ? `<clipPath id="${id}"><rect ${at} rx="${(Math.min(b.w, b.h) * 0.04).toFixed(1)}"/></clipPath>` : ""}<image ${at} href="${h(src)}" preserveAspectRatio="xMidYMid slice"${round ? ` clip-path="url(#${id})"` : ""}/>`); }
      else out.push(`<rect ${at} fill="rgba(128,128,128,.18)" stroke="rgba(128,128,128,.5)" stroke-dasharray="6 4"/><text x="${(b.x + b.w / 2).toFixed(1)}" y="${(b.y + b.h / 2).toFixed(1)}" text-anchor="middle" font-size="16" fill="${css(ink)}" opacity=".6">图片</text>`);
      continue;
    }
    if (sh.kind === "chart" || sh.kind === "group" || sh.kind === "line" || sh.kind === "other") { if (sh.kind !== "line") out.push(`<rect ${at} fill="rgba(128,128,128,.12)" stroke="rgba(128,128,128,.45)" stroke-dasharray="6 4"/><text x="${(b.x + b.w / 2).toFixed(1)}" y="${(b.y + b.h / 2).toFixed(1)}" text-anchor="middle" font-size="16" fill="${css(ink)}" opacity=".6">${{ chart: "图表", group: "组合图形" }[sh.kind] || ""}</text>`); continue; }
    const f = fillOf(sp.replace(/<a:ln\b[\s\S]*?<\/a:ln>|<a:ln\b[^>]*\/>/g, ""), colors), ln = fillOf(first(/<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/, sp), colors);
    const stroke = ln ? ` stroke="${css(ln)}" stroke-width="1.3"` : "";
    if (f || ln) {
      if (/prst="ellipse"/.test(sp)) out.push(`<ellipse cx="${(b.x + b.w / 2).toFixed(1)}" cy="${(b.y + b.h / 2).toFixed(1)}" rx="${(b.w / 2).toFixed(1)}" ry="${(b.h / 2).toFixed(1)}" fill="${css(f) || "none"}"${stroke}/>`);
      else { const adj = /prst="roundRect"/.test(sp) ? +((/<a:gd name="adj" fmla="val (\d+)"/.exec(sp) || [])[1] || 16667) : 0; out.push(`<rect ${at}${adj ? ` rx="${((Math.min(b.w, b.h) * Math.min(50000, adj)) / 100000).toFixed(1)}"` : ""} fill="${css(f) || "none"}"${stroke}/>`); }
    }
    const isTitle = sh.ph === "title" || sh.ph === "ctrTitle";
    const t = textHtml(x, colors, { sz: isTitle ? 3600 : sh.ph ? 2400 : 1800, b: isTitle, c: ink, anchor: isTitle ? "ctr" : "t", al: sh.ph === "ctrTitle" ? "ctr" : null }, o.no);
    if (t) out.push(`<foreignObject ${at}>${t}</foreignObject>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${out.join("")}</svg>`;
}

module.exports = { svg, colorOf };
