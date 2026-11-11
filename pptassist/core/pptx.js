// 捞捞PPT助手 · 读写 .pptx（它就是一个 zip，里面是一页一页的 XML）
//   read(buf)  → 每一页的标题、文字、背景色、是不是隐藏页
//   write(buf, plan) → 在选中的页上加：老师形象讲解视频（进这一页自动播放）+ 几个问题按钮；
//                      每个问题一张隐藏的回答页（点按钮跳过去，老师回答，点「返回」回到原来那页）
//   原文件不动，写出一个新文件。
"use strict";
const JSZip = require("jszip");

const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = {
  slide: NS_R + "/slide",
  layout: NS_R + "/slideLayout",
  video: NS_R + "/video",
  image: NS_R + "/image",
  media: "http://schemas.microsoft.com/office/2007/relationships/media",
};
const CT_SLIDE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const EMU = 914400;   // 1 英寸

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const unesc = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? unesc(m[1]) : null; };
const dirOf = (p) => p.slice(0, p.lastIndexOf("/") + 1);
// 关系文件里的 Target 是相对路径：拼成 zip 里的完整路径
function resolve(base, target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = (dirOf(base) + target).split("/"), out = [];
  for (const p of parts) { if (p === "..") out.pop(); else if (p !== ".") out.push(p); }
  return out.join("/");
}
const relsPath = (part) => dirOf(part) + "_rels/" + part.slice(part.lastIndexOf("/") + 1) + ".rels";

function parseRels(xml) {
  const out = [];
  for (const m of String(xml || "").matchAll(/<Relationship\b[^>]*\/?>/g)) out.push({ id: attr(m[0], "Id"), type: attr(m[0], "Type"), target: attr(m[0], "Target"), external: attr(m[0], "TargetMode") === "External" });
  return out;
}
function relsXml(rels) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    rels.map((r) => `<Relationship Id="${esc(r.id)}" Type="${esc(r.type)}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`).join("") + "</Relationships>";
}
function nextRid(rels) { let n = 0; for (const r of rels) { const m = /^rId(\d+)$/.exec(r.id || ""); if (m) n = Math.max(n, +m[1]); } return () => "rId" + ++n; }

// 一段 XML 里的文字：每个 <a:p> 一行
function paragraphs(xml) {
  const out = [];
  for (const p of String(xml).matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p [^>]*>([\s\S]*?)<\/a:p>/g)) {
    const body = p[1] != null ? p[1] : p[2];
    const t = [...body.matchAll(/<a:t>([^<]*)<\/a:t>|<a:t [^>]*>([^<]*)<\/a:t>/g)].map((m) => unesc(m[1] != null ? m[1] : m[2])).join("");
    if (t.trim()) out.push(t.trim());
  }
  return out;
}
// 页面里的形状（<p:sp>），只看最外层的，带占位符类型
function shapes(slideXml) {
  const out = [];
  for (const m of String(slideXml).matchAll(/<p:sp>[\s\S]*?<\/p:sp>|<p:sp [^>]*>[\s\S]*?<\/p:sp>/g)) {
    const ph = /<p:ph\b[^>]*\/?>/.exec(m[0]);
    out.push({ xml: m[0], ph: ph ? attr(ph[0], "type") || "body" : null, text: paragraphs(m[0]) });
  }
  return out;
}
function bgColor(xml) {
  const bg = /<p:bg>([\s\S]*?)<\/p:bg>/.exec(String(xml || ""));
  if (!bg) return null;
  const c = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(bg[1]);
  if (c) return "#" + c[1].toLowerCase();
  return /<a:schemeClr val="(dk1|tx1|bg2|dk2)"/.test(bg[1]) ? "#1f2937" : "#ffffff";
}

