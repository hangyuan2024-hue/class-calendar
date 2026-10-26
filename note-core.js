// 7.1 全屏备忘录：富文本（delta）和「我的事项」原来的字段（note 文字 + list 清单）互相转换。
// 网页、小程序（lib/notecore.js 是这一份的拷贝）、电脑版共用；安卓 App 的 NoteCore.kt 是同一套规则。
// 只认 note 和 list 的老版本照样能看，所以每次保存都同时写回这两个字段；格式、手写、图片存在 rich 里：
//   rich: { d: [delta ops], s: 保存时 note + list 的指纹, f: { 图片编号: 云端附件 id } }
// 在别的地方改过文字（指纹对不上）就按新的文字重新排，图片放到最后，不会丢。
// delta 的写法和微信小程序 editor 一样（Quill）：
//   文字 { insert: "abc", attributes: { bold, italic, underline, strike, color, backgroundColor } }
//   换行 { insert: "\n", attributes: { header: 1|2, list: "bullet"|"ordered"|"checked"|"unchecked", indent: 1.. } }
//   图片 { insert: { image: 地址 }, attributes: { "data-custom": "k=编号", width } }   分割线 { insert: { divider: true } }
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./memo-core.js"));
  else root.NoteCore = factory(root.MemoCore);
})(typeof self !== "undefined" ? self : this, function (MC) {
  "use strict";
  var sig = function (rec) { return JSON.stringify([String((rec && rec.note) || ""), MC.listOf(rec).map(function (x) { return [x.t, !!x.d]; })]); };

  // 普通文字 + 清单 → delta
  function fromPlain(rec, keepImgs) {
    var ops = [];
    var note = String((rec && rec.note) || "").replace(/\r/g, "");
    if (note) note.split("\n").forEach(function (line) { if (line) ops.push({ insert: line }); ops.push({ insert: "\n" }); });
    MC.listOf(rec).forEach(function (x) { ops.push({ insert: x.t }); ops.push({ insert: "\n", attributes: { list: x.d ? "checked" : "unchecked" } }); });
    (keepImgs || []).forEach(function (im) { ops.push(im); ops.push({ insert: "\n" }); });
    if (!ops.length) ops.push({ insert: "\n" });
    return ops;
  }

  // delta → 一行一行：[{ t, attrs, imgs, runs }]（runs：这一行里每一段文字和它的格式）
  function lines(ops) {
    var out = [], cur = { t: "", imgs: [], runs: [] };
    (ops || []).forEach(function (op) {
      if (typeof op.insert === "string") {
        var parts = op.insert.split("\n");
        parts.forEach(function (p, i) {
          if (p) { cur.t += p; cur.runs.push({ t: p, a: op.attributes || null }); }
          if (i < parts.length - 1) { cur.attrs = op.attributes || {}; out.push(cur); cur = { t: "", imgs: [], runs: [] }; }
        });
      } else if (op.insert && op.insert.image) { cur.imgs.push(op); cur.runs.push({ img: op }); }
      else if (op.insert && op.insert.divider !== undefined) { cur.t += "———"; cur.runs.push({ hr: true }); }
    });
    if (cur.t || cur.imgs.length) { cur.attrs = {}; out.push(cur); }
    return out;
  }

  // delta → { note, list, imgs }（写回原来的字段，老版本能看）
  function toPlain(ops) {
    var note = [], list = [], imgs = [], n = 0;
    lines(ops).forEach(function (ln) {
      ln.imgs.forEach(function (im) { imgs.push(im); });
      var a = ln.attrs || {}, t = ln.t.replace(/\s+$/, "");
      if (a.list === "checked" || a.list === "unchecked") { if (t.trim()) list.push({ t: t.trim().slice(0, 200), d: a.list === "checked" }); return; }
      var pre = "";
      if (a.list === "ordered") pre = (++n) + ". "; else { n = 0; if (a.list === "bullet") pre = "• "; }
      if (ln.imgs.length && !t.trim()) { note.push("[图片]"); return; }
      note.push(pre + t);
    });
    while (note.length && !note[note.length - 1].trim()) note.pop();
    while (note.length && !note[0].trim()) note.shift();
    return { note: note.join("\n").slice(0, 5000), list: list.slice(0, 100), imgs: imgs };
  }

  // 打开时用哪份内容：rich 还对得上就用 rich，否则按文字重新排（保留图片）
  function load(rec) {
    var r = rec && rec.rich;
    if (r && Array.isArray(r.d) && r.s === sig(rec)) return { ops: r.d, fresh: false };
    var imgs = r && Array.isArray(r.d) ? r.d.filter(function (op) { return op && op.insert && op.insert.image; }) : [];
    return { ops: fromPlain(rec, imgs), fresh: !!r };
  }

  // 有没有「只在全屏页里才看得出来」的东西（格式、图片、手写）
  function hasRich(rec) {
    var r = rec && rec.rich;
    return !!(r && Array.isArray(r.d) && r.d.some(function (op) { return (op.insert && op.insert.image) || (op.attributes && Object.keys(op.attributes).some(function (k) { return k !== "list" || /ordered|bullet/.test(op.attributes.list); })); }));
  }
  function imgCount(rec) { var r = rec && rec.rich; return r && Array.isArray(r.d) ? r.d.filter(function (op) { return op.insert && op.insert.image; }).length : 0; }

  // 图片上挂的编号（小程序 editor 把 insertImage 的 data 变成 data-custom="k=xxx"）
  function imgKey(op) {
    var a = (op && op.attributes) || {}, c = String(a["data-custom"] || a.dataCustom || "");
    var m = /(?:^|&)k=([^&]+)/.exec(c);
    return m ? decodeURIComponent(m[1]) : "";
  }

  return { sig: sig, fromPlain: fromPlain, toPlain: toPlain, lines: lines, load: load, hasRich: hasRich, imgCount: imgCount, imgKey: imgKey };
});
