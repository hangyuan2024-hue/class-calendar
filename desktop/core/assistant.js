// AI 助手：把课表和事项整理成一段背景，让本地模型能回答「明天几点上课」「这周要交什么」
const M = require("./model");

function context(snap, now) {
  const lines = [], today = M.dayKey(now);
  lines.push(`现在是 ${today} 周${M.WEEK[now.getDay()]} ${M.pad(now.getHours())}:${M.pad(now.getMinutes())}。`);
  const me = snap.me || {};
  if (me.display_name) lines.push(`用户：${me.display_name}${(snap.classes || []).find((c) => c.id === snap.cid) ? "，班级：" + snap.classes.find((c) => c.id === snap.cid).name : ""}。`);
  const wk = M.weekOf((snap.courses || {}).meta, now);
  if (wk) lines.push(`本学期第 ${wk} 周。`);
  for (let i = 0; i < 7; i++) {
    const d = M.addDays(now, i), cs = M.coursesOn(snap.courses, d);
    if (cs.length) lines.push(`${i === 0 ? "今天" : i === 1 ? "明天" : M.dayKey(d) + "（周" + M.WEEK[d.getDay()] + "）"}的课：` + cs.map((c) => `${c.tStart}-${c.tEnd} ${c.name}${c.location ? "@" + c.location : ""}${c.teacher ? "（" + c.teacher + "）" : ""}`).join("；"));
  }
  const items = M.sortItems(M.allItems(snap).filter((x) => !x.hidden && (!x.day || (M.dayDiff(x.day, now) >= -7 && M.dayDiff(x.day, now) <= 30))));
  if (items.length) {
    lines.push("事项（作业、通知、活动、我的待办）：");
    for (const x of items.slice(0, 80)) lines.push(`- [${x.type}] ${x.title}${x.summary ? "：" + x.summary : ""} | ${x.day ? x.day + (x.time ? " " + x.time : "") : "没定日子"}${x.type === "作业" ? " 截止" : ""}${x.location ? " | 地点 " + x.location : ""}${x.prepare ? " | 需准备 " + x.prepare : ""}${x.done ? " | 已完成" : ""}`);
  } else lines.push("最近没有事项。");
  return lines.join("\n");
}

function systemPrompt(snap, now) {
  return `你是「捞捞」，捞捞课程表电脑版里的学习小助手。说话亲切、简洁，用中文回答。
回答关于课程、作业、日程的问题时，只根据下面的资料，资料里没有的就直说不知道，不要编。
需要列多件事时用短列表，时间写清楚。其他学习、生活问题可以正常回答。

${context(snap, now)}`;
}

module.exports = { context, systemPrompt };
