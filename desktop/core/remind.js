// 什么时候该弹提醒：事项开始前、上课前、每晚 8 点汇总明天
const M = require("./model");

// 返回现在该弹的提醒（sent 里记着已经弹过的，避免重复）
function due(snap, now, sent) {
  const st = snap.settings || {}, out = [];
  const today = M.dayKey(now), nowMin = now.getHours() * 60 + now.getMinutes();
  const items = M.allItems(snap).filter((x) => !x.done && !x.hidden && x.day === today && x.time);
  const before = Math.max(0, Number(st.remindBefore) || 0);
  for (const it of items) {
    const at = M.toMin(it.time); if (at == null) continue;
    const id = `item:${it.key}:${it.day}:${it.time}`;
    if (sent.has(id)) continue;
    if (nowMin >= at - before && nowMin <= at + 5) {
      const left = at - nowMin;
      out.push({ id, kind: "item", key: it.key, title: `${it.type === "作业" ? "作业快截止了" : "马上开始"}：${it.title}`,
        body: `${left > 0 ? left + " 分钟后" : "现在"}（${it.time}）${it.location ? " · " + it.location : ""}` });
    }
  }
  const cb = Math.max(0, Number(st.courseRemind) || 0);
  if (cb) for (const c of M.coursesOn(snap.courses, now)) {
    const at = M.toMin(c.tStart); if (at == null) continue;
    const id = `course:${today}:${c.start}:${c.name}`;
    if (sent.has(id)) continue;
    if (nowMin >= at - cb && nowMin <= at) out.push({ id, kind: "course", title: `${at - nowMin > 0 ? at - nowMin + " 分钟后" : "现在"}上课：${c.name}`, body: `${c.tStart}–${c.tEnd}${c.location ? " · " + c.location : ""}${c.teacher ? " · " + c.teacher : ""}` });
  }
  if (st.eveningDigest && nowMin >= 20 * 60 && nowMin < 23 * 60) {
    const id = `evening:${today}`;
    if (!sent.has(id)) {
      const tmr = M.addDays(now, 1), tk = M.dayKey(tmr);
      const its = M.allItems(snap).filter((x) => !x.done && !x.hidden && x.day === tk);
      const cs = M.coursesOn(snap.courses, tmr);
      const hw = M.allItems(snap).filter((x) => !x.done && !x.hidden && x.type === "作业" && x.day && M.dayDiff(x.day, now) >= 1 && M.dayDiff(x.day, now) <= 3);
      if (its.length || cs.length || hw.length) {
        const parts = [];
        if (cs.length) parts.push(`${cs.length} 节课，第一节 ${cs[0].tStart} ${cs[0].name}`);
        if (its.length) parts.push(`${its.length} 件事：${its.slice(0, 3).map((x) => x.title).join("、")}${its.length > 3 ? "…" : ""}`);
        else if (hw.length) parts.push(`3 天内要交 ${hw.length} 份作业`);
        out.push({ id, kind: "evening", title: "明天的安排", body: parts.join("；") });
      }
    }
  }
  // 倒数日：提前 7 天、3 天、1 天和当天早上 8 点以后提醒一次
  if (st.countdownRemind !== false && nowMin >= 8 * 60 && nowMin < 22 * 60) {
    for (const c of ((snap.kv || {}).countdown_v1 || [])) {
      if (!c || !c.date || !c.title) continue;
      const n = M.dayDiff(c.date, now);
      if (![7, 3, 1, 0].includes(n)) continue;
      const id = `countdown:${c.id}:${today}`;
      if (sent.has(id)) continue;
      out.push({ id, kind: "countdown", title: n ? `距离「${c.title}」还有 ${n} 天` : `今天就是「${c.title}」`, body: n ? `${c.date}，提前准备起来` : "加油！" });
    }
  }
  return out;
}

// 现在是不是在上课（上课时可以只弹上课提醒）
function inClass(snap, now) {
  const nm = now.getHours() * 60 + now.getMinutes();
  return M.coursesOn(snap.courses, now).some((c) => { const a = M.toMin(c.tStart), b = M.toMin(c.tEnd); return a != null && b != null && nm >= a && nm < b; });
}

module.exports = { due, inClass };
