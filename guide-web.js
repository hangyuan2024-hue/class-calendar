// 1.33 带插图的功能介绍（和小程序一样，插图在 guide/*.svg）
//   1. 「功能介绍」页顶上：一图一卡，点卡片跳到对应的小节
//   2. 第一次打开某个页面：弹一张卡片说这个功能怎么用（每个页面只弹一次，记在本机；功能介绍页底部可以重新弹）
(function () {
  "use strict";
  const KEY = "web_tips_seen_v1";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // img = guide/ 下的插图；view = 网站里对应的页面（第一次打开时弹）；kw = 功能介绍里对应小节标题的关键字
  const G = [
    { img: "ingest", t: "整理群消息", kw: "整理", c: ["把群里的通知文字粘贴进来，或者选截图、Word 文件，点「整理」。", "捞捞认出作业、通知、截止时间和地点，你核对一下再发布到班级或加到自己的事项。"] },
    { img: "homework", t: "作业", view: "homework", kw: "作业", c: ["按截止时间列出要交的作业，做完点右边的圆圈标记完成。", "点一条看详情、附件和原文；作业也会出现在首页和日历里。"] },
    { img: "checkin", t: "签到", kw: "签到", c: ["同学：输入投屏上的 4 位签到码，或者用手机扫二维码；要拍照、定位的按提示做。网络不好也能签，联网后自动交。", "老师、班委：发起签到时选方式、时长和「谁要签」（学生、班委、老师、指定的人或分组）。"] },
    { img: "calendar", t: "日历", view: "calendar", kw: "日历", c: ["按月看所有作业、通知和课程，点某一天看当天安排。", "想让手机系统日历也提醒：在「我的 → 数据」里订阅。"] },
    { img: "course", t: "课程表", kw: "课程表", c: ["拍照导入课表，也可以手动加课；早自习、晚自习显示在课表最上面和最下面。", "学校临时调休、换课、停课，在「调课 / 调休」里改，首页和提醒都会跟着变。"] },
    { img: "class", t: "班级", kw: "班级", c: ["同学：输入老师或班委给的班级码申请加入，老师或班委批准后就能看到班级作业和通知。", "老师：可以审批入班、设置班委和权限；班委默认也能批准入班，老师可以单独关掉。"] },
    { img: "plan", t: "规划与专注", view: "plan", kw: "规划", c: ["用四象限、六件事等方法排今天要做的事，番茄钟帮你专注 25 分钟。", "专注、完成的事都会算进成长值。"] },
    { img: "growth", t: "成长", view: "growth", kw: "成长", c: ["完成作业、签到、打卡都会攒成长值，看本周进度和最近的趋势。", "习惯打卡：加一个习惯，每天点一下。"] },
    { img: "tools", t: "工具", view: "tools", kw: "工具", c: ["常用小工具都在这里：课程表、倒计时、记账、番茄专注、格式转换……", "可以挑几个放到首页。"] },
    { img: "ask", t: "查日程", view: "ask", kw: "查", c: ["输入「明天的课」「这周的作业」「下节课在哪」，捞捞按你的日历和课表回答。", "在你的设备上按规则算，不上传，也不用大模型。"] },
    { img: "remind", t: "提醒", kw: "提醒", c: ["作业快截止、新通知、签到开始时提醒你；也可以订阅到手机日历，到点系统提醒。"] },
    { img: "farm", t: "云宠农场", view: "farm", kw: "农场", c: ["完成作业、打卡、番茄专注会攒「养料」，喂你的云宠长大。"] },
    { img: "rank", t: "成长排行榜", view: "rank", kw: "排行", c: ["看本周、本月、总榜，可以选实名、匿名或不参加。"] },
    { img: "coach", t: "捞捞教练", kw: "教练", c: ["每周帮你复盘，看看自己几点状态最好、这周完成了多少。全部在你的设备上计算，可以随时关掉。"] },
  ];
  const seen = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } };
  const mark = (k) => { try { const s = seen(); s[k] = 1; localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} };

  // ---------- 1. 功能介绍页的插图卡片 ----------
  function cards() {
    const box = document.getElementById("introBox"); if (!box || box.querySelector(".gd-cards")) return;
    const hero = box.querySelector(".in-hero"); if (!hero) return;   // 编辑模式、加载中不加
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="sec-h"><b>一图看懂</b><span>点卡片看详细说明</span></div><div class="gd-cards">${G.map((g, i) => `<button type="button" class="gd-card" data-gdi="${i}"><img src="guide/${g.img}.svg" alt="" loading="lazy" width="600" height="320"><div><b>${esc(g.t)}</b><span>${esc(g.c[0])}</span></div></button>`).join("")}</div>
      <div class="meta gd-reset"><button type="button" class="linkish" data-gdreset>以后第一次打开每个页面时，再弹一次使用说明</button></div>`;
    hero.insertAdjacentElement("afterend", wrap);
  }
  // ---------- 2. 第一次打开某个页面：弹卡片 ----------
  function dlg() {
    let d = document.getElementById("gdDlg");
    if (!d) {
      d = document.createElement("dialog"); d.id = "gdDlg"; d.className = "dlg gd-dlg"; document.body.appendChild(d);
      d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-gdx]")) d.close(); });
    }
    return d;
  }
  function show(g, more) {
    const d = dlg();
    d.innerHTML = `<img class="gd-img" src="guide/${g.img}.svg" alt="" width="600" height="320"><h3>${esc(g.t)}</h3>
      <ol class="gd-steps">${g.c.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
      <div class="row">${more ? `<button type="button" class="small" data-gdmore="${esc(g.kw)}">看详细介绍</button>` : ""}<span class="spacer"></span><button type="button" class="btn ink sm" data-gdx>知道了</button></div>`;
    if (!d.open) try { d.showModal(); } catch (e) {}
  }
  let lastView = "";
  function onView() {
    const v = document.querySelector(".view.on[data-view]"), id = v && v.dataset.view;
    if (!id || id === lastView) return; lastView = id;
    if (id === "intro") { setTimeout(cards, 50); return; }
    const g = G.find((x) => x.view === id); if (!g || seen()["v:" + id]) return;
    if (document.querySelector("dialog[open]")) return;   // 别的弹窗开着就不打扰
    mark("v:" + id);
    setTimeout(() => show(g, true), 500);
  }
  function jump(kw) {
    const box = document.getElementById("introBox"); if (!box) return;
    const sec = [...box.querySelectorAll(".in-sec")].find((s) => (s.querySelector("h4") || {}).textContent.indexOf(kw) >= 0);
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-gdi]");
    if (c) { const g = G[+c.dataset.gdi]; show(g, false); return; }
    const m = e.target.closest("[data-gdmore]");
    if (m) { const kw = m.dataset.gdmore; document.getElementById("gdDlg").close(); if (typeof showView === "function") showView("intro"); setTimeout(() => jump(kw), 400); return; }
    if (e.target.closest("[data-gdreset]")) { try { localStorage.removeItem(KEY); } catch (e2) {} e.target.closest("[data-gdreset]").textContent = "好了，下次打开每个页面会再弹一次"; }
  });
  function boot() {
    const views = document.querySelectorAll(".view[data-view]");
    if (!views.length) return;
    const mo = new MutationObserver(onView);
    views.forEach((v) => mo.observe(v, { attributes: true, attributeFilter: ["class"] }));
    const ib = document.getElementById("introBox");
    if (ib) new MutationObserver(() => { if (lastView === "intro") cards(); }).observe(ib, { childList: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.LaoGuide = { show: (k) => { const g = G.find((x) => x.img === k || x.view === k); if (g) show(g, false); } };
})();
