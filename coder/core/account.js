// 捞捞编程 · 捞捞账号（和捞捞课程表、捞捞学习同一个账号）+ 练习进度、连续写代码天数
// 登录用捞捞课程表电脑版同一份接口代码（core/api.js，打包前从 desktop/core 拷来）。
// 进度存在本机 progress.json，登录后同步到账号（user_kv：code_progress_v1 每道题一条，code_days_v1 每天一条）。
"use strict";
const fs = require("fs");
const path = require("path");

const NS_EX = "code_progress_v1", NS_DAY = "code_days_v1";

function dayKey(d = new Date()) {
  // 按北京时间算「今天」
  const t = new Date(d.getTime() + 8 * 3600e3);
  return t.toISOString().slice(0, 10);
}

class Progress {
  constructor(file) { this.file = file; this.data = { ex: {}, days: {}, rev: 0, pending: [] }; try { Object.assign(this.data, JSON.parse(fs.readFileSync(file, "utf8"))); } catch (e) {} }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data)); } catch (e) {} }
  queue(ns, k, v) { this.data.pending = this.data.pending.filter((p) => !(p.ns === ns && p.k === k)); this.data.pending.push({ ns, k, v, t: Date.now() }); }
  // 运行了一次（算今天写了代码）
  ran() { const k = dayKey(); const d = (this.data.days[k] ||= { runs: 0, solved: 0 }); d.runs++; this.queue(NS_DAY, k, d); this.save(); }
  solved(id, lang) {
    const old = this.data.ex[id];
    const v = { done: true, lang, t: Date.now(), first: (old && old.first) || Date.now(), tries: ((old && old.tries) || 0) + 1 };
    this.data.ex[id] = v; this.queue(NS_EX, id, v);
    if (!old || !old.done) { const k = dayKey(); const d = (this.data.days[k] ||= { runs: 0, solved: 0 }); d.solved++; this.queue(NS_DAY, k, d); }
    this.save();
    return !old || !old.done;
  }
  tried(id, lang) {
    const old = this.data.ex[id] || {};
    if (old.done) return;
    const v = { ...old, done: false, lang, t: Date.now(), tries: (old.tries || 0) + 1 };
    this.data.ex[id] = v; this.queue(NS_EX, id, v); this.save();
  }
  // 连续写代码天数（今天还没写的话，从昨天往前数）
  streak(now = new Date()) {
    let n = 0, d = new Date(now.getTime());
    if (!this.data.days[dayKey(d)]) d = new Date(d.getTime() - 864e5);
    while (this.data.days[dayKey(d)] && n < 3650) { n++; d = new Date(d.getTime() - 864e5); }
    return n;
  }
  summary() {
    const today = this.data.days[dayKey()] || { runs: 0, solved: 0 };
    return { ex: this.data.ex, streak: this.streak(), today, solved: Object.values(this.data.ex).filter((x) => x && x.done).length };
  }
  // 账号里的进度合并进来：做对了的算做对了；同一天的次数取大的
  merge(rows) {
    let changed = false;
    for (const r of rows || []) {
      if (!r || !r.v) continue;
      if (r.ns === NS_EX) {
        const a = this.data.ex[r.k], b = r.v;
        if (!a || (b.done && !a.done) || (b.done === a.done && (b.t || 0) > (a.t || 0))) { this.data.ex[r.k] = { ...a, ...b, done: !!(b.done || (a && a.done)) }; changed = true; }
      } else if (r.ns === NS_DAY && /^\d{4}-\d{2}-\d{2}$/.test(r.k)) {
        const a = this.data.days[r.k] || { runs: 0, solved: 0 }, b = r.v;
        const m = { runs: Math.max(a.runs || 0, b.runs || 0), solved: Math.max(a.solved || 0, b.solved || 0) };
        if (m.runs !== a.runs || m.solved !== a.solved) { this.data.days[r.k] = m; changed = true; }
      }
    }
    if (changed) this.save();
    return changed;
  }
}

// api：core/api.js 的 Api；progress：Progress
async function sync(api, progress) {
  if (!api || !(await api.session())) return { ok: false, reason: "没登录" };
  // 1. 先传本机攒着的
  const pend = progress.data.pending.slice();
  for (let i = 0; i < pend.length; i += 200) {
    await api.rpc("udata_push", { p: pend.slice(i, i + 200) });
  }
  progress.data.pending = progress.data.pending.filter((p) => !pend.includes(p));
  // 2. 再拉账号里的（只要编程的两类；其它类的数据也会一起回来，跳过）
  let since = progress.data.rev || 0, rows = [];
  for (let page = 0; page < 20; page++) {
    const r = await api.rpc("udata_pull", { since });
    for (const x of (r && r.rows) || []) if (x.ns === NS_EX || x.ns === NS_DAY) rows.push(x);
    since = (r && r.rev) || since;
    if (!r || !r.more) break;
  }
  progress.data.rev = since;
  progress.merge(rows);
  progress.save();
  return { ok: true, pulled: rows.length, pushed: pend.length };
}

module.exports = { Progress, sync, dayKey, NS_EX, NS_DAY };
