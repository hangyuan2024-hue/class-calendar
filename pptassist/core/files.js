// 捞小智 · 文件进、文件出
//   读：对话框里传上来的文件 → 给模型看的文字（Word、PPT、PDF、网页、表格、代码和纯文本）或图片（照片、截图）
//   写：make_file 工具 —— 让捞小智直接交一个文件：Word（.docx，用 Markdown 写内容）、表格（.csv，Excel 直接打开）、
//       Markdown、纯文本、网页、JSON、各种代码文件。文件存在本机，界面上点开、在文件夹里看、另存为
"use strict";
const fs = require("fs");
const path = require("path");

const IMG = /\.(png|jpe?g|webp|gif|bmp)$/i;
const CODE = /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|xml|log|ini|toml|py|ipynb|js|mjs|cjs|ts|tsx|jsx|c|h|cpp|cc|hpp|java|kt|go|rs|rb|php|cs|swift|m|r|sql|sh|bat|ps1|css|scss|vue|tex|bib|srt)$/i;
const OFFICE = /\.(docx|pptx|pdf|html?)$/i, XLSX = /\.xlsx$/i;
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp" };
const MAX_IN = 30 * 1048576;
const canRead = (name) => IMG.test(name) || CODE.test(name) || OFFICE.test(name) || XLSX.test(name);

