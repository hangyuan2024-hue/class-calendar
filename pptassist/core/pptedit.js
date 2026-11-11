// 捞捞PPT助手 · 按老师的要求改 PPT（给本地大模型调用的「工具」都在这里）
//   读：outline() 整份的大纲、slide(no) 一页上有哪些文字框
//   改：setText 改某个框的文字、replace 全文替换、addSlide 加一页、deleteSlide 删一页、moveSlide 挪位置、insertFormula 插公式
//   每一步都能 undo；save() 出新的 .pptx（原文件不动）。
// 直接改 pptx 里的 XML（和 core/pptx.js 一样的做法），原来的动画、母版、图片都不碰。
"use strict";
const JSZip = require("jszip");
const X = require("./pptx");
const M = require("./latex2omml");

const { esc, attr, parseRels, relsXml, nextRid, resolve, relsPath, box, maxShapeId, REL, CT_SLIDE, NS_R } = X;
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_M = "http://schemas.openxmlformats.org/officeDocument/2006/math";

// 一页里最外层的形状（<p:sp>，包括包在公式 mc:AlternateContent 里的）
function shapeList(xml) {
  const out = [];
  const tree = /<p:spTree>([\s\S]*)<\/p:spTree>/.exec(xml);
  if (!tree) return out;
  const re = /<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent>|<p:sp>[\s\S]*?<\/p:sp>|<p:sp [^>]*>[\s\S]*?<\/p:sp>|<p:pic\b[\s\S]*?<\/p:pic>|<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>|<p:grpSp>[\s\S]*?<\/p:grpSp>/g;
  const base = tree.index + "<p:spTree>".length;
  for (const m of tree[1].matchAll(re)) {
    const x = m[0], start = base + m.index;
    const nv = /<p:cNvPr\b[^>]*>/.exec(x);
    const ph = /<p:ph\b[^>]*\/?>/.exec(x);
    const kind = x.startsWith("<mc:") ? (/<a14:m>|<m:oMath/.test(x) ? "formula" : "other") : x.startsWith("<p:pic") ? "picture" : x.startsWith("<p:graphicFrame") ? (/<a:tbl>/.test(x) ? "table" : "chart") : x.startsWith("<p:grpSp") ? "group" : "text";
    out.push({ start, end: start + x.length, xml: x, id: nv ? +attr(nv[0], "id") : 0, name: nv ? attr(nv[0], "name") || "" : "", ph: ph ? attr(ph[0], "type") || "body" : null, kind, text: X.paragraphs(x) });
  }
  return out;
}
const TITLE = (s) => s.ph === "title" || s.ph === "ctrTitle";

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
  const put = async (p, content) => { if (tx && !tx.has(p)) tx.set(p, has(p) ? await txt(p) : null); zip.file(p, content); };
  const drop = async (p) => { if (!has(p)) return; if (tx && !tx.has(p)) tx.set(p, await txt(p)); zip.remove(p); };
  async function step(label, fn) {
    tx = new Map();
    try { const r = await fn(); if (tx.size) history.push({ label, parts: tx }); return r; }
    catch (e) { for (const [p, c] of tx) { if (c == null) zip.remove(p); else zip.file(p, c); } throw e; }
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
      const xml = await txt(s.part), sh = shapeList(xml);
      const t = sh.find(TITLE);
      out.push({ no: s.no, title: t ? t.text.join(" ") : "", hidden: /<p:sld\b[^>]*\sshow="0"/.test(xml),
        texts: sh.filter((x) => !TITLE(x) && x.kind === "text" && !["sldNum", "dt", "ftr"].includes(x.ph)).flatMap((x) => x.text),
        formulas: sh.filter((x) => x.kind === "formula").length, pictures: sh.filter((x) => x.kind === "picture").length });
    }
    return out;
  }
  async function slide(no) {
    const s = await get(no);
    return { no: s.no, shapes: shapeList(s.xml).map((x, i) => ({ shape: i + 1, kind: TITLE(x) ? "title" : x.kind, name: x.name, text: x.text })) };
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
  async function setText(no, shape, lines) {
    lines = (Array.isArray(lines) ? lines : String(lines || "").split(/\n/)).map((x) => String(x).replace(/\r/g, ""));
    return step(`改第 ${no} 页的文字`, async () => {
      const s = await get(no), sh = shapeList(s.xml);
      const t = shape === "title" ? sh.find(TITLE) : sh[(+shape || 0) - 1];
      if (!t) throw new Error(shape === "title" ? `第 ${no} 页没有标题框` : `第 ${no} 页没有第 ${shape} 个框（一共 ${sh.length} 个）`);
      if (t.kind !== "text" || !/<p:txBody>/.test(t.xml)) throw new Error(`第 ${no} 页第 ${shape} 个不是文字框（是${{ formula: "公式", picture: "图片", table: "表格", chart: "图表", group: "组合" }[t.kind] || t.kind}）`);
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
  async function addSlide(after, title, lines) {
    lines = (Array.isArray(lines) ? lines : String(lines || "").split(/\n/)).map(String).filter((x) => x.trim());
    return step(`加一页「${title || ""}」`, async () => {
      const all = await slides();
      after = Math.max(0, Math.min(all.length, after == null ? all.length : +after));
      const prev = all[after - 1] || all[all.length - 1];
      const { cx: W, cy: H } = await size();
      const nums = Object.keys(zip.files).map((f) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(f)).filter(Boolean).map((m) => +m[1]);
      const n = Math.max(0, ...nums) + 1, part = `ppt/slides/slide${n}.xml`;
      const layout = await layoutFor(prev && prev.part);
      const sp = (id, name, ph, x, y, w, h, paras) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr>${box(x, y, w, h)}</p:spPr><p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
      const body = (lines.length ? lines : [""]).map((l) => `<a:p>${l ? run(l) : '<a:endParaRPr lang="zh-CN" altLang="en-US"/>'}</a:p>`).join("");
      const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
        sp(2, "标题 1", '<p:ph type="title"/>', W * 0.06, H * 0.05, W * 0.88, H * 0.15, `<a:p>${run(title || "")}</a:p>`) +
        sp(3, "内容 2", '<p:ph idx="1"/>', W * 0.06, H * 0.23, W * 0.88, H * 0.68, body) +
        `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
      await put(part, xml);
      await put(relsPath(part), relsXml(layout ? [{ id: "rId1", type: REL.layout, target: layout }] : []));
      let ct = await txt("[Content_Types].xml");
      if (!ct.includes(`PartName="/${part}"`)) await put("[Content_Types].xml", ct.replace("</Types>", `<Override PartName="/${part}" ContentType="${CT_SLIDE}"/></Types>`));
      const prels = parseRels(await txt("ppt/_rels/presentation.xml.rels")); const rid = nextRid(prels)();
      prels.push({ id: rid, type: REL.slide, target: `slides/slide${n}.xml` });
      await put("ppt/_rels/presentation.xml.rels", relsXml(prels));
      let p = await pres();
      let maxId = 255; for (const m of p.matchAll(/<p:sldId\b[^>]*\sid="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
      const tag = `<p:sldId id="${maxId + 1}" r:id="${rid}"/>`;
      if (!/<p:sldIdLst>/.test(p)) p = p.replace(/(<p:sldMasterIdLst>[\s\S]*?<\/p:sldMasterIdLst>)/, `$1<p:sldIdLst></p:sldIdLst>`);
      p = after > 0 && all[after - 1] ? p.replace(all[after - 1].tag, all[after - 1].tag + tag) : p.replace("<p:sldIdLst>", "<p:sldIdLst>" + tag);
      await put("ppt/presentation.xml", p);
      await fixCount();
      return { no: after + 1, count: all.length + 1 };
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
      await put("[Content_Types].xml", ct.replace(new RegExp(`<Override PartName="/${s.part.replace(/[.]/g, "\\.")}"[^>]*/>`), ""));
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

  // ---------- 公式 ----------
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

  // ---------- 撤销、另存 ----------
  async function undo() {
    const h = history.pop(); if (!h) return null;
    for (const [p, c] of h.parts) { if (c == null) zip.remove(p); else zip.file(p, c); }
    return h.label;
  }
  const save = () => zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { outline, slide, setText, replace, addSlide, deleteSlide, moveSlide, insertFormula, undo, save, history: () => history.map((h) => h.label), size };
}

module.exports = { load, shapeList };
