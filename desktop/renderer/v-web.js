// 直接用网站代码的几个页面：课内学习、思维导图、云宠农场（代码在 renderer/web/，由 scripts/sync-web.js 从网站拷来）
// 这里只放页面的「架子」（网站代码要找的那些 id），样式在 webshim.css 里换成电脑版的样子
"use strict";
const webOk = (fn) => typeof window[fn] === "function";
const webMissing = (name) => `<div class="empty" style="padding:80px 20px"><b>🧩</b>「${name}」的代码还没拷进来<br><small class="muted">打包前会自动从网站拷最新版（npm run sync-web）</small></div>`;

// ---------- 课内学习 ----------
App.views.study = {
  title: "学习", icon: "study",
  count() { const its = App.items().filter((x) => x.study && !x.done && x.day && M.dayDiff(x.day, App.now()) >= 0 && M.dayDiff(x.day, App.now()) <= 7); return { n: its.length, hot: its.some((x) => M.dayDiff(x.day, App.now()) <= 1) }; },
  mount(el) {
    el.classList.add("web"); el.dataset.view = "study";
    el.innerHTML = `<header class="vhead"><button class="btn ghost iconbtn" id="knBack" aria-label="返回" title="返回">${icon("left")}</button><div><h1 id="knTitle">课内学习</h1><div class="sub">资料 · 笔记 · 考核 · 错题 · 知识框架，按课程整理；考核的截止日期会进日历和提醒</div></div><span class="grow"></span>
      <button class="btn" data-pop title="单独开一个窗口">${icon("mini")}</button><button class="btn primary" id="knAdd">＋ 课程</button></header>
      <div class="vbody"><div id="studyBox"></div></div>`;
    if (!$("#knDlg")) document.body.append(h(`<dialog id="knDlg" class="dlg kn-dlg web"><div id="knDlgBody"></div></dialog>`));
    $("[data-pop]", el).onclick = () => popOut("study");
  },
  update() { if (webOk("renderStudy")) window.renderStudy(); else $("#studyBox", this.el).innerHTML = webMissing("课内学习"); },
  show(a) { if (a && a.item && a.item.studyId && webOk("openStudyItem")) setTimeout(() => window.openStudyItem(a.item.studyId), 50); },
};

// ---------- 思维导图 ----------
App.views.mindmap = {
  title: "思维导图", icon: "mindmap", ownKeys: true,
  mount(el) {
    el.classList.add("web", "mm-view"); el.dataset.view = "mindmap";
    el.innerHTML = `<header class="vhead mm-head"><button class="btn ghost iconbtn back" data-mm="back" aria-label="返回" title="返回导图列表">${icon("left")}</button><h1 id="mmHeadTitle">捞捞思维导图</h1><input id="mmTitleIn" class="mm-title input hidden" maxlength="80" aria-label="导图名称"><span class="grow"></span><span id="mmSync" class="mm-sync hidden"></span>
      <button class="btn ghost" data-pop title="单独开一个窗口，可以放到另一块屏幕上">${icon("mini")}单独窗口</button></header>
      <div class="vbody mm-body"><div id="mmBox" class="mm-box"></div></div>`;
    if (!$("#mmDlg")) document.body.append(h(`<dialog id="mmDlg" class="dlg kn-dlg mm-dlg web"><div id="mmDlgBody"></div></dialog>`));
    $("[data-pop]", el).onclick = () => popOut("mindmap");
  },
  update() { if (webOk("renderMindmap")) window.renderMindmap(); else $("#mmBox", this.el).innerHTML = webMissing("思维导图"); },
  show(a) {
    this.el.classList.add("on");
    if (a && a.create && window.Mindmap && typeof window.Mindmap.create === "function") window.Mindmap.create();
  },
  leave() { this.el.classList.remove("on"); if (webOk("mmLeave")) window.mmLeave(); },
};

