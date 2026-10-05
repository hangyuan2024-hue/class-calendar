(function(){
  'use strict';

  const root = document.documentElement;
  const toggle = document.getElementById('sidebarToggle');
  const rail = document.querySelector('.rail');
  const quick = document.getElementById('quickPart');
  const widgets = document.getElementById('widgets');

  // Load the UI hotfix without changing index.html. A new cache version is shipped with this patch.
  if (!document.querySelector('link[data-workspace-hotfix]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'workspace-hotfix.css?v=20261005-fix1';
    link.dataset.workspaceHotfix = '1';
    document.head.appendChild(link);
  }

  let collapsed = false;
  try { collapsed = localStorage.getItem('campus_sidebar_collapsed_v1') === '1'; } catch (e) {}

  function positionToggle(){
    if (!toggle || window.innerWidth <= 700) return;
    let left = 14;
    if (!collapsed && rail && rail.getClientRects().length) {
      const r = rail.getBoundingClientRect();
      // Straddle the rail edge so it reads as a rail control, not as page content.
      left = Math.max(10, Math.round(r.right - 18));
    }
    root.style.setProperty('--sidebar-toggle-left', left + 'px');
  }

  function paint(){
    root.classList.toggle('sidebar-collapsed', collapsed);
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.title = collapsed ? '展开侧栏' : '收起侧栏';
      const label = toggle.querySelector('span');
      if (label) label.textContent = toggle.title;
    }
    requestAnimationFrame(positionToggle);
  }

  if (toggle) {
    toggle.addEventListener('click', () => {
      collapsed = !collapsed;
      paint();
      try { localStorage.setItem('campus_sidebar_collapsed_v1', collapsed ? '1' : '0'); } catch (e) {}
      requestAnimationFrame(fitQuick);
    });
  }

  function markScroll(){
    root.classList.toggle('workspace-scrolled', window.scrollY > 8);
  }

  function fitQuick(){
    if (!quick || !widgets) return;
    const card = quick.closest('.wcard');
    if (!card || card.closest('.wedit')) return;
    const grid = getComputedStyle(widgets);
    const row = parseFloat(grid.gridAutoRows);
    const gap = parseFloat(grid.rowGap || '0');
    const step = row + gap;
    if (!Number.isFinite(step) || step <= 0) return;
    const rows = Math.max(1, Math.ceil((quick.getBoundingClientRect().height + gap) / step));
    const value = 'span ' + rows;
    if (card.style.gridRowEnd !== value || card.style.gridRowStart !== 'auto') {
      card.style.gridRowStart = 'auto';
      card.style.gridRowEnd = value;
    }
  }

  if (quick && widgets && 'ResizeObserver' in window) {
    const ro = new ResizeObserver(() => requestAnimationFrame(fitQuick));
    ro.observe(quick);
    ro.observe(widgets);
    new MutationObserver(() => requestAnimationFrame(fitQuick)).observe(widgets, { childList: true });
  }

  window.addEventListener('resize', () => {
    requestAnimationFrame(positionToggle);
    requestAnimationFrame(fitQuick);
  }, { passive: true });
  window.addEventListener('scroll', markScroll, { passive: true });

  paint();
  markScroll();
  requestAnimationFrame(fitQuick);
})();
