// 成品展示里的「PPT 预览」：捞小智做的 / 改的 PPT，每一页直接画在界面上（不用开 PowerPoint），每改一步跟着变
//   大图 + 一排缩略图；← → 翻页；点色块直接换配色；撤销；用 PowerPoint 打开 / 在文件夹里看
// 捞捞PPT助手和捞捞算力用同一份（打包时拷过去）。画面是主进程给的 SVG（core/pptview.js 按 .pptx 里现在的样子画的）
(function (root) {
  "use strict";
  const CSS = `
.dv { display: flex; flex-direction: column; gap: 8px; width: 100%; height: 100%; min-height: 0; outline: none; }
.dv-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; }
.dv-bar b { font-size: 14px; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv-info { opacity: .65; white-space: nowrap; }
.dv-grow { flex: 1; }
.dv-themes { display: flex; gap: 5px; align-items: center; }
.dv-th { width: 18px; height: 18px; border-radius: 50%; border: 2px solid color-mix(in srgb, currentColor 30%, transparent); cursor: pointer; padding: 0; background-clip: padding-box; }
.dv-th.on { border-color: currentColor; box-shadow: 0 0 0 2px rgba(34,190,230,.85); }
.dv-btn { font: inherit; font-size: 12px; color: inherit; background: color-mix(in srgb, currentColor 7%, transparent); border: 1px solid color-mix(in srgb, currentColor 22%, transparent); border-radius: 8px; padding: 3px 9px; cursor: pointer; white-space: nowrap; }
.dv-btn:hover { border-color: rgba(34,190,230,.9); }
.dv-main { flex: 1; min-height: 0; display: flex; align-items: center; gap: 6px; }
.dv-slide { flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; justify-content: center; }
.dv-slide svg { max-width: 100%; max-height: 100%; aspect-ratio: 16 / 9; border-radius: 8px; box-shadow: 0 6px 22px rgba(0,0,0,.28); background: #fff; }
.dv-slide.flash svg { animation: dvflash .9s 1; }
@keyframes dvflash { 0% { box-shadow: 0 0 0 3px rgba(62,240,161,.95), 0 8px 28px rgba(0,0,0,.45); } 100% { box-shadow: 0 0 0 0 rgba(62,240,161,0), 0 8px 28px rgba(0,0,0,.45); } }
.dv-nav { font-size: 22px; line-height: 1; width: 30px; height: 54px; border-radius: 10px; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); background: color-mix(in srgb, currentColor 5%, transparent); color: inherit; cursor: pointer; flex: none; }
.dv-nav:disabled { opacity: .25; cursor: default; }
.dv-strip { display: flex; gap: 8px; overflow-x: auto; padding: 4px 2px 6px; flex: none; }
.dv-thumb { position: relative; flex: none; width: 112px; border-radius: 6px; overflow: hidden; border: 2px solid transparent; cursor: pointer; padding: 0; background: #fff; line-height: 0; }
.dv-thumb svg { width: 100%; height: auto; display: block; pointer-events: none; }
.dv-thumb { box-shadow: 0 1px 4px rgba(0,0,0,.2); } .dv-thumb.on { border-color: #22bee6; }
.dv-thumb i { position: absolute; left: 4px; bottom: 3px; font: 600 10px/1.4 system-ui, sans-serif; font-style: normal; color: #fff; background: rgba(0,0,0,.55); border-radius: 4px; padding: 0 5px; }
.dv-note { font-size: 12px; opacity: .6; text-align: center; }`;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // host：放预览的那一块；o：{ load(rev) → 这一份现在的样子（没变过返回 null，还没有 PPT 返回 { none: true }）, theme(key), undo(), open(), reveal(), onChange(有没有 PPT), onError(e) }
  function create(host, o) {
    if (!document.getElementById("dv-css")) { const st = document.createElement("style"); st.id = "dv-css"; st.textContent = CSS; document.head.appendChild(st); }
    host.innerHTML = `<div class="dv" tabindex="0"><div class="dv-bar"><b class="dv-name"></b><span class="dv-info"></span><span class="dv-grow"></span><span class="dv-themes" title="点一下换配色"></span><button class="dv-btn" data-a="undo" title="撤销上一步改动">↶ 撤销</button><button class="dv-btn" data-a="open">用 PowerPoint 打开</button><button class="dv-btn" data-a="reveal">文件夹</button></div>` +
      `<div class="dv-main"><button class="dv-nav" data-a="prev" title="上一页（←）">‹</button><div class="dv-slide"></div><button class="dv-nav" data-a="next" title="下一页（→）">›</button></div><div class="dv-strip"></div><div class="dv-note">这是预览，动画和个别字体以 PowerPoint 里打开的为准</div></div>`;
    const $ = (s) => host.querySelector(s);
    let data = null, at = 1, loading = null;
    const fail = (e) => { if (o.onError) o.onError(e); };
    function paint(flash) {
      if (!data) return;
      at = Math.max(1, Math.min(data.pages, at));
      $(".dv-name").textContent = data.title || data.name; $(".dv-name").title = data.name;
      $(".dv-info").textContent = `第 ${at} / ${data.pages} 页${data.theme_name ? " · " + data.theme_name : ""}`;
      const big = $(".dv-slide"); big.innerHTML = data.svgs[at - 1] || `<div class="dv-note">这一页画不出来</div>`;
      if (flash) { big.classList.remove("flash"); void big.offsetWidth; big.classList.add("flash"); }
      $('[data-a="prev"]').disabled = at <= 1; $('[data-a="next"]').disabled = at >= data.pages;
      $(".dv-themes").innerHTML = data.designed ? (data.themes || []).map((t) => `<button class="dv-th ${t.key === data.theme ? "on" : ""}" data-th="${esc(t.key)}" title="${esc(t.name)}" style="background:linear-gradient(135deg, ${esc(t.main)} 50%, ${esc(t.dark)} 50%)"></button>`).join("") : "";
      const strip = $(".dv-strip");
      strip.innerHTML = data.svgs.map((s, i) => `<button class="dv-thumb ${i + 1 === at ? "on" : ""}" data-no="${i + 1}">${s}<i>${i + 1}</i></button>`).join("");
      const cur = strip.querySelector(".dv-thumb.on"); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    function go(no) { if (!data) return; const n = Math.max(1, Math.min(data.pages, +no || 1)); if (n === at) return; at = n; paint(false); }
    // 去问一次现在的样子；jump：改的是第几页（跳过去闪一下）
    function refresh(jump) {
      loading = (loading || Promise.resolve()).catch(() => {}).then(async () => {
        const had = !!data, d = await o.load(data ? data.rev : null);
        if (d && d.none) { data = null; if (had && o.onChange) o.onChange(false); return null; }
        if (d) { const fresh = !data || d.name !== data.name; data = d; if (fresh) at = 1; if (jump) at = +jump; paint(true); if (o.onChange) o.onChange(true, fresh); }
        else if (jump && data) { at = +jump; paint(false); }
        return data;
      });
      return loading.catch((e) => { fail(e); return data; });
    }
    host.addEventListener("click", async (e) => {
      const th = e.target.closest("[data-th]"), tb = e.target.closest("[data-no]"), b = e.target.closest("[data-a]");
      try {
        if (th) { await o.theme(th.dataset.th); await refresh(); }
        else if (tb) go(tb.dataset.no);
        else if (b) { const a = b.dataset.a; if (a === "prev") go(at - 1); else if (a === "next") go(at + 1); else if (a === "undo") { await o.undo(); await refresh(); } else if (a === "open") await o.open(); else if (a === "reveal") await o.reveal(); }
      } catch (x) { fail(x); }
    });
    $(".dv").addEventListener("keydown", (e) => { if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(at - 1); } if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); go(at + 1); } });
    return { refresh, go, has: () => !!data, page: () => at, data: () => data };
  }
  root.LaoDeckView = { create };
})(window);