// 表格：每个工作表一段，一行一行用 Tab 隔开（够模型看懂；公式只取算好的值）
async function xlsx(file) {
  const Z = await require("jszip").loadAsync(fs.readFileSync(file));
  const un = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const ss = [];
  const sx = Z.file("xl/sharedStrings.xml");
  if (sx) for (const m of (await sx.async("string")).matchAll(/<si>([\s\S]*?)<\/si>/g)) ss.push(un([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")));
  const wb = Z.file("xl/workbook.xml") ? await Z.file("xl/workbook.xml").async("string") : "";
  const names = [...wb.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => un(m[1]));
  const sheets = Object.keys(Z.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  const col = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const out = [];
  for (const [i, f] of sheets.entries()) {
    const x = await Z.file(f).async("string"), rows = [];
    for (const r of x.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = (/r="([A-Z]+\d+)"/.exec(c[1]) || [])[1], t = (/t="(\w+)"/.exec(c[1]) || [])[1], body = c[2] || "";
        let v = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1];
        if (t === "s" && v != null) v = ss[+v]; else if (t === "inlineStr") v = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("");
        if (v == null) continue;
        cells[ref ? col(ref) : cells.length] = un(v);
      }
      if (cells.length) rows.push(Array.from(cells, (v) => (v == null ? "" : v)).join("\t"));
      if (rows.length >= 2000) break;
    }
    out.push(`【工作表：${names[i] || "第 " + (i + 1) + " 张"}】\n` + rows.join("\n"));
  }
  return out.join("\n\n");
}

// 传上来的文件 → { kind: "image" | "text" | "ppt", text?, image?（data: 地址）}
async function read(file) {
  const name = path.basename(file), st = fs.statSync(file);
  if (st.size > MAX_IN) throw new Error(`「${name}」太大了（${(st.size / 1048576).toFixed(0)}M）：最多 30M`);
  if (IMG.test(name)) return { kind: "image", image: `data:${MIME[name.split(".").pop().toLowerCase()] || "image/png"};base64,` + fs.readFileSync(file).toString("base64") };
  if (/\.pptx$/i.test(name)) { const KB = require("./kbfiles"); const r = await KB.extract(file); return { kind: "ppt", text: r.segs.map((s) => (s.loc ? `（${s.loc}）` : "") + s.text).join("\n") }; }
  if (XLSX.test(name)) return { kind: "text", text: await xlsx(file) };
  if (OFFICE.test(name)) { const KB = require("./kbfiles"); const r = await KB.extract(file); return { kind: "text", text: r.segs.map((s) => (s.loc ? `（${s.loc}）` : "") + s.text).join("\n") }; }
  if (CODE.test(name)) {
    let t = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
    if (/\.ipynb$/i.test(name)) { try { t = JSON.parse(t).cells.map((c) => (c.cell_type === "code" ? "```\n" + [].concat(c.source).join("") + "\n```" : [].concat(c.source).join(""))).join("\n\n"); } catch (e) {} }
    return { kind: "text", text: t };
  }
  throw new Error(`「${name}」这种文件还读不了：能读 Word、PPT、PDF、Excel、网页、图片、代码和纯文本`);
}

// ---------- 写 Word：Markdown → 最小的 .docx（标题、段落、加粗、列表、表格、代码） ----------
const xe = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
function runs(text, base = "") {
  // **加粗**、*斜体*、`代码`；公式 $…$ 原样留着（Word 里能看懂）
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0, m;
  const push = (t, rp) => { if (t) out.push(`<w:r><w:rPr>${base}${rp}</w:rPr><w:t xml:space="preserve">${xe(t)}</w:t></w:r>`); };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index), "");
    const s = m[0];
    if (s.startsWith("**")) push(s.slice(2, -2), "<w:b/>");
    else if (s.startsWith("`")) push(s.slice(1, -1), '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:fill="F2F2F2"/>');
    else push(s.slice(1, -1), "<w:i/>");
    last = m.index + s.length;
  }
  push(text.slice(last), "");
  return out.join("");
}
const FONT = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/>';
const para = (inner, ppr = "") => `<w:p><w:pPr>${ppr}</w:pPr>${inner}</w:p>`;
function mdToBody(md) {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n"), out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if (/^```/.test(l)) {
      i++; const code = [];
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      for (const c of code) out.push(para(`<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei"/><w:sz w:val="19"/></w:rPr><w:t xml:space="preserve">${xe(c)}</w:t></w:r>`, '<w:shd w:val="clear" w:fill="F5F5F5"/><w:spacing w:after="0"/>'));
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { const n = m[1].length, sz = [0, 40, 32, 28, 26, 24, 24][n]; out.push(para(runs(m[2], `${FONT}<w:b/><w:sz w:val="${sz}"/>`), `<w:spacing w:before="${n === 1 ? 240 : 200}" w:after="120"/>${n === 1 ? '<w:jc w:val="center"/>' : ""}`)); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const rows = [cells(l)]; i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      const b = '<w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/>';
      out.push(`<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${b}</w:tblBorders></w:tblPr>` + rows.map((r, ri) => `<w:tr>${r.map((c) => `<w:tc><w:tcPr>${ri === 0 ? '<w:shd w:val="clear" w:fill="F2F2F2"/>' : ""}</w:tcPr>${para(runs(c, FONT + (ri === 0 ? "<w:b/>" : "")), '<w:spacing w:after="0"/>')}</w:tc>`).join("")}</w:tr>`).join("") + "</w:tbl>");
      out.push(para(""));
      continue;
    }
    if ((m = /^(\s*)([-*+]|\d+[.)、])\s+(.*)$/.exec(l))) {
      const lead = /\d/.test(m[2]) ? m[2].replace(/[)、]/, ".") + " " : "•  ", ind = 360 + Math.min(3, Math.floor(m[1].length / 2)) * 360;
      out.push(para(runs(lead + m[3], FONT), `<w:ind w:left="${ind}" w:hanging="300"/><w:spacing w:after="60"/>`)); i++; continue;
    }
    if (/^\s*>/.test(l)) { out.push(para(runs(l.replace(/^\s*>\s?/, ""), FONT + '<w:color w:val="595959"/>'), '<w:ind w:left="360"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="BFBFBF"/></w:pBdr>')); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push(para("", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D9D9D9"/></w:pBdr>')); i++; continue; }
    out.push(para(runs(l, FONT), '<w:spacing w:after="120" w:line="360" w:lineRule="auto"/>')); i++;
  }
  return out.join("");
}
async function docx(md) {
  const Z = new (require("jszip"))();
  Z.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  Z.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  Z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + mdToBody(md) +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>');
  return Z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// ---------- make_file：交一个文件 ----------
const FORMATS = { docx: "Word 文档", csv: "表格（Excel 能打开）", md: "Markdown", txt: "纯文本", html: "网页", json: "JSON", py: "Python", js: "JavaScript", ts: "TypeScript", c: "C", cpp: "C++", java: "Java", go: "Go", sql: "SQL", sh: "Shell", css: "CSS", tex: "LaTeX", xml: "XML", yaml: "YAML" };
const safeName = (s) => String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/^\.+/, "").trim().slice(0, 60);
function tool(o) {
  const dir = () => (typeof o.dir === "function" ? o.dir() : o.dir);
  return {
    name: "make_file",
    desc: "把内容做成一个文件交给对方（对方能直接打开、保存）。对方说「做成文件 / 导出 / 生成 Word / 给我一个 xx 文件 / 写成文档 / 下载」，或者要一份作业、报告、计划、名单、代码文件时用。" +
      "format 是文件类型：" + Object.entries(FORMATS).map(([k, v]) => `${k} ${v}`).join("、") + "。content 写完整的内容，不要省略：docx 用 Markdown 写（# 标题、## 小标题、- 列表、1. 编号、| 表格 |、**加粗**）；csv 第一行是表头、用英文逗号隔开，有逗号的格子加双引号；代码文件只写代码。name 是文件名（不带后缀）。做好以后简单说一句做了什么，不要把整份内容再贴一遍。",
    params: { name: { type: "string" }, format: { type: "string", enum: Object.keys(FORMATS) }, content: { type: "string" } }, req: ["name", "format", "content"],
    say: (a) => `做文件「${safeName(a.name) || "文件"}.${a.format || "txt"}」`,
    run: async (a) => {
      const fmt = FORMATS[a.format] ? a.format : "txt";
      const content = String(a.content || "");
      if (!content.trim()) throw new Error("文件内容是空的");
      if (content.length > 400000) throw new Error("内容太长了（最多 40 万字）");
      const d = path.join(dir(), "files"); fs.mkdirSync(d, { recursive: true });
      let base = safeName(a.name) || "捞小智做的文件", f = path.join(d, `${base}.${fmt}`);
      for (let k = 2; fs.existsSync(f); k++) f = path.join(d, `${base}（${k}）.${fmt}`);
      const buf = fmt === "docx" ? await docx(content) : Buffer.from((fmt === "csv" ? "﻿" : "") + content, "utf8");   // csv 带 BOM：Excel 打开中文不乱码
      fs.writeFileSync(f, buf);
      const r = { ok: true, file: path.basename(f), format: fmt, kind: FORMATS[fmt], size: buf.length };
      if (o.onFile) try { o.onFile({ ...r, path: f }); } catch (e) {}
      return { ...r, note: "文件做好了，界面上已经显示出来，对方点一下就能打开" };
    },
  };
}
module.exports = { read, canRead, docx, mdToBody, tool, FORMATS, xlsx };
