// 捞捞PPT助手 · 按老师的要求改 PPT（给本地大模型调用的「工具」都在这里）
//   读：outline() 整份的大纲、slide(no) 一页上有哪些文字框
//   改：setText 改某个框的文字、replace 全文替换、addSlide 加一页、deleteSlide 删一页、moveSlide 挪位置、insertFormula 插公式
//   排版：addDesigned 加一页排好版的（版式引擎 core/deck.js）、editSlide 换版式 / 重写一页、setTheme 换配色、scaleFont 调字号、
//         formatText 给某几个字加粗 / 上色 / 标底色、insertTable 插表格、insertImage 放图片、setNotes 写备注、duplicateSlide 复制一页、
//         deleteShape 删一个框、check 自己检查一遍（放不下、没标题、重复…）、preview 一页画成 SVG（界面上直接看，不用开 PowerPoint）
//   每一步都能 undo；save() 出新的 .pptx（原文件不动）。
// 直接改 pptx 里的 XML（和 core/pptx.js 一样的做法），原来的动画、母版、图片都不碰。
"use strict";
const JSZip = require("jszip");
const X = require("./pptx");
const M = require("./latex2omml");
const D = require("./deck");

const { esc, attr, parseRels, relsXml, nextRid, resolve, relsPath, box, maxShapeId, REL, CT_SLIDE, NS_R } = X;
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_M = "http://schemas.openxmlformats.org/officeDocument/2006/math";

// 一页里最外层的形状（<p:sp>，包括包在公式 mc:AlternateContent 里的）
function shapeList(xml) {
  const out = [];
  const tree = /<p:spTree>([\s\S]*)<\/p:spTree>/.exec(xml);
  if (!tree) return out;
  const re = /<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent>|<p:sp>[\s\S]*?<\/p:sp>|<p:sp [^>]*>[\s\S]*?<\/p:sp>|<p:pic\b[\s\S]*?<\/p:pic>|<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>|<p:grpSp>[\s\S]*?<\/p:grpSp>|<p:cxnSp\b[\s\S]*?<\/p:cxnSp>/g;
  const base = tree.index + "<p:spTree>".length;
  for (const m of tree[1].matchAll(re)) {
    const x = m[0], start = base + m.index;
    const nv = /<p:cNvPr\b[^>]*>/.exec(x);
    const ph = /<p:ph\b[^>]*\/?>/.exec(x);
    const kind = x.startsWith("<mc:") ? (/<a14:m>|<m:oMath/.test(x) ? "formula" : "other") : x.startsWith("<p:pic") ? "picture" : x.startsWith("<p:graphicFrame") ? (/<a:tbl>/.test(x) ? "table" : "chart") : x.startsWith("<p:grpSp") ? "group" : x.startsWith("<p:cxnSp") ? "line" : "text";
    const name = nv ? attr(nv[0], "name") || "" : "";
    out.push({ start, end: start + x.length, xml: x, id: nv ? +attr(nv[0], "id") : 0, name, lz: D.lzName(name), ph: ph ? attr(ph[0], "type") || "body" : null, kind, text: X.paragraphs(x) });
  }
  return out;
}
const TITLE = (s) => s.ph === "title" || s.ph === "ctrTitle";
const DECO = (s) => !!(s.lz && s.lz.path === ".");                       // 捞小智画的装饰（圆点、编号、页码…）：不给模型看，重排的时候重画
const FOOT = (s) => ["sldNum", "dt", "ftr"].includes(s.ph);
const KIND = { formula: "公式", picture: "图片", table: "表格", chart: "图表", group: "组合", line: "线条" };
const ROLE = (z) => { if (!z) return null; const [k, i] = z.path.split("."); return { title: "标题", sub: "副标题", takeaway: "这一页的结论", lines: `第 ${+i + 1} 条要点`, items: `第 ${+i + 1} 项`, left: i === "head" ? "左栏标题" : "左栏内容", right: i === "head" ? "右栏标题" : "右栏内容", code: "代码", lang: "代码的语言", table: "表格", formula: "公式", image: "图片", credit: "封面下面的说明" }[k] || null; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// 颜色：#RRGGBB、中文 / 英文的颜色名、主题色（accent1 … / 主色）
const COLORS = { 红: "D92D20", red: "D92D20", 橙: "EA580C", orange: "EA580C", 黄: "CA8A04", yellow: "CA8A04", 绿: "15803D", green: "15803D", 青: "0E7490", cyan: "0E7490", 蓝: "1D4ED8", blue: "1D4ED8", 紫: "7E22CE", purple: "7E22CE", 粉: "DB2777", pink: "DB2777", 棕: "92400E", brown: "92400E", 灰: "6B7280", gray: "6B7280", grey: "6B7280", 黑: "000000", black: "000000", 白: "FFFFFF", white: "FFFFFF" };
const HILITE = { 黄: "FFF176", yellow: "FFF176", 绿: "B9F6CA", green: "B9F6CA", 蓝: "BBDEFB", blue: "BBDEFB", 粉: "F8BBD0", pink: "F8BBD0", 橙: "FFE0B2", orange: "FFE0B2", 红: "FFCDD2", red: "FFCDD2", 紫: "E1BEE7", purple: "E1BEE7", 灰: "E5E7EB", gray: "E5E7EB" };
function colorXml(c, table = COLORS) {
  const k = String(c || "").trim().replace(/色$/, "").toLowerCase();
  if (/^(accent[1-6]|tx[12]|bg[12])$/.test(k)) return `<a:schemeClr val="${k}"/>`;
  if (/^(主|主题|强调)$/.test(k)) return '<a:schemeClr val="accent1"/>';
  const h = table[k] || (/^#?[0-9a-f]{6}$/i.test(k) ? k.replace("#", "").toUpperCase() : null);
  if (!h) throw new Error(`不认识这个颜色「${c}」：写颜色名（红、蓝、绿、橙、紫、黄、灰…）或者 #RRGGBB`);
  return `<a:srgbClr val="${h}"/>`;
}
// 图片是什么格式、多大（只看文件头）
function imageInfo(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { ext: "png", w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 10 && buf.slice(0, 3).toString("latin1") === "GIF") return { ext: "gif", w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { ext: "jpeg", w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) }; i += 2 + buf.readUInt16BE(i + 2); }
    return { ext: "jpeg", w: 4, h: 3 };
  }
  throw new Error("这张图片的格式不认识（只支持 PNG、JPG、GIF）");
}

// 这一页上哪一段竖着的空白放得下高 h 的公式：别压在原来的字、图上面。where 是老师说的大概位置
function freeY(xml, W, H, h, where) {
  const busy = [];
  for (const sh of shapeList(xml)) {
    const m = /<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/.exec(sh.xml);
    if (!m) continue;
    const y0 = +m[2], y1 = y0 + +m[4];
    if (+m[3] < W * 0.02 || +m[4] <= 0) continue;
    busy.push([y0, y1]);
  }
  busy.sort((a, b) => a[0] - b[0]);
  const top = H * 0.04, bot = H * 0.96, gaps = [];
  let cur = top;
  for (const [a, b] of busy) { if (a - cur >= h) gaps.push([cur, a]); cur = Math.max(cur, b); }
  if (bot - cur >= h) gaps.push([cur, bot]);
  const want = { top: H * 0.25, middle: H * 0.5, bottom: H * 0.8 }[where] || H * 0.65;
  if (!gaps.length) return { y: H - h - H * 0.01, crowded: true };   // 实在没地方：放在最下面，告诉老师
  const at = (g) => Math.max(g[0], Math.min(g[1] - h, want - h / 2));
  gaps.sort((p, q) => Math.abs(at(p) + h / 2 - want) - Math.abs(at(q) + h / 2 - want));
  return { y: at(gaps[0]), crowded: false };
}

