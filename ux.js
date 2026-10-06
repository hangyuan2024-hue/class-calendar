// ===== 用起来更顺手的小功能（所有外观都有） =====
// 1. 切换页面时的过渡动画：用浏览器自带的 View Transitions，支持的浏览器里切页面会淡入滑动，不支持的照常切换
// 2. 手机上左右滑事项：往右滑 = 完成，往左滑 = 隐藏（班级事项）/ 删除（我的事项），有震动反馈
// 3. 电脑上的键盘快捷键：1~5 切换页面、N 记一件事、/ 问捞捞、T 回到今天、? 看全部快捷键
"use strict";

// ---------- 1. 页面切换动画 ----------
(() => {
  if (!document.startViewTransition) return;
  const raw = showView;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  showView = function (id) {   // eslint-disable-line no-global-assign
    if (reduce.matches || id === currentView() || document.hidden) return raw(id);
    try {
      const transition = document.startViewTransition(() => raw(id));
      // Cancelling a visual transition does not cancel the destination page.
      transition.ready.catch(() => {});
      transition.finished.catch(() => {});
    } catch (e) { raw(id); }
  };
})();

// ---------- 2. 手机上左右滑事项 ----------
(() => {
  let s = null;
  const rowOf = (t) => t.closest && t.closest(".acard .arow[data-row]");
  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    const row = rowOf(e.target);
    if (!row || e.target.closest("button, a, input, select, textarea, details")) return;
    s = { row, x: e.clientX, y: e.clientY, dx: 0, on: false, id: e.pointerId };
  }, true);
  document.addEventListener("pointermove", (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.on) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { s = null; return; }   // 是在上下滚动
      if (Math.abs(dx) < 14) return;
      s.on = true; s.row.classList.add("swiping");
      const k = s.row.dataset.row, mineItem = !k.startsWith("c") && !k.startsWith("x");
      s.bg = document.createElement("div");
      s.bg.innerHTML = `<span>✓ ${s.row.classList.contains("done") ? "取消完成" : "完成"}</span><span>${mineItem ? "删除 🗑" : "隐藏 ⊘"}</span>`;
      s.bg.style.cssText = `top:${s.row.offsetTop}px;height:${s.row.offsetHeight}px;bottom:auto`;
      s.row.parentElement.insertBefore(s.bg, s.row);
    }
    s.dx = Math.max(-140, Math.min(140, dx));
    s.bg.className = "swipe-bg " + (s.dx > 0 ? "r" : "l");
    s.row.style.transform = `translateX(${s.dx}px)`;
    if (!s.buzzed && Math.abs(s.dx) > 88) { s.buzzed = true; buzz(10); } else if (Math.abs(s.dx) < 80) s.buzzed = false;
  }, true);
  const end = (e) => {
    if (!s || e.pointerId !== s.id) return;
    const { row, dx, on, bg } = s; s = null;
    if (!on) return;
    row.classList.remove("swiping");
    row.style.transition = "transform .2s"; row.style.transform = "";
    setTimeout(() => { row.style.transition = ""; bg && bg.remove(); }, 220);
    const k = row.dataset.row;
    if (dx > 88) { const b = row.querySelector('[data-act="done"]'); if (b) b.click(); }
    else if (dx < -88) {
      if (k.startsWith("c")) { setMark(k, { hidden: true }); showBanner("已隐藏，可以在日历页「显示已隐藏」里找回"); setTimeout(() => showBanner(""), 3000); }
      else if (!k.startsWith("x")) { const i = mine.findIndex((x) => x.id === k); if (i >= 0 && confirm(`删除「${mine[i].subject || "这条事项"}」？`)) { delete quadMap[k]; mine.splice(i, 1); save(LS_MINE, mine); save(LS_QUAD, quadMap); renderAll(); } }
    }
    // 滑过以后，接下来那一下点击不要当成「展开详情」
    row.dataset.swiped = "1"; setTimeout(() => { delete row.dataset.swiped; }, 300);
  };
  document.addEventListener("pointerup", end, true);
  document.addEventListener("pointercancel", end, true);
  document.addEventListener("click", (e) => { const r = rowOf(e.target); if (r && r.dataset.swiped) { e.stopPropagation(); e.preventDefault(); } }, true);
})();

// ---------- 3. 键盘快捷键 ----------
(() => {
  const typing = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const TABS = ["home", "homework", "wall", "calendar", "plan"];
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || typing(e.target) || document.querySelector("dialog[open], #modal.open, .modal2.open")) return;
    const k = e.key;
    if (/^[1-5]$/.test(k)) { e.preventDefault(); showView(TABS[+k - 1]); return; }
    if (k === "n" || k === "N") { e.preventDefault(); $("addBtn").click(); return; }
    if (k === "/") { if (typeof islandOpen === "function" && islandOpts().on !== false) { e.preventDefault(); islandOpen(true); } return; }
    if (k === "t" || k === "T") { e.preventDefault(); selectedKey = todayKey(); showView("calendar"); try { renderAll(); } catch (err) {} return; }
    if (k === "?") { e.preventDefault(); $("kbHelp").showModal(); }
  });
  $("kbHelp").addEventListener("click", (e) => { if (e.target === $("kbHelp") || e.target.closest("[data-kbx]")) $("kbHelp").close(); });
})();