async function open(buf) {
  const zip = await JSZip.loadAsync(buf);
  const txt = async (p) => { const f = zip.file(p); return f ? f.async("string") : null; };
  const pres = await txt("ppt/presentation.xml");
  if (!pres) throw new Error("这不是 PowerPoint 文件（.pptx）");
  const presRels = parseRels(await txt("ppt/_rels/presentation.xml.rels"));
  const sz = /<p:sldSz\b[^>]*>/.exec(pres);
  const size = { cx: sz ? +attr(sz[0], "cx") : 12192000, cy: sz ? +attr(sz[0], "cy") : 6858000 };
  const ids = [...pres.matchAll(/<p:sldId\b[^>]*\/>/g)].map((m) => ({ id: +attr(m[0], "id"), rid: attr(m[0], "r:id") }));
  const slides = [];
  for (const [i, s] of ids.entries()) {
    const rel = presRels.find((r) => r.id === s.rid); if (!rel) continue;
    const part = resolve("ppt/presentation.xml", rel.target);
    const xml = await txt(part); if (xml == null) continue;
    const rels = parseRels(await txt(relsPath(part)));
    const lay = rels.find((r) => r.type === REL.layout);
    const layPart = lay ? resolve(part, lay.target) : null;
    const layXml = layPart ? await txt(layPart) : null;
    let bg = bgColor(xml) || bgColor(layXml);
    if (!bg && layPart) { const lr = parseRels(await txt(relsPath(layPart))).find((r) => /slideMaster$/.test(r.type)); if (lr) bg = bgColor(await txt(resolve(layPart, lr.target))); }
    const sh = shapes(xml);
    const title = (sh.find((x) => x.ph === "title" || x.ph === "ctrTitle") || {}).text || [];
    const texts = sh.filter((x) => x.ph !== "title" && x.ph !== "ctrTitle" && x.ph !== "sldNum" && x.ph !== "dt" && x.ph !== "ftr").flatMap((x) => x.text);
    const laolao = /name="捞捞讲解"|name="捞捞问答/.test(xml);
    slides.push({ no: i + 1, part, sldId: s.id, rid: s.rid, title: title.join(" ") || "", texts, hidden: /<p:sld\b[^>]*\sshow="0"/.test(xml), bg: bg || "#ffffff", layout: lay ? lay.target : null, laolao });
  }
  return { zip, size, slides, pres, presRels };
}

async function read(buf) {
  const d = await open(buf);
  return { size: d.size, slides: d.slides.map(({ no, title, texts, hidden, bg, laolao }) => ({ no, title, texts, hidden, bg, laolao })) };
}

// ---------- 写 ----------
function maxShapeId(xml) { let n = 1; for (const m of String(xml).matchAll(/<p:cNvPr\b[^>]*\sid="(\d+)"/g)) n = Math.max(n, +m[1]); return n; }
function maxCtnId(xml) { let n = 0; for (const m of String(xml).matchAll(/<p:cTn\b[^>]*\sid="(\d+)"/g)) n = Math.max(n, +m[1]); return n; }
const box = (x, y, cx, cy) => `<a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>`;

