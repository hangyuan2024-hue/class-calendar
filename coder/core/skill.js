// 捞捞编程 · 看你做题的情况，估计你现在的水平，推荐「跳一跳够得着」的题
//
// 怎么估：每个人一个总分，每个知识点（数组、字符串、排序……）各一个分，起点 1000（刚学完输入输出）。
// 每做一道题（软件里的练习，或者力扣 / Codeforces 上的题），按国际象棋等级分（Elo）的办法更新：
//   预期能做出来的概率 E = 1 / (1 + 10^((题目难度 − 你的分) / 400))
//   你的分 += K × (这次的表现 − E)
// 表现：一次就对 1；改了几次才对 0.9~0.6；问了捞捞才做出来再减一点；看了题解才会 0.4；没做出来 0。
// 比预期做得好就涨，比预期差就降；刚开始 K 大（几道题就能找准水平），做得多了 K 变小（分数稳定）。
//
// 怎么推荐：难度比你现在高一点点（+40 分左右，做出来的把握四五成）、最弱的知识点优先、从没碰过的知识点给一点机会，
// 已经做过 / 跳过的不推，同一个知识点不连着推。
"use strict";
const fs = require("fs");
const path = require("path");

const START = 1000;
const LEVELS = [[900, "刚起步"], [1100, "入门"], [1300, "初级"], [1500, "进阶"], [1750, "熟练"], [2000, "高手"], [Infinity, "大神"]];
const levelName = (r) => LEVELS.find(([m]) => r < m)[1];
const ADV = new Set(["动态规划", "回溯", "分治", "堆", "图", "位运算", "搜索", "树", "构造", "滑动窗口"]);
const expect = (r, d) => 1 / (1 + Math.pow(10, (d - r) / 400));

// 软件里练习的 topic（中文）→ 知识点
const TOPIC_MAP = [
  [/排序/, "排序"], [/二分/, "二分查找"], [/双指针/, "双指针"], [/字符串|字符/, "字符串"], [/二维数组|矩阵/, "二维数组"], [/数组/, "数组"],
  [/递归/, "递归"], [/指针/, "指针"], [/结构体/, "结构体"], [/栈/, "栈"], [/队列/, "队列"], [/链表/, "链表"], [/动态规划|dp/i, "动态规划"],
  [/素数|约数|公约|取余|数字|运算符|数学|浮点/, "数学"], [/循环/, "循环"], [/if|选择|switch|判断/, "分支"], [/输入|输出|format/, "输入输出"],
  [/字典|集合|哈希/, "哈希表"], [/枚举/, "枚举"], [/模拟/, "模拟"],
];
function topicTags(topic) { const t = String(topic || ""); const out = []; for (const [re, n] of TOPIC_MAP) if (re.test(t) && !out.includes(n)) out.push(n); return out.length ? out : ["基础"]; }
// 软件里练习的难度：level 1/2/3 → 分数
const exDiff = (level) => ({ 1: 850, 2: 1050, 3: 1250, 4: 1450 }[level] || 1000);

