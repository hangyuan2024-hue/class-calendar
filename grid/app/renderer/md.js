// 捞小智的回答：Markdown（标题、加粗、列表、表格、代码）+ 公式（$…$、$$…$$、\(…\)、\[…\]，用本地的 KaTeX 画）
//   先整体转义再加标签，模型回答里的 HTML 不会被当成网页执行。边打字边调用（每来一段重画一次），没写完的公式先原样显示。
(function (root) {
  "use strict";
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function tex(src, display) {
    const K = root.katex;
    if (!K) return `<code class="md-tex">${esc(src)}</code>`;
    try { return K.renderToString(src, { displayMode: display, throwOnError: false, strict: "ignore", output: "html", trust: false, maxSize: 20, maxExpand: 300 }); }
    catch (e) { return `<code class="md-tex">${esc(src)}</code>`; }
  }

  // 行内：先把代码、公式抠出来换成占位符，转义剩下的，再做加粗 / 斜体 / 删除线，最后放回去
  function inline(s, keep) {
    const put = (html) => "\u0000" + (keep.push(html) - 1) + "\u0000";
    s = s.replace(/`([^`\n]+)`/g, (_, c) => put(`<code>${esc(c)}</code>`));
    s = s.replace(/\$\$([^$]+?)\$\$/g, (_, t) => put(tex(t, true)));
    s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => put(tex(t, true)));
    s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => put(tex(t, false)));
    // $…$：前后不是数字（「5$ 和 $6」这种价格不算），里面不以空格开头结尾
    s = s.replace(/(^|[^\\$\d])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, pre, t) => pre + put(tex(t, false)));
    s = esc(s);
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>").replace(/__([^_\n]+?)__/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~\n]+?)~~/g, "<del>$1</del>");
    return s;
  }
  const back = (s, keep) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]);

  function render(text) {
    const src = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
    const keep = [];
    const put = (html) => "\u0000" + (keep.push(html) - 1) + "\u0000";
    // 整块的：```代码```、$$…$$ / \[…\] 单独成段的公式（可以跨好几行）
    let s = src.replace(/```([\w+-]*)\n?([\s\S]*?)(```|$)/g, (_, lang, code) => "\n" + put(`<pre class="md-code"><code>${esc(code.replace(/\n$/, ""))}</code></pre>`) + "\n");
    s = s.replace(/(^|\n)[ \t]*\$\$([\s\S]+?)\$\$[ \t]*(?=\n|$)/g, (_, pre, t) => pre + put(`<div class="md-math">${tex(t.trim(), true)}</div>`));
    s = s.replace(/(^|\n)[ \t]*\\\[([\s\S]+?)\\\][ \t]*(?=\n|$)/g, (_, pre, t) => pre + put(`<div class="md-math">${tex(t.trim(), true)}</div>`));

    const lines = s.split("\n"), out = [];
    let i = 0;
    const isBlockPh = (l) => /^\u0000\d+\u0000$/.test(l.trim());
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      if (isBlockPh(l)) { out.push(l.trim()); i++; continue; }
      let m;
      if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { const n = Math.min(6, m[1].length + 2); out.push(`<h${n}>${inline(m[2], keep)}</h${n}>`); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
      if (/^\s*>/.test(l)) { const q = []; while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, "")); out.push(`<blockquote>${q.map((x) => inline(x, keep)).join("<br>")}</blockquote>`); continue; }
      // 表格：| a | b | 下一行 |---|---|
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
        const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim(), keep));
        const head = cells(l); i += 2; const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        out.push(`<div class="md-tbl"><table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
      // 列表（只认一层；缩进的当成上一项的续行）
      if ((m = /^\s*([-*+]|\d+[.)、])\s+/.exec(l))) {
        const ol = /\d/.test(m[1]); const items = [];
        const start = ol ? parseInt(m[1], 10) : 1;
        while (i < lines.length) {
          const x = lines[i], mm = /^\s*([-*+]|\d+[.)、])\s+(.*)$/.exec(x);
          if (mm && /\d/.test(mm[1]) === ol) { items.push(mm[2]); i++; continue; }
          if (x.trim() && /^\s{2,}\S/.test(x) && items.length) { items[items.length - 1] += "\n" + x.trim(); i++; continue; }
          break;
        }
        const tag = ol ? "ol" : "ul";
        out.push(`<${tag}${ol && start !== 1 ? ` start="${start}"` : ""}>${items.map((t) => `<li>${inline(t, keep).replace(/\n/g, "<br>")}</li>`).join("")}</${tag}>`);
        continue;
      }
      // 段落：连着的几行并成一段，行内换行保留
      const para = [];
      while (i < lines.length && lines[i].trim() && !isBlockPh(lines[i]) && !/^(#{1,6})\s|^\s*>|^\s*([-*+]|\d+[.)、])\s+/.test(lines[i]) && !(/^\s*\|.*\|\s*$/.test(lines[i]) && para.length === 0 && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]))) para.push(lines[i++]);
      if (!para.length) { out.push(`<p>${inline(lines[i++], keep)}</p>`); continue; }
      out.push(`<p>${para.map((x) => inline(x, keep)).join("<br>")}</p>`);
    }
    return back(back(out.join(""), keep), keep);
  }
  // 念出来用的纯文字：去掉 Markdown 记号；公式里的 \frac 之类念不出来，换成说法简单的
  function speech(text) {
    return String(text || "")
      .replace(/```[\s\S]*?(```|$)/g, "（代码见屏幕）")
      .replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g, (_, a, b, c, d) => texWords(a || b || c || d))
      .replace(/^#{1,6}\s+/gm, "").replace(/\*\*|__|~~|`/g, "").replace(/^\s*>\s?/gm, "").replace(/^\s*[-*+]\s+/gm, "").replace(/^\s*\|?\s*:?-{2,}.*$/gm, "").replace(/\|/g, "，");
  }
  function texWords(t) {
    return String(t)
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$2分之$1").replace(/\\sqrt\{([^{}]*)\}/g, "根号$1")
      .replace(/\\times|\\cdot/g, "乘").replace(/\\div/g, "除以").replace(/\\Rightarrow|\\to|\\rightarrow/g, "，所以").replace(/\\pm/g, "正负")
      .replace(/\\leq?|\\le\b/g, "小于等于").replace(/\\geq?|\\ge\b/g, "大于等于").replace(/\\neq?/g, "不等于").replace(/\\approx/g, "约等于")
      .replace(/\^\{?2\}?/g, "的平方").replace(/\^\{?3\}?/g, "的立方").replace(/\\pi/g, "派")
      .replace(/\\(text|mathrm|mathbf)\{([^{}]*)\}/g, "$2").replace(/\\[a-zA-Z]+/g, "").replace(/[{}]/g, "").replace(/=/g, "等于");
  }
  root.LaoMd = { render, speech };
})(window);
