// 捞捞编程 · 把模型的回答（Markdown）变成网页：代码块、行内代码、粗体、列表、标题。先转义，不执行任何 HTML
"use strict";
window.MD = (function () {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function inline(s) {
    return esc(s)
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<i>$2</i>");
  }
  function render(src) {
    const out = [], lines = String(src || "").replace(/\r/g, "").split("\n");
    let i = 0, list = null;
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
    while (i < lines.length) {
      const l = lines[i];
      const fence = l.match(/^\s*```\s*([\w+#-]*)\s*$/);
      if (fence) {
        closeList();
        const code = []; i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
        i++;
        out.push(`<div class="md-code"><div class="md-code-bar"><span>${esc(fence[1] || "代码")}</span><button type="button" data-copy>复制</button></div><pre><code>${esc(code.join("\n"))}</code></pre></div>`);
        continue;
      }
      const h = l.match(/^(#{1,4})\s+(.*)$/);
      const ul = l.match(/^\s*[-*•]\s+(.*)$/), ol = l.match(/^\s*\d+[.)、]\s+(.*)$/);
      if (h) { closeList(); out.push(`<p class="md-h">${inline(h[2])}</p>`); }
      else if (ul || ol) { const t = ul ? "ul" : "ol"; if (list !== t) { closeList(); out.push(`<${t}>`); list = t; } out.push(`<li>${inline((ul || ol)[1])}</li>`); }
      else if (!l.trim()) closeList();
      else { closeList(); out.push(`<p>${inline(l)}</p>`); }
      i++;
    }
    closeList();
    return out.join("");
  }
  return { render, esc };
})();
