/* 捞捞课程表 · Competition Layout V2
 * 只做结构增强与视觉辅助，不改数据、接口、ID 或业务状态。
 */
(function () {
  'use strict';

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function go(tab) {
    var target = qs('[data-tab="' + tab + '"]');
    if (target) { target.click(); return; }
    if (tab === 'ask') {
      var bot = qs('#laoBot');
      if (bot) bot.click();
    }
  }

  function enhanceMain() {
    if (document.documentElement.getAttribute('data-competition-ui') !== 'main') return;
    if (document.documentElement.hasAttribute('data-competition-layout-v2')) return;
    document.documentElement.setAttribute('data-competition-layout-v2', '');

    var home = qs('.view[data-view="home"]');
    var rail = qs('.siderail');
    var head = home && qs('.vhead', home);

    if (head && !qs('.cc-head-copy', head)) {
      var copy = el('span', 'cc-head-copy', '<b>今天</b><small>AI 校园驾驶舱</small>');
      var h2 = qs('h2', head);
      if (h2) {
        h2.classList.add('cc-hide-title');
        h2.insertAdjacentElement('afterend', copy);
      } else {
        head.prepend(copy);
      }
    }

    if (rail && !qs('.cc-agent-card', rail)) {
      var card = el('section', 'cc-agent-card surface');
      card.innerHTML = '' +
        '<div class="cc-agent-top">' +
          '<span class="cc-agent-mark">✦</span>' +
          '<div><b>捞捞 AI 助手</b><small>结合课程、作业和日历给你下一步建议</small></div>' +
          '<span class="cc-agent-beta">AGENT</span>' +
        '</div>' +
        '<div class="cc-agent-pulse"><i></i><span>已连接你的校园日程</span></div>' +
        '<p class="cc-agent-copy">不只是回答问题。捞捞会帮你发现临近课程、待完成作业和需要提前准备的事项。</p>' +
        '<div class="cc-agent-actions">' +
          '<button type="button" data-cc-go="ask">帮我规划今天</button>' +
          '<button type="button" data-cc-go="homework">看看待办</button>' +
          '<button type="button" data-cc-go="calendar">查看日程</button>' +
        '</div>' +
        '<button type="button" class="cc-agent-ask" data-cc-go="ask"><span>问捞捞任何问题…</span><b>↗</b></button>';
      rail.insertBefore(card, rail.firstChild);
      card.addEventListener('click', function (e) {
        var b = e.target.closest('[data-cc-go]');
        if (!b) return;
        go(b.getAttribute('data-cc-go'));
      });
    }

    // 给已有右栏卡片补更清晰的语义标题，不触碰其数据内容。
    if (rail) {
      var widgets = rail.querySelectorAll('.widget.surface');
      if (widgets[0]) widgets[0].classList.add('cc-calendar-card');
      if (widgets[1]) widgets[1].classList.add('cc-homework-card');
    }

    // 首页下方内容增加分层锚点，完全保留原节点与事件。
    var widgetsBox = qs('#widgets');
    if (widgetsBox) widgetsBox.classList.add('cc-dashboard-grid');
    var hero = qs('#hero');
    if (hero) hero.classList.add('cc-hero-wrap');
    var agenda = qs('#agenda');
    if (agenda) agenda.classList.add('cc-agenda-wrap');

    // 让 AI 助手入口在桌面更明确；仍调用原 island.js。
    var lao = qs('#lao');
    if (lao) lao.classList.add('cc-agent-island');
  }

  function boot() {
    enhanceMain();
    // 部分首页组件由 app.js 异步渲染，延迟再标记一次即可，不修改内容。
    setTimeout(enhanceMain, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
