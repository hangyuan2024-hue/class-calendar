// 自己画的标题栏：窗口没有系统边框时（捞小智版），顶上一条可以拖动的栏 + 最小化 / 最大化（还原）/ 关闭。
//   全屏的时候整条藏起来；最大化以后中间那个按钮变成「还原」。浏览器里测试时没有 lg.win，什么都不做。
(function () {
  "use strict";
  const lg = window.lg;
  if (!lg || typeof lg.win !== "function") return;
  const I = {
    min: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 6.5h9"/></svg>',
    max: '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="1.6"/></svg>',
    restore: '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="3.5" width="7" height="7" rx="1.4"/><path d="M3.8 3.5V2.9c0-.8.6-1.4 1.4-1.4h3.9c.8 0 1.4.6 1.4 1.4v3.9c0 .8-.6 1.4-1.4 1.4h-.6"/></svg>',
    close: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg>',
  };
  function paint(st) {
    if (!st) return;
    document.body.classList.toggle("tb-full", !!st.full);
    const b = document.querySelector(".tbar .m");
    if (b) { b.innerHTML = st.max ? I.restore : I.max; b.title = b.ariaLabel = st.max ? "还原" : "最大化"; }
  }
  function mount(st) {
    if (!st || !st.frameless || document.querySelector(".tbar")) return;
    const bar = document.createElement("div");
    bar.className = "tbar";
    bar.innerHTML = `<div class="tb-title"><img src="${document.querySelector('link[rel~="icon"]') ? document.querySelector('link[rel~="icon"]').href : "icon.png"}" alt=""><span></span></div>` +
      `<div class="tb-btns"><button class="n" data-a="min" title="最小化" aria-label="最小化">${I.min}</button><button class="m" data-a="max">${I.max}</button><button class="x" data-a="close" title="关闭" aria-label="关闭">${I.close}</button></div>`;
    bar.querySelector(".tb-title span").textContent = document.title;
    document.body.prepend(bar);
    document.body.classList.add("frameless");
    bar.addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (b) lg.win(b.dataset.a).then(paint).catch(() => {}); });
    bar.addEventListener("dblclick", (e) => { if (!e.target.closest(".tb-btns")) lg.win("max").then(paint).catch(() => {}); });
    new MutationObserver(() => { const t = bar.querySelector(".tb-title span"); if (t) t.textContent = document.title; }).observe(document.querySelector("title"), { childList: true });
    paint(st);
    window.dispatchEvent(new Event("resize"));
  }
  lg.on("win", paint);
  const go = () => lg.win("state").then(mount).catch(() => {});
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
})();