function picXml(id, name, rVid, rMedia, rImg, x, y, cx, cy) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(name)}"><a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>` +
    `<p:nvPr><a:videoFile r:link="${rVid}"/><p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><p14:media xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" r:embed="${rMedia}"/></p:ext></p:extLst></p:nvPr></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rImg}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${box(x, y, cx, cy)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}
function textRun(t, { sz = 1400, color = "1E2A4A", bold = false } = {}) {
  return `<a:r><a:rPr lang="zh-CN" altLang="en-US" sz="${sz}"${bold ? ' b="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:rPr><a:t>${esc(t)}</a:t></a:r>`;
}
// 圆角按钮（点了跳到别的页）
function buttonXml(id, name, text, link, x, y, cx, cy, o = {}) {
  const fill = o.fill || "ECFEFF", line = o.line || "22D3EE", color = o.color || "0E7490";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}">${link}</p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${box(x, y, cx, cy)}<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 50000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="108000" rIns="108000" tIns="36000" bIns="36000" anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="ctr"/>${textRun(text, { sz: o.sz || 1400, color })}</a:p></p:txBody></p:sp>`;
}
function textBoxXml(id, name, lines, x, y, cx, cy, o = {}) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${box(x, y, cx, cy)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${o.fill ? `<a:solidFill><a:srgbClr val="${o.fill}"/></a:solidFill>` : "<a:noFill/>"}</p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="144000" rIns="144000" tIns="108000" bIns="108000"><a:normAutofit/></a:bodyPr><a:lstStyle/>` +
    lines.map((l) => `<a:p><a:pPr><a:lnSpc><a:spcPct val="130000"/></a:lnSpc></a:pPr>${textRun(l, o)}</a:p>`).join("") + `</p:txBody></p:sp>`;
}

// 进这一页就自动播放视频（PowerPoint 自己存「自动开始」的写法）
function autoplayPar(c0, spid, ms) {
  return `<p:par><p:cTn id="${c0}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst>` +
    `<p:par><p:cTn id="${c0 + 1}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
    `<p:par><p:cTn id="${c0 + 2}" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="afterEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
    `<p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="${c0 + 3}" dur="${Math.max(1, Math.round(ms))}" fill="hold"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:cmd>` +
    `</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
}
const mediaNode = (c, spid) => `<p:video><p:cMediaNode vol="80000"><p:cTn id="${c}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cMediaNode></p:video>`;
function addAutoplay(xml, spid, ms) {
  const m = /<p:timing>([\s\S]*)<\/p:timing>/.exec(xml);
  if (!m) {
    const t = `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
      `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${autoplayPar(3, spid, ms)}</p:childTnLst></p:cTn>` +
      `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>` +
      mediaNode(7, spid) + `</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
    // 顺序是 cSld、clrMapOvr、transition（可能包在 mc:AlternateContent 里）、timing、extLst：
    // 放在页面级的 <p:extLst> 前面，没有就放最后
    const cut = xml.indexOf("</p:cSld>") + "</p:cSld>".length;
    const tail = xml.slice(cut), e = tail.indexOf("<p:extLst"), z = tail.lastIndexOf("</p:sld>");
    const at = cut + (e >= 0 ? e : z);
    return { xml: xml.slice(0, at) + t + xml.slice(at), auto: true };
  }
  // 这一页本来就有动画：把「自动播放」插到最前面，其他动画照旧
  const c0 = maxCtnId(m[1]) + 1;
  const seq = /(<p:cTn\b[^>]*nodeType="mainSeq"[^>]*>\s*<p:childTnLst>)/.exec(xml);
  const rootEnd = /<\/p:childTnLst>\s*<\/p:cTn>\s*<\/p:par>\s*<\/p:tnLst>/.exec(xml);
  if (!seq || !rootEnd) return { xml, auto: false };
  let out = xml.slice(0, seq.index + seq[0].length) + autoplayPar(c0, spid, ms) + xml.slice(seq.index + seq[0].length);
  const re = /<\/p:childTnLst>\s*<\/p:cTn>\s*<\/p:par>\s*<\/p:tnLst>/.exec(out);
  out = out.slice(0, re.index) + mediaNode(c0 + 4, spid) + out.slice(re.index);
  return { xml: out, auto: true };
}

// plan: [{ no: 第几页, narration: { video, poster, ms }, qa: [{ q, a, video, poster, ms }] }]
//   opt.side: "right" | "left"（形象放在哪边），opt.scale：形象占页面高度的多少（默认 0.46）
async function write(buf, plan, opt = {}) {
  const d = await open(buf);
  const { zip, size } = d;
  const ct0 = await zip.file("[Content_Types].xml").async("string");
  let ct = ct0;
  const ensureDefault = (ext, type) => { if (!new RegExp(`<Default Extension="${ext}"`, "i").test(ct)) ct = ct.replace(/<Types\b[^>]*>/, (m) => `${m}<Default Extension="${ext}" ContentType="${type}"/>`); };
  ensureDefault("mp4", "video/mp4"); ensureDefault("png", "image/png");
  let mediaN = 0; const taken = new Set(Object.keys(zip.files));
  const addMedia = (data, ext) => { let f; do { f = `ppt/media/laolao_${++mediaN}.${ext}`; } while (taken.has(f)); taken.add(f); zip.file(f, data); return "../media/" + f.slice("ppt/media/".length); };
  let pres = d.pres; const presRels = d.presRels.slice(); const presRid = nextRid(presRels);
  let maxSld = 255; for (const m of pres.matchAll(/<p:sldId\b[^>]*\sid="(\d+)"/g)) maxSld = Math.max(maxSld, +m[1]);
  let slideN = 0; for (const f of taken) { const m = /^ppt\/slides\/slide(\d+)\.xml$/.exec(f); if (m) slideN = Math.max(slideN, +m[1]); }
  const W = size.cx, H = size.cy;
  const AR = 432 / 768;   // 视频是竖的 9:16（真人比例的形象）
  const avH = H * (opt.scale || 0.6), avW = avH * AR, margin = W * 0.012;
  const side = opt.side === "left" ? "left" : "right";
  const avX = side === "right" ? W - avW - margin : margin, avY = H - avH;
  const report = [];

  // 视频的三条关系（视频、媒体、封面图）
  const videoRels = (rels, rid, v) => {
    const vt = addMedia(v.video, "mp4"), it = addMedia(v.poster, "png");
    const r = { vid: rid(), media: rid(), img: rid() };
    rels.push({ id: r.vid, type: REL.video, target: vt }, { id: r.media, type: REL.media, target: vt }, { id: r.img, type: REL.image, target: it });
    return r;
  };

  const newSlides = [];
  for (const item of plan) {
    const s = d.slides.find((x) => x.no === item.no);
    if (!s) throw new Error(`没有第 ${item.no} 页`);
    let xml = await zip.file(s.part).async("string");
    const rp = relsPath(s.part);
    const rels = parseRels(zip.file(rp) ? await zip.file(rp).async("string") : "");
    const rid = nextRid(rels);
    let id = maxShapeId(xml);
    let add = "";
    const rec = { no: s.no, narration: false, auto: false, qa: 0 };
    if (item.narration && item.narration.video) {
      const r = videoRels(rels, rid, item.narration);
      const spid = ++id;
      add += picXml(spid, "捞捞讲解", r.vid, r.media, r.img, avX, avY, avW, avH);
      const a = addAutoplay(xml, spid, item.narration.ms || 10000); xml = a.xml; rec.narration = true; rec.auto = a.auto;
    }
    // 问题按钮：竖着排在形象旁边（从下往上）
    const qa = (item.qa || []).filter((q) => q && q.q && q.video);
    const bw = W * 0.26, bh = H * 0.07, gap = H * 0.022;
    qa.forEach((q, k) => {
      // 回答页（隐藏）
      const no = ++slideN, part = `ppt/slides/slide${no}.xml`, sid = ++maxSld, prid = presRid();
      presRels.push({ id: prid, type: REL.slide, target: `slides/slide${no}.xml` });
      newSlides.push({ after: s.sldId, xml: `<p:sldId id="${sid}" r:id="${prid}"/>` });
      ct = ct.replace(/<\/Types>/, `<Override PartName="/${part}" ContentType="${CT_SLIDE}"/></Types>`);
      const arels = []; const arid = nextRid(arels);
      if (s.layout) arels.push({ id: arid(), type: REL.layout, target: s.layout });
      const vr = videoRels(arels, arid, q);
      const vh = H * 0.86, vw = vh * AR, vx = W - vw - W * 0.06, vy = H - vh - H * 0.04;
      const body =
        textBoxXml(2, "捞捞问题", ["问：" + q.q], W * 0.05, H * 0.07, W * 0.6, H * 0.16, { sz: 2600, color: "0E7490", bold: true }) +
        textBoxXml(3, "捞捞回答", String(q.a || "").split(/\n+/).filter(Boolean), W * 0.05, H * 0.26, W * 0.55, H * 0.5, { sz: 1800, color: "33415C", fill: "F4FBFF" }) +
        picXml(4, "捞捞讲解", vr.vid, vr.media, vr.img, vx, vy, vw, vh) +
        buttonXml(5, "捞捞返回", "← 返回", `<a:hlinkClick r:id="" action="ppaction://hlinkshowjump?jump=lastslideviewed"/>`, W * 0.05, H * 0.82, W * 0.14, H * 0.08, { fill: "FFFFFF" });
      let axml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${NS_R}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" show="0">` +
        `<p:cSld name="捞捞回答"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
      axml = addAutoplay(axml, 4, q.ms || 10000).xml;
      zip.file(part, axml);
      zip.file(relsPath(part), relsXml(arels));
      // 原来那页上的按钮
      const lr = rid(); rels.push({ id: lr, type: REL.slide, target: `slide${no}.xml` });
      const bx = side === "right" ? avX - bw - W * 0.01 : avX + avW + W * 0.01;
      const by = H - margin * 2 - bh - k * (bh + gap);
      add += buttonXml(++id, `捞捞问答${k + 1}`, "问：" + q.q, `<a:hlinkClick r:id="${lr}" action="ppaction://hlinksldjump"/>`, bx, by, bw, bh);
      rec.qa++;
    });
    if (add) xml = xml.replace(/<\/p:spTree>/, `${add}</p:spTree>`);
    zip.file(s.part, xml);
    zip.file(rp, relsXml(rels));
    report.push(rec);
  }
  // 回答页插在原页后面
  for (const ns of newSlides.reverse()) {
    const re = new RegExp(`(<p:sldId\\b[^>]*\\sid="${ns.after}"[^>]*/>)`);
    pres = pres.replace(re, `$1${ns.xml}`);
  }
  zip.file("ppt/presentation.xml", pres);
  zip.file("ppt/_rels/presentation.xml.rels", relsXml(presRels));
  zip.file("[Content_Types].xml", ct);
  const app = zip.file("docProps/app.xml");
  if (app) { const ax = await app.async("string"); const n = (pres.match(/<p:sldId\b/g) || []).length; zip.file("docProps/app.xml", ax.replace(/<Slides>\d+<\/Slides>/, `<Slides>${n}</Slides>`)); }
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { buf: out, report };
}

module.exports = { read, write, paragraphs, EMU };
