/* office-preview.js —— 课内学习 · 网站版的 Word / PPT 在线预览（自己写的轻量渲染，不用 LibreOffice、不上传文件）
 * 本机版把 docx / pptx 交给 LibreOffice 转成 PDF 再显示；网站上没有这个服务，这里在浏览器里直接读文件：
 *   · docx：段落、标题、粗体 / 斜体 / 下划线、列表、表格、图片
 *   · pptx：每页按原来的位置摆放文字框和图片（字号按比例缩放），一页一页往下排
 * 复杂排版（艺术字、图表、SmartArt、公式对象）只显示里面的文字，完整效果请下载原文件。旧版 .doc / .ppt 不支持。 */
(function () {
  "use strict";
  var fflateReady = null;
  function loadFflate() {
    if (window.fflate) return Promise.resolve(window.fflate);
    if (fflateReady) return fflateReady;
    fflateReady = new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = "vendor/office/fflate.min.js";
      s.onload = function () { window.fflate ? res(window.fflate) : rej(new Error("解压组件加载失败")); };
      s.onerror = function () { fflateReady = null; rej(new Error("解压组件加载失败")); };
      document.head.appendChild(s);
    });
    return fflateReady;
  }
  var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var NS = { w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main", a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    p: "http://schemas.openxmlformats.org/presentationml/2006/main", r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships" };
  function xml(files, name) { var f = files[name]; return f ? new DOMParser().parseFromString(new TextDecoder().decode(f), "application/xml") : null; }
  function kids(el, ns, local) { var out = []; if (!el) return out; for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (c.namespaceURI === ns && (!local || c.localName === local)) out.push(c); return out; }
  function first(el, ns, local) { return el ? el.getElementsByTagNameNS(ns, local)[0] || null : null; }
  function attr(el, ns, name) { return el ? (ns ? el.getAttributeNS(ns, name) : el.getAttribute(name)) : null; }
  function rels(files, path) {
    var dir = path.slice(0, path.lastIndexOf("/") + 1), relPath = dir + "_rels/" + path.slice(dir.length) + ".rels", doc = xml(files, relPath), map = {};
    if (!doc) return map;
    Array.prototype.forEach.call(doc.getElementsByTagName("Relationship"), function (r) {
      var t = r.getAttribute("Target") || "", full = t.charAt(0) === "/" ? t.slice(1) : normalize(dir + t);
      map[r.getAttribute("Id")] = { target: full, type: r.getAttribute("Type") || "", external: r.getAttribute("TargetMode") === "External" };
    });
    return map;
  }
  function normalize(p) { var out = []; p.split("/").forEach(function (s) { if (s === "..") out.pop(); else if (s && s !== ".") out.push(s); }); return out.join("/"); }
  var MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml" };
  function blobUrl(files, path, urls) {
    var d = files[path]; if (!d) return "";
    var ext = (path.split(".").pop() || "").toLowerCase(); if (!MIME[ext]) return "";
    var u = URL.createObjectURL(new Blob([d], { type: MIME[ext] })); urls.push(u); return u;
  }

  // ---------------- Word ----------------
  function runHtml(r, ctx) {
    var pr = first(r, NS.w, "rPr"), html = "";
    for (var c = r.firstElementChild; c; c = c.nextElementSibling) {
      if (c.namespaceURI === NS.w && c.localName === "t") html += esc(c.textContent);
      else if (c.namespaceURI === NS.w && c.localName === "tab") html += "&emsp;";
      else if (c.namespaceURI === NS.w && (c.localName === "br" || c.localName === "cr")) html += "<br>";
      else if (c.localName === "drawing" || c.localName === "pict") {
        var blip = first(c, NS.a, "blip"), id = blip && (attr(blip, NS.r, "embed") || attr(blip, NS.r, "link"));
        var imgd = c.getElementsByTagNameNS("urn:schemas-microsoft-com:vml", "imagedata")[0];
        if (!id && imgd) id = attr(imgd, NS.r, "id");
        var rel = id && ctx.rels[id], src = rel && blobUrl(ctx.files, rel.target, ctx.urls);
        var ext = first(c, "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", "extent");
        var w = ext ? Math.round(+ext.getAttribute("cx") / 9525) : 0;
        if (src) html += '<img src="' + src + '" alt=""' + (w ? ' style="width:' + Math.min(w, 900) + 'px"' : "") + ">";
      }
    }
    if (!html || !pr) return html;
    var on = function (n) { var e = first(pr, NS.w, n); return e && attr(e, NS.w, "val") !== "0" && attr(e, NS.w, "val") !== "false"; };
    var st = [];
    var sz = first(pr, NS.w, "sz"); if (sz) { var pt = +attr(sz, NS.w, "val") / 2; if (pt && pt !== 10.5 && pt !== 11 && pt !== 12) st.push("font-size:" + Math.max(9, Math.min(pt, 40)) + "pt"); }
    var col = first(pr, NS.w, "color"); if (col) { var v = attr(col, NS.w, "val"); if (/^[0-9A-Fa-f]{6}$/.test(v) && v !== "000000") st.push("color:#" + v); }
    var hl = first(pr, NS.w, "highlight"); if (hl) st.push("background:" + ({ yellow: "#fff3a0", green: "#c8f5c0", cyan: "#c4f1f5" }[attr(hl, NS.w, "val")] || "#fff3a0"));
    if (on("b")) html = "<b>" + html + "</b>";
    if (on("i")) html = "<i>" + html + "</i>";
    if (first(pr, NS.w, "u") && attr(first(pr, NS.w, "u"), NS.w, "val") !== "none") html = "<u>" + html + "</u>";
    if (on("strike")) html = "<s>" + html + "</s>";
    var va = first(pr, NS.w, "vertAlign"); if (va) html = attr(va, NS.w, "val") === "superscript" ? "<sup>" + html + "</sup>" : attr(va, NS.w, "val") === "subscript" ? "<sub>" + html + "</sub>" : html;
    return st.length ? '<span style="' + st.join(";") + '">' + html + "</span>" : html;
  }
  function inlineHtml(p, ctx) {
    var html = "";
    for (var c = p.firstElementChild; c; c = c.nextElementSibling) {
      if (c.namespaceURI !== NS.w) continue;
      if (c.localName === "r") html += runHtml(c, ctx);
      else if (c.localName === "hyperlink" || c.localName === "ins" || c.localName === "smartTag" || c.localName === "fldSimple" || c.localName === "sdt") html += inlineHtml(c.localName === "sdt" ? first(c, NS.w, "sdtContent") || c : c, ctx);
    }
    return html;
  }
  function paraHtml(p, ctx) {
    var pr = first(p, NS.w, "pPr"), style = pr && first(pr, NS.w, "pStyle"), sid = style ? attr(style, NS.w, "val") || "" : "";
    var name = (ctx.styles[sid] || sid).toLowerCase(), body = inlineHtml(p, ctx);
    var m = /heading\s*(\d)|^标题\s*(\d)|^(title)$/.exec(name) || /^(\d)$/.exec(sid);
    var jc = pr && first(pr, NS.w, "jc"), align = jc ? attr(jc, NS.w, "val") : "";
    var al = align === "center" ? ' style="text-align:center"' : align === "right" || align === "end" ? ' style="text-align:right"' : "";
    var num = pr && first(pr, NS.w, "numPr");
    if (!num && /list|列表/.test(name)) return { li: true, level: 0, html: body || "&nbsp;" };
    if (num) { var lvl = first(num, NS.w, "ilvl"); return { li: true, level: lvl ? +attr(lvl, NS.w, "val") || 0 : 0, html: body || "&nbsp;" }; }
    if (m) { var lv = m[3] ? 1 : Math.min(+(m[1] || m[2]) || 1, 4); return { html: "<h" + lv + al + ">" + (body || "&nbsp;") + "</h" + lv + ">" }; }
    return { html: "<p" + al + ">" + (body || "&nbsp;") + "</p>" };
  }
  function tableHtml(t, ctx) {
    var rows = kids(t, NS.w, "tr").map(function (tr) {
      return "<tr>" + kids(tr, NS.w, "tc").map(function (tc) {
        var pr = first(tc, NS.w, "tcPr"), span = pr && first(pr, NS.w, "gridSpan"), vm = pr && first(pr, NS.w, "vMerge");
        if (vm && attr(vm, NS.w, "val") !== "restart") return "";
        return "<td" + (span ? ' colspan="' + attr(span, NS.w, "val") + '"' : "") + ">" + blockHtml(tc, ctx) + "</td>";
      }).join("") + "</tr>";
    });
    return '<div class="op-table"><table>' + rows.join("") + "</table></div>";
  }
  function blockHtml(parent, ctx) {
    var out = "", list = [];
    var flush = function () { if (!list.length) return; out += "<ul>" + list.map(function (x) { return '<li style="margin-left:' + x.level * 1.4 + 'em">' + x.html + "</li>"; }).join("") + "</ul>"; list = []; };
    for (var c = parent.firstElementChild; c; c = c.nextElementSibling) {
      if (c.namespaceURI !== NS.w) continue;
      if (c.localName === "p") { var r = paraHtml(c, ctx); if (r.li) list.push(r); else { flush(); out += r.html; } }
      else if (c.localName === "tbl") { flush(); out += tableHtml(c, ctx); }
      else if (c.localName === "sdt") { flush(); out += blockHtml(first(c, NS.w, "sdtContent") || c, ctx); }
    }
    flush();
    return out;
  }
  function renderDocx(files, urls) {
    var doc = xml(files, "word/document.xml"); if (!doc) throw new Error("不是有效的 Word 文档");
    var styles = {}, sd = xml(files, "word/styles.xml");
    if (sd) Array.prototype.forEach.call(sd.getElementsByTagNameNS(NS.w, "style"), function (s) { var n = first(s, NS.w, "name"); styles[attr(s, NS.w, "styleId")] = n ? attr(n, NS.w, "val") : ""; });
    var ctx = { files: files, urls: urls, styles: styles, rels: rels(files, "word/document.xml") };
    var div = document.createElement("div"); div.className = "op-doc";
    div.innerHTML = blockHtml(first(doc, NS.w, "body"), ctx);
    return div;
  }

  // ---------------- PPT ----------------
  var EMU = 12700;    // 1pt
  function xfrm(el) {
    var x = first(el, NS.a, "xfrm"); if (!x) return null;
    var off = first(x, NS.a, "off"), ext = first(x, NS.a, "ext"); if (!off || !ext) return null;
    return { x: +off.getAttribute("x"), y: +off.getAttribute("y"), w: +ext.getAttribute("cx"), h: +ext.getAttribute("cy") };
  }
  function pptText(txBody, scale, ph) {
    return kids(txBody, NS.a, "p").map(function (p) {
      var ppr = first(p, NS.a, "pPr"), algn = ppr ? ppr.getAttribute("algn") : "", bullet = ppr && (first(ppr, NS.a, "buChar") || first(ppr, NS.a, "buAutoNum"));
      var runs = "", fs = 0;
      for (var c = p.firstElementChild; c; c = c.nextElementSibling) {
        if (c.namespaceURI !== NS.a) continue;
        if (c.localName === "r" || c.localName === "fld") {
          var rp = first(c, NS.a, "rPr"), t = esc((first(c, NS.a, "t") || {}).textContent || ""), st = [];
          if (rp) {
            var sz = +rp.getAttribute("sz"); if (sz) { fs = fs || sz; st.push("font-size:" + Math.max(6, sz / 100 * scale).toFixed(1) + "px"); }
            if (rp.getAttribute("b") === "1") t = "<b>" + t + "</b>";
            if (rp.getAttribute("i") === "1") t = "<i>" + t + "</i>";
            if (rp.getAttribute("u") && rp.getAttribute("u") !== "none") t = "<u>" + t + "</u>";
            var clr = first(rp, NS.a, "srgbClr"); if (clr && /^[0-9A-Fa-f]{6}$/.test(clr.getAttribute("val"))) st.push("color:#" + clr.getAttribute("val"));
          }
          runs += st.length ? '<span style="' + st.join(";") + '">' + t + "</span>" : t;
        } else if (c.localName === "br") runs += "<br>";
      }
      var base = ph === "title" || ph === "ctrTitle" ? 32 : 18;
      return '<div style="text-align:' + ({ ctr: "center", r: "right", just: "justify" }[algn] || "left") + ";font-size:" + (base * scale).toFixed(1) + 'px">' + (bullet && runs ? "• " : "") + (runs || "&nbsp;") + "</div>";
    }).join("");
  }
  function renderSlide(files, path, size, urls, W) {
    var doc = xml(files, path); if (!doc) return null;
    var rl = rels(files, path), scale = W / (size.w / EMU);   // 每 pt 多少像素
    var box = document.createElement("div"); box.className = "op-slide";
    box.style.width = W + "px"; box.style.height = Math.round(W * size.h / size.w) + "px";
    var px = function (v) { return (v / size.w * W).toFixed(1) + "px"; };
    var tree = first(doc, NS.p, "spTree");
    (function walk(node, offset) {
      for (var c = node.firstElementChild; c; c = c.nextElementSibling) {
        if (c.namespaceURI !== NS.p) continue;
        if (c.localName === "grpSp") { walk(c, offset); continue; }
        var pos = xfrm(c.localName === "pic" ? first(c, NS.p, "spPr") || c : first(c, NS.p, "spPr") || c);
        var el = null;
        if (c.localName === "sp") {
          var tx = first(c, NS.p, "txBody"); if (!tx || !tx.textContent.trim()) continue;
          var ph = c.getElementsByTagNameNS(NS.p, "ph")[0], phType = ph ? ph.getAttribute("type") || "body" : "";
          el = document.createElement("div"); el.className = "op-sp" + (phType === "title" || phType === "ctrTitle" ? " title" : "");
          el.innerHTML = pptText(tx, scale, phType);
          if (!pos) { el.style.position = "relative"; el.style.margin = "4% 6%"; }
        } else if (c.localName === "pic") {
          var blip = first(c, NS.a, "blip"), id = blip && attr(blip, NS.r, "embed"), rel = id && rl[id], src = rel && blobUrl(files, rel.target, urls);
          if (!src) continue;
          el = document.createElement("img"); el.src = src; el.alt = ""; el.className = "op-pic";
        } else if (c.localName === "graphicFrame") {
          var tbl = first(c, NS.a, "tbl");
          if (tbl) {
            el = document.createElement("div"); el.className = "op-sp op-ptable";
            el.innerHTML = "<table>" + kids(tbl, NS.a, "tr").map(function (tr) { return "<tr>" + kids(tr, NS.a, "tc").map(function (tc) { var b = first(tc, NS.a, "txBody"); return "<td>" + (b ? pptText(b, scale * .8, "") : "") + "</td>"; }).join("") + "</tr>"; }).join("") + "</table>";
            pos = pos || xfrm(c);
            var x2 = first(c, NS.p, "xfrm"); if (x2) { var o = first(x2, NS.a, "off"), e = first(x2, NS.a, "ext"); if (o && e) pos = { x: +o.getAttribute("x"), y: +o.getAttribute("y"), w: +e.getAttribute("cx"), h: +e.getAttribute("cy") }; }
          } else {
            var t = c.textContent.trim(); if (!t) continue;
            el = document.createElement("div"); el.className = "op-sp op-note"; el.textContent = "〔图表 / 对象〕" + t.slice(0, 200);
          }
        }
        if (!el) continue;
        if (pos) { el.style.left = px(pos.x); el.style.top = px(pos.y); el.style.width = px(pos.w); if (c.localName === "pic") el.style.height = px(pos.h); else el.style.minHeight = px(pos.h); }
        box.appendChild(el);
      }
    })(tree);
    return box;
  }
  function renderPptx(files, urls, width) {
    var pres = xml(files, "ppt/presentation.xml"); if (!pres) throw new Error("不是有效的 PPT 文件");
    var sz = first(pres, NS.p, "sldSz"), size = sz ? { w: +sz.getAttribute("cx"), h: +sz.getAttribute("cy") } : { w: 12192000, h: 6858000 };
    var rl = rels(files, "ppt/presentation.xml");
    var ids = Array.prototype.map.call(pres.getElementsByTagNameNS(NS.p, "sldId"), function (s) { return rl[attr(s, NS.r, "id")]; }).filter(Boolean).map(function (r) { return r.target; });
    if (!ids.length) ids = Object.keys(files).filter(function (k) { return /^ppt\/slides\/slide\d+\.xml$/.test(k); }).sort(function (a, b) { return +a.match(/\d+/)[0] - +b.match(/\d+/)[0]; });
    var wrap = document.createElement("div"); wrap.className = "op-deck";
    ids.forEach(function (p, i) {
      var s = renderSlide(files, p, size, urls, width); if (!s) return;
      var n = document.createElement("div"); n.className = "op-num"; n.textContent = "第 " + (i + 1) + " / " + ids.length + " 页";
      wrap.appendChild(n); wrap.appendChild(s);
    });
    return wrap;
  }

  // ---------------- 接到课内的附件预览窗口 ----------------
  var css = document.createElement("style");
  css.textContent = [
    ".op-wrap{padding:18px;box-sizing:border-box;min-height:100%;background:var(--op-bg,#eef0f4)}",
    ".op-doc{max-width:820px;margin:0 auto;background:#fff;color:#1f2330;padding:48px 56px;box-shadow:0 6px 24px rgba(20,30,60,.12);border-radius:6px;font:15px/1.75 'Noto Serif SC','Songti SC',SimSun,serif;transform-origin:top center}",
    ".op-doc h1,.op-doc h2,.op-doc h3,.op-doc h4{font-family:system-ui,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.35;margin:1.1em 0 .5em}.op-doc h1{font-size:24px}.op-doc h2{font-size:20px}.op-doc h3{font-size:17px}",
    ".op-doc p{margin:.35em 0}.op-doc img{max-width:100%;height:auto}.op-doc ul{padding-left:1.4em;margin:.4em 0}",
    ".op-table{overflow-x:auto;margin:.6em 0}.op-doc table,.op-ptable table{border-collapse:collapse;width:100%}.op-doc td,.op-ptable td{border:1px solid #c9ced8;padding:4px 8px;vertical-align:top}",
    ".op-deck{display:flex;flex-direction:column;align-items:center;gap:8px}.op-num{color:#778;font:12px system-ui;align-self:center;margin-top:6px}",
    ".op-slide{position:relative;background:#fff;color:#1f2330;box-shadow:0 6px 24px rgba(20,30,60,.14);border-radius:4px;overflow:hidden;font-family:system-ui,'PingFang SC','Microsoft YaHei',sans-serif;flex:none}",
    ".op-sp{position:absolute;box-sizing:border-box;padding:.3% .6%;line-height:1.3;overflow-wrap:anywhere}.op-sp.title{font-weight:700}.op-pic{position:absolute;object-fit:contain}.op-note{color:#889;font-size:12px}"
  ].join("");
  document.head.appendChild(css);

  window.prepareOfficeAttachment = async function (s) {
    var name = new URL(s.url, location.href).pathname.split("/").pop().toLowerCase();
    var stage = document.getElementById("attachmentPreviewStage");
    var setStatus = function (t, err) { if (typeof attachmentStatus === "function") attachmentStatus(t, err); };
    if (/\.(doc|ppt)$/.test(name)) { setStatus("旧版 .doc / .ppt 网站上没法预览，请下载原文件，或者另存为 .docx / .pptx 后重新上传。", true); return ""; }
    setStatus("正在读取文档…");
    try {
      var lib = await loadFflate();
      var buf = new Uint8Array(await (await fetch(s.url)).arrayBuffer());
      if (attachmentViewer !== s) return "";
      var files = lib.unzipSync(buf, { filter: function (f) { return !/\.(mp4|mov|wav|mp3|wmv|avi|m4a|emf|wmf|bin)$/i.test(f.name); } });
      var urls = []; s.cancelPoll = function () { urls.forEach(URL.revokeObjectURL); };
      var wrap = document.createElement("div"); wrap.className = "op-wrap";
      var width = Math.max(320, Math.min(1100, (stage.clientWidth || 900) - 40));
      wrap.appendChild(/\.pptx$/.test(name) ? renderPptx(files, urls, width) : renderDocx(files, urls));
      stage.replaceChildren(wrap); stage.scrollTop = 0;
      s.ready = false;   // 缩放 / 翻页按钮只对 PDF 有用
      document.getElementById("attachmentPdfPages").hidden = true;
      setStatus("网站版预览：版式是近似的，复杂排版以原文件为准。可点「下载附件」查看原文件。");
    } catch (e) {
      setStatus("这个文档没法预览（" + (e && e.message || "格式不支持") + "），请下载原文件查看。", true);
    }
    return "";
  };
})();
