// 捞捞PPT助手 · 版式引擎：告诉它「这一页讲什么」，它排成好看的一页（不用模板文件，整份 .pptx 从这里生出来）
//   · 12 种版式：封面、章节页、要点、卡片、步骤、对比、金句、代码、表格、公式、小结、结束页
//   · 8 套配色：所有颜色都写成「主题色」，换配色只改主题那一个文件，整份（包括老师手改过的页）一起变
//   · 字号自己算：字多就小一点、放不下就拆成两页；行距写死成磅值，PowerPoint / WPS / LibreOffice 排出来一样高
//   · 每个框的名字是「lz:版式|哪一块」（比如 lz:cards|items.2）：以后要换版式、加一条、改字，
//     从页面上把内容读回来（specOf）重新排一遍（render）——老师在 PowerPoint 里手改的字、加的粗和颜色都带着
"use strict";
const JSZip = require("jszip");
const X = require("./pptx");
const M = require("./latex2omml");
const { esc, unesc, attr } = X;

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_M = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const NS_R = X.NS_R;
const EMU = 914400, DW = 13.3333, DH = 7.5;      // 按 16:9（13.33 × 7.5 英寸）设计，别的尺寸按比例缩
const FONT = "微软雅黑", MONO = "Consolas";

// ---------- 配色 ----------
// lt1 页面底色 / dk1 正文 / lt2 卡片底色 / dk2 深色大色块（封面、小结、代码框；上面的字固定用白色）/ accent1 主色 …
const THEMES = {
  blue:   { name: "学院蓝", c: ["FFFFFF", "1B2437", "EEF3FB", "16254F", "2F6FED", "12B5A6", "F5A524", "7C5CFC", "EF5B6B", "3BA55D"] },
  green:  { name: "松绿",   c: ["FCFDFB", "1E2B23", "EAF3EC", "1F4D3A", "2E8B57", "D9A441", "3A7CA5", "8FB339", "C8553D", "5B8C85"] },
  warm:   { name: "暖陶",   c: ["FFFDF9", "33241C", "F7EDE2", "5A2E22", "C8553D", "E0A030", "2F6F6B", "8C5E3C", "B23A48", "6B8F71"] },
  berry:  { name: "莓紫",   c: ["FFFCFD", "2A1F2D", "F6EBF2", "4A1F45", "A23B72", "F18F01", "3B6FB6", "6D4C9F", "D1495B", "2E9E8F"] },
  orange: { name: "活力橙", c: ["FFFFFF", "2B2118", "FFF2E5", "3B2A1F", "F26B21", "1F7A8C", "FFB703", "8E5572", "D7263D", "4C956C"] },
  mono:   { name: "石墨",   c: ["FFFFFF", "1F2328", "F1F3F5", "24292F", "D9363E", "4B5563", "9CA3AF", "111827", "F59E0B", "2563EB"] },
  dark:   { name: "深色",   c: ["10141C", "E9EDF5", "1B2230", "26335C", "5B9BFF", "2DD4BF", "FBBF24", "A78BFA", "FB7185", "4ADE80"] },
  board:  { name: "黑板",   c: ["1F3B33", "F4F1E8", "2A4A40", "152A24", "F6D55C", "F29E9E", "9AD1F5", "B8E0A8", "F4B183", "D7BDE2"] },
};
const THEME_KEYS = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];
const hex = (s) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(s || "").trim()); return m ? m[1].toUpperCase() : null; };
const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t)).map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
// 老师指定一个颜色（比如校徽的颜色）：主色用它，深色块、卡片底色跟着它配
function themeOf(o = {}) {
  const base = THEMES[o.theme] || null, c = hex(o.color);
  if (!c) { if (!base) throw new Error("没有这套配色。可以选：" + Object.entries(THEMES).map(([k, v]) => `${k}（${v.name}）`).join("、") + "；或者给一个颜色（color，比如 #8B1A1A）"); return { key: o.theme, name: base.name, c: base.c.slice() }; }
  const b = (base || THEMES.blue).c.slice(), darkBg = base && rgb(b[0]).reduce((x, y) => x + y, 0) < 300;
  b[4] = c; b[3] = mix(c, "000000", darkBg ? 0.45 : 0.6); b[2] = darkBg ? mix(b[0], c, 0.14) : mix(c, "FFFFFF", 0.9);
  return { key: "custom", name: "自定义 #" + c, c: b };
}
const clrScheme = (t) => `<a:clrScheme name="${esc("捞小智·" + t.name)}">` + ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"].map((k) => `<a:${k}><a:srgbClr val="${t.c[THEME_KEYS.indexOf(k)]}"/></a:${k}>`).join("") + `<a:hlink><a:srgbClr val="${t.c[4]}"/></a:hlink><a:folHlink><a:srgbClr val="${t.c[7]}"/></a:folHlink></a:clrScheme>`;