async function load(buf) {
  const zip = await JSZip.loadAsync(buf);
  const has = (p) => !!zip.file(p);
  const txt = async (p) => { const f = zip.file(p); return f ? f.async("string") : null; };
  if (!has("ppt/presentation.xml")) throw new Error("这不是 PowerPoint 文件（.pptx）");
  // 改动记录：每一步改了哪些文件、改之前是什么（撤销用）
  const history = []; let tx = null;
  const put = async (p, content) => { if (tx && !tx.has(p)) tx.set(p, has(p) ? await txt(p) : null); zip.file(p, content, { createFolders: false }); };
  const drop = async (p) => { if (!has(p)) return; if (tx && !tx.has(p)) tx.set(p, await txt(p)); zip.remove(p); };
  async function step(label, fn) {
    tx = new Map();
    try { const r = await fn(); if (tx.size) history.push({ label, parts: tx }); return r; }
    catch (e) { for (const [p, c] of tx) { if (c == null) zip.remove(p); else zip.file(p, c, { createFolders: false }); } throw e; }
    finally { tx = null; }
  }

  const pres = () => txt("ppt/presentation.xml");
  const size = async () => { const sz = /<p:sldSz\b[^>]*>/.exec(await pres()); return { cx: sz ? +attr(sz[0], "cx") : 12192000, cy: sz ? +attr(sz[0], "cy") : 6858000 }; };
  async function slides() {
    const p = await pres(), rels = parseRels(await txt("ppt/_rels/presentation.xml.rels"));
    return [...p.matchAll(/<p:sldId\b[^>]*\/>/g)].map((m, i) => {
      const rid = attr(m[0], "r:id"), rel = rels.find((r) => r.id === rid);
      return { no: i + 1, id: +attr(m[0], "id"), rid, tag: m[0], part: rel ? resolve("ppt/presentation.xml", rel.target) : null };
    }).filter((s) => s.part && has(s.part));
  }
  async function get(no) {
    const all = await slides();
    const s = all.find((x) => x.no === +no);
    if (!s) throw new Error(`没有第 ${no} 页（一共 ${all.length} 页）`);
    return { ...s, xml: await txt(s.part), count: all.length };
  }

  // ---------- 读 ----------
  async function outline() {
    const out = [];
    for (const s of await slides()) {
      const xml = await txt(s.part), sh = shapeList(xml), mine = sh.find((x) => x.lz);
      const t = sh.find(TITLE);
      out.push({ no: s.no, title: t ? t.text.join(" ") : "", hidden: /<p:sld\b[^>]*\sshow="0"/.test(xml), ...(mine ? { layout: mine.lz.layout } : {}),
        texts: sh.filter((x) => !TITLE(x) && !DECO(x) && (x.kind === "text" || x.kind === "table") && !FOOT(x) && !(x.lz && x.lz.path === "credit")).flatMap((x) => x.text),
        formulas: sh.filter((x) => x.kind === "formula").length, pictures: sh.filter((x) => x.kind === "picture").length, tables: sh.filter((x) => x.kind === "table").length });
    }
    return out;
  }
  async function slide(no) {
    const s = await get(no), sh = shapeList(s.xml), mine = sh.find((x) => x.lz), nt = await notes(no);
    return { no: s.no, ...(mine ? { layout: mine.lz.layout, layout_name: D.LAYOUTS[mine.lz.layout] || "" } : {}),
      shapes: sh.map((x, i) => ({ shape: i + 1, kind: TITLE(x) ? "title" : x.kind, name: x.lz ? ROLE(x.lz) || x.name : x.name, text: x.kind === "formula" && x.lz ? [(/descr="([^"]*)"/.exec(x.xml) || [])[1] ? X.unesc(/descr="([^"]*)"/.exec(x.xml)[1]) : x.text.join("")] : x.text, deco: DECO(x) })).filter((x) => !x.deco).map(({ deco, ...x }) => x),
      ...(nt ? { notes: nt } : {}) };
  }

  // ---------- 排版（版式引擎 core/deck.js） ----------
  const designed = async () => { for (const s of await slides()) if (shapeList(await txt(s.part)).some((x) => x.lz)) return true; return /<a:theme\b[^>]*\sname="捞小智/.test((await txt(await themePart())) || ""); };
  // 这一页是「捞小智」排的：{ layout, spec, fs, keep }；不是：把标题和文字读出来当要点（图片只有一张就放进版式的图片位，别的原样留着）
  function designOf(sh) {
    const d = D.specOf(sh);
    if (d) return d;
    const t = sh.find(TITLE), pics = sh.filter((x) => x.kind === "picture"), one = pics.length === 1 ? pics[0] : null;
    return { foreign: true, layout: "", fs: 1, spec: { layout: "", title: t ? t.text.join(" ") : "", lines: sh.filter((x) => !TITLE(x) && x.kind === "text" && !FOOT(x)).flatMap((x) => x.text), image: one ? one.xml : null },
      keep: sh.filter((x) => x.kind !== "text" && x !== one).map((x) => x.xml) };
  }
  // 把一页画出来写回去（s：get(no) 的结果）。不是这一版式要的图片不丢：变成一张普通的图片留在页上
  async function paint(s, spec, o = {}) {
    const { cx: W, cy: H } = await size();
    let keep = (o.keep || []).slice();
    if (spec.image && !["bullets", "summary"].includes(spec.layout)) { keep.push(spec.image.replace(/(<p:cNvPr\b[^>]*\sname=")[^"]*(")/, "$1图片$2")); spec = { ...spec, image: null }; }
    else if (!spec.image && ["bullets", "summary"].includes(spec.layout)) { const i = keep.findIndex((x) => x.startsWith("<p:pic")); if (i >= 0 && keep.filter((x) => x.startsWith("<p:pic")).length === 1 && o.adopt) { spec = { ...spec, image: keep[i] }; keep.splice(i, 1); } }
    const r = D.render(spec, { W, H, fs: o.fs || 1, idFrom: Math.max(1, ...keep.map((x) => maxShapeId(x))) + 1 });
    let xml = s.xml.replace(/<p:spTree>[\s\S]*<\/p:spTree>/, () => `<p:spTree>${D.TREE0}${r.xml}${keep.join("")}</p:spTree>`).replace(/<p:timing>[\s\S]*?<\/p:timing>/, "");
    if (r.bg || !o.foreign) xml = xml.replace(/<p:bg>[\s\S]*?<\/p:bg>/, "");
    if (r.bg) xml = xml.replace(/<p:cSld\b[^>]*>/, (m) => `${m}<p:bg><p:bgPr>${D.fill(r.bg)}<a:effectLst/></p:bgPr></p:bg>`);
    await put(s.part, xml);
    return r.warn;
  }
  // 新的一页放进放映顺序（after 页后面）：页面文件、关系、类型登记、页数
  async function insertPart(after, xml, rels) {
    const all = await slides();
    after = Math.max(0, Math.min(all.length, after == null ? all.length : +after));
    const nums = Object.keys(zip.files).map((f) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(f)).filter(Boolean).map((m) => +m[1]);
    const n = Math.max(0, ...nums) + 1, part = `ppt/slides/slide${n}.xml`;
    await put(part, xml);
    await put(relsPath(part), relsXml(rels));
    const ct = await txt("[Content_Types].xml");
    if (!ct.includes(`PartName="/${part}"`)) await put("[Content_Types].xml", ct.replace("</Types>", `<Override PartName="/${part}" ContentType="${CT_SLIDE}"/></Types>`));
    const prels = parseRels(await txt("ppt/_rels/presentation.xml.rels")); const rid = nextRid(prels)();
    prels.push({ id: rid, type: REL.slide, target: `slides/slide${n}.xml` });
    await put("ppt/_rels/presentation.xml.rels", relsXml(prels));
    let p = await pres();
    let maxId = 255; for (const m of p.matchAll(/<p:sldId\b[^>]*\sid="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
    const tag = `<p:sldId id="${maxId + 1}" r:id="${rid}"/>`;
    if (/<p:sldIdLst\s*\/>/.test(p)) p = p.replace(/<p:sldIdLst\s*\/>/, "<p:sldIdLst></p:sldIdLst>");
    if (!/<p:sldIdLst>/.test(p)) p = p.replace(/(<p:sldMasterIdLst>[\s\S]*?<\/p:sldMasterIdLst>(?:<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>)?(?:<p:handoutMasterIdLst>[\s\S]*?<\/p:handoutMasterIdLst>)?)/, `$1<p:sldIdLst></p:sldIdLst>`);
    p = after > 0 && all[after - 1] ? p.replace(all[after - 1].tag, all[after - 1].tag + tag) : p.replace("<p:sldIdLst>", "<p:sldIdLst>" + tag);
    await put("ppt/presentation.xml", p);
    await fixCount();
    return { no: after + 1, count: all.length + 1, part };
  }
  // 排好版的页挂在哪个版式上：自己那份里的「捞小智」，别人的 PPT 里找「仅标题」/ 空白，再没有就跟前一页一样
  async function plainLayout(afterPart) {
    const lays = Object.keys(zip.files).filter((f) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f)).sort();
    const xs = []; for (const f of lays) xs.push([f, await txt(f)]);
    const hit = xs.find(([, x]) => /<p:cSld\b[^>]*\sname="捞小智"/.test(x)) || xs.find(([, x]) => /<p:sldLayout\b[^>]*\stype="titleOnly"/.test(x)) || xs.find(([, x]) => /<p:sldLayout\b[^>]*\stype="blank"/.test(x));
    return hit ? "../slideLayouts/" + hit[0].split("/").pop() : layoutFor(afterPart);
  }
  async function addOne(after, spec, fs) {
    const all = await slides(), prev = all[Math.max(0, Math.min(all.length, after)) - 1] || all[all.length - 1];
    const layout = await plainLayout(prev && prev.part);
    const made = await insertPart(after, D.slideXml({ bg: null, xml: "" }), layout ? [{ id: "rId1", type: REL.layout, target: layout }] : []);
    const warn = await paint({ part: made.part, xml: await txt(made.part) }, spec, { fs });
    if (spec.notes) await writeNotes(made.part, spec.notes);
    return { ...made, warn };
  }
  // 加一页排好版的。raw：{ layout, title, lines, items, left, right, code, table, formula, takeaway, notes … }（缺什么版式引擎自己凑；放不下自动拆成几页）
  async function addDesigned(after, raw, o = {}) {
    const specs = D.split(D.normalize(raw, { first: o.first }));
    return step(`加一页「${D.plain(specs[0].title)}」`, async () => {
      const n0 = (await slides()).length; let at = Math.max(0, Math.min(n0, after == null ? n0 : +after)); const first = at + 1, warn = [];
      for (const sp of specs) { const r = await addOne(at, sp, o.fs); warn.push(...r.warn); at++; }
      return { no: first, count: n0 + specs.length, layout: specs[0].layout, ...(specs.length > 1 ? { pages: specs.length, note: `内容多，拆成了 ${specs.length} 页（第 ${first}～${first + specs.length - 1} 页）` } : {}), ...(warn.length ? { warn: [...new Set(warn)].join("；") } : {}) };
    });
  }
  // 换版式 / 重写一页：patch 里写了的块（title、lines、items、left、right、code、table、formula、takeaway、layout）换成新的，没写的留着
  async function editSlide(no, patch = {}) {
    return step(`重排第 ${no} 页`, async () => {
      const s = await get(no), d = designOf(shapeList(s.xml));
      const fs = patch.font_scale ? clamp(+patch.font_scale || 1, 0.6, 1.8) : d.fs;
      const specs = D.split(D.convert(d.spec, patch));
      const warn = await paint(s, specs[0], { keep: d.keep, fs, foreign: d.foreign, adopt: true });
      if (patch.notes != null) await writeNotes(s.part, String(patch.notes));
      for (let i = 1; i < specs.length; i++) warn.push(...(await addOne(s.no + i - 1, specs[i], fs)).warn);
      return { no: s.no, layout: specs[0].layout, ...(specs.length > 1 ? { pages: specs.length, note: `内容多，拆成了 ${specs.length} 页（第 ${s.no}～${s.no + specs.length - 1} 页）` } : {}), ...(d.foreign ? { converted: "这一页原来不是我排的版：标题和文字搬过来重新排了，图片留着；不满意可以撤销" } : {}), ...(warn.length ? { warn: [...new Set(warn)].join("；") } : {}) };
    });
  }

  // ---------- 改文字 ----------
  // 某个框的文字换成 lines（每行一段）：保留这个框原来的字体、字号、颜色（用第一段第一个字的样子）
  function newBody(tb, lines) {
    const body = /<p:txBody>([\s\S]*)<\/p:txBody>/.exec(tb);
    const inner = body[1];
    const head = (/^[\s\S]*?(?=<a:p>|<a:p |$)/.exec(inner) || [""])[0];   // bodyPr + lstStyle
    const p0 = /<a:p>[\s\S]*?<\/a:p>|<a:p [^>]*>[\s\S]*?<\/a:p>/.exec(inner);
    const pPr = p0 ? (/<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/.exec(p0[0]) || [""])[0] : "";
    const rPr = p0 ? (/<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/.exec(p0[0]) || [""])[0] : "";
    const r = rPr || '<a:rPr lang="zh-CN" altLang="en-US"/>';
    const paras = (lines.length ? lines : [""]).map((l) => `<a:p>${pPr}${l ? `<a:r>${r.replace(/\sdirty="\d"/, "")}<a:t>${esc(l)}</a:t></a:r>` : `<a:endParaRPr lang="zh-CN" altLang="en-US"/>`}</a:p>`).join("");
    return tb.slice(0, body.index) + `<p:txBody>${head}${paras}</p:txBody>` + tb.slice(body.index + body[0].length);
  }
  // 捞小智排的页：改的是「哪一块」的内容，改完整页重新排（字多了自动缩一点、放得下）
  function setPath(spec, path, lines) {
    const [k, i] = path.split("."), all = lines.join("\n");
    if (k === "lines") spec.lines.splice(+i, 1, ...lines.filter((x) => x.trim()));
    else if (k === "items") spec.items[+i] = { head: lines[0] || "", body: lines.slice(1).join("\n") };
    else if (k === "left" || k === "right") { spec[k] = spec[k] || { head: "", lines: [] }; if (i === "head") spec[k].head = all; else spec[k].lines = lines.filter((x) => x.trim()); }
    else if (k === "table") throw new Error("表格要整张换：用 edit_slide，table 里把每一行写全");
    else if (k === "image") throw new Error("这是图片，不能改成文字");
    else spec[k] = all;
    return spec;
  }
  async function setText(no, shape, lines) {
    lines = (Array.isArray(lines) ? lines : String(lines || "").split(/\n/)).map((x) => String(x).replace(/\r/g, ""));
    return step(`改第 ${no} 页的文字`, async () => {
      const s = await get(no), sh = shapeList(s.xml);
      const t = shape === "title" ? sh.find(TITLE) : sh[(+shape || 0) - 1];
      if (!t) throw new Error(shape === "title" ? `第 ${no} 页没有标题框` : `第 ${no} 页没有第 ${shape} 个框（一共 ${sh.length} 个）`);
      if (DECO(t)) throw new Error(`第 ${no} 页第 ${shape} 个是装饰，不能改字：先 get_slide 看看要改的是第几个`);
      if (t.lz) { const d = D.specOf(sh);
        const sp = D.convert(setPath(d.spec, t.lz.path, lines), {});
        const warn = await paint(s, sp, { keep: d.keep, fs: d.fs });
        return { no: s.no, shape: sh.indexOf(t) + 1, lines: lines.length, ...(warn.length ? { warn: warn.join("；") } : {}) }; }
      if (t.kind !== "text" || !/<p:txBody>/.test(t.xml)) throw new Error(`第 ${no} 页第 ${shape} 个不是文字框（是${KIND[t.kind] || t.kind}）`);
      await put(s.part, s.xml.slice(0, t.start) + newBody(t.xml, lines) + s.xml.slice(t.end));
      return { no: s.no, shape: sh.indexOf(t) + 1, lines: lines.length };
    });
  }
  // 全文替换（no 给了就只替换那一页）；一个词被拆在几段格式里时，把这一段合成第一段的格式再换
  async function replace(find, to, no) {
    find = String(find || ""); to = String(to == null ? "" : to);
    if (!find) throw new Error("要替换什么？");
    return step(`把「${find}」换成「${to}」`, async () => {
      let n = 0; const pages = [];
      for (const s of await slides()) {
        if (no && s.no !== +no) continue;
        const xml = await txt(s.part);
        const out = xml.replace(/<a:p>[\s\S]*?<\/a:p>|<a:p [^>]*>[\s\S]*?<\/a:p>/g, (p) => {
          const ts = [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)];
          const all = ts.map((m) => X.unesc(m[1])).join("");
          if (!all.includes(find)) return p;
          const cnt = all.split(find).length - 1;
          // 每一处都在同一个 <a:t> 里：只换那几处，格式不动
          const inOne = ts.reduce((k, m) => k + (X.unesc(m[1]).split(find).length - 1), 0);
          n += cnt;
          if (inOne === cnt) return p.replace(/<a:t>([^<]*)<\/a:t>/g, (m0, t) => `<a:t>${esc(X.unesc(t).split(find).join(to))}</a:t>`);
          const r0 = /<a:r>[\s\S]*?<\/a:r>/.exec(p);
          const rPr = r0 ? (/<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/.exec(r0[0]) || [""])[0] : "";
          const runs = /(<a:r>[\s\S]*<\/a:r>)/.exec(p);
          return runs ? p.replace(runs[1], `<a:r>${rPr}<a:t>${esc(all.split(find).join(to))}</a:t></a:r>`) : p;
        });
        if (out !== xml) { await put(s.part, out); pages.push(s.no); }
      }
      if (!n) throw new Error(`没找到「${find}」`);
      return { count: n, pages };
    });
  }

  // ---------- 页 ----------
  async function layoutFor(afterPart) {
    // 先找「标题和内容」版式（type="obj"），没有就用后面这一页的版式
    const lays = Object.keys(zip.files).filter((f) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f));
    for (const f of lays) if (/<p:sldLayout\b[^>]*\stype="obj"/.test(await txt(f))) return "../slideLayouts/" + f.split("/").pop();
    if (afterPart) { const r = parseRels(await txt(relsPath(afterPart))).find((x) => x.type === REL.layout); if (r) return r.target; }
    return lays.length ? "../slideLayouts/" + lays[0].split("/").pop() : null;
  }
  const run = (t, o = {}) => `<a:r><a:rPr lang="zh-CN" altLang="en-US"${o.sz ? ` sz="${o.sz}"` : ""}${o.b ? ' b="1"' : ""} dirty="0"/><a:t>${esc(t)}</a:t></a:r>`;
  // 加一页。捞小智做的那种 PPT（或者写了 extra.layout 这些）：排好版的一页；老师自己的 PPT：用它母版里的「标题和内容」
  async function addSlide(after, title, lines, extra) {
    const ex = extra && typeof extra === "object" ? Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null && v !== "")) : {};
    if (Object.keys(ex).length || (await designed())) return addDesigned(after, { title, lines, ...ex });
    lines = (Array.isArray(lines) ? lines : String(lines || "").split(/\n/)).map(String).filter((x) => x.trim());
    return step(`加一页「${title || ""}」`, async () => {
      const all = await slides();
      after = Math.max(0, Math.min(all.length, after == null ? all.length : +after));
      const prev = all[after - 1] || all[all.length - 1];
      const { cx: W, cy: H } = await size();
      const layout = await layoutFor(prev && prev.part);
      const sp = (id, name, ph, x, y, w, h, paras) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr>${box(x, y, w, h)}</p:spPr><p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
      const body = (lines.length ? lines : [""]).map((l) => `<a:p>${l ? run(l) : '<a:endParaRPr lang="zh-CN" altLang="en-US"/>'}</a:p>`).join("");
      const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
        sp(2, "标题 1", '<p:ph type="title"/>', W * 0.06, H * 0.05, W * 0.88, H * 0.15, `<a:p>${run(title || "")}</a:p>`) +
        sp(3, "内容 2", '<p:ph idx="1"/>', W * 0.06, H * 0.23, W * 0.88, H * 0.68, body) +
        `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
      const made = await insertPart(after, xml, layout ? [{ id: "rId1", type: REL.layout, target: layout }] : []);
      return { no: made.no, count: made.count };
    });
  }
  async function fixCount() {
    const app = await txt("docProps/app.xml"); if (!app) return;
    const n = ((await pres()).match(/<p:sldId\b/g) || []).length;
    await put("docProps/app.xml", app.replace(/<Slides>\d+<\/Slides>/, `<Slides>${n}</Slides>`));
  }
  // 删一页：从放映顺序里拿掉（页面文件留着不删，别的页、备注引用它也不会坏）
  async function deleteSlide(no) {
    return step(`删掉第 ${no} 页`, async () => {
      const s = await get(no);
      if (s.count <= 1) throw new Error("只剩一页了，不能删");
      await put("ppt/presentation.xml", (await pres()).replace(s.tag, ""));
      const prels = parseRels(await txt("ppt/_rels/presentation.xml.rels")).filter((r) => r.id !== s.rid);
      await put("ppt/_rels/presentation.xml.rels", relsXml(prels));
      let ct = await txt("[Content_Types].xml");
      // 这一页的备注页也一起拿掉（不然留下一张没人要的备注）
      const nrel = parseRels(await txt(relsPath(s.part))).find((r) => r.type === REL_NOTES), npart = nrel ? resolve(s.part, nrel.target) : null;
      ct = ct.replace(new RegExp(`<Override PartName="/${s.part.replace(/[.]/g, "\\.")}"[^>]*/>`), "");
      if (npart) { ct = ct.replace(new RegExp(`<Override PartName="/${npart.replace(/[.]/g, "\\.")}"[^>]*/>`), ""); await drop(npart); await drop(relsPath(npart)); }
      await put("[Content_Types].xml", ct);
      await drop(s.part); await drop(relsPath(s.part));
      await fixCount();
      return { deleted: +no, count: s.count - 1 };
    });
  }
  async function moveSlide(no, to) {
    return step(`把第 ${no} 页挪到第 ${to} 页`, async () => {
      const all = await slides(), s = all.find((x) => x.no === +no);
      if (!s) throw new Error(`没有第 ${no} 页`);
      to = Math.max(1, Math.min(all.length, +to));
      const order = all.filter((x) => x !== s); order.splice(to - 1, 0, s);
      const p = await pres();
      const lst = /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/.exec(p);
      await put("ppt/presentation.xml", p.replace(lst[0], `<p:sldIdLst>${order.map((x) => x.tag).join("")}</p:sldIdLst>`));
      return { from: +no, to };
    });
  }
  // 复制一页，放在它后面（图片、版式都跟原来那页一样；备注不带）
  async function duplicateSlide(no) {
    return step(`复制第 ${no} 页`, async () => {
      const s = await get(no);
      const rels = parseRels(await txt(relsPath(s.part))).filter((r) => r.type !== REL_NOTES);
      const made = await insertPart(s.no, s.xml, rels);
      return { from: s.no, no: made.no, count: made.count };
    });
  }

  // ---------- 配色 ----------
  async function themePart() {
    const rels = parseRels(await txt("ppt/_rels/presentation.xml.rels")), m = rels.find((r) => /\/slideMaster$/.test(r.type));
    if (m) { const mp = resolve("ppt/presentation.xml", m.target), t = parseRels(await txt(relsPath(mp))).find((r) => /\/theme$/.test(r.type)); if (t) return resolve(mp, t.target); }
    const t = rels.find((r) => /\/theme$/.test(r.type));
    return t ? resolve("ppt/presentation.xml", t.target) : "ppt/theme/theme1.xml";
  }
  async function theme() {
    const x = (await txt(await themePart())) || "", sc = /<a:clrScheme\b[^>]*>[\s\S]*?<\/a:clrScheme>/.exec(x), c = {};
    if (sc) for (const k of ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"]) { const m = new RegExp(`<a:${k}>\\s*<a:(?:srgbClr val|sysClr[^>]*lastClr)="([0-9A-Fa-f]{6})"`).exec(sc[0]); c[k] = m ? m[1].toUpperCase() : k.startsWith("lt") ? "FFFFFF" : "000000"; }
    const nm = sc ? attr(/<a:clrScheme\b[^>]*>/.exec(sc[0])[0], "name") || "" : "";
    return { name: nm.replace(/^捞小智·/, ""), colors: c, key: Object.keys(D.THEMES).find((k) => D.THEMES[k].name === nm.replace(/^捞小智·/, "")) || null };
  }
  // 换配色：theme 写名字（blue / green / warm / berry / orange / mono / dark / board），或者 color 给一个颜色（#RRGGBB），主色用它、别的跟着配
  async function setTheme(o = {}) {
    const t = D.themeOf(typeof o === "string" ? { theme: o } : o);
    return step(`换成「${t.name}」配色`, async () => {
      const part = await themePart(), x = await txt(part);
      if (!x || !/<a:clrScheme\b/.test(x)) throw new Error("这份 PPT 里没找到主题配色");
      await put(part, x.replace(/<a:clrScheme\b[^>]*>[\s\S]*?<\/a:clrScheme>/, D.clrScheme(t)));
      return { theme: t.key, name: t.name, ...((await designed()) ? {} : { note: "这份不是我做的 PPT：只换了主题色，页面上老师自己指定了颜色的地方不会变" }) };
    });
  }

  // ---------- 字号、强调 ----------
  // 这个框不写字号的时候是多大：自己的 lstStyle → 版式里同一个占位符 → 母版里的 → 母版的标题 / 正文样式
  async function baseSize(part, sh) {
    const own = /<a:lstStyle>[\s\S]*?<a:lvl1pPr\b[\s\S]*?<a:defRPr\b[^>]*\ssz="(\d+)"/.exec(sh.xml);
    if (own) return +own[1];
    const phTag = /<p:ph\b[^>]*\/?>/.exec(sh.xml), type = phTag ? attr(phTag[0], "type") || "body" : null, idx = phTag ? attr(phTag[0], "idx") : null;
    if (!type) return 1800;
    const lr = parseRels(await txt(relsPath(part))).find((r) => r.type === REL.layout), lay = lr ? resolve(part, lr.target) : null;
    const mr = lay ? parseRels(await txt(relsPath(lay))).find((r) => /\/slideMaster$/.test(r.type)) : null, mas = mr ? resolve(lay, mr.target) : null;
    const same = (t) => (type === t) || (["title", "ctrTitle"].includes(type) && ["title", "ctrTitle"].includes(t));
    for (const p of [lay, mas]) { if (!p) continue;
      for (const x of shapeList((await txt(p)) || "")) { const ph = /<p:ph\b[^>]*\/?>/.exec(x.xml); if (!ph) continue;
        if ((idx != null && attr(ph[0], "idx") === idx) || same(attr(ph[0], "type") || "body")) { const m = /<a:lvl1pPr\b[\s\S]*?<a:defRPr\b[^>]*\ssz="(\d+)"/.exec(x.xml); if (m) return +m[1]; } } }
    const mx = mas ? (await txt(mas)) || "" : "", st = /<p:(titleStyle|bodyStyle)>/.test(mx) ? new RegExp(`<p:${["title", "ctrTitle"].includes(type) ? "titleStyle" : "bodyStyle"}>[\\s\\S]*?<a:defRPr\\b[^>]*\\ssz="(\\d+)"`).exec(mx) : null;
    return st ? +st[1] : ["title", "ctrTitle"].includes(type) ? 4400 : 2800;
  }
  // rPr 里的东西按规定的先后放（线、填充、效果、底色、下划线、字体…顺序错了 PowerPoint 打不开）
  function rPrSet(rPr, f) {
    const m = /<a:rPr\b([^>]*?)(\/>|>([\s\S]*?)<\/a:rPr>)/.exec(rPr || '<a:rPr lang="zh-CN" altLang="en-US"/>');
    let a = m[1], inner = m[3] || "";
    const setA = (k, v) => { a = a.replace(new RegExp(`\\s${k}="[^"]*"`), ""); if (v != null) a += ` ${k}="${v}"`; };
    if (f.bold != null) setA("b", f.bold ? 1 : 0);
    if (f.italic != null) setA("i", f.italic ? 1 : 0);
    if (f.underline != null) setA("u", f.underline ? "sng" : "none");
    if (f.sz != null) setA("sz", f.sz);
    const take = (re) => { const x = re.exec(inner); if (x) inner = inner.replace(x[0], ""); return x ? x[0] : ""; };
    const ln = take(/<a:ln\b[^>]*\/>|<a:ln\b[\s\S]*?<\/a:ln>/);
    let fl = take(/<a:(solidFill|gradFill|pattFill|blipFill)\b[\s\S]*?<\/a:\1>|<a:noFill\/>/);
    const ef = take(/<a:effectLst\/>|<a:effectLst>[\s\S]*?<\/a:effectLst>|<a:effectDag\b[\s\S]*?<\/a:effectDag>/);
    let hl = take(/<a:highlight>[\s\S]*?<\/a:highlight>/);
    if (f.color != null) fl = f.color ? `<a:solidFill>${f.color}</a:solidFill>` : "";
    if (f.highlight != null) hl = f.highlight ? `<a:highlight>${f.highlight}</a:highlight>` : "";
    const body = ln + fl + ef + hl + inner;
    return body ? `<a:rPr${a}>${body}</a:rPr>` : `<a:rPr${a}/>`;
  }
  const PARA = /<a:p>[\s\S]*?<\/a:p>|<a:p [^>]*>[\s\S]*?<\/a:p>/g;
  const RUN = /<a:r>([\s\S]*?)<\/a:r>/g;
  const rParts = (r) => { const pr = /<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/.exec(r), t = /<a:t>([^<]*)<\/a:t>|<a:t [^>]*>([^<]*)<\/a:t>/.exec(r); return { pr: pr ? pr[0] : "", t: t ? X.unesc(t[1] != null ? t[1] : t[2]) : "" }; };
  // 一段里找到 find（可能跨着几种格式），把那几个字单独切出来套上 f；find 是空的就是整段
  function fmtPara(p, find, f) {
    const runs = [...p.matchAll(RUN)]; if (!runs.length) return { p, n: 0 };
    const parts = runs.map((m) => rParts(m[1])), all = parts.map((x) => x.t).join("");
    const hits = [];
    if (!find) { if (all) hits.push([0, all.length]); } else for (let i = all.indexOf(find); i >= 0; i = all.indexOf(find, i + find.length)) hits.push([i, i + find.length]);
    if (!hits.length) return { p, n: 0 };
    const out = []; let pos = 0;
    for (const x of parts) { const a = pos, b = pos + x.t.length; pos = b;
      const cuts = [...new Set([a, b, ...hits.flatMap((h) => h).filter((c) => c > a && c < b)])].sort((m, n) => m - n);
      for (let i = 0; i + 1 < cuts.length; i++) { const s0 = cuts[i], s1 = cuts[i + 1], on = hits.some((h) => s0 >= h[0] && s1 <= h[1]);
        out.push(`<a:r>${on ? rPrSet(x.pr, f) : x.pr}<a:t>${esc(all.slice(s0, s1))}</a:t></a:r>`); } }
    const first = runs[0].index, last = runs[runs.length - 1].index + runs[runs.length - 1][0].length;
    // 中间夹着的换行（<a:br>）、域留在原地太复杂：只有纯文字的段才切；别的段整段套
    const between = p.slice(first, last).replace(RUN, "");
    if (between.trim()) return { p: p.replace(RUN, (m0, r) => { const x = rParts(r); return `<a:r>${rPrSet(x.pr, f)}<a:t>${esc(x.t)}</a:t></a:r>`; }), n: 1 };
    return { p: p.slice(0, first) + out.join("") + p.slice(last), n: hits.length };
  }
  const fmtOf = (o = {}) => { const f = {};
    if (o.bold != null) f.bold = !!o.bold; if (o.italic != null) f.italic = !!o.italic; if (o.underline != null) f.underline = !!o.underline;
    if (o.color != null) f.color = o.color === "" || o.color === false ? "" : colorXml(o.color);
    if (o.highlight != null) f.highlight = o.highlight === "" || o.highlight === false ? "" : colorXml(o.highlight === true ? "黄" : o.highlight, { ...COLORS, ...HILITE });
    if (o.size != null) f.sz = Math.round(clamp(+o.size || 18, 6, 200) * 100);
    if (!Object.keys(f).length) throw new Error("要怎么标？加粗（bold）、颜色（color）、底色（highlight）、斜体（italic）、下划线（underline）、字号（size）至少写一样");
    return f; };
  // 给某几个字加粗 / 上色 / 标底色 / 下划线 / 改字号。find：要标的那几个字（空着 = shape 那个框里全部）；no 是 0 = 整份
  async function formatText(no, find, o = {}) {
    const f = fmtOf(o); find = String(find || "");
    if (!find && !o.shape) throw new Error("要标哪几个字？写 find；或者写 shape 把整个框都标上");
    return step(find ? `标出「${find}」` : `改第 ${no} 页第 ${o.shape} 个框的样子`, async () => {
      let n = 0; const pages = [];
      for (const s of await slides()) {
        if (+no && s.no !== +no) continue;
        const xml = await txt(s.part), sh = shapeList(xml);
        const targets = o.shape ? [o.shape === "title" ? sh.find(TITLE) : sh[(+o.shape || 0) - 1]].filter(Boolean) : sh.filter((x) => !DECO(x) && x.kind !== "formula" && x.kind !== "picture");
        if (o.shape && !targets.length) throw new Error(`第 ${s.no} 页没有第 ${o.shape} 个框`);
        let out = xml, k = 0;
        for (const t of targets.slice().reverse()) { let c = 0; const nx = t.xml.replace(PARA, (p) => { const r = fmtPara(p, find, f); c += r.n; return r.p; }); if (c) { out = out.slice(0, t.start) + nx + out.slice(t.end); k += c; } }
        if (k) { await put(s.part, out); n += k; pages.push(s.no); }
      }
      if (!n) throw new Error(find ? `没找到「${find}」` : "这个框里没有字");
      return { count: n, pages };
    });
  }
  // 调字号。scale：放大 / 缩小几倍（1.2 = 大两成）；size：直接定成多少磅（要写 shape）。捞小智排的页整页重排（大了还放得下）
  async function scaleFont(no, o = {}) {
    const scale = o.size ? null : clamp(+o.scale || 1.15, 0.4, 3);
    return step(`调第 ${no} 页的字号`, async () => {
      const s = await get(no), sh = shapeList(s.xml), d = D.specOf(sh);
      if (d && !o.shape && scale) { const fs = Math.round(clamp(d.fs * scale, 0.6, 1.8) * 100) / 100; const warn = await paint(s, D.convert(d.spec, {}), { keep: d.keep, fs });
        return { no: s.no, font_scale: fs, ...(warn.length ? { warn: warn.join("；") + "：可以拆成两页（edit_slide），或者少放几条" } : {}), ...(fs === d.fs ? { note: "已经到头了，不能再" + (scale > 1 ? "大" : "小") + "了" } : {}) }; }
      const targets = o.shape ? [o.shape === "title" ? sh.find(TITLE) : sh[(+o.shape || 0) - 1]].filter(Boolean) : sh.filter((x) => x.kind === "text" && !DECO(x) && !FOOT(x));
      if (!targets.length) throw new Error(o.shape ? `第 ${no} 页没有第 ${o.shape} 个框` : `第 ${no} 页没有文字`);
      let out = s.xml, n = 0;
      for (const t of targets.slice().reverse()) { if (!/<a:r>/.test(t.xml)) continue;
        const base = await baseSize(s.part, t);
        const nx = t.xml.replace(RUN, (m0, r) => { const x = rParts(r), cur = /\ssz="(\d+)"/.exec(x.pr); n++;
          return `<a:r>${rPrSet(x.pr, { sz: o.size ? Math.round(clamp(+o.size, 6, 200) * 100) : Math.round(clamp(((cur ? +cur[1] : base) * scale) / 100, 6, 200)) * 100 })}<a:t>${esc(x.t)}</a:t></a:r>`; });
        out = out.slice(0, t.start) + nx + out.slice(t.end); }
      if (!n) throw new Error("没有能调字号的文字");
      await put(s.part, out);
      return { no: s.no, shapes: targets.length };
    });
  }

  // ---------- 公式、表格、图片 ----------
  // PowerPoint 自己的公式（老师双击能改）；不认识公式的软件显示后备的文字
  // where：top / middle / bottom（放在这一页的什么位置），size：字号（磅）
  async function insertFormula(no, latex, o = {}) {
    const clean = M.clean(latex);
    if (!clean) throw new Error("公式是空的");
    return step(`在第 ${no} 页插公式`, async () => {
      const s = await get(no), { cx: W, cy: H } = await size();
      const sz = Math.round(Math.max(10, Math.min(72, +o.size || 28)) * 100);
      const omml = M.toOmml(clean).replace(/<a:rPr lang="en-US" altLang="zh-CN"/g, `<a:rPr lang="en-US" altLang="zh-CN" sz="${sz}"`);
      const id = maxShapeId(s.xml) + 1;
      const h = Math.max(H * 0.1, (sz / 100) * 12700 * 2.6), w = W * 0.8, x = (W - w) / 2;
      const { y, crowded } = freeY(s.xml, W, H, h, o.where);
      const name = `公式 ${id}`;
      const choice = `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"><a:extLst><a:ext uri="{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}"/></a:extLst></p:cNvPr><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
        `<p:spPr>${box(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
        `<p:txBody><a:bodyPr wrap="square" anchor="ctr"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="ctr"/><a14:m><m:oMathPara xmlns:m="${NS_M}"><m:oMathParaPr><m:jc m:val="centerGroup"/></m:oMathParaPr>${omml}</m:oMathPara></a14:m><a:endParaRPr lang="en-US" altLang="zh-CN" sz="${sz}" dirty="0"/></a:p></p:txBody></p:sp>`;
      const fallback = `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${box(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
        `<p:txBody><a:bodyPr wrap="square" anchor="ctr"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" altLang="zh-CN" sz="${sz}" dirty="0"><a:latin typeface="Cambria Math"/></a:rPr><a:t>${esc(M.linear(clean))}</a:t></a:r></a:p></p:txBody></p:sp>`;
      const ac = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14">${choice}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;
      await put(s.part, s.xml.replace(/<\/p:spTree>/, `${ac}</p:spTree>`));
      return { no: s.no, shape: shapeList(s.xml).length + 1, text: M.linear(clean), ...(crowded ? { note: "这一页地方不够，公式放在了最下面，可能压着原来的字：可以在 PowerPoint 里拖开，或者放到新加的一页" } : {}) };
    });
  }
  // 在一页上放一张表格（rows：第一行是表头）。想要一整页的表格，用 addDesigned / editSlide 的 table 版式
  async function insertTable(no, rows, o = {}) {
    rows = (Array.isArray(rows) ? rows : []).filter(Array.isArray).map((r) => r.map((c) => String(c == null ? "" : c)));
    if (rows.length < 2 || !rows[0].length) throw new Error("表格至少要有表头和一行内容（rows：[[表头…],[第一行…],…]）");
    return step(`在第 ${no} 页放表格`, async () => {
      const s = await get(no), { cx: W, cy: H } = await size();
      const t = D.tableItem(rows, { x: 0.75, y: 0, w: D.DW - 1.5, h: 4.6 }, { grow: false });
      const hE = (t.item.h / D.DH) * H, { y, crowded } = freeY(s.xml, W, H, hE, o.where);
      const id = maxShapeId(s.xml) + 1;
      const xml = D.emit([{ ...t.item, y: (y / H) * D.DH, name: `表格 ${id}` }], { W, H, idFrom: id }).xml;
      await put(s.part, s.xml.replace(/<\/p:spTree>/, `${xml}</p:spTree>`));
      return { no: s.no, rows: rows.length, cols: rows[0].length, ...(crowded || !t.ok ? { note: "这一页地方不够，表格可能压着原来的字：建议单独放一页（add_slide，layout 写 table）" } : {}) };
    });
  }
  const picXml = (id, name, rid, x, y, w, h, round) => `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${box(x, y, w, h)}<a:prstGeom prst="${round ? "roundRect" : "rect"}"><a:avLst>${round ? '<a:gd name="adj" fmla="val 4000"/>' : ""}</a:avLst></a:prstGeom></p:spPr></p:pic>`;
  // 往一页上放图片（buf：PNG / JPG / GIF）。where：right / left / center / full / top / bottom；不写：要点页自动腾出右边一栏，别的页找空的地方
  async function insertImage(no, buf, o = {}) {
    if (typeof buf === "string") buf = Buffer.from(buf.replace(/^data:[^,]*,/, ""), "base64");
    const info = imageInfo(buf);
    return step(`在第 ${no} 页放图片`, async () => {
      const s = await get(no), { cx: W, cy: H } = await size(), sh = shapeList(s.xml), d = D.specOf(sh);
      const nums = Object.keys(zip.files).map((f) => /^ppt\/media\/lz-image(\d+)\./.exec(f)).filter(Boolean).map((m) => +m[1]);
      const media = `ppt/media/lz-image${Math.max(0, ...nums) + 1}.${info.ext}`;
      await put(media, buf);
      const ct = await txt("[Content_Types].xml");
      if (!new RegExp(`<Default Extension="${info.ext}"`, "i").test(ct)) await put("[Content_Types].xml", ct.replace(/(<Types\b[^>]*>)/, `$1<Default Extension="${info.ext}" ContentType="image/${info.ext}"/>`));
      const rels = parseRels(await txt(relsPath(s.part))), rid = nextRid(rels)();
      rels.push({ id: rid, type: REL.image, target: "../media/" + media.split("/").pop() });
      await put(relsPath(s.part), relsXml(rels));
      const r = info.w / Math.max(1, info.h), id = maxShapeId(s.xml) + 1;
      if (d && !o.where && ["bullets", "summary"].includes(d.layout) && !d.spec.image) {
        const warn = await paint({ ...s, xml: s.xml }, D.convert({ ...d.spec, image: picXml(id, "图片", rid, 0, 0, 1000 * r, 1000, true) }, {}), { keep: d.keep, fs: d.fs });
        return { no: s.no, placed: "右边一栏（要点挪到了左边）", ...(warn.length ? { warn: warn.join("；") } : {}) };
      }
      const R = { right: [0.54, 0.24, 0.4, 0.66], left: [0.06, 0.24, 0.4, 0.66], center: [0.15, 0.24, 0.7, 0.68], full: [0, 0, 1, 1], top: [0.2, 0.2, 0.6, 0.36], bottom: [0.2, 0.56, 0.6, 0.38] }[o.where];
      let bx, crowded = false;
      if (R) bx = { x: R[0] * W, y: R[1] * H, w: R[2] * W, h: R[3] * H };
      else { const h0 = H * 0.42, f = freeY(s.xml, W, H, h0); crowded = f.crowded; bx = crowded ? { x: 0.54 * W, y: 0.24 * H, w: 0.4 * W, h: 0.66 * H } : { x: 0.1 * W, y: f.y, w: 0.8 * W, h: h0 }; }
      let w = bx.w, h = w / r; if (h > bx.h) { h = bx.h; w = h * r; }
      const pic = picXml(id, `图片 ${id}`, rid, bx.x + (bx.w - w) / 2, bx.y + (bx.h - h) / 2, w, h, o.where !== "full");
      // 铺满整页的放在最底下（当背景），别的放在最上面
      await put(s.part, o.where === "full" ? s.xml.replace(/(<p:spTree>[\s\S]*?<\/p:grpSpPr>)/, `$1${pic}`) : s.xml.replace(/<\/p:spTree>/, `${pic}</p:spTree>`));
      return { no: s.no, placed: { right: "右边", left: "左边", center: "中间", full: "铺满整页（当背景）", top: "上面", bottom: "下面" }[o.where] || (crowded ? "右边" : "空的地方"), ...(crowded ? { note: "这一页没有空地方了，图片可能压着字：可以让我把这一页的字挪一挪（edit_slide），或者单独放一页" } : {}) };
    });
  }
  // 删掉一页上的一个框（公式、图片、表格、多出来的文字框…）。捞小智排的页：删的是一条要点 / 一项，整页重排
  async function deleteShape(no, shape) {
    return step(`删掉第 ${no} 页第 ${shape} 个框`, async () => {
      const s = await get(no), sh = shapeList(s.xml), t = sh[(+shape || 0) - 1];
      if (!t) throw new Error(`第 ${no} 页没有第 ${shape} 个框（一共 ${sh.length} 个）`);
      if (DECO(t)) throw new Error("这是装饰，会跟着版式走：要换样子用 edit_slide 换版式");
      if (t.lz && t.lz.path !== "image") { const d = D.specOf(sh), [k, i] = t.lz.path.split(".");
        if (k === "title") throw new Error("标题不能删：要改用 set_text");
        if (k === "lines") d.spec.lines.splice(+i, 1); else if (k === "items") d.spec.items.splice(+i, 1); else if (k === "left" || k === "right") { if (i === "head") d.spec[k].head = ""; else d.spec[k].lines = []; } else if (k === "table") d.spec.table = []; else d.spec[k] = "";
        const sp = ["code", "table", "formula"].includes(k) ? D.convert({ ...d.spec, layout: "" }, {}) : D.convert(d.spec, {});
        await paint(s, sp, { keep: d.keep, fs: d.fs });
        return { no: s.no, deleted: ROLE(t.lz) || k, layout: sp.layout }; }
      if (t.lz) { const d = D.specOf(sh); await paint(s, D.convert({ ...d.spec, image: null }, {}), { keep: d.keep, fs: d.fs }); return { no: s.no, deleted: "图片" }; }
      await put(s.part, s.xml.slice(0, t.start) + s.xml.slice(t.end));
      return { no: s.no, deleted: KIND[t.kind] || "文字框" };
    });
  }

  // ---------- 备注（讲稿） ----------
  const REL_NOTES = NS_R + "/notesSlide", CT = "application/vnd.openxmlformats-officedocument.presentationml.";
  async function notesPart(part) { const r = parseRels(await txt(relsPath(part))).find((x) => x.type === REL_NOTES); return r ? resolve(part, r.target) : null; }
  async function notes(no) {
    const s = await get(no), np = await notesPart(s.part); if (!np) return "";
    const b = shapeList((await txt(np)) || "").find((x) => x.ph === "body");
    return b ? b.text.join("\n") : "";
  }
  async function notesMaster() {
    const prels = parseRels(await txt("ppt/_rels/presentation.xml.rels")), has = prels.find((r) => /\/notesMaster$/.test(r.type));
    if (has) return resolve("ppt/presentation.xml", has.target);
    // 这份 PPT 从来没写过备注：补一个备注母版（配色跟着这份的主题）
    const part = "ppt/notesMasters/notesMaster1.xml", tp = await themePart();
    const nums = Object.keys(zip.files).map((f) => /^ppt\/theme\/theme(\d+)\.xml$/.exec(f)).filter(Boolean).map((m) => +m[1]), th = `ppt/theme/theme${Math.max(0, ...nums) + 1}.xml`;
    await put(th, await txt(tp));
    const ph = (id, name, type, y, h, body) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"${type === "sldImg" ? ' noRot="1" noChangeAspect="1"' : ""}/></p:cNvSpPr><p:nvPr><p:ph type="${type}"${type === "body" ? ' idx="1"' : ""}/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="${y}"/><a:ext cx="5486400" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>${body}</p:sp>`;
    await put(part, `${D.HEAD}<p:notesMaster ${D.NSS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${D.TREE0}${ph(2, "幻灯片图像占位符 1", "sldImg", 1143000, 3086100, "")}${ph(3, "备注占位符 2", "body", 4400550, 3600450, '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN" altLang="en-US"/></a:p></p:txBody>')}</p:spTree></p:cSld>` +
      `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`);
    await put(relsPath(part), relsXml([{ id: "rId1", type: NS_R + "/theme", target: "../theme/" + th.split("/").pop() }]));
    const rid = nextRid(prels)(); prels.push({ id: rid, type: NS_R + "/notesMaster", target: "notesMasters/notesMaster1.xml" });
    await put("ppt/_rels/presentation.xml.rels", relsXml(prels));
    await put("ppt/presentation.xml", (await pres()).replace(/<\/p:sldMasterIdLst>/, `</p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="${rid}"/></p:notesMasterIdLst>`));
    const ct = await txt("[Content_Types].xml");
    await put("[Content_Types].xml", ct.replace("</Types>", `<Override PartName="/${part}" ContentType="${CT}notesMaster+xml"/><Override PartName="/${th}" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`));
    return part;
  }
  async function writeNotes(part, text) {
    const lines = String(text || "").replace(/\r/g, "").split("\n"), paras = lines.map((l) => `<a:p>${l ? `<a:r><a:rPr lang="zh-CN" altLang="en-US" dirty="0"/><a:t>${esc(l)}</a:t></a:r>` : '<a:endParaRPr lang="zh-CN" altLang="en-US" dirty="0"/>'}</a:p>`).join("");
    const np = await notesPart(part);
    if (np) { const x = await txt(np), b = shapeList(x).find((q) => q.ph === "body");
      if (b && /<p:txBody>/.test(b.xml)) { await put(np, x.slice(0, b.start) + b.xml.replace(/(<p:txBody>[\s\S]*?)(?:<a:p>|<a:p )[\s\S]*<\/p:txBody>/, `$1${paras}</p:txBody>`) + x.slice(b.end)); return; }
      if (b) { await put(np, x.slice(0, b.start) + b.xml.replace(/<\/p:sp>$/, `<p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp>`) + x.slice(b.end)); return; } }
    const nm = await notesMaster();
    const nums = Object.keys(zip.files).map((f) => /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/.exec(f)).filter(Boolean).map((m) => +m[1]), n = Math.max(0, ...nums) + 1, nsp = np || `ppt/notesSlides/notesSlide${n}.xml`;
    await put(nsp, `${D.HEAD}<p:notes ${D.NSS}><p:cSld><p:spTree>${D.TREE0}<p:sp><p:nvSpPr><p:cNvPr id="2" name="幻灯片图像占位符 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="备注占位符 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`);
    if (np) return;
    const rel = (from, to) => { const a = from.split("/").slice(0, -1), b = to.split("/"); let i = 0; while (i < a.length && a[i] === b[i]) i++; return "../".repeat(a.length - i) + b.slice(i).join("/"); };
    await put(relsPath(nsp), relsXml([{ id: "rId1", type: NS_R + "/notesMaster", target: rel(nsp, nm) }, { id: "rId2", type: REL.slide, target: rel(nsp, part) }]));
    const srels = parseRels(await txt(relsPath(part))); srels.push({ id: nextRid(srels)(), type: REL_NOTES, target: rel(part, nsp) });
    await put(relsPath(part), relsXml(srels));
    const ct = await txt("[Content_Types].xml");
    await put("[Content_Types].xml", ct.replace("</Types>", `<Override PartName="/${nsp}" ContentType="${CT}notesSlide+xml"/></Types>`));
  }
  // 给一页写备注（上课时只有老师自己看得见的讲稿）；text 是空的就是清掉
  async function setNotes(no, text) {
    return step(`写第 ${no} 页的备注`, async () => { const s = await get(no); await writeNotes(s.part, text); return { no: s.no, chars: String(text || "").length }; });
  }

  // ---------- 自己检查一遍 ----------
  // 放不下、没标题、标题重复、空页、没清干净的记号……每一条都带「在第几页、怎么改」
  async function check() {
    const issues = [], seen = new Map(), all = await slides();
    const add = (no, problem, fix) => issues.push({ slide: no, problem, fix });
    for (const s of all) {
      const xml = await txt(s.part), sh = shapeList(xml), d = D.specOf(sh), t = sh.find(TITLE), title = t ? t.text.join(" ").trim() : "";
      const body = sh.filter((x) => !TITLE(x) && !DECO(x) && !FOOT(x) && (x.kind === "text" || x.kind === "table")).flatMap((x) => x.text).join("\n");
      if (!title) add(s.no, "没有标题", "set_text 把标题写上（shape 写 \"title\"）；没有标题框就 edit_slide 给一个 title");
      else { const k = title.replace(/（续）$/, ""); if (seen.has(k) && !/（续）$/.test(title)) add(s.no, `标题和第 ${seen.get(k)} 页一样：「${title}」`, "两页讲的不一样就改一个标题；一样就删掉一页"); else if (!seen.has(k)) seen.set(k, s.no); }
      if (title.length > 30) add(s.no, `标题太长（${title.length} 个字）`, "标题压到 20 个字以内，细节放到要点里");
      if (!body.trim() && !sh.some((x) => ["picture", "formula", "chart", "group"].includes(x.kind)) && !(d && D.DARK.has(d.layout))) add(s.no, "这一页除了标题什么都没有", "edit_slide 补上内容，或者删掉这一页");
      if (d) { let warn = []; try { warn = D.render(D.convert(d.spec, {}), { fs: d.fs }).warn; } catch (e) { warn = [e.message]; } for (const w of warn) add(s.no, w, "edit_slide 精简文字，或者把内容分成两页"); }
      else if (body.length > 260) add(s.no, `字太多（${body.length} 个字），后排的学生看不清`, "精简到 5 条以内，或者拆成两页");
      const junk = /\*\*|```|\$[^$\n]{1,80}\$|\{\{|TODO|待补充|此处填写|XXX|单击此处/i.exec(title + "\n" + body);
      if (junk) add(s.no, `有没清干净的记号或者占位的字：「${junk[0].slice(0, 20)}」`, "set_text 改成正式的内容（公式用 insert_formula）");
    }
    return { pages: all.length, ok: !issues.length, issues, ...(issues.length ? {} : { note: "没发现版面上的问题。内容对不对（概念、数据、代码）还要老师自己过一遍" }) };
  }

  // ---------- 预览 ----------
  // 一页画成 SVG（界面上的缩略图、大图）：读的就是 .pptx 里现在的样子，所以每改一步都跟着变
  async function preview(no) {
    const s = await get(no), { cx: W, cy: H } = await size(), th = await theme();
    const rels = parseRels(await txt(relsPath(s.part))), img = {};
    for (const r of rels.filter((x) => x.type === REL.image)) { const p = resolve(s.part, r.target), f = zip.file(p); if (!f) continue; const ext = p.split(".").pop().toLowerCase(); if (!/^(png|jpe?g|gif)$/.test(ext)) continue; const b = await f.async("nodebuffer"); if (b.length < 3e6) img[r.id] = `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${b.toString("base64")}`; }
    let inherit = null;       // 老师自己的 PPT：占位符的位置写在版式 / 母版里
    const lr = rels.find((r) => r.type === REL.layout);
    if (lr && !shapeList(s.xml).some((x) => x.lz)) { const lay = resolve(s.part, lr.target), lx = (await txt(lay)) || "", mr = parseRels(await txt(relsPath(lay))).find((r) => /\/slideMaster$/.test(r.type)), mx = mr ? (await txt(resolve(lay, mr.target))) || "" : ""; inherit = { layout: lx, master: mx }; }
    return require("./pptview").svg({ xml: s.xml, W, H, colors: th.colors, images: img, no: s.no, inherit, shapeList });
  }

  // ---------- 撤销、另存 ----------
  async function undo() {
    const h = history.pop(); if (!h) return null;
    for (const [p, c] of h.parts) { if (c == null) zip.remove(p); else zip.file(p, c, { createFolders: false }); }
    return h.label;
  }
  // 压缩包里不留「文件夹」条目（有的网盘、在线预览遇到会打不开）
  const save = () => { for (const k of Object.keys(zip.files)) if (zip.files[k].dir) delete zip.files[k]; return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }); };
  return { outline, slide, setText, replace, addSlide, addDesigned, editSlide, deleteSlide, moveSlide, duplicateSlide, insertFormula, insertTable, insertImage, deleteShape, setTheme, theme, formatText, scaleFont, setNotes, notes, check, preview, designed, undo, save, history: () => history.map((h) => h.label), size, count: async () => (await slides()).length };
}

module.exports = { load, shapeList, imageInfo };
