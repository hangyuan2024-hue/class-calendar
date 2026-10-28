/* 7.7.5 悬浮窗（电脑网页）：信箱、工具、插件都能以悬浮窗打开；可以拖动、八个方向调整大小、多个窗口互相吸附拼接
 *   FloatWM.open({ id, title, icon, el, w, h, onClose })   把一个元素（比如信箱）放进新的悬浮窗
 *   FloatWM.popView(viewId)                                 把网站里的一页（工具、插件）原地变成悬浮窗：
 *       页面元素不挪位置（插件在 iframe 里，挪了会重新加载、丢掉没保存的内容），只是改成固定定位，外面套一个窗框
 *   FloatWM.close(id) / focus(id) / isOpen(id) / enabled()
 *   吸附：拖动或调大小时，窗口边缘靠近屏幕边、侧栏、别的窗口边 12 像素以内就自动贴齐（出现蓝色参考线），方便左右、上下拼在一起
 *   位置和大小记在本机（localStorage），下次打开还在原处。手机（窄屏）不用悬浮窗。 */
(function () {
  "use strict";
  var wins = {}, zTop = 800, SNAP = 12, HEAD = 42, GAP = 0, LS = "fw_geo_v1";
  var gv, gh;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var SVG = {
    max: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    restore: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
    dock: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="m12 18-3-3h6z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    pop: '<rect x="3" y="7" width="13" height="13" rx="2"/><path d="M10 3h11v11"/><path d="m21 3-9 9"/>',
  };
  var svg = function (k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + SVG[k] + "</svg>"; };
  // 悬浮窗都放在 .shell 里面：网站的页面在 .shell 这一层叠放，窗口和页面要在同一层才能互相盖住
  function host() { return document.querySelector(".shell") || document.body; }
  function loadGeo() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } }
  function saveGeo(id, g) { try { var all = loadGeo(); all[id] = g; localStorage.setItem(LS, JSON.stringify(all)); } catch (e) {} }

  function railRight() { var r = document.querySelector(".rail"); if (!r) return 0; var b = r.getBoundingClientRect(); return b.left < 8 && b.height > innerHeight * 0.6 ? Math.round(b.right) : 0; }
  function enabled() {
    var r = document.querySelector(".rail"); if (!r || innerWidth <= 860) return false;
    var b = r.getBoundingClientRect();
    return b.left < 8 && b.height > innerHeight * 0.6 && b.width < 420;
  }
  function clampGeo(g) {
    var minX = railRight() + 8, W = innerWidth, H = innerHeight;
    g.w = Math.max(320, Math.min(g.w, W - minX - 8)); g.h = Math.max(220, Math.min(g.h, H - 16));
    g.x = Math.max(minX, Math.min(g.x, W - g.w - 8)); g.y = Math.max(8, Math.min(g.y, H - g.h - 8));
    return g;
  }
  // 拖动后：允许一部分移出屏幕（方便拼接），但至少露出 120 像素，标题栏不能拖出屏幕
  function keepVisible(g) {
    var minX = railRight() + 8;
    g.x = Math.max(minX - g.w + 120, Math.min(g.x, innerWidth - 120)); g.y = Math.max(0, Math.min(g.y, innerHeight - HEAD));
    return g;
  }
  function defaultGeo(w, h) {
    var n = Object.keys(wins).length, left = railRight() + 16;
    return clampGeo({ x: left + n * 28, y: Math.max(16, innerHeight - (h || 640) - 16 - n * 28), w: w || 900, h: h || 640 });
  }

  // ---------- 一个窗口 = 窗框（标题栏 + 调整大小的把手）+ 内容（固定定位，和窗框同一个位置）----------
  function make(o) {
    var id = o.id;
    var frame = document.createElement("div");
    frame.className = "fw-frame"; frame.dataset.fw = id;
    frame.innerHTML = '<div class="fw-head"><span class="fw-ic">' + (o.icon || "") + '</span><b class="fw-t">' + esc(o.title || "") + '</b><span class="fw-sp"></span>' +
      (o.dock ? '<button type="button" class="fw-b" data-fw-a="dock" title="放回页面" aria-label="放回页面">' + svg("dock") + "</button>" : "") +
      '<button type="button" class="fw-b" data-fw-a="max" title="放大 / 还原（双击标题栏）" aria-label="放大或还原">' + svg("max") + "</button>" +
      '<button type="button" class="fw-b fw-x" data-fw-a="close" title="关闭" aria-label="关闭">' + svg("close") + "</button></div>" +
      ["n", "s", "e", "w", "ne", "nw", "se", "sw"].map(function (d) { return '<i class="fw-rz" data-rz="' + d + '"></i>'; }).join("");
    host().appendChild(frame);
    var body = o.el;
    if (o.move !== false && body.parentNode !== host()) host().appendChild(body);
    body.classList.add("fw-body");
    body.dataset.fwBody = id;
    var saved = loadGeo()[id];
    var w = { id: id, o: o, frame: frame, body: body, max: false, geo: saved ? keepVisible({ x: saved.x, y: saved.y, w: Math.max(o.minW || 320, saved.w), h: Math.max(o.minH || 220, saved.h) }) : defaultGeo(o.w, o.h) };
    wins[id] = w;
    frame.addEventListener("pointerdown", function () { focus(id); }, true);
    body.addEventListener("pointerdown", function () { focus(id); }, true);
    frame.querySelector(".fw-head").addEventListener("dblclick", function (e) { if (!e.target.closest(".fw-b")) toggleMax(id); });
    frame.addEventListener("click", function (e) {
      var b = e.target.closest("[data-fw-a]"); if (!b) return;
      var a = b.dataset.fwA;
      if (a === "close") close(id); else if (a === "max") toggleMax(id); else if (a === "dock") { var v = o.dock; close(id); if (v) v(); }
    });
    drag(w); resizers(w);
    place(w); focus(id);
    requestAnimationFrame(function () { frame.classList.add("on"); body.classList.add("fw-on"); });
    return w;
  }
  function place(w) {
    var g = w.max ? { x: railRight() + 10, y: 10, w: innerWidth - railRight() - 20, h: innerHeight - 20 } : w.geo;
    [w.frame, w.body].forEach(function (e) { e.style.left = g.x + "px"; e.style.top = g.y + "px"; e.style.width = g.w + "px"; e.style.height = g.h + "px"; });
    w.frame.classList.toggle("max", w.max);
    var mb = w.frame.querySelector('[data-fw-a="max"]'); if (mb) mb.innerHTML = svg(w.max ? "restore" : "max");
  }
  function focus(id) {
    var w = wins[id]; if (!w) return;
    if (+w.frame.style.zIndex === zTop) return;
    zTop += 2; w.body.style.zIndex = zTop - 1; w.frame.style.zIndex = zTop;
    Object.keys(wins).forEach(function (k) { wins[k].frame.classList.toggle("top", k === id); });
  }
  function toggleMax(id) { var w = wins[id]; if (!w) return; w.max = !w.max; place(w); }
  function close(id) {
    var w = wins[id]; if (!w) return;
    delete wins[id];
    w.frame.remove();
    w.body.classList.remove("fw-body", "fw-on");
    ["left", "top", "width", "height", "zIndex"].forEach(function (k) { w.body.style[k] = ""; });
    delete w.body.dataset.fwBody;
    if (w.o.home) { w.body.classList.remove("on"); if (w.o.home.parent) w.o.home.parent.insertBefore(w.body, w.o.home.next && w.o.home.next.parentNode === w.o.home.parent ? w.o.home.next : null); }
    if (w.o.onClose) try { w.o.onClose(); } catch (e) {}
    document.dispatchEvent(new CustomEvent("fw-change"));
  }

  // ---------- 吸附 ----------
  function edges(self) {
    var xs = [railRight() + 8, innerWidth - 8], ys = [8, innerHeight - 8];
    Object.keys(wins).forEach(function (k) {
      var w = wins[k]; if (w === self || w.max) return;
      var g = w.geo; xs.push(g.x - GAP, g.x + g.w + GAP, g.x, g.x + g.w); ys.push(g.y - GAP, g.y + g.h + GAP, g.y, g.y + g.h);
    });
    return { xs: xs, ys: ys };
  }
  function near(v, list) { var best = null, d = SNAP + 1; list.forEach(function (c) { var dd = Math.abs(c - v); if (dd < d) { d = dd; best = c; } }); return best; }
  function guide(x, y) {
    if (!gv) { gv = document.createElement("i"); gv.className = "fw-guide v"; gh = document.createElement("i"); gh.className = "fw-guide h"; document.body.append(gv, gh); }
    gv.style.display = x == null ? "none" : "block"; if (x != null) gv.style.left = x + "px";
    gh.style.display = y == null ? "none" : "block"; if (y != null) gh.style.top = y + "px";
  }

  function track(e0, move, end) {
    var el = e0.currentTarget; try { el.setPointerCapture(e0.pointerId); } catch (e) {}
    document.documentElement.classList.add("fw-dragging");
    var mv = function (e) { move(e.clientX - e0.clientX, e.clientY - e0.clientY); };
    var up = function () {
      el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      document.documentElement.classList.remove("fw-dragging"); guide(null, null); end();
    };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  }
  function drag(w) {
    var head = w.frame.querySelector(".fw-head");
    head.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || e.target.closest(".fw-b")) return;
      e.preventDefault();
      if (w.max) {   // 放大状态下拖标题栏：先还原，窗口跟着鼠标
        w.max = false; var r = (e.clientX - w.geo.x) / w.geo.w; w.geo.x = e.clientX - w.geo.w * Math.min(Math.max(r, .1), .9); w.geo.y = 8; place(w);
      }
      var g0 = { x: w.geo.x, y: w.geo.y };
      track(e, function (dx, dy) {
        var g = w.geo, E = edges(w), x = g0.x + dx, y = g0.y + dy, sx = null, sy = null, c;
        if ((c = near(x, E.xs)) != null) { x = c; sx = c; } else if ((c = near(x + g.w, E.xs)) != null) { x = c - g.w; sx = c; }
        if ((c = near(y, E.ys)) != null) { y = c; sy = c; } else if ((c = near(y + g.h, E.ys)) != null) { y = c - g.h; sy = c; }
        g.x = Math.round(x); g.y = Math.round(Math.max(0, Math.min(y, innerHeight - HEAD))); place(w); guide(sx, sy);
      }, function () { keepVisible(w.geo); place(w); saveGeo(w.id, w.geo); });
    });
  }
  function resizers(w) {
    w.frame.querySelectorAll(".fw-rz").forEach(function (h) {
      h.addEventListener("pointerdown", function (e) {
        if (e.button !== 0 || w.max) return;
        e.preventDefault(); e.stopPropagation();
        var d = h.dataset.rz, g0 = { x: w.geo.x, y: w.geo.y, w: w.geo.w, h: w.geo.h }, MW = w.o.minW || 320, MH = w.o.minH || 220;
        track(e, function (dx, dy) {
          var E = edges(w), g = { x: g0.x, y: g0.y, w: g0.w, h: g0.h }, sx = null, sy = null, c;
          if (/e/.test(d)) { var r = g0.x + g0.w + dx; if ((c = near(r, E.xs)) != null) { r = c; sx = c; } g.w = Math.max(MW, r - g0.x); }
          if (/w/.test(d)) { var l = g0.x + dx; if ((c = near(l, E.xs)) != null) { l = c; sx = c; } l = Math.min(l, g0.x + g0.w - MW); g.x = l; g.w = g0.x + g0.w - l; }
          if (/s/.test(d)) { var b = g0.y + g0.h + dy; if ((c = near(b, E.ys)) != null) { b = c; sy = c; } g.h = Math.max(MH, b - g0.y); }
          if (/n/.test(d)) { var t = g0.y + dy; if ((c = near(t, E.ys)) != null) { t = c; sy = c; } t = Math.max(0, Math.min(t, g0.y + g0.h - MH)); g.y = t; g.h = g0.y + g0.h - t; }
          w.geo = { x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.w), h: Math.round(g.h) }; place(w); guide(sx, sy);
        }, function () { keepVisible(w.geo); place(w); saveGeo(w.id, w.geo); });
      });
    });
  }
  addEventListener("resize", function () {
    if (!enabled()) { Object.keys(wins).forEach(close); return; }
    Object.keys(wins).forEach(function (k) { keepVisible(wins[k].geo); place(wins[k]); });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || document.querySelector(".mbx-ask, .modal.open, dialog[open]")) return;
    var top = null; Object.keys(wins).forEach(function (k) { if (!top || +wins[k].frame.style.zIndex > +top.frame.style.zIndex) top = wins[k]; });
    if (top && (top.frame.contains(document.activeElement) || top.body.contains(document.activeElement) || document.activeElement === document.body)) close(top.id);
  });

  // ---------- 公开的接口 ----------
  function open(o) {
    if (!enabled()) return null;
    if (wins[o.id]) { focus(o.id); return wins[o.id]; }
    var w = make(o);
    document.dispatchEvent(new CustomEvent("fw-change"));
    return w;
  }

  // 网站里的一页（工具、插件）变成悬浮窗
  var origShow = null;
  function viewTitle(sec) { var h = sec.querySelector(".vhead h2"); return h ? h.textContent.trim() : ""; }
  function toolOf(viewId) { try { return (typeof toolList === "function" ? toolList() : []).find(function (t) { return t.view === viewId; }) || null; } catch (e) { return null; } }
  function poppable(viewId) { return !!toolOf(viewId); }
  function popView(viewId) {
    if (!enabled()) return null;
    if (wins["v:" + viewId]) { focus("v:" + viewId); return wins["v:" + viewId]; }
    var sec = document.querySelector('.view[data-view="' + CSS.escape(viewId) + '"]'); if (!sec) return null;
    var cur = typeof currentView === "function" ? currentView() : "";
    if (cur === viewId && origShow) origShow("home");   // 正在看的这一页变成悬浮窗：主页面回到首页
    var t = toolOf(viewId);
    sec.classList.remove("sub", "back", "tab");
    // 插件（iframe）不能挪位置，挪了会重新加载；网站自带的页面挪到最后，并且一直保持「打开」状态（.on），这样它自己的刷新照常工作，
    // 又不会被当成主页面（主页面在前面，网站找「当前页」时先找到主页面）
    var native = !/^p_/.test(viewId) && !sec.querySelector("iframe");
    var home = native ? { parent: sec.parentNode, next: sec.nextSibling } : null;
    if (native) {
      sec.classList.add("on");
      // 网站自带的页面要画一遍（平时是切换到这一页时画的）
      var R = { growth: "renderGrowth", plan: "renderPlan", farm: "renderFarm", meta: "renderMeta", rank: "loadRank" }[viewId];
      try { if (R && typeof window[R] === "function") window[R](); } catch (e) {}
    }
    return open({ id: "v:" + viewId, el: sec, move: native, home: home, title: (t && t.name) || viewTitle(sec) || "工具", icon: svgBox(),
      dock: function () { if (origShow) origShow(viewId); }, w: 760, h: 600 });
  }
  function svgBox() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/></svg>'; }

  // 已经是悬浮窗的页面：在侧栏 / 工具里再点它，只把窗口提到最前面，不切换主页面
  if (typeof window.showView === "function") {
    origShow = window.showView;
    window.showView = function (id) {
      if (wins["v:" + id]) { focus("v:" + id); return; }
      var r = origShow.apply(this, arguments);
      Object.keys(wins).forEach(function (k) { if (wins[k].o.home) wins[k].body.classList.add("on"); });   // 网站切换页面时会把所有页面的 .on 去掉
      return r;
    };
  }

  // 工具页：每个工具加一个「悬浮窗打开」按钮；工具 / 插件页面的标题栏也加一个
  function decorate() {
    if (!enabled()) return;
    document.querySelectorAll("#toolGrid > .tool").forEach(function (box) {
      var b = box.querySelector("button.tool[data-tab]"); if (!b || box.querySelector(".tpop") || !poppable(b.dataset.tab)) return;
      var p = document.createElement("button"); p.type = "button"; p.className = "tpop"; p.dataset.fwPop = b.dataset.tab; p.title = "在悬浮窗打开"; p.setAttribute("aria-label", "在悬浮窗打开");
      p.innerHTML = svg("pop"); box.appendChild(p);
    });
    document.querySelectorAll(".view[data-view] > .vhead").forEach(function (h) {
      var v = h.parentNode.dataset.view; if (h.querySelector(".fw-popbtn") || !poppable(v)) return;
      var p = document.createElement("button"); p.type = "button"; p.className = "fw-popbtn"; p.dataset.fwPop = v; p.title = "在悬浮窗打开（可以拖动、拼接）";
      p.innerHTML = svg("pop") + "<span>悬浮窗</span>"; h.appendChild(p);
    });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-fw-pop]"); if (!b) return;
    e.preventDefault(); e.stopPropagation(); popView(b.dataset.fwPop);
  }, true);
  if (typeof window.renderTools === "function") {
    var rt = window.renderTools;
    window.renderTools = function () { var r = rt.apply(this, arguments); try { decorate(); } catch (e) {} return r; };
  }
  function boot() { decorate(); setTimeout(decorate, 2500); new MutationObserver(function () { clearTimeout(boot.t); boot.t = setTimeout(decorate, 300); }).observe($("pluginViews") || document.body, { childList: true }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  window.FloatWM = { open: open, close: close, focus: focus, popView: popView, isOpen: function (id) { return !!wins[id]; }, enabled: enabled, list: function () { return Object.keys(wins); } };
})();