// ---------- 文字 ----------
// 一段文字：字符串，或者 { runs: [{ t, a, x }] }（a：<a:rPr> 上额外的属性；x：<a:rPr> 里面的东西——给某几个字加的粗、颜色、底色）
const strip = (s) => String(s == null ? "" : s).replace(/\*\*/g, "");
const plain = (v) => (v == null ? "" : typeof v === "object" ? (Array.isArray(v.runs) ? v.runs.map((r) => r.t).join("") : "") : strip(v));
function runsOf(v) {
  if (v && typeof v === "object" && Array.isArray(v.runs)) return v.runs;
  const s = String(v == null ? "" : v), out = []; let i = 0;       // 模型爱写 **重点**：变成加粗
  for (const m of s.matchAll(/\*\*([^*]+)\*\*/g)) { if (m.index > i) out.push({ t: s.slice(i, m.index) }); out.push({ t: m[1], a: ' b="1"' }); i = m.index + m[0].length; }
  if (i < s.length) out.push({ t: s.slice(i) });
  return out.length ? out : [{ t: "" }];
}
// 一行字大概多宽（单位：一个汉字的宽）；w 英寸宽、pt 磅的字要排几行
function units(s, mono) {
  let u = 0;
  for (const ch of plain(s)) { const c = ch.codePointAt(0); u += c > 0x2E7F ? 1 : mono ? 0.6 : c === 32 ? 0.3 : c >= 0x2000 && c < 0x2070 ? 0.6 : /[A-Z0-9mwMW@%&]/.test(ch) ? 0.64 : /[ilj.,:;'|!()[\]]/.test(ch) ? 0.33 : 0.55; }
  return u;
}
const nLines = (s, w, pt) => plain(s).split("\n").reduce((n, l) => n + Math.max(1, Math.ceil((units(l) * pt) / 72 / Math.max(0.2, w * 0.96))), 0);
const LH = 1.32;                                        // 行距 = 字号 × 1.32（写死成磅值）
const textH = (s, w, pt, lh = LH) => (nLines(s, w, pt) * pt * lh) / 72;

// 颜色：主题色名（"accent1"）或者 "#RRGGBB"，后面可以跟 "@透明度"（"accent1@20" = 20% 不透明）
function clr(c) {
  const [n, a] = String(c).split("@"), al = a ? `<a:alpha val="${Math.round(+a * 1000)}"/>` : "";
  return n[0] === "#" ? `<a:srgbClr val="${n.slice(1)}">${al}</a:srgbClr>` : `<a:schemeClr val="${n}">${al}</a:schemeClr>`;
}
const fill = (c) => (c ? `<a:solidFill>${clr(c)}</a:solidFill>` : "<a:noFill/>");

// ---------- 一页的东西 → XML ----------
// 版式函数返回一串「东西」：{ k: rect / round / oval（可以带字）| table | formula | pic，x y w h（英寸），name … }
function emit(items, o) {
  const sx = o.W / EMU / DW, sy = o.H / EMU / DH, k = Math.min(sx, sy);
  const E = (v, s) => Math.round(v * s * EMU);
  let id = o.idFrom || 2;
  const xfrm = (it) => `<a:xfrm><a:off x="${E(it.x, sx)}" y="${E(it.y, sy)}"/><a:ext cx="${E(it.w, sx)}" cy="${E(it.h, sy)}"/></a:xfrm>`;
  const run = (r) => `<a:r><a:rPr lang="zh-CN" altLang="en-US"${r.a || ""} dirty="0"${r.x ? `>${r.x}</a:rPr>` : "/>"}<a:t>${esc(r.t)}</a:t></a:r>`;
  const para = (p) => {
    const pr = p.lvl ? `<a:pPr lvl="${p.lvl}"/>` : "";
    if (p.fld) return `<a:p>${pr}<a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="zh-CN" altLang="en-US" dirty="0"/><a:t>‹#›</a:t></a:fld></a:p>`;
    const rs = (p.runs || []).filter((r) => r.t !== "");
    return `<a:p>${pr}${rs.length ? rs.map((r) => (r.t === "\n" ? '<a:br><a:rPr lang="zh-CN" altLang="en-US" dirty="0"/></a:br>' : run(r))).join("") : '<a:endParaRPr lang="zh-CN" altLang="en-US" dirty="0"/>'}</a:p>`;
  };
  const lvl = (s, i) => `<a:lvl${i + 1}pPr marL="${s.bu ? Math.round(s.sz * k * 12700 * 1.2) : 0}" indent="${s.bu ? -Math.round(s.sz * k * 12700 * 1.2) : 0}" algn="${s.al || "l"}"><a:lnSpc><a:spcPts val="${Math.round((s.lh || s.sz * LH) * k * 100)}"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="${Math.round((s.after || 0) * k * 100)}"/></a:spcAft>` +
    (s.bu ? `<a:buClr>${clr(s.bu)}</a:buClr><a:buFont typeface="Arial"/><a:buChar char="•"/>` : "<a:buNone/>") +
    `<a:defRPr sz="${Math.round(s.sz * k) * 100}" b="${s.b ? 1 : 0}">${fill(s.c || "tx1")}${s.mono ? `<a:latin typeface="${MONO}"/><a:ea typeface="${FONT}"/><a:cs typeface="${MONO}"/>` : ""}</a:defRPr></a:lvl${i + 1}pPr>`;
  const body = (t) => { const ins = t.inset || [0.1, 0.05, 0.1, 0.05];
    return `<p:txBody><a:bodyPr wrap="${t.nowrap ? "none" : "square"}" lIns="${E(ins[0], sx)}" tIns="${E(ins[1], sy)}" rIns="${E(ins[2], sx)}" bIns="${E(ins[3], sy)}" rtlCol="0" anchor="${t.anchor || "t"}"><a:noAutofit/></a:bodyPr><a:lstStyle>${t.styles.map(lvl).join("")}</a:lstStyle>${t.paras.map(para).join("")}</p:txBody>`; };
  const geom = (it) => it.k === "oval" ? '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>' : it.k === "round" ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.round(Math.min(50000, ((it.r == null ? 0.12 : it.r) / Math.max(0.01, Math.min(it.w * sx, it.h * sy))) * 100000))}"/></a:avLst></a:prstGeom>` : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  const out = [];
  for (const it of items) {
    if (it.k === "pic") {      // 老师放进来的图片：原样留着，只挪位置（按原来的宽高比放进给它留的那一块）
      const m = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(it.xml), r = m && +m[2] > 0 ? +m[1] / +m[2] : 1.5;
      let w = it.w, h = w / r; if (h > it.h) { h = it.h; w = h * r; }
      const b = { x: it.x + (it.w - w) / 2, y: it.y + (it.h - h) / 2, w, h };
      out.push(it.xml.replace(/<a:xfrm\b[^>]*>[\s\S]*?<\/a:xfrm>/, xfrm(b)).replace(/(<p:cNvPr\b[^>]*\sname=")[^"]*(")/, `$1${esc(it.name)}$2`));
      continue;
    }
    const nid = id++;
    const nv = `<p:cNvPr id="${nid}" name="${esc(it.name)}"${it.descr ? ` descr="${esc(it.descr)}"` : ""}/>`;
    if (it.k === "table") {
      const tw = it.colW.reduce((a, b) => a + b, 0);
      const cell = (c, head, band) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${head ? "ctr" : "l"}"><a:lnSpc><a:spcPts val="${Math.round(it.sz * 1.3 * k * 100)}"/></a:lnSpc></a:pPr>${runsOf(c).filter((r) => r.t !== "").map((r) => `<a:r><a:rPr lang="zh-CN" altLang="en-US" sz="${Math.round(it.sz * k) * 100}" b="${head ? 1 : 0}"${r.a || ""} dirty="0">${r.x || fill(head ? "bg1" : "tx1")}</a:rPr><a:t>${esc(r.t)}</a:t></a:r>`).join("")}<a:endParaRPr lang="zh-CN" altLang="en-US" sz="${Math.round(it.sz * k) * 100}" dirty="0"/></a:p></a:txBody>` +
        `<a:tcPr marL="${E(0.12, sx)}" marR="${E(0.12, sx)}" marT="${E(0.06, sy)}" marB="${E(0.06, sy)}" anchor="ctr">${["L", "R", "T", "B"].map((s) => `<a:ln${s} w="12700"><a:solidFill>${clr("bg1")}</a:solidFill></a:ln${s}>`).join("")}${fill(head ? "accent1" : band ? "bg2" : "accent1@7")}</a:tcPr></a:tc>`;
      out.push(`<p:graphicFrame><p:nvGraphicFramePr>${nv}<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${E(it.x, sx)}" y="${E(it.y, sy)}"/><a:ext cx="${E(it.w, sx)}" cy="${E(it.h, sy)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${it.colW.map((w) => `<a:gridCol w="${E((w / tw) * it.w, sx)}"/>`).join("")}</a:tblGrid>` +
        it.rows.map((r, i) => `<a:tr h="${E(it.rowH[i], sy)}">${it.colW.map((_, j) => cell(r[j] == null ? "" : r[j], i === 0, i % 2 === 1)).join("")}</a:tr>`).join("") + `</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`);
      continue;
    }
    if (it.k === "formula") {  // PowerPoint 自己的公式（双击能改）；LaTeX 原文记在替代文字里，以后重排、给模型看都用它
      const sz = Math.round(it.sz * k) * 100, latex = M.clean(it.latex);
      const omml = M.toOmml(latex).replace(/<a:rPr lang="en-US" altLang="zh-CN"/g, `<a:rPr lang="en-US" altLang="zh-CN" sz="${sz}"`);
      const sp = (inner, ext) => `<p:sp><p:nvSpPr><p:cNvPr id="${nid}" name="${esc(it.name)}" descr="${esc(latex)}">${ext}</p:cNvPr><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(it)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="ctr"/>${inner}</a:p></p:txBody></p:sp>`;
      out.push(`<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14">` +
        sp(`<a14:m><m:oMathPara xmlns:m="${NS_M}"><m:oMathParaPr><m:jc m:val="centerGroup"/></m:oMathParaPr>${omml}</m:oMathPara></a14:m><a:endParaRPr lang="en-US" altLang="zh-CN" sz="${sz}" dirty="0"/>`, "") + `</mc:Choice><mc:Fallback>` +
        sp(`<a:r><a:rPr lang="en-US" altLang="zh-CN" sz="${sz}" dirty="0">${fill(it.c || "tx1")}<a:latin typeface="Cambria Math"/></a:rPr><a:t>${esc(M.linear(latex))}</a:t></a:r>`, "") + `</mc:Fallback></mc:AlternateContent>`);
      continue;
    }
    out.push(`<p:sp><p:nvSpPr>${nv}<p:cNvSpPr${it.ph ? '><a:spLocks noGrp="1"/></p:cNvSpPr>' : it.text && !it.fill ? ' txBox="1"/>' : "/>"}<p:nvPr>${it.ph ? `<p:ph type="${it.ph}"/>` : ""}</p:nvPr></p:nvSpPr><p:spPr>${xfrm(it)}${geom(it)}${fill(it.fill)}<a:ln><a:noFill/></a:ln></p:spPr>${it.text ? body(it.text) : ""}</p:sp>`);
  }
  return { xml: out.join(""), nextId: id };
}

// 一张表格放进 box（英寸）里：列宽按内容长短分，字号放得下为止
function tableItem(table, box, o = {}) {
  const fs = o.fs || 1, rws = table.map((r) => (Array.isArray(r) ? r : [r])), cols = Math.max(1, ...rws.map((r) => r.length));
  const cu = Array.from({ length: cols }, (_, j) => Math.max(2, ...rws.map((r) => Math.min(units(r[j] == null ? "" : r[j]), 26))));
  const tot = cu.reduce((a, b) => a + b, 0), colW = cu.map((u) => Math.max(0.09, u / tot)), sum = colW.reduce((a, b) => a + b, 0);
  const cw = (j) => (colW[j] / sum) * box.w - 0.26;
  const rowH = (z) => rws.map((r) => Math.max(...Array.from({ length: cols }, (_, j) => textH(r[j] == null ? "" : r[j], cw(j), z, 1.3))) + 0.2);
  const p = pick([20, 18, 16, 14, 12, 11].map((x) => Math.round(x * fs)), (z) => rowH(z).reduce((a, b) => a + b, 0) <= box.h);
  const hs = rowH(p.v), th = hs.reduce((a, b) => a + b, 0), grow = o.grow === false ? 0 : Math.max(0, Math.min(0.22, (box.h - th) / hs.length));
  return { ok: p.ok, item: { k: "table", x: box.x, y: box.y, w: box.w, h: th + grow * hs.length, rows: rws, colW, rowH: hs.map((h) => h + grow), sz: p.v } };
}

// ---------- 版式 ----------
const LAYOUTS = {
  cover: "封面", section: "章节页（一部分的开头）", bullets: "要点（一条一条列）", cards: "卡片（2～6 个并列的概念，每个有小标题和说明）", steps: "步骤（2～5 步的过程，从左到右）",
  compare: "对比（左右两栏）", statement: "金句（一句最重要的话放大）", code: "代码（深色代码框，旁边可以放讲解）", table: "表格", formula: "公式（大公式 + 说明）", summary: "小结（深色底，几条结论）", end: "结束页",
};
const DARK = new Set(["cover", "section", "statement", "summary", "end"]);
const nm = (L, path, q) => `lz:${L}|${path}${q ? "?" + q : ""}`;
const P1 = (v, lvl) => plain(v).split("\n").length > 1 && !(v && v.runs) ? plain(v).split("\n").map((l) => ({ lvl, runs: runsOf(l) })) : [{ lvl, runs: runsOf(v) }];
const pick = (cands, fits) => { for (const c of cands) if (fits(c)) return { v: c, ok: true }; return { v: cands[cands.length - 1], ok: false }; };

function layout(L, s, o) {
  const fs = o.fs || 1, out = [], warn = [];
  const dark = DARK.has(L), ink = dark ? "#FFFFFF" : "tx1", soft = dark ? "#FFFFFF@10" : "bg2";
  const deco = (it) => out.push({ ...it, name: nm(L, ".") });
  const sizes = (...a) => a.map((x) => Math.round(x * fs));
  const TN = nm(L, "title", fs !== 1 ? "fs=" + fs : "");
  const frame = () => {
    const t = pick(sizes(32, 30, 28, 26, 24), (z) => nLines(s.title, 10.6, z) <= (z <= 26 * fs ? 2 : 1));
    out.push({ k: "rect", ph: "title", name: TN, x: 0.75, y: 0.5, w: 10.9, h: 1.05, text: { anchor: "ctr", inset: [0, 0, 0, 0], styles: [{ sz: t.v, b: 1, c: ink, lh: t.v * 1.2 }], paras: P1(s.title, 0) } });
    [["accent1", 11.95], ["accent2", 12.2], ["accent3", 12.45]].forEach(([c, x]) => deco({ k: "oval", x, y: 0.95, w: 0.14, h: 0.14, fill: c }));
    deco({ k: "rect", x: 11.4, y: 6.93, w: 1.18, h: 0.34, text: { anchor: "ctr", inset: [0, 0, 0, 0], styles: [{ sz: 11, c: dark ? "#FFFFFF@60" : "tx1@50", al: "r" }], paras: [{ fld: true }] } });
  };
  const B = { x: 0.75, y: 1.75, w: 11.83, h: 4.95 };
  const takeaway = (v) => { if (!plain(v)) return 0;
    const z = pick(sizes(18, 16, 14), (q) => nLines(v, 11.2, q) <= 1).v;
    out.push({ k: "round", name: nm(L, "takeaway"), x: B.x, y: B.y + B.h - 0.72, w: B.w, h: 0.72, fill: dark ? "#FFFFFF@14" : "accent1@14", text: { anchor: "ctr", inset: [0.3, 0.04, 0.3, 0.04], styles: [{ sz: z, b: 1, c: ink }], paras: P1(v, 0) } }); return 0.9; };
  // 一条一行的小卡片：左边一个圆点（小结页是编号）
  const rows = (lines, r, path, opt = {}) => {
    const n = lines.length; if (!n) return;
    const tw = r.w - 1.05, gap = n > 5 ? 0.12 : 0.16;
    const H1 = (l, z) => Math.max(n <= 4 && !opt.cands ? 0.85 : 0.6, textH(l, tw, z) + 0.28);
    const p = pick(sizes(...(opt.cands || [28, 26, 24, 22, 20, 18, 16])), (z) => lines.reduce((a, l) => a + H1(l, z), 0) + gap * (n - 1) <= r.h);
    if (!p.ok) warn.push("字太多，这一页可能放不下");
    const hs = lines.map((l) => H1(l, p.v)), total = hs.reduce((a, b) => a + b, 0) + gap * (n - 1);
    const grow = Math.max(0, Math.min(n <= 4 ? 0.42 : 0.3, (r.h - total) / n));
    let y = r.y;
    lines.forEach((l, i) => { const h = hs[i] + grow;
      out.push({ k: "round", name: nm(L, `${path}.${i}`), x: r.x, y, w: r.w, h, fill: soft, text: { anchor: "ctr", inset: [0.8, 0.05, 0.25, 0.05], styles: [{ sz: p.v, c: ink }], paras: P1(l, 0) } });
      if (opt.num) deco({ k: "oval", x: r.x + 0.2, y: y + h / 2 - 0.2, w: 0.4, h: 0.4, fill: "accent1", text: { anchor: "ctr", inset: [0, 0, 0, 0], styles: [{ sz: 14, b: 1, c: "bg1", al: "ctr" }], paras: [{ runs: [{ t: String(i + 1) }] }] } });
      else deco({ k: "oval", x: r.x + 0.31, y: y + h / 2 - 0.09, w: 0.18, h: 0.18, fill: ["accent1", "accent2", "accent3"][i % 3] });
      y += h + gap; });
  };
  const A4 = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];
  const itemParas = (it) => [...P1(it.head, 0), ...(plain(it.body) ? P1(it.body, 1) : [])];

  if (L === "cover" || L === "end") {
    deco({ k: "oval", x: 8.5, y: -1.5, w: 6.4, h: 6.4, fill: "accent1" });
    deco({ k: "oval", x: 10.6, y: 3.7, w: 3.9, h: 3.9, fill: "accent2@88" });
    deco({ k: "oval", x: 7.85, y: 5.0, w: 1.3, h: 1.3, fill: "accent3" });
    const t = pick(sizes(50, 46, 42, 38, 34, 30), (z) => nLines(s.title, 7.2, z) <= (z >= 46 * fs ? 2 : 3));
    out.push({ k: "rect", ph: "title", name: TN, x: 0.9, y: 1.4, w: 7.4, h: 2.9, text: { anchor: "b", inset: [0, 0, 0, 0], styles: [{ sz: t.v, b: 1, c: "#FFFFFF", lh: t.v * 1.22 }], paras: P1(s.title, 0) } });
    deco({ k: "round", x: 0.9, y: 4.5, w: 0.9, h: 0.08, r: 0.04, fill: "accent3" });
    if (plain(s.sub)) out.push({ k: "rect", name: nm(L, "sub"), x: 0.9, y: 4.75, w: 7.2, h: 1.3, text: { inset: [0, 0, 0, 0], styles: [{ sz: Math.round(22 * fs), c: "#FFFFFF@82" }], paras: P1(s.sub, 0) } });
    if (L === "cover" && (s.credit == null || plain(s.credit))) out.push({ k: "rect", name: nm(L, "credit"), x: 0.9, y: 6.72, w: 7.2, h: 0.4, text: { anchor: "ctr", inset: [0, 0, 0, 0], styles: [{ sz: 11, c: "#FFFFFF@55" }], paras: P1(s.credit == null ? "本课件由 AI（捞小智）生成，请老师核对后使用" : s.credit, 0) } });
    return { bg: "tx2", items: out, warn };
  }
  if (L === "section") {
    deco({ k: "oval", x: 8.9, y: 1.2, w: 6.8, h: 6.8, fill: "bg1@12" });
    deco({ k: "oval", x: 10.9, y: -0.9, w: 2.6, h: 2.6, fill: "bg1@16" });
    const t = pick(sizes(46, 42, 38, 34, 30), (z) => nLines(s.title, 8.6, z) <= 2);
    out.push({ k: "rect", ph: "title", name: TN, x: 1.0, y: 1.9, w: 8.8, h: 2.3, text: { anchor: "b", inset: [0, 0, 0, 0], styles: [{ sz: t.v, b: 1, c: "bg1", lh: t.v * 1.22 }], paras: P1(s.title, 0) } });
    deco({ k: "round", x: 1.0, y: 4.4, w: 0.9, h: 0.08, r: 0.04, fill: "bg1" });
    if (plain(s.sub)) out.push({ k: "rect", name: nm(L, "sub"), x: 1.0, y: 4.65, w: 8.6, h: 1.4, text: { inset: [0, 0, 0, 0], styles: [{ sz: Math.round(20 * fs), c: "bg1@88" }], paras: P1(s.sub, 0) } });
    return { bg: "accent1", items: out, warn };
  }
  if (L === "statement") {
    deco({ k: "oval", x: 10.4, y: 4.4, w: 4.6, h: 4.6, fill: "accent1@30" });
    deco({ k: "rect", x: 0.85, y: 0.55, w: 2.2, h: 1.9, text: { inset: [0, 0, 0, 0], styles: [{ sz: 130, b: 1, c: "accent1", lh: 130 }], paras: [{ runs: [{ t: "“" }] }] } });
    const t = pick(sizes(42, 38, 34, 30, 26, 22), (z) => textH(s.title, 10.4, z) <= 2.8);
    out.push({ k: "rect", ph: "title", name: TN, x: 1.45, y: 1.95, w: 10.4, h: 2.9, text: { anchor: "ctr", inset: [0, 0, 0, 0], styles: [{ sz: t.v, b: 1, c: "#FFFFFF", lh: t.v * 1.3 }], paras: P1(s.title, 0) } });
    if (plain(s.sub)) out.push({ k: "rect", name: nm(L, "sub"), x: 1.45, y: 5.0, w: 9.2, h: 1.3, text: { inset: [0, 0, 0, 0], styles: [{ sz: Math.round(20 * fs), c: "#FFFFFF@78" }], paras: P1(s.sub, 0) } });
    return { bg: "tx2", items: out, warn };
  }

  frame();
  if (L === "bullets" || L === "summary") {
    const tk = takeaway(s.takeaway), img = s.image;
    rows(s.lines || [], { x: B.x, y: B.y, w: img ? 6.85 : B.w, h: B.h - tk }, "lines", { num: L === "summary" });
    if (img) out.push({ k: "pic", xml: img, name: nm(L, "image"), x: 7.9, y: B.y, w: 4.68, h: B.h - tk });
  } else if (L === "cards") {
    const it = s.items || [], n = it.length, cols = n <= 3 ? n : n === 4 ? 2 : 3, rws = Math.ceil(n / cols), gap = 0.25;
    const w = (B.w - gap * (cols - 1)) / cols, hMax = (B.h - gap * (rws - 1)) / rws, row1 = rws === 1;
    const need = (z) => Math.max(...it.map((c) => textH(c.head, w - 0.6, z[0], 1.25) + (plain(c.body) ? textH(c.body, w - 0.6, z[1], 1.38) + 0.1 : 0))) + (row1 ? 1.25 : 0.4);
    const p = pick([[28, 20], [26, 19], [24, 18], [22, 17], [20, 16], [18, 14], [16, 13]].map((z) => sizes(...z)), (z) => need(z) <= (row1 ? hMax - 0.5 : hMax));   // 最小 16 / 13 磅：再小后排看不清，宁可拆页
    if (!p.ok) warn.push("卡片里的字太多，可能放不下");
    const h = row1 ? Math.min(hMax, Math.max(3.3, need(p.v) + 0.5)) : hMax, y0 = B.y + (row1 ? (B.h - h) * 0.3 : 0);
    it.forEach((c, i) => { const x = B.x + (i % cols) * (w + gap), y = y0 + Math.floor(i / cols) * (h + gap);
      // 一排的：编号在上面、字在下面；两排的：编号在左边、字在右边
      out.push({ k: "round", name: nm(L, `items.${i}`), x, y, w, h, fill: soft, text: { anchor: row1 ? "t" : "ctr", inset: row1 ? [0.3, 1.0, 0.3, 0.2] : [1.0, 0.12, 0.25, 0.12], styles: [{ sz: p.v[0], b: 1, c: ink, lh: p.v[0] * 1.25, after: 5 }, { sz: p.v[1], c: dark ? "#FFFFFF@82" : "tx1@82", lh: p.v[1] * 1.38 }], paras: itemParas(c) } });
      deco({ k: "oval", x: x + (row1 ? 0.3 : 0.25), y: row1 ? y + 0.3 : y + h / 2 - 0.26, w: 0.52, h: 0.52, fill: A4[i % 6], text: { anchor: "ctr", inset: [0, 0, 0, 0], styles: [{ sz: 16, b: 1, c: "bg1", al: "ctr" }], paras: [{ runs: [{ t: String(i + 1) }] }] } }); });
  } else if (L === "steps") {
    const it = s.items || [], n = it.length, gap = 0.3, w = (B.w - gap * (n - 1)) / n;
    const need = (z) => Math.max(...it.map((c) => textH(c.head, w - 0.4, z[0], 1.25) + (plain(c.body) ? textH(c.body, w - 0.4, z[1], 1.38) + 0.1 : 0))) + 0.5;
    const p = pick([[26, 18], [24, 17], [22, 16], [20, 15], [18, 14], [16, 13]].map((z) => sizes(...z)), (z) => need(z) <= B.h - 1.3 - (z[0] > 22 * fs ? 0.6 : 0));
    if (!p.ok) warn.push("步骤里的字太多，可能放不下");
    const h = Math.min(B.h - 1.3, Math.max(2.5, need(p.v) + 0.4)), off = (B.h - 1.3 - h) * 0.35, cy = B.y + 0.5 + off, top = B.y + 1.3 + off;
    if (n > 1) deco({ k: "rect", x: B.x + w / 2, y: cy - 0.03, w: (w + gap) * (n - 1), h: 0.06, fill: "accent1@35" });
    it.forEach((c, i) => { const x = B.x + i * (w + gap);
      deco({ k: "oval", x: x + w / 2 - 0.5, y: cy - 0.5, w: 1.0, h: 1.0, fill: "bg1" });
      deco({ k: "oval", x: x + w / 2 - 0.42, y: cy - 0.42, w: 0.84, h: 0.84, fill: "accent1", text: { anchor: "ctr", inset: [0, 0, 0, 0], styles: [{ sz: 24, b: 1, c: "bg1", al: "ctr" }], paras: [{ runs: [{ t: String(i + 1) }] }] } });
      out.push({ k: "round", name: nm(L, `items.${i}`), x, y: top, w, h, fill: soft, text: { anchor: "t", inset: [0.2, 0.25, 0.2, 0.2], styles: [{ sz: p.v[0], b: 1, c: ink, al: "ctr", lh: p.v[0] * 1.25, after: 5 }, { sz: p.v[1], c: "tx1@82", al: "ctr", lh: p.v[1] * 1.38 }], paras: itemParas(c) } }); });
  } else if (L === "compare") {
    const tk = takeaway(s.takeaway), gap = 0.75, w = (B.w - gap) / 2, hh = 0.74, bh = B.h - tk - hh - 0.12;
    const sides = [["left", "accent1", B.x], ["right", "accent2", B.x + w + gap]];
    const all = sides.flatMap(([k]) => ((s[k] || {}).lines || []));
    const need = (z, ls) => ls.reduce((a, l) => a + textH(l, w - 0.9, z, 1.4) + (z * 0.45) / 72, 0) + 0.4;
    const p = pick(sizes(22, 20, 18, 16, 14), (z) => sides.every(([k]) => need(z, (s[k] || {}).lines || []) <= bh));
    if (!p.ok && all.length) warn.push("两栏里的字太多，可能放不下");
    for (const [k, c, x] of sides) { const d = s[k] || {};
      out.push({ k: "round", name: nm(L, `${k}.head`), x, y: B.y, w, h: hh, fill: c, text: { anchor: "ctr", inset: [0.25, 0, 0.25, 0], styles: [{ sz: Math.round(20 * fs), b: 1, c: "bg1", al: "ctr" }], paras: P1(d.head || "", 0) } });
      out.push({ k: "round", name: nm(L, `${k}.lines`), x, y: B.y + hh + 0.12, w, h: bh, fill: soft, text: { anchor: "t", inset: [0.3, 0.22, 0.3, 0.15], styles: [{ sz: p.v, c: ink, lh: p.v * 1.4, after: p.v * 0.45, bu: c }], paras: (d.lines && d.lines.length ? d.lines : [""]).map((l) => ({ runs: runsOf(l) })) } }); }
    deco({ k: "oval", x: B.x + w + gap / 2 - 0.36, y: B.y + hh / 2 - 0.36, w: 0.72, h: 0.72, fill: "bg1" });
    deco({ k: "oval", x: B.x + w + gap / 2 - 0.3, y: B.y + hh / 2 - 0.3, w: 0.6, h: 0.6, fill: "tx2", text: { anchor: "ctr", inset: [0, 0, 0, 0], styles: [{ sz: 12, b: 1, c: "#FFFFFF", al: "ctr" }], paras: [{ runs: [{ t: "VS" }] }] } });
  } else if (L === "code") {
    const lines = s.lines || [], side = lines.length ? 4.5 : 0, px = B.x + (side ? side + 0.3 : 0), pw = B.w - (side ? side + 0.3 : 0);
    if (side) rows(lines, { x: B.x, y: B.y, w: side, h: B.h }, "lines", { cands: [20, 18, 16, 14, 13, 12] });
    const code = plain(s.code).replace(/\t/g, "    ").replace(/\s+$/, "").split("\n");
    const longest = Math.max(1, ...code.map((l) => units(l, true)));
    const z = Math.max(9, Math.min(Math.round(20 * fs), Math.floor(((pw - 0.7) * 72) / longest), Math.floor(((B.h - 0.95) * 72) / (code.length * 1.32))));
    if (z <= 9 && (longest * 9 > (pw - 0.7) * 72 || code.length * 9 * 1.32 > (B.h - 0.95) * 72)) warn.push("代码太长，这一页可能放不下");
    out.push({ k: "round", name: nm(L, "."), x: px, y: B.y, w: pw, h: B.h, fill: "tx2", r: 0.16 });
    [["#FF5F57", 0], ["#FEBC2E", 1], ["#28C840", 2]].forEach(([c, i]) => deco({ k: "oval", x: px + 0.28 + i * 0.24, y: B.y + 0.22, w: 0.14, h: 0.14, fill: c }));
    out.push({ k: "rect", name: nm(L, "lang"), x: px + pw - 2.3, y: B.y + 0.1, w: 2.0, h: 0.38, text: { anchor: "ctr", inset: [0, 0, 0, 0], styles: [{ sz: 11, c: "#FFFFFF@60", al: "r" }], paras: P1(s.lang || "", 0) } });
    out.push({ k: "rect", name: nm(L, "code"), x: px + 0.3, y: B.y + 0.58, w: pw - 0.6, h: B.h - 0.78, text: { nowrap: true, anchor: "t", inset: [0, 0, 0, 0], styles: [{ sz: z, c: "#F2F5FA", mono: true, lh: z * 1.32 }], paras: code.map((l) => ({ runs: [{ t: l }] })) } });
  } else if (L === "table") {
    const tk = takeaway(s.takeaway), t = tableItem(s.table || [], { x: B.x, y: B.y, w: B.w, h: B.h - tk }, { fs });
    if (!t.ok) warn.push("表格太大，这一页可能放不下");
    out.push({ ...t.item, name: nm(L, "table") });
  } else if (L === "formula") {
    const lines = s.lines || [], latex = M.clean(plain(s.formula)), nr = latex.split(/\\\\/).length, lin = M.linear(latex);
    const ph = lines.length ? Math.min(3.2, Math.max(1.7, 0.9 + nr * 0.75)) : B.h;
    const z = Math.max(18, Math.min(Math.round((lines.length ? 34 : 40) * fs), Math.floor((10.6 * 72) / Math.max(4, units(lin) / nr) / 0.62)));
    deco({ k: "round", x: B.x, y: B.y, w: B.w, h: ph, fill: "bg2", r: 0.16 });
    deco({ k: "round", x: B.x, y: B.y + 0.3, w: 0.09, h: ph - 0.6, r: 0.045, fill: "accent1" });
    out.push({ k: "formula", name: nm(L, "formula"), x: B.x + 0.4, y: B.y + 0.1, w: B.w - 0.8, h: ph - 0.2, latex, sz: z });
    if (lines.length) rows(lines, { x: B.x, y: B.y + ph + 0.2, w: B.w, h: B.h - ph - 0.2 }, "lines", { cands: [22, 20, 18, 16, 14, 13] });
  } else throw new Error("没有这种版式：" + L);
  return { bg: dark ? "tx2" : null, items: out, warn };
}

// ---------- 内容整理 ----------
const tidy = (v) => { if (v && typeof v === "object" && v.runs) return v;
  return String(v == null ? "" : v).replace(/\r/g, "").replace(/`([^`]*)`/g, "$1").replace(/\$\$?([^$\n]{1,200})\$\$?/g, (_, f) => M.linear(M.clean(f))).replace(/^\s*(?:[•·●○◆▪■▶]+\s*|[-*—–]\s+|\(?\d{1,2}[.、)）](?!\d)\s*)/, "").replace(/[ \t]+/g, " ").trim(); };
const arr = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : typeof v === "string" ? v.split(/\n+/) : [v]);
const linesOf = (v) => arr(v).map(tidy).filter((x) => plain(x));
function itemOf(v) {
  if (v && typeof v === "object" && !v.runs) return { head: tidy(v.head != null ? v.head : v.title != null ? v.title : v.name), body: Array.isArray(v.body) ? v.body.map(tidy).join("\n") : tidy(v.body != null ? v.body : v.text != null ? v.text : v.desc) };
  const rich = v && v.runs ? v : null, t = plain(rich || tidy(v)), m = /^(.{1,16}?)[：:]\s*(.+)$/s.exec(t);
  if (rich) return m ? { head: cut(rich, 0, m[1].length), body: cut(rich, t.length - m[2].length) } : { head: rich, body: "" };   // 加过粗、上过色的字带着
  return m ? { head: m[1], body: m[2] } : { head: t, body: "" };
}
// 取一段文字的 [a, b)、把几段接起来：格式带着
function cut(v, a, b = Infinity) {
  const out = []; let pos = 0;
  for (const r of v.runs) { const s = Math.max(a, pos), e = Math.min(b, pos + r.t.length); if (e > s) out.push({ ...r, t: r.t.slice(s - pos, e - pos) }); pos += r.t.length; }
  return { runs: out };
}
const join = (...vs) => (vs.some((v) => v && v.runs) ? { runs: vs.flatMap((v) => (v && v.runs ? v.runs : plain(v) ? [{ t: plain(v) }] : [])) } : vs.map(plain).join(""));
const sideOf = (v, name) => (v && typeof v === "object" && !Array.isArray(v) ? { head: tidy(v.head != null ? v.head : v.title != null ? v.title : name), lines: linesOf(v.lines != null ? v.lines : v.items) } : { head: name, lines: linesOf(v) });
const itemLine = (it) => (plain(it.body) ? join(it.head, plain(it.head) ? "：" : "", it.body && it.body.runs ? it.body : plain(it.body).replace(/\n/g, "；")) : it.head);
const sideLines = (s) => ["left", "right"].flatMap((k) => (!s[k] ? [] : plain(s[k].head) ? [plain(s[k].head) + "：" + s[k].lines.map(plain).join("；")] : s[k].lines)).filter((x) => plain(x));

const ALIAS = { title: "cover", bullet: "bullets", list: "bullets", points: "bullets", card: "cards", grid: "cards", step: "steps", process: "steps", flow: "steps", vs: "compare", two: "compare", twocol: "compare", quote: "statement", key: "statement", thanks: "end", ending: "end", conclusion: "summary", formulas: "formula", math: "formula", tables: "table",
  封面: "cover", 章节: "section", 章节页: "section", 要点: "bullets", 卡片: "cards", 步骤: "steps", 流程: "steps", 对比: "compare", 两栏: "compare", 金句: "statement", 代码: "code", 表格: "table", 公式: "formula", 小结: "summary", 总结: "summary", 结束: "end", 结束页: "end" };
const layoutKey = (x) => { let L = String(x || "").trim().toLowerCase(); L = ALIAS[L] || L; return LAYOUTS[L] ? L : ""; };
// 模型给的一页（字段随它写，缺的、多的都容忍）→ 规整的一页；layout 没写就按内容挑一个
function normalize(raw, o = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const s = { title: tidy(r.title), sub: tidy(r.sub != null ? r.sub : r.subtitle), takeaway: tidy(r.takeaway != null ? r.takeaway : r.note), lines: linesOf(r.lines != null ? r.lines : r.points != null ? r.points : r.bullets),
    items: arr(r.items != null ? r.items : r.cards != null ? r.cards : r.steps).map(itemOf).filter((x) => plain(x.head) || plain(x.body)),
    left: r.left != null ? sideOf(r.left, tidy(r.left_title) || "") : null, right: r.right != null ? sideOf(r.right, tidy(r.right_title) || "") : null,
    code: r.code == null ? "" : String(Array.isArray(r.code) ? r.code.join("\n") : r.code).replace(/\r/g, "").replace(/^```\w*\n?|\n?```\s*$/g, ""), lang: tidy(r.lang != null ? r.lang : r.language),
    formula: r.formula == null ? "" : M.clean(String(r.formula)), table: Array.isArray(r.table) ? r.table.filter(Array.isArray).map((x) => x.map(tidy)) : Array.isArray(r.rows) ? r.rows.filter(Array.isArray).map((x) => x.map(tidy)) : [],
    notes: r.notes == null ? "" : String(r.notes).trim(), image: typeof r.image === "string" && r.image.startsWith("<p:pic") ? r.image : null, credit: r.credit == null ? undefined : tidy(r.credit) };
  let L = layoutKey(r.layout);
  const t = plain(s.title);
  if (!L) L = s.code.trim() ? "code" : s.table.length >= 2 ? "table" : s.formula ? "formula" : s.left && s.right ? "compare" : s.items.length >= 2 ? "cards"
    : /^(小结|总结|本节小结|课堂小结|回顾|本课小结)/.test(t) && s.lines.length ? "summary"
    : s.lines.length >= 2 && s.lines.length <= 6 && !s.image && s.lines.every((l) => /^.{1,12}?[：:]\s*\S/.test(plain(l))) && o.auto !== false ? "cards" : s.lines.length ? "bullets" : o.first ? "cover" : "statement";
  // 版式要的那一块没有：从别的块里凑（比如模型给了 lines 却要卡片）
  if (["cards", "steps"].includes(L) && !s.items.length) s.items = (s.lines.length ? s.lines : sideLines(s)).map(itemOf);
  if (["bullets", "summary"].includes(L) && !s.lines.length) s.lines = s.items.length ? s.items.map(itemLine) : sideLines(s);
  if (L === "compare") {
    if (!s.left || !s.right) { const src = s.items.length ? s.items : s.lines.map(itemOf);
      if (src.length === 2) { s.left = { head: src[0].head, lines: linesOf(plain(src[0].body).split(/[；;\n]/)) }; s.right = { head: src[1].head, lines: linesOf(plain(src[1].body).split(/[；;\n]/)) }; }
      else { const h = Math.ceil(src.length / 2), f = (a) => a.map(itemLine); s.left = s.left || { head: "", lines: f(src.slice(0, h)) }; s.right = s.right || { head: "", lines: f(src.slice(h)) }; } }
  }
  if (["code", "formula"].includes(L) && !s.lines.length && s.items.length) s.lines = s.items.map(itemLine);
  if (["statement", "section", "cover", "end"].includes(L) && !plain(s.sub) && s.lines.length && s.lines.length <= 3) s.sub = s.lines.map(plain).join("\n");
  if (L === "code" && !s.code.trim()) throw new Error("代码页要有代码（code）");
  if (L === "formula" && !s.formula) throw new Error("公式页要有公式（formula，写 LaTeX）");
  if (L === "table" && s.table.length < 2) throw new Error("表格页要有表格（table：第一行是表头，至少再有一行）");
  if (["cards", "steps"].includes(L) && s.items.length < 2) { if (s.items.length) { L = "bullets"; s.lines = s.items.map(itemLine); } else throw new Error((L === "cards" ? "卡片" : "步骤") + "页至少要两项（items）"); }
  if (["bullets", "summary"].includes(L) && !s.lines.length) { if (t) L = "statement"; else throw new Error("这一页没有内容"); }
  if (!t && !["code", "table", "formula"].includes(L)) { if (L === "statement" && plain(s.sub)) { s.title = s.sub; s.sub = ""; } else if (!["cover", "section", "statement", "end"].includes(L)) s.title = ""; else throw new Error("这一页要有标题（title）"); }
  return { ...s, layout: L };
}
// 一页放不下就拆成几页（标题后面加「（续）」）
function split(s) {
  const more = (x, i) => (i ? { ...x, title: plain(x.title) + "（续）", takeaway: "" } : x), chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
  const even = (a, max) => { const k = Math.ceil(a.length / max); return chunk(a, Math.ceil(a.length / k)); };
  const L = s.layout;
  if (["bullets", "summary"].includes(L)) {
    const fits = (ls) => layout(L, { ...s, lines: ls }, {}).warn.length === 0;
    if (s.lines.length > 7 || !fits(s.lines)) { let n = Math.min(7, s.lines.length); for (; n > 1; n--) if (even(s.lines, n).every(fits)) break; return even(s.lines, Math.max(1, n)).map((ls, i, all) => more({ ...s, lines: ls, takeaway: i === all.length - 1 ? s.takeaway : "", image: i ? null : s.image }, i)); }
  }
  if (L === "cards" || L === "steps") {      // 太多项、或者字多到最小字号也放不下：分成两页（每页至少两项）
    const max = L === "cards" ? 6 : 5, fits = (it) => layout(L, { ...s, items: it }, {}).warn.length === 0;
    if (s.items.length > max || (s.items.length >= 4 && !fits(s.items))) { let n = Math.min(max, s.items.length - (s.items.length > max ? 0 : 1)); for (; n > 2; n--) if (even(s.items, n).every((c) => c.length >= 2 && fits(c))) break; const parts = even(s.items, Math.max(2, n)); if (parts.every((c) => c.length >= 2)) return parts.map((it, i) => more({ ...s, items: it }, i)); }
  }
  if (L === "code") { const ls = s.code.replace(/\s+$/, "").split("\n"); if (ls.length > 22) return even(ls, 20).map((c, i) => more({ ...s, code: c.join("\n"), lines: i ? [] : s.lines }, i)); }
  if (L === "table" && s.table.length > 9) return even(s.table.slice(1), 8).map((rs, i) => more({ ...s, table: [s.table[0], ...rs] }, i));
  return [s];
}

// ---------- 画一页 / 把一页读回来 ----------
// 返回 { bg：整页底色（主题色名）或者 null, xml：<p:spTree> 里面这一页自己的那些形状, warn, nextId }
function render(spec, o = {}) {
  const lay = layout(spec.layout, spec, { fs: o.fs || spec.fs || 1 });
  const e = emit(lay.items, { W: o.W || 12192000, H: o.H || 6858000, idFrom: o.idFrom || 2 });
  return { bg: lay.bg, xml: e.xml, nextId: e.nextId, warn: lay.warn };
}
const lzName = (name) => { const m = /^lz:([a-z]+)\|([^?]*)(?:\?(.*))?$/.exec(name || ""); return m ? { layout: m[1], path: m[2], q: Object.fromEntries((m[3] || "").split("&").filter(Boolean).map((x) => x.split("="))) } : null; };
// 一个框里的每一段 → 字符串；有哪几个字单独加了粗、颜色、底色（rPr 上有东西）就带着：{ runs }
function parasOf(xml) {
  const out = [];
  for (const p of String(xml).matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p [^>]*>([\s\S]*?)<\/a:p>/g)) {
    const inner = p[1] != null ? p[1] : p[2], runs = []; let rich = false;
    for (const m of inner.matchAll(/<a:r>([\s\S]*?)<\/a:r>|<a:fld\b[^>]*>([\s\S]*?)<\/a:fld>|<a:br\b[^>]*\/>|<a:br\b[^>]*>[\s\S]*?<\/a:br>/g)) {
      if (m[0].startsWith("<a:br")) { runs.push({ t: "\n" }); continue; }
      const r = m[1] != null ? m[1] : m[2], t = [...r.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => unesc(x[1])).join("");
      const pr = /<a:rPr\b([^>]*?)(\/>|>([\s\S]*?)<\/a:rPr>)/.exec(r);
      const a = pr ? pr[1].replace(/\s(?:lang|altLang|dirty|err|smtClean|noProof)="[^"]*"/g, "").replace(/\s+$/, "") : "", x = pr && pr[3] ? pr[3] : "";
      if (a || x) rich = true;
      runs.push({ t, ...(a ? { a } : {}), ...(x ? { x } : {}) });
    }
    out.push(rich ? { runs } : runs.map((r) => r.t).join(""));
  }
  return out;
}
const tableOf = (xml) => [...String(xml).matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map((tr) => [...tr[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((tc) => parasOf(tc[0]).map(plain).join("\n")));
// shapes：pptedit.shapeList(这一页的 xml)。是「捞小智」排的页就返回 { layout, spec, fs, keep: [不是它排的那些形状的 xml] }，不是就返回 null
function specOf(shapes) {
  const mine = shapes.map((sh) => ({ sh, z: lzName(sh.name) })).filter((x) => x.z);
  if (!mine.length) return null;
  const L = mine[0].z.layout, s = { layout: L, title: "", sub: "", takeaway: "", lines: [], items: [], left: null, right: null, code: "", lang: "", formula: "", table: [], image: null, credit: "" };
  let fs = 1;
  const one = (ps) => (ps.length === 1 ? ps[0] : ps.map(plain).join("\n"));
  for (const { sh, z } of mine) {
    if (z.q.fs) fs = +z.q.fs || 1;
    if (z.path === ".") continue;
    const ps = sh.kind === "table" || sh.kind === "picture" ? [] : parasOf(sh.xml), [k, i, sub] = z.path.split(".");
    if (k === "lines" && i != null) s.lines[+i] = one(ps);
    else if (k === "items") { const body = ps.slice(1); s.items[+i] = { head: ps[0] == null ? "" : ps[0], body: body.length === 1 ? body[0] : body.map(plain).join("\n") }; }
    else if (k === "left" || k === "right") { s[k] = s[k] || { head: "", lines: [] }; if (i === "head") s[k].head = one(ps); else s[k].lines = ps.filter((x) => plain(x)); }
    else if (k === "code") s.code = ps.map(plain).join("\n");
    else if (k === "table") s.table = tableOf(sh.xml);
    else if (k === "formula") { const d = /<p:cNvPr\b[^>]*>/.exec(sh.xml); s.formula = (d && attr(d[0], "descr")) || ""; }
    else if (k === "image") s.image = sh.xml;
    else if (k in s) s[k] = one(ps);
    void sub;
  }
  s.lines = s.lines.filter((x) => x != null && plain(x)); s.items = s.items.filter(Boolean);
  return { layout: L, spec: s, fs, keep: shapes.filter((sh) => !lzName(sh.name)).map((sh) => sh.xml) };
}
// 换版式 / 改内容：patch 里写了的块用 patch 的；没写的，内容尽量带过去（要点 ↔ 卡片 ↔ 步骤 ↔ 两栏）
const MAIN = ["lines", "items", "left", "right", "code", "table", "formula"];
function convert(spec, patch = {}) {
  const L = layoutKey(patch.layout) || spec.layout, given = MAIN.filter((k) => patch[k] != null);
  const base = L !== spec.layout && given.length ? { title: spec.title, sub: spec.sub, takeaway: spec.takeaway, image: spec.image, credit: spec.credit } : { ...spec };
  if (given.length && L === spec.layout) {       // 版式没换、给的却是另一种块（卡片页给了 lines）：按给的重新凑
    if (["cards", "steps"].includes(L) && patch.items == null) base.items = [];
    if (["bullets", "summary"].includes(L) && patch.lines == null) base.lines = [];
    if (L === "compare" && patch.left == null && patch.right == null) base.left = base.right = null;
  }
  return normalize({ ...base, ...patch, layout: L }, { auto: false });
}

// ---------- 整份空白的 .pptx ----------
const REL = (id, type, target) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
const RELS = (inner) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const TREE0 = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const NSS = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;
function themeXml(t) {
  const f = `<a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/><a:cs typeface=""/>`, ph = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  return `${HEAD}<a:theme xmlns:a="${NS_A}" name="${esc("捞小智·" + t.name)}"><a:themeElements>${clrScheme(t)}<a:fontScheme name="捞小智"><a:majorFont>${f}</a:majorFont><a:minorFont>${f}</a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="捞小智"><a:fillStyleLst>${ph.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${[6350, 12700, 19050].map((w) => `<a:ln w="${w}">${ph}</a:ln>`).join("")}</a:lnStyleLst><a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${ph.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}
const slideXml = (r) => `${HEAD}<p:sld ${NSS}><p:cSld>${r.bg ? `<p:bg><p:bgPr>${fill(r.bg)}<a:effectLst/></p:bgPr></p:bg>` : ""}<p:spTree>${TREE0}${r.xml}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
// 一份只有母版、还没有页的 .pptx（Buffer）。页由 pptedit 的 addDesigned 一页一页加
async function blank(o = {}) {
  const t = themeOf({ theme: o.theme || "blue", color: o.color }), z0 = new JSZip(), zip = { file: (p, c) => z0.file(p, c, { createFolders: false }) };
  const W = 12192000, H = 6858000;
  const lvl = (i, sz) => `<a:lvl${i}pPr marL="${(i - 1) * 457200}" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="${sz}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${i}pPr>`;
  const ph = (id, name, type, x, y, w, h, extra = "") => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph ${type}/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr${extra}/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN" altLang="en-US"/></a:p></p:txBody></p:sp>`;
  const tb = ph(2, "标题", 'type="title"', 685800, 457200, 9966960, 960120, ' anchor="ctr"'), bd = ph(3, "内容", 'type="body" idx="1"', 685800, 1600200, 10817352, 4526280);
  zip.file("[Content_Types].xml", `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>` +
    [["/ppt/presentation.xml", "presentationml.presentation.main"], ["/ppt/slideMasters/slideMaster1.xml", "presentationml.slideMaster"], ["/ppt/slideLayouts/slideLayout1.xml", "presentationml.slideLayout"], ["/ppt/slideLayouts/slideLayout2.xml", "presentationml.slideLayout"], ["/ppt/theme/theme1.xml", "theme"], ["/docProps/app.xml", "extended-properties"]].map(([p, c]) => `<Override PartName="${p}" ContentType="application/vnd.openxmlformats-officedocument.${c}+xml"/>`).join("") +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.file("_rels/.rels", RELS(REL("rId1", "officeDocument", "ppt/presentation.xml") + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` + REL("rId3", "extended-properties", "docProps/app.xml")));
  const now = (o.now || new Date()).toISOString().replace(/\.\d+Z$/, "Z");
  zip.file("docProps/core.xml", `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(o.title || "")}</dc:title><dc:creator>捞小智</dc:creator><cp:lastModifiedBy>捞小智</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  zip.file("docProps/app.xml", `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><TotalTime>0</TotalTime><Application>Microsoft Office PowerPoint</Application><PresentationFormat>宽屏</PresentationFormat><Slides>0</Slides></Properties>`);
  zip.file("ppt/presentation.xml", `${HEAD}<p:presentation ${NSS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst></p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="${H}" cy="${W}"/><p:defaultTextStyle>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => lvl(i, 1800)).join("")}</p:defaultTextStyle></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", RELS(REL("rId1", "slideMaster", "slideMasters/slideMaster1.xml") + REL("rId2", "theme", "theme/theme1.xml")));
  zip.file("ppt/theme/theme1.xml", themeXml(t));
  zip.file("ppt/slideMasters/slideMaster1.xml", `${HEAD}<p:sldMaster ${NSS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${TREE0}${tb}${bd}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst>` +
    `<p:txStyles><p:titleStyle><a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="3200" b="1" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<a:lvl${i}pPr marL="${i * 342900}" indent="-342900" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="110000"/></a:lnSpc><a:spcBef><a:spcPts val="800"/></a:spcBef><a:buClr><a:schemeClr val="accent1"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="${Math.max(1600, 2400 - (i - 1) * 200)}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${i}pPr>`).join("")}</p:bodyStyle><p:otherStyle>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => lvl(i, 1800)).join("")}</p:otherStyle></p:txStyles></p:sldMaster>`);
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", RELS(REL("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml") + REL("rId2", "slideLayout", "../slideLayouts/slideLayout2.xml") + REL("rId3", "theme", "../theme/theme1.xml")));
  const lay = (name, type, inner) => `${HEAD}<p:sldLayout ${NSS} type="${type}" preserve="1"><p:cSld name="${name}"><p:spTree>${TREE0}${inner}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  zip.file("ppt/slideLayouts/slideLayout1.xml", lay("捞小智", "titleOnly", tb));          // 捞小智排的页都挂在这个版式上（只有标题，别的都画在页面上）
  zip.file("ppt/slideLayouts/slideLayout2.xml", lay("标题和内容", "obj", tb + bd));        // 老师自己在 PowerPoint 里「新建幻灯片」用的
  for (const n of [1, 2]) zip.file(`ppt/slideLayouts/_rels/slideLayout${n}.xml.rels`, RELS(REL("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")));
  return z0.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

module.exports = { THEMES, LAYOUTS, DARK, layoutKey, MAIN, emit, tableItem, EMU, DW, DH, NSS, HEAD, RELS, REL1: REL, themeOf, clrScheme, themeXml, normalize, split, render, specOf, convert, lzName, parasOf, tableOf, plain, runsOf, units, nLines, slideXml, blank, fill, clr, TREE0, itemLine };