// ---------- 云宠农场 ----------
App.views.farm = {
  title: "云宠农场", icon: "farm",
  navOn() { return App.fun().farm !== false; },
  mount(el) {
    el.classList.add("web"); el.dataset.view = "farm";
    el.innerHTML = `<div class="vhead"><div><h1>云宠农场</h1><div class="sub">完成作业、打卡、番茄钟攒养料，喂你的云宠长大；云宠跟着账号走，网页、手机上也是这一只</div></div><span class="grow"></span><button class="btn" data-go2="rank">🏆 排行榜</button></div>
      <div class="vbody"><div class="farm-wrap">
        <div class="farm-col"><div class="surface farm-pet" id="farmPet"></div><div class="surface"><div class="farm-week" id="farmWeek"></div></div></div>
        <div class="farm-col">
          <div class="surface farm-todo"><div class="sec-h"><b>现在就能攒养料</b><span>在这里勾完成，和作业页、日历是同一份记录</span></div><div id="farmTodo"></div></div>
          <div class="surface"><div class="sec-h"><b>最近 7 天的养料</b></div><div id="farmHist"></div>
            <details class="farm-rules"><summary>养料怎么来？</summary><ul>
              <li>完成一项作业 <b>+10</b>，其它事项 <b>+5</b>（作业页、日历、这里打勾都算，只算一次）</li>
              <li>习惯打卡 <b>+3</b>（每天最多 5 次），专注一个番茄钟 <b>+2</b>（每天最多 12 个）</li>
              <li>一天完成 3 件事以上再 <b>+5</b>；连续 3 天以上都有完成、打卡或专注，每天再 <b>+3</b></li>
              <li>喂一次花 10 养料，云宠经验 +20；Lv.2、4、7、10 会进化成新样子</li>
              <li>云宠和养料跟着账号走，换手机、换电脑登录还是这一只</li></ul></details></div>
        </div></div>
        <div class="muted" style="font-size:12px;margin-top:14px">云宠形象由队友设计 · 原「云养殖」工具</div>
      </div><div class="farm-toast" id="farmToast" role="status" aria-live="polite"></div>`;
    if (!$("#farmDlg")) document.body.append(h(`<dialog id="farmDlg" class="dlg web"><form method="dialog"><h3>🔄 换一只云宠</h3><div class="meta">等级和经验跟着走，随时可以换回来。</div><div class="fpk-grid" id="farmPets"></div>
      <div class="meta" style="margin-top:4px">进化路线：Lv.2 幼崽 → Lv.4 成长期（穿上小围裙）→ Lv.7 完全体（拿着道具）→ Lv.10 传说形态（光环、云翼、星尘）</div><div class="fev-row" id="farmEvo"></div>
      <div class="nd-actions"><span class="spacer"></span><button type="button" class="btn ink sm" id="farmDlgClose">好了</button></div></form></dialog>`));
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-go2]")) return App.go(e.target.closest("[data-go2]").dataset.go2);
      const c = e.target.closest(".chk[data-act=done][data-k]"); if (c) { const x = App.find(c.dataset.k); if (x) toggleDone(x.key, !x.done); }
      const t = e.target.closest("[data-tab]"); if (t) { e.preventDefault(); App.go(t.dataset.tab === "plan" ? "focus" : t.dataset.tab); }
    });
  },
  F() { return (WebShim.mods.farm || {}); },
  update() {
    const F = this.F();
    if (!F.renderFarm) { $(".farm-wrap", this.el).innerHTML = webMissing("云宠农场"); return; }
    if (F.farmReload) F.farmReload();   // 别的设备喂过：重新读账号里的云宠
    this.el.classList.add("on"); F.renderFarm();
  },
  show() { this.el.classList.add("on"); },
  leave() { this.el.classList.remove("on"); },
  // 首页、捞捞小屏幕用：现在有多少养料
  mini() { const F = this.F(); if (!F.farmNumbers) return null; try { const s = F.farmState(), n = F.farmNumbers(); return { name: s.name, level: s.level, left: n.left, svg: F.petSVG ? F.petSVG(s.pet, s.level) : "" }; } catch (e) { return null; } },
};

// 课内学习里有截止日期的考核：交给主进程，和别的事项放在一起（首页、日历、作业、提醒、AI 都能看到；完成标记跟着账号同步）
let studySig = "";
function pushStudyItems() {
  if (!webOk("studyItems") || !App.S || !App.S.loggedIn) return;
  let raw = []; try { raw = window.studyItems() || []; } catch (e) { return; }
  const list = raw.map((r) => { const p = M.parseTime(r.event_time); return { key: r._key, studyId: r._study, course: r._studyCourse || "", title: r.subject, summary: r.summary || "", day: p ? p.day : "", time: p ? p.time : "" }; });
  const sig = JSON.stringify(list); if (sig === studySig) return;
  studySig = sig; call("extra:items", list).catch(() => {});
}
setInterval(pushStudyItems, 4000);
// 考核的备注：存在完成标记里（和班级事项一样）
const Study = { setNote: (x, v) => call("mark", x.key, { note: v }) };

// 网站代码一加载就去找这些元素（绑按钮、输入框）：页面的架子先搭好（藏着），App.go 时直接用
for (const id of ["study", "mindmap", "farm"]) {
  const v = App.views[id], el = h(`<section class="view hidden" data-v="${id}"></section>`);
  $("#main").append(el); v.el = el; v.mount(el); v.premounted = true;
}
