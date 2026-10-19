// 捞捞调度 · 闲时自学（6.8）
// 大家都不用的时候（页面放在后台、几分钟没人操作、或者夜里），捞捞拿本班发布过的事项当「标准答案」自己考自己：
//   1. 先留出一小部分当「考卷」，用学之前的捞捞做一遍，记下准确率；
//   2. 把其余做错的消息逐条学一遍（地名、课程叫法、上课时间、这类说法是什么类型、一模一样的消息怎么整理）；
//   3. 用学过的捞捞再做一遍考卷，看准确率涨了多少；再按本班数据把「参考以前修改」的两个门槛调到最准；
//   4. 考卷也学进去，把学到的东西存起来，下次打开直接用。
// 另外，本地 AI（Ollama 等）开着时，还会把「拿不准」的消息交给本地 AI 当老师，学它的答案（不花 token）。
// 全部在本机算，不上传任何消息；一次只占用很短的空闲时间，有人一操作就停下。
(function (root) {
  "use strict";

  const bigrams = (s) => { const g = new Set(); s = String(s || "").replace(/[\s，。,.!！？?；;:：、~（）()【】\[\]"'“”‘’]/g, ""); for (let i = 0; i + 1 < s.length; i++) g.add(s.slice(i, i + 2)); if (s.length === 1) g.add(s); return g; };
  function simText(a, b) { const A = bigrams(a), B = bigrams(b); if (!A.size || !B.size) return 0; let n = 0; A.forEach((x) => { if (B.has(x)) n++; }); return n / (A.size + B.size - n); }
  function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const day = (et) => String(et || "").slice(0, 10), hm = (et) => String(et || "").slice(11, 16);
  const normLoc = (s) => String(s || "").replace(/\s+/g, "");

  // ---------- 题库：本班发布过的事项（同一段原文的几件事算一道题）+ 班委改过的记录 ----------
  // records：[{ original, msg_type, subject, summary, event_time, location, prepare, publish_date }]
  // feedback：parse_feedback 里的行 [{ text, pub, items, chatter, source }]
  // msgText(original)：把「张三：……」这种原文变成消息正文
  function corpus(records, feedback, msgText) {
    const by = new Map();
    for (const r of records || []) {
      if (!r || !r.original || /^（由/.test(r.original) || !r.msg_type) continue;
      const text = msgText ? msgText(r.original) : r.original;
      if (!text || text.length < 4) continue;
      const k = text.replace(/\s+/g, "");
      if (!by.has(k)) by.set(k, { text, pub: r.publish_date || day(r.event_time) || "", items: [], from: "history" });
      by.get(k).items.push({ msg_type: r.msg_type, subject: r.subject || "", summary: r.summary || "", event_time: r.event_time || "", location: r.location || "", prepare: r.prepare || "" });
    }
    // 班委亲手改过的更可信：同一段原文以改过的为准
    for (const f of feedback || []) {
      if (!f || !f.text || f.source === "forget") continue;
      const k = String(f.text).replace(/\s+/g, "");
      by.set(k, { text: f.text, pub: f.pub || "", items: f.chatter ? [] : (f.items || []).map((x) => Object.assign({}, x)), chatter: !!f.chatter, from: f.source === "ai" ? "ai" : "user" });
    }
    return Array.from(by.values()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.pub));
  }

  // ---------- 打分：一道题做对了几成 ----------
  // 每件事看 5 项：类型、日期、钟点、地点、标题（标题相似就算对）。闲聊题：没整理出事项就算对
  function grade(res, sample) {
    const got = (res.items || []).concat((res.unsure || []).map((u) => u.guess).filter(Boolean));
    if (sample.chatter) { const ok = got.length === 0 ? 1 : 0; return { score: ok, fields: { type: ok }, n: 1 }; }
    const gold = sample.items || [];
    if (!gold.length) return { score: got.length ? 0 : 1, fields: {}, n: 1 };
    const used = new Set(), fields = { type: 0, day: 0, time: 0, loc: 0, subject: 0 }, cnt = { type: 0, day: 0, time: 0, loc: 0, subject: 0 };
    let total = 0, n = 0;
    for (const g of gold) {
      // 找最像的那件：同一天 + 标题相似
      let best = null, bs = -1;
      got.forEach((x, i) => { if (used.has(i)) return; const s = (day(x.event_time) === day(g.event_time) ? 1 : 0) + simText(x.subject, g.subject) + (x.msg_type === g.msg_type ? 0.5 : 0); if (s > bs) { bs = s; best = i; } });
      const x = best == null ? null : got[best]; if (best != null) used.add(best);
      const f = {
        type: x && x.msg_type === g.msg_type ? 1 : 0,
        day: x && day(x.event_time) === day(g.event_time) ? 1 : 0,
        time: !hm(g.event_time) ? null : x && hm(x.event_time) === hm(g.event_time) ? 1 : 0,
        loc: !g.location ? (x && x.location ? 0.5 : 1) : x && (normLoc(x.location) === normLoc(g.location) || normLoc(g.location).includes(normLoc(x.location)) && normLoc(x.location).length >= 2) ? 1 : 0,
        subject: x && (simText(x.subject, g.subject) >= 0.4 || x.subject && g.subject && (g.subject.includes(x.subject) || x.subject.includes(g.subject))) ? 1 : 0,
      };
      let s = 0, k = 0;
      for (const key in f) { if (f[key] == null) continue; fields[key] += f[key]; cnt[key]++; s += f[key]; k++; }
      total += s / k; n++;
    }
    // 多整理出来的（原来没有的）扣一点
    const extra = Math.max(0, got.length - gold.length);
    return { score: Math.max(0, total / n - 0.15 * extra), fields, cnt, n };
  }

  // ---------- 一次自学任务：分很多小步，每步只用一点空闲时间 ----------
  // P：LaoParse；model：createModel() 的结果；samples：corpus() 的结果
  // opts.testShare：留多少当考卷（默认 20%）；opts.max：最多复习多少道题（默认 600，最近的优先）
  function job(P, model, samples, opts) {
    opts = opts || {};
    const max = opts.max || 600;
    const all = samples.slice(-max);
    const test = [], train = [];
    for (const s of all) ((hash(s.text) % 100) < (opts.testShare || 20) ? test : train).push(s);
    if (test.length < 3 && train.length >= 6) Array.prototype.push.apply(test, train.splice(0, 3));
    const st = { phase: "before", i: 0, before: 0, after: 0, learned: 0, rows: [], cfgTried: [], fields: {}, startedAt: Date.now() };
    const parseOne = (s) => { try { return P.parse(s.text, s.pub, { model }); } catch (e) { return { items: [], unsure: [], chatter: [] }; } };
    const learnOne = (s, res) => {
      const items = (s.items || []).map((x) => ({ msg_type: x.msg_type, subject: x.subject || "", summary: x.summary || "", event_time: x.event_time || "", location: x.location || "", prepare: x.prepare || "" }));
      try { model.learn({ text: s.text, pub: s.pub, before: res, items, chatter: !!s.chatter, source: "self" }); } catch (e) { return; }
      const rb = res && ((res.items && res.items[0]) || (res.unsure && res.unsure[0] && res.unsure[0].guess));
      st.rows.push({ text: s.text, pub: s.pub, chatter: !!s.chatter, items, before: rb ? { msg_type: rb.msg_type, subject: rb.subject || "", location: rb.location || "", event_time: rb.event_time || "" } : null });
      st.learned++;
    };
    const CFGS = [{ hi: 0.6, lo: 0.45 }, { hi: 0.55, lo: 0.4 }, { hi: 0.5, lo: 0.38 }, { hi: 0.66, lo: 0.5 }, { hi: 0.72, lo: 0.55 }];
    let cfgI = 0, cfgSum = 0, baseCfg = model.cfg ? Object.assign({}, model.cfg) : CFGS[0];
    function score(list, i) { return grade(parseOne(list[i]), list[i]).score; }
    // 每次调用最多跑 ms 毫秒；返回 true 表示做完了
    function step(ms) {
      const t0 = Date.now();
      while (Date.now() - t0 < (ms || 12)) {
        if (st.phase === "before") {
          if (st.i < test.length) { st.before += score(test, st.i++); continue; }
          st.phase = "learn"; st.i = 0; continue;
        }
        if (st.phase === "learn") {
          if (st.i < train.length) {
            const s = train[st.i++], res = parseOne(s), g = grade(res, s);
            if (g.score < 0.999) learnOne(s, res);           // 做错的才学，做对的不用（省时间，也不把规则本来对的带偏）
            continue;
          }
          st.phase = "tune"; st.i = 0; cfgI = 0; cfgSum = 0; model.setCfg && model.setCfg(CFGS[0]); continue;
        }
        if (st.phase === "tune") {
          if (!model.setCfg || !test.length) { st.phase = "after"; st.i = 0; continue; }
          if (st.i < test.length) { cfgSum += score(test, st.i++); continue; }
          st.cfgTried.push({ cfg: CFGS[cfgI], acc: cfgSum / test.length });
          cfgI++; st.i = 0; cfgSum = 0;
          if (cfgI < CFGS.length) { model.setCfg(CFGS[cfgI]); continue; }
          // 选最准的；一样准就用原来的（不乱动）
          const base = st.cfgTried.find((x) => x.cfg.hi === baseCfg.hi && x.cfg.lo === baseCfg.lo) || st.cfgTried[0];
          const best = st.cfgTried.reduce((a, b) => (b.acc > a.acc + 0.005 ? b : a), base);
          model.setCfg(best.cfg); st.cfg = best.cfg; st.after = best.acc * test.length;
          st.phase = "final"; st.i = 0; continue;
        }
        if (st.phase === "after") {
          if (st.i < test.length) { st.after += score(test, st.i++); continue; }
          st.phase = "final"; st.i = 0; continue;
        }
        if (st.phase === "final") {
          // 考完了，考卷上做错的也学进去
          if (st.i < test.length) { const s = test[st.i++], res = parseOne(s); if (grade(res, s).score < 0.999) learnOne(s, res); continue; }
          st.phase = "done"; st.finishedAt = Date.now(); return true;
        }
        return true;
      }
      return st.phase === "done";
    }
    function report() {
      const n = test.length || 1;
      return { at: st.finishedAt || Date.now(), samples: all.length, test: test.length, train: train.length, before: st.before / n, after: st.after / n,
        learned: st.learned, cfg: st.cfg || (model.cfg ? Object.assign({}, model.cfg) : null), ms: (st.finishedAt || Date.now()) - st.startedAt };
    }
    return { step, report, get phase() { return st.phase; }, get progress() { const tot = test.length * (2 + CFGS.length) + train.length; const done = st.phase === "before" ? st.i : st.phase === "learn" ? test.length + st.i : st.phase === "tune" ? test.length + train.length + cfgI * test.length + st.i : st.phase === "final" ? tot - test.length + st.i : tot; return tot ? Math.min(1, done / tot) : 1; }, rows: () => st.rows.slice() };
  }

  // 把存起来的自学结果重新装进模型（不用再算一遍）
  function replay(model, saved) {
    if (!saved) return 0;
    let n = 0;
    for (const r of saved.rows || []) {
      try { model.learn({ text: r.text, pub: r.pub, before: r.before ? { items: [r.before] } : null, items: r.items || [], chatter: !!r.chatter, source: "self" }); n++; } catch (e) {}
    }
    if (saved.cfg && model.setCfg) model.setCfg(saved.cfg);
    return n;
  }

  // 现在算不算「大家都不用」：页面在后台，或者 idleMs 毫秒没人操作；夜里（23:00~6:00）门槛放低
  function isQuiet(lastInputAt, now, hidden) {
    const d = now ? new Date(now) : new Date(), h = d.getHours(), idle = (d.getTime() - (lastInputAt || 0));
    if (hidden) return idle > 20000;
    return h >= 23 || h < 6 ? idle > 30000 : idle > 120000;
  }
  // 多久自学一次：题库变化大（新发布了不少）或者超过 12 小时
  function due(last, samplesN, now) {
    if (!last) return samplesN >= 4;
    const t = now || Date.now();
    if (samplesN - (last.samples || 0) >= 8) return t - last.at > 10 * 60000;
    return t - last.at > 12 * 3600000 && samplesN >= 4;
  }

  const api = { corpus, grade, job, replay, isQuiet, due, simText };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.LaoTrain = api;
})(typeof window !== "undefined" ? window : globalThis);