class Skill {
  constructor(file) {
    this.file = file;
    this.d = { r: START, n: 0, tags: {}, done: {}, skip: {}, log: [], accounts: {} };
    try { Object.assign(this.d, JSON.parse(fs.readFileSync(file, "utf8"))); } catch (e) {}
  }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d)); } catch (e) {} }
  K() { return Math.max(20, 56 - this.d.n * 1.6); }

  /**
   * 记一次做题。p：{ id, title, diff, tags, src }；score：0~1 的表现；opt.how：一句话（给记录看）
   * 返回分数变化（给界面显示「+18」）
   */
  record(p, score, opt = {}) {
    if (!p || !p.id) return 0;
    const before = this.d.r, K = this.K() * (opt.weight || 1);
    const e = expect(this.d.r, p.diff);
    this.d.r = Math.round(this.d.r + K * (score - e));
    // 知识点：每个知识点各自更新（没记过的从总分开始）
    for (const t of p.tags || []) {
      const x = (this.d.tags[t] ||= { r: before, n: 0 });
      const kt = Math.max(24, 64 - x.n * 4) * (opt.weight || 1);
      x.r = Math.round(x.r + kt * (score - expect(x.r, p.diff)));
      x.n++;
    }
    this.d.n++;
    if (score >= 0.5) this.d.done[p.id] = Date.now();
    delete this.d.skip[p.id];
    this.d.log.unshift({ id: p.id, title: p.title, src: p.src || "", s: score, d: p.diff, t: Date.now(), how: opt.how || "", delta: this.d.r - before });
    this.d.log = this.d.log.slice(0, 200);
    this.save();
    return this.d.r - before;
  }
  skip(id, days = 30) { this.d.skip[id] = Date.now() + days * 864e5; this.save(); }
  unskip(id) { delete this.d.skip[id]; this.save(); }
  isDone(id) { return !!this.d.done[id]; }

  // 软件里的练习：检查通过 / 没通过
  exercise(ex, pass, tries, askedAi) {
    const p = { id: "ex:" + ex.id, title: ex.title, diff: exDiff(ex.level), tags: topicTags(ex.topic), src: "ex" };
    if (pass) { const s = Math.max(0.6, 1 - 0.1 * Math.max(0, (tries || 1) - 1)) - (askedAi ? 0.15 : 0); return this.record(p, s, { how: tries > 1 ? `改了 ${tries} 次做对` : "一次做对", weight: 0.8 }); }
    // 没通过：只在第 3 次、第 6 次没过时扣一点（每次检查都扣会扣太多）
    if (tries === 3 || tries === 6) return this.record(p, 0.2, { how: `检查了 ${tries} 次还没过`, weight: 0.5 });
    return 0;
  }

  // 外面的题：自己点「做出来了 / 看了题解 / 没做出来 / 太简单」
  static SCORE = { easy: 1, solved: 0.95, hint: 0.4, failed: 0, auto: 1, samples: 0.85, accepted: 1 };
  external(p, how) {
    const s = Skill.SCORE[how]; if (s == null) return 0;
    const words = { easy: "太简单了", solved: "做出来了", hint: "看了题解才会", failed: "没做出来", auto: "在网站上做出来了（自动同步）", samples: "样例全对（本地判）", accepted: "力扣判题通过" };
    return this.record(p, s, { how: words[how], weight: how === "easy" ? 1.3 : how === "auto" ? 0.6 : how === "samples" ? 0.7 : 1 });
  }

  summary(allTags) {
    const tags = Object.entries(this.d.tags).map(([t, x]) => ({ t, r: x.r, n: x.n })).sort((a, b) => b.n - a.n);
    const weak = tags.filter((x) => x.n >= 2).sort((a, b) => a.r - b.r).slice(0, 3).map((x) => x.t);
    const strong = tags.filter((x) => x.n >= 2).sort((a, b) => b.r - a.r).slice(0, 3).map((x) => x.t);
    return { r: this.d.r, level: levelName(this.d.r), n: this.d.n, tags, weak, strong, log: this.d.log.slice(0, 20), done: Object.keys(this.d.done).length, accounts: this.d.accounts, next: LEVELS.find(([m]) => this.d.r < m)[0] };
  }

  /**
   * 推荐 n 道。list：题库（judge.js 的格式）；opt.src：只要某个网站的（"lc" / "cf" / ""）；opt.tag：只要某个知识点
   */
  recommend(list, n = 6, opt = {}) {
    const R = this.d.r, now = Date.now();
    const seenTags = this.d.tags;
    const cand = list.filter((p) => !this.d.done[p.id] && !(this.d.skip[p.id] > now) && (!opt.src || p.src === opt.src) && (!opt.tag || (p.tags || []).includes(opt.tag)));
    const target = R + 40;
    const scored = cand.map((p) => {
      let s = -Math.abs(p.diff - target) / 120;           // 难度离「跳一跳够得着」越近越好
      const why = [];
      const prob = expect(R, p.diff);
      let weakest = null;
      for (const t of p.tags || []) {
        const x = seenTags[t];
        if (!x) { if (!(R < 1300 && ADV.has(t))) { s += 0.2; if (!weakest) weakest = { t, fresh: true }; } continue; }
        const gap = (R - x.r) / 200;                       // 这个知识点比你的总分低多少
        if (gap > 0) { s += Math.min(1.2, gap * 0.8); if (!weakest || weakest.fresh || x.r < weakest.r) weakest = { t, r: x.r }; }
      }
      if (weakest && !weakest.fresh) why.push(`练练你还弱一点的「${weakest.t}」`);
      else if (weakest && weakest.fresh) why.push(`试试还没碰过的「${weakest.t}」`);
      why.push(prob > 0.7 ? "不难，可以热热身" : prob > 0.35 ? "比你现在的水平高一点点，正好" : "有挑战，做出来涨分多");
      if ((p.tags || []).length === 0) s -= 0.3;
      // 刚起步：先练数组、字符串、数学这些基础的，动态规划、回溯这些等水平上来了再推
      if (R < 1300) s -= Math.min(0.6, (p.tags || []).filter((t) => ADV.has(t) && !seenTags[t]).length * 0.3);
      return { ...p, score: s + Math.random() * 0.08, prob: Math.round(prob * 100), why: why.join("；") };
    }).sort((a, b) => b.score - a.score);
    // 知识点不扎堆：已经选了的知识点再出现就扣分
    const out = [], used = {};
    for (const p of scored) {
      if (out.length >= n) break;
      const rep = (p.tags || []).reduce((m, t) => Math.max(m, used[t] || 0), 0);
      if (rep >= 2 && scored.length > n * 3) continue;
      out.push(p); for (const t of p.tags || []) used[t] = (used[t] || 0) + 1;
    }
    return out;
  }
}

module.exports = { Skill, expect, levelName, topicTags, exDiff, START };
