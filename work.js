/* 5.8.0 职场版：单位类型选了「职场人员」的用户，界面换一套用词（班级→团队、作业→任务、班委→负责人…），
 * 首页顶部是「今天的会议和待办」。底层功能完全一样（数据还是同一套），只换显示的文字。
 * 依赖 app.js：workMode allItems keyOf ccDate esc showView；只在中文界面下替换（英文界面不动） */
(function () {
  "use strict";
  // 长的放前面，先换长的
  const MAP = [
    ["班级管理", "团队管理"], ["班级码", "团队码"], ["班级墙", "团队墙"], ["班级群", "团队群"], ["班级成员", "团队成员"], ["班级课表", "团队日程表"],
    ["班级事项", "团队事项"], ["班级数据", "团队数据"], ["加入班级", "加入团队"], ["创建班级", "创建团队"], ["切换班级", "切换团队"], ["建班", "建团队"],
    ["全班", "全团队"], ["本班", "本团队"], ["班级", "团队"], ["班委", "负责人"], ["课代表", "负责人"],
    ["交作业", "交付任务"], ["写作业", "做任务"], ["作业", "任务"], ["同学们", "同事们"], ["同学", "同事"], ["老师", "管理员"], ["学生", "成员"],
    ["学习工作台", "工作台"], ["我的学习空间", "我的工作空间"], ["学习伙伴", "工作伙伴"], ["课内学习", "学习资料"],
  ];
  const RE = new RegExp(MAP.map((m) => m[0]).join("|"), "g");
  const TO = Object.fromEntries(MAP);
  const sub = (s) => s.replace(RE, (m) => TO[m]);
  // 用户自己写的内容（事项标题、备注、帖子、名字、输入框）不改
  const SKIP = "script,style,textarea,input,select,option,[contenteditable],.atitle,.asub,.anote,.aorig,.title,.ulink,.av,.mavatar,#className,#classNick,#classMotto,#classSel,.wp-body,.wp-title,.wpost .body,.cmt-body,.t-sn,.hw-vp,.memo-list,.mm-wrap,[data-raw]";
  let on = false, obs = null;
  const active = () => typeof workMode === "function" && workMode() && !(window.CCLang && CCLang.lang === "en") && document.documentElement.lang !== "en";
  function skip(el) { return !el || (el.closest && el.closest(SKIP)); }
  function doNode(n) {
    if (n.nodeType === 3) { if (RE.test(n.nodeValue) && !skip(n.parentElement)) { RE.lastIndex = 0; n.nodeValue = sub(n.nodeValue); } RE.lastIndex = 0; return; }
    if (n.nodeType !== 1 || skip(n)) return;
    for (const a of ["placeholder", "title", "aria-label"]) { const v = n.getAttribute(a); if (v && RE.test(v)) { RE.lastIndex = 0; n.setAttribute(a, sub(v)); } RE.lastIndex = 0; }
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: (x) => (x.nodeType === 1 && skip(x) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let x; while ((x = w.nextNode())) {
      if (x.nodeType === 3) { if (RE.test(x.nodeValue)) { RE.lastIndex = 0; x.nodeValue = sub(x.nodeValue); } RE.lastIndex = 0; }
      else for (const a of ["placeholder", "title", "aria-label"]) { const v = x.getAttribute(a); if (v && RE.test(v)) { RE.lastIndex = 0; x.setAttribute(a, sub(v)); } RE.lastIndex = 0; }
    }
  }
  function start() {
    if (on) return; on = true;
    document.title = sub(document.title);
    doNode(document.body);
    obs = new MutationObserver((ms) => { for (const m of ms) { if (m.type === "characterData") doNode(m.target); else m.addedNodes.forEach(doNode); } });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    const A = window.alert, C = window.confirm, P = window.prompt;
    window.alert = (m) => A.call(window, on ? sub(String(m)) : m);
    window.confirm = (m) => C.call(window, on ? sub(String(m)) : m);
    window.prompt = (m, d) => P.call(window, on ? sub(String(m)) : m, d);
  }
  window.CCWork = { sub, active };

  // ---------- 首页：今天的会议和待办 ----------
  const keyOfD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function home() {
    const ok = active();
    if (ok) start();
    window.CC_HOME_TITLE = ok ? "工作台" : null; window.CC_HOME_EYEBROW = ok ? "高效工作，也好好生活" : null;
    const view = document.querySelector('.view[data-view="home"]'); if (!view) return;
    const h2 = view.querySelector(".studio-home-heading h2"), eb = view.querySelector(".studio-home-heading .studio-eyebrow");
    if (ok && h2) { h2.firstChild.textContent = "工作台"; eb.textContent = "高效工作，也好好生活"; }
    let box = document.getElementById("workHome");
    if (!ok) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement("section"); box.id = "workHome"; box.className = "w-home surface";
      const n = document.getElementById("notice"); n.parentNode.insertBefore(box, n.nextSibling);
      box.addEventListener("click", (e) => { const b = e.target.closest("[data-wgo]"); if (!b) return; if (b.dataset.wgo === "add") { const q = document.getElementById("qMine"); if (q) q.click(); } else showView(b.dataset.wgo); });
    }
    const t = keyOfD(typeof ccDate === "function" ? ccDate() : new Date());
    const all = allItems().filter((r) => !r._plugin);
    const today = all.filter((r) => r._p && r._p.day === t).sort((a, b) => (a._p.time || "99").localeCompare(b._p.time || "99"));
    const meet = today.filter((r) => r.msg_type === "会议" || /会|meeting|评审|面试|拜访|电话|call/i.test(r.subject || ""));
    const todo = all.filter((r) => !r._done && !meet.includes(r) && r._p && r._p.day <= t && (r._p.day === t || r.msg_type === "作业" || r._mine));
    const row = (r, late) => `<div class="w-r${r._done ? " done" : ""}"><span class="w-t">${esc(r._p.time || (late ? "过期" : "全天"))}</span><span class="w-n" data-raw>${esc(r.subject || r.summary || r.msg_type)}</span>${r.location ? `<small data-raw>📍 ${esc(r.location)}</small>` : ""}</div>`;
    box.innerHTML = `<div class="w-col"><div class="w-h"><b>📅 今天的会议</b><span>${meet.length}</span></div>${meet.length ? meet.map((r) => row(r)).join("") : `<div class="meta">今天没有会议</div>`}</div>
      <div class="w-col"><div class="w-h"><b>✅ 待办</b><span>${todo.length}</span></div>${todo.length ? todo.slice(0, 6).map((r) => row(r, r._p.day < t)).join("") + (todo.length > 6 ? `<button class="link" data-wgo="homework">还有 ${todo.length - 6} 项 ›</button>` : "") : `<div class="meta">今天的事都清空了 🎉</div>`}</div>
      <div class="w-act"><button class="small" data-wgo="add">✏️ 记一件事</button><button class="small" data-wgo="calendar">📅 日历</button><button class="small" data-wgo="homework">📋 全部任务</button></div>`;
  }
  (window.CC_HOME_HOOKS ||= []).push(home);
})();
