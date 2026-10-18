// 6.3 直接导入文稿：把 Word 文档（.docx）读成一行行字，全在本机，不上传、不花 token。
// 正文一段一行；表格每一行输出成一行（格子之间空一格），本地整理（parse.js 的 tableItems）就能按表头把每一行认成一件事。
// 网页、电脑版、小程序共用这一份（安卓 App 用 Java 自带的 zip，规则一样）。
// 用法：DocxText.read(u8 /* Uint8Array */, inflateRaw /* (Uint8Array) => Uint8Array，可以是 pako.inflateRaw */) → Promise<string>
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DocxText = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  // zip 里找一个文件，返回 { method, data }（data 还没解压）
  function zipEntry(b, want) {
    var e = -1;
    for (var i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (u32(b, i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error("不是 Word 文档（.docx）");
    var n = u16(b, e + 10), p = u32(b, e + 16);
    for (var k = 0; k < n && p + 46 <= b.length; k++) {
      if (u32(b, p) !== 0x02014b50) break;
      var method = u16(b, p + 10), csize = u32(b, p + 20), nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32), off = u32(b, p + 42);
      var name = ""; for (var j = 0; j < nl; j++) name += String.fromCharCode(b[p + 46 + j]);
      if (name === want) {
        var start = off + 30 + u16(b, off + 26) + u16(b, off + 28);
        return { method: method, data: b.subarray(start, start + csize) };
      }
      p += 46 + nl + xl + cl;
    }
    return null;
  }
  function utf8(b) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(b);
    var s = "", i = 0;
    while (i < b.length) {
      var c = b[i++];
      if (c < 0x80) s += String.fromCharCode(c);
      else if (c < 0xe0) s += String.fromCharCode(((c & 31) << 6) | (b[i++] & 63));
      else if (c < 0xf0) s += String.fromCharCode(((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63));
      else { var cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63); cp -= 0x10000; s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023)); }
    }
    return s;
  }
  function unxml(s) { return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); }).replace(/&amp;/g, "&"); }
  // word/document.xml → 文字：段落一行；表格一行一行（只拿最外层表格，格子里的段落接起来）
  function xmlText(xml) {
    var body = (xml.match(/<w:body[\s\S]*<\/w:body>/) || [xml])[0];
    var re = /<w:tbl[ >]|<\/w:tbl>|<w:tr[ >]|<\/w:tr>|<w:tc[ >]|<\/w:tc>|<w:p[ >]|<w:p\/>|<\/w:p>|<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
    var out = [], depth = 0, para = "", row = null, cell = "", m;
    function endPara() {
      if (depth > 0) { cell += (cell && para ? " " : "") + para.trim(); }
      else if (para.trim()) out.push(para.trim());
      para = "";
    }
    while ((m = re.exec(body))) {
      var t = m[0];
      if (t.indexOf("<w:tbl") === 0) { if (depth === 0) endPara(); depth++; }
      else if (t === "</w:tbl>") { depth = Math.max(0, depth - 1); }
      else if (t.indexOf("<w:tr") === 0) { if (depth === 1) row = []; }
      else if (t === "</w:tr>") { if (depth === 1 && row) { var line = row.join(" ").replace(/\s+/g, " ").trim(); if (line) out.push(line); row = null; } }
      else if (t.indexOf("<w:tc") === 0) { if (depth === 1) cell = ""; }
      else if (t === "</w:tc>") { if (depth === 1 && row) { row.push(cell.replace(/\s+/g, " ").trim() || "-"); cell = ""; } }
      else if (t === "</w:p>" || t === "<w:p/>") endPara();
      else if (t.indexOf("<w:p") === 0) { /* 段落开始 */ }
      else if (t === "<w:tab/>") para += " ";
      else if (t === "<w:br/>" || t === "<w:cr/>") { if (depth > 0) para += " "; else { endPara(); } }
      else para += unxml(m[1] || "");
    }
    endPara();
    return out.join("\n");
  }
  function read(u8, inflateRaw) {
    return Promise.resolve().then(function () {
      var b = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
      if (b[0] === 0xd0 && b[1] === 0xcf) throw new Error("这是老版本的 .doc 文件，请在 Word / WPS 里另存为 .docx 再导入");
      if (b[0] === 0x25 && b[1] === 0x50) throw new Error("PDF 暂时不能直接导入：截图后用「截图识别」，或者复制里面的文字粘贴进来");
      var e = zipEntry(b, "word/document.xml");
      if (!e) throw new Error("不是 Word 文档（.docx）");
      var raw = e.method === 0 ? e.data : e.method === 8 ? inflateRaw(e.data) : null;
      if (!raw) throw new Error("这个 Word 文档的压缩方式不支持");
      return Promise.resolve(raw).then(function (r) { return xmlText(utf8(r instanceof Uint8Array ? r : new Uint8Array(r))); });
    });
  }
  // 浏览器自带的解压（新浏览器都有），没有就用 pako
  function browserInflate(data) {
    if (typeof DecompressionStream === "undefined") { if (typeof pako !== "undefined") return pako.inflateRaw(data); throw new Error("浏览器太旧，不能读 Word 文档"); }
    var ds = new DecompressionStream("deflate-raw");
    return new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }
  return { read: read, xmlText: xmlText, browserInflate: browserInflate };
});
