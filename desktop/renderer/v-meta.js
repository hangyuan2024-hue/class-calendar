// 捞捞元宇宙：身份卡（等级、经验）、今日任务、成就徽章、元宇宙小百科；可以切到霓虹风格的「元宇宙模式」
// 经验全部由你自己的记录算出来（完成事项、打卡、番茄钟、目标），和网页版算法一样
"use strict";
const META_TITLES = [[1, "新手旅人"], [2, "见习探索者"], [3, "时间猎手"], [5, "自律骑士"], [8, "星际学霸"], [12, "银河指挥官"], [18, "元宇宙传奇"]];
const META_WIKI = [
  ["🌐", "什么是元宇宙", "元宇宙（Metaverse）指和现实世界平行、又互相连通的虚拟空间。人们可以用虚拟形象在里面学习、社交、工作和创作。这个词最早出自 1992 年的科幻小说《雪崩》。"],
  ["🥽", "虚拟现实 VR", "VR 用头戴设备把你的视野完全换成电脑生成的世界，转头、走动时画面跟着变，让人有「身临其境」的感觉。常用于游戏、模拟驾驶、虚拟实验室。"],
  ["📱", "增强现实 AR", "AR 把虚拟内容叠加到真实画面上，比如用手机扫课本出现立体模型、导航箭头直接画在路面上。它不替换现实，而是给现实「加一层」。"],
  ["🏙️", "数字孪生", "给真实的工厂、城市甚至校园在电脑里做一个一模一样的「双胞胎」，实时同步数据。改方案前先在虚拟世界里试，省钱又安全。"],
  ["🧑‍🚀", "虚拟形象与数字人", "虚拟形象是你在元宇宙里的「化身」；数字人是能说话、有表情的虚拟人物，已经被用在新闻播报、客服和虚拟主播里。"],
  ["🎓", "元宇宙里的学习", "在虚拟空间里可以走进细胞内部、站在古罗马街头、做危险的化学实验。沉浸式学习让抽象知识变得看得见、摸得着。"],
  ["🛡️", "安全小贴士", "在任何虚拟世界里都要保护好个人信息：不随便透露真实姓名、学校和住址，遇到让你不舒服的人或内容及时离开并告诉老师家长。"],
];
function metaStats() {
  const t = todayKey(), dl = App.S.doneLog || {}, habits = KV("habits_v1"), log = KV("habit_log_v1") || {}, pl = App.S.pomo || {}, pn = KV("plan_notes_v1") || {};
  const doneAll = Object.keys(dl).length, doneToday = Object.values(dl).filter((d) => d === t).length;
  let checks = 0, checksToday = 0, bestStreak = 0;
  for (const hh of habits) { const lg = log[hh.id] || {}; checks += Object.keys(lg).length; if (lg[t]) checksToday++; bestStreak = Math.max(bestStreak, habitStreak(hh.id)); }
  const pomos = Object.values(pl).reduce((a, b) => a + (+b || 0), 0), pomosToday = +pl[t] || 0;
  const goals = Object.keys(pn).filter((k) => k.startsWith("smart:") && pn[k]), goalsDone = goals.filter((k) => pn[k].done).length;
  const pdcaRounds = Object.keys(pn).filter((k) => k.startsWith("pdca:") && pn[k]).reduce((a, k) => a + ((pn[k].round || 1) - 1) + (pn[k].stage === 3 ? 1 : 0), 0);
  const ivyDone = Object.keys(pn).filter((k) => k.startsWith("ivy:") && Array.isArray(pn[k])).reduce((a, k) => a + pn[k].filter((x) => x && x.text && x.done).length, 0);
  const exp = doneAll * 10 + checks * 5 + pomos * 15 + goalsDone * 30 + pdcaRounds * 20 + ivyDone * 5;
  const level = Math.floor(Math.sqrt(exp / 40)) + 1, lo = 40 * (level - 1) ** 2, hi = 40 * level ** 2;
  const title = META_TITLES.filter(([l]) => level >= l).pop()[1];
  return { doneAll, doneToday, checks, checksToday, bestStreak, pomos, pomosToday, goals: goals.length, goalsDone, pdcaRounds, ivyDone, exp, level, lo, hi, title };
}
const META_BADGES = [
  ["🛸", "初次接入", "进入过一次捞捞元宇宙", () => { try { return !!localStorage.getItem("metaVisited"); } catch (e) { return true; } }],
  ["✅", "第一步", "完成 1 件事", (s) => s.doneAll >= 1], ["🔟", "十全十美", "累计完成 10 件事", (s) => s.doneAll >= 10], ["💯", "百事通", "累计完成 100 件事", (s) => s.doneAll >= 100],
  ["🔥", "小火苗", "任意习惯连续打卡 3 天", (s) => s.bestStreak >= 3], ["🌟", "一周不断", "任意习惯连续打卡 7 天", (s) => s.bestStreak >= 7],
  ["🍅", "番茄新手", "完成 1 个番茄钟", (s) => s.pomos >= 1], ["⏱️", "专注大师", "累计 25 个番茄钟", (s) => s.pomos >= 25],
  ["🏹", "神射手", "达成 1 个 SMART 目标", (s) => s.goalsDone >= 1], ["🔄", "螺旋上升", "完成一轮 PDCA", (s) => s.pdcaRounds >= 1],
  ["☁️", "云端旅人", "开启云端同步", () => !!(App.S.me)], ["📚", "课表达人", "导入了课程表", () => (App.S.courses.courses || []).length > 0],
  ["💻", "桌面玩家", "用上了电脑版", () => true],
];
App.views.meta = {
  title: "元宇宙", icon: "meta", wiki: 0,
  mount(el) {
    el.innerHTML = `<div class="vhead"><div><h1>捞捞元宇宙</h1><div class="sub">经验和徽章由你的完成记录、打卡、番茄钟、目标自动计算，跟着账号同步</div></div><span class="grow"></span><button class="btn primary" id="mtWarp"></button></div>
      <div class="vbody"><div class="mt-wrap" id="mtBox"></div></div>`;
    $("#mtWarp", el).onclick = () => { const on = App.S.settings.theme === "meta"; call("settings", { theme: on ? (App.S.settings.themeBefore || "system") : "meta", themeBefore: on ? App.S.settings.themeBefore : App.S.settings.theme }); toast(on ? "已回到现实" : "欢迎来到捞捞元宇宙 🌐"); };
    el.addEventListener("toggle", (e) => { const d = e.target; if (d.matches && d.matches("details.mw") && d.open) this.wiki = +d.dataset.mw; }, true);
  },
  show() { try { localStorage.setItem("metaVisited", "1"); } catch (e) {} },
  update() {
    const el = this.el, s = metaStats(), me = App.S.me || {}, on = App.S.settings.theme === "meta";
    $("#mtWarp", el).textContent = on ? "⏏ 回到现实" : "🌐 进入元宇宙模式";
    const g = (KV("profile_v1") || {}).gender || me.gender, avatar = g === "f" ? "👩‍🚀" : g === "m" ? "🧑‍🚀" : "🤖";
    const quests = [["完成 1 件事", s.doneToday, 1, 10], ["打卡 1 个习惯", s.checksToday, 1, 5], ["专注 1 个番茄", s.pomosToday, 1, 15]];
    const qDone = quests.filter(([, n, need]) => n >= need).length;
    const got = META_BADGES.filter((b) => { try { return b[3](s); } catch (e) { return false; } });
    const pct = Math.round((s.exp - s.lo) / (s.hi - s.lo) * 100);
    $("#mtBox", el).innerHTML = `
      <div class="card mt-id"><div class="mt-av">${avatar}<span>LV.${s.level}</span></div>
        <div class="mt-main"><div class="mt-name">${esc(me.display_name || "访客")}<span class="tag" style="--c:var(--brand)">${esc(s.title)}</span></div>
          <div class="mt-bar"><i style="width:${pct}%"></i></div><div class="muted">距离 LV.${s.level + 1} 还差 <b>${s.hi - s.exp}</b> EXP · 累计 ${s.exp} EXP</div>
          <div class="mt-stats"><span><b>${s.doneAll}</b>完成</span><span><b>${s.checks}</b>打卡</span><span><b>${s.pomos}</b>番茄</span><span><b>${got.length}</b>徽章</span></div></div></div>
      <div class="sec-h"><b>今日任务</b><span>${qDone === 3 ? "全部完成，明天见 🎉" : `完成 ${qDone}/3，做完拿经验`}</span></div>
      <div class="mt-q">${quests.map(([n, have, need, xp]) => `<div class="card${have >= need ? " ok" : ""}"><span>${have >= need ? "✓" : "◇"}</span><div><b>${n}</b><small>${Math.min(have, need)}/${need} · +${xp} EXP</small></div></div>`).join("")}</div>
      <div class="sec-h"><b>成就徽章</b><span>已解锁 ${got.length}/${META_BADGES.length}</span></div>
      <div class="mt-b">${META_BADGES.map((b) => { const ok = got.includes(b); return `<div class="card${ok ? " on" : ""}" title="${esc(b[2])}"><span>${ok ? b[0] : "🔒"}</span><b>${esc(b[1])}</b><small>${esc(b[2])}</small></div>`; }).join("")}</div>
      <div class="sec-h"><b>元宇宙小百科</b><span>点开看看</span></div>
      <div class="mt-w">${META_WIKI.map(([i, t, d], k) => `<details class="card mw"${k === this.wiki ? " open" : ""} data-mw="${k}"><summary><span>${i}</span>${esc(t)}</summary><p>${esc(d)}</p></details>`).join("")}</div>`;
  },
};
