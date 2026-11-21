// 捞小智 · 知识库读文件：学校自己的资料放进知识库文件夹就能查
//   · Word（.docx）、PPT（.pptx，每页标「第 N 页」）、PDF（每页标「第 N 页」）、网页（.html / .htm，抽正文、认发布日期）、.txt / .md
//   · 视频、录音（.mp4 .mkv .mov .webm .mp3 .m4a .wav）：本机听写成带时间的文字稿，每段标「12:30」，回答时能说「见第几分几秒」；视频本身不复制、不上传
//   · 校规、手册（文字里有「第一条 第二条……」的）：按条切，每条一段，标「第十二条」（前面带上第几章）
//   · 资料说明（知识库文件夹里的「资料说明.json」，可选）：{ "学生手册.pdf": { "date": "2025-09-01", "abolished": false, "source": "教务处" } }
//     废止的不查；日期新的排前面一点
//   读出来的文字存在知识库文件夹的 .cache 里（按文件大小和修改时间），文件没变就不重读；视频只在点「整理知识库」时才听写（慢）
"use strict";
const fs = require("fs");
const path = require("path");

const TEXT = /\.(txt|md)$/i, DOCX = /\.docx$/i, PPTX = /\.pptx$/i, PDF = /\.pdf$/i, HTML = /\.html?$/i, AV = /\.(mp4|mkv|mov|webm|avi|mp3|m4a|wav|aac|flac)$/i;
const SUPPORTED = (f) => [TEXT, DOCX, PPTX, PDF, HTML, AV].some((r) => r.test(f));
const unx = (s) => String(s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&");
const mmss = (s) => { s = Math.max(0, Math.round(+s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };

async function zip(file) { const JSZip = require("jszip"); return JSZip.loadAsync(fs.readFileSync(file)); }
async function docx(file) {
  const z = await zip(file), xml = await z.file("word/document.xml").async("string");
  const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => unx([...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:tab\/>/g)].map((t) => (t[1] != null ? t[1] : " ")).join(""))).filter((x) => x.trim());
  return [{ text: paras.join("\n") }];
}
async function pptx(file) {
  const z = await zip(file);
  const names = Object.keys(z.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  const out = [];
  for (const n of names) {
    const xml = await z.file(n).async("string");
    const t = [...xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((m) => unx([...m[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => x[1]).join(""))).filter((x) => x.trim()).join("\n");
    if (t.trim()) out.push({ text: t, loc: "第 " + n.match(/\d+/)[0] + " 页" });
  }
  return out;
}
async function pdf(file) {
  let lib;
  try { lib = await import("pdfjs-dist/legacy/build/pdf.mjs"); } catch (e) { throw new Error("读 PDF 的组件没装上（pdfjs-dist）"); }
  const doc = await lib.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    let t = "", lastY = null;
    for (const it of c.items) { const y = it.transform ? it.transform[5] : null; if (lastY != null && y != null && Math.abs(y - lastY) > 2) t += "\n"; t += it.str; lastY = y; }
    t = t.replace(/[ \t]+\n/g, "\n").trim();
    if (t) out.push({ text: t, loc: "第 " + i + " 页" });
  }
  if (!out.length) throw new Error("这个 PDF 里没有文字（可能是扫描件，要先做文字识别）");
  return out;
}
function html(file) {
  const x = require("./websearch").extractHtml(fs.readFileSync(file, "utf8"));
  return { segs: [{ text: x.text }], title: x.title, date: x.date };
}

// 校规按条切：「第一章 总则」「第十二条 ……」；条数不到 3 条就不按条切
const CN = "零一二三四五六七八九十百千〇";
function byArticle(text) {
  const lines = String(text).split(/\n/);
  const isArt = (l) => new RegExp(`^\\s*第[${CN}\\d]+条`).test(l), isCh = (l) => new RegExp(`^\\s*第[${CN}\\d]+[章节]`).test(l);
  if (lines.filter(isArt).length < 3) return null;
  const out = []; let ch = "", cur = null, head = [];
  for (const l of lines) {
    if (isCh(l) && !isArt(l)) { ch = l.trim().slice(0, 40); continue; }
    if (isArt(l)) { if (cur) out.push(cur); const no = l.trim().match(new RegExp(`^第[${CN}\\d]+条`))[0]; cur = { loc: (ch ? ch.split(/\s+/)[0] + " " : "") + no, text: (ch ? ch + "\n" : "") + l.trim() }; continue; }
    if (cur) cur.text += "\n" + l.trim(); else if (l.trim()) head.push(l.trim());
  }
  if (cur) out.push(cur);
  if (head.join("").length > 20) out.unshift({ loc: "开头", text: head.join("\n") });
  return out;
}

// 一个文件 → { segs: [{ text, loc }], title, date, kind }
//   o.transcribe(file, say) → [{ start, end, text }]（视频、录音；没有就跳过）
async function extract(file, o = {}) {
  const name = path.basename(file), title = name.replace(/\.[^.]+$/, "");
  let segs, date = null, ttl = title, kind = "text";
  if (TEXT.test(name)) segs = [{ text: fs.readFileSync(file, "utf8") }];
  else if (DOCX.test(name)) { segs = await docx(file); kind = "word"; }
  else if (PPTX.test(name)) { segs = await pptx(file); kind = "ppt"; }
  else if (PDF.test(name)) { segs = await pdf(file); kind = "pdf"; }
  else if (HTML.test(name)) { const x = html(file); segs = x.segs; date = x.date || null; ttl = title; kind = "web"; }
  else if (AV.test(name)) {
    if (!o.transcribe) throw new Error("这台电脑还不能听写（成品展示里接一次电话准备好听写再试）");
    const ss = await o.transcribe(file, o.say || (() => {}));
    // 一分钟左右一段（太碎了查不准）：把相邻的句子拼起来，标开始时间
    segs = []; let cur = null;
    for (const x of ss || []) {
      if (!cur || x.start - cur.start > 60) { if (cur) segs.push(cur); cur = { start: x.start, text: "" }; }
      cur.text += x.text;
    }
    if (cur) segs.push(cur);
    segs = segs.map((x) => ({ text: x.text, loc: mmss(x.start), t: Math.round(x.start) }));
    kind = "video";
  } else throw new Error("不认识的文件：" + name);
  // 只有一段（Word、网页、txt）：看是不是按条写的规章，是就按条切
  if (segs.length === 1 || kind === "pdf") {
    const all = segs.map((s) => s.text).join("\n");
    const arts = byArticle(all);
    if (arts) { segs = arts; kind = kind === "pdf" ? "rules-pdf" : "rules"; }
  }
  return { segs: segs.filter((s) => s.text && s.text.trim()), title: ttl, date, kind };
}

module.exports = { extract, byArticle, SUPPORTED, AV, mmss };
