// 捞捞编程 · 外面的题库：力扣（leetcode.cn）、Codeforces
// 只拿题目列表（编号、标题、难度、知识点、通过率）和你自己公开的做题记录；题目内容不搬进软件，点「去做」在浏览器里打开原网站。
// 拿到的列表存在本机（judge-cache.json），7 天更新一次；断网 / 网站改了接口时用自带的一份常见题（SEED），照样能推荐。
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");

// ---------- 知识点：各网站的标签 → 统一的中文名（和本地练习的 topic 也对得上） ----------
const TAGS = {
  array: "数组", string: "字符串", "hash-table": "哈希表", math: "数学", sorting: "排序", "two-pointers": "双指针",
  "binary-search": "二分查找", "linked-list": "链表", stack: "栈", queue: "队列", recursion: "递归", "dynamic-programming": "动态规划",
  greedy: "贪心", simulation: "模拟", "bit-manipulation": "位运算", matrix: "二维数组", "sliding-window": "滑动窗口",
  "prefix-sum": "前缀和", backtracking: "回溯", "depth-first-search": "搜索", "breadth-first-search": "搜索", tree: "树", "binary-tree": "树",
  "divide-and-conquer": "分治", counting: "计数", "number-theory": "数学", enumeration: "枚举", "heap-priority-queue": "堆", memoization: "动态规划",
  // Codeforces 的标签
  implementation: "模拟", sortings: "排序", "brute force": "枚举", strings: "字符串", dp: "动态规划", "binary search": "二分查找",
  "two pointers": "双指针", "number theory": "数学", "constructive algorithms": "构造", "dfs and similar": "搜索", graphs: "图", trees: "树",
  "bitmasks": "位运算", "data structures": "数据结构", combinatorics: "数学", geometry: "数学",
};
const tagName = (t) => TAGS[t] || TAGS[String(t).toLowerCase()] || "";

// ---------- 自带的常见题（力扣，适合学 C 的同学；题号、标题、难度、知识点） ----------
// [题号, slug, 中文标题, 难度 E/M/H, 知识点（用上面的 slug）, 大约的通过率 %]
const SEED_LC = [
  [1, "two-sum", "两数之和", "E", "array hash-table", 54],
  [9, "palindrome-number", "回文数", "E", "math", 58],
  [13, "roman-to-integer", "罗马数字转整数", "E", "hash-table math string", 63],
  [14, "longest-common-prefix", "最长公共前缀", "E", "string", 44],
  [20, "valid-parentheses", "有效的括号", "E", "stack string", 44],
  [21, "merge-two-sorted-lists", "合并两个有序链表", "E", "linked-list recursion", 67],
  [26, "remove-duplicates-from-sorted-array", "删除有序数组中的重复项", "E", "array two-pointers", 55],
  [27, "remove-element", "移除元素", "E", "array two-pointers", 60],
  [35, "search-insert-position", "搜索插入位置", "E", "array binary-search", 47],
  [58, "length-of-last-word", "最后一个单词的长度", "E", "string", 46],
  [66, "plus-one", "加一", "E", "array math", 46],
  [67, "add-binary", "二进制求和", "E", "bit-manipulation math string simulation", 53],
  [69, "sqrtx", "x 的平方根", "E", "math binary-search", 39],
  [70, "climbing-stairs", "爬楼梯", "E", "memoization math dynamic-programming", 55],
  [83, "remove-duplicates-from-sorted-list", "删除排序链表中的重复元素", "E", "linked-list", 54],
  [88, "merge-sorted-array", "合并两个有序数组", "E", "array two-pointers sorting", 53],
  [118, "pascals-triangle", "杨辉三角", "E", "array dynamic-programming", 76],
  [121, "best-time-to-buy-and-sell-stock", "买卖股票的最佳时机", "E", "array dynamic-programming", 58],
  [125, "valid-palindrome", "验证回文串", "E", "two-pointers string", 47],
  [136, "single-number", "只出现一次的数字", "E", "bit-manipulation array", 74],
  [141, "linked-list-cycle", "环形链表", "E", "hash-table linked-list two-pointers", 52],
  [169, "majority-element", "多数元素", "E", "array hash-table divide-and-conquer counting sorting", 66],
  [191, "number-of-1-bits", "位1的个数", "E", "bit-manipulation divide-and-conquer", 77],
  [202, "happy-number", "快乐数", "E", "hash-table math two-pointers", 64],
  [206, "reverse-linked-list", "反转链表", "E", "recursion linked-list", 74],
  [217, "contains-duplicate", "存在重复元素", "E", "array hash-table sorting", 55],
  [242, "valid-anagram", "有效的字母异位词", "E", "hash-table string sorting", 66],
  [268, "missing-number", "丢失的数字", "E", "bit-manipulation array hash-table math binary-search sorting", 65],
  [283, "move-zeroes", "移动零", "E", "array two-pointers", 64],
  [344, "reverse-string", "反转字符串", "E", "two-pointers string", 79],
  [349, "intersection-of-two-arrays", "两个数组的交集", "E", "array hash-table two-pointers binary-search sorting", 74],
  [387, "first-unique-character-in-a-string", "字符串中的第一个唯一字符", "E", "queue hash-table string counting", 55],
  [412, "fizz-buzz", "Fizz Buzz", "E", "math string simulation", 69],
  [448, "find-all-numbers-disappeared-in-an-array", "找到所有数组中消失的数字", "E", "array hash-table", 65],
  [509, "fibonacci-number", "斐波那契数", "E", "recursion memoization math dynamic-programming", 66],
  [704, "binary-search", "二分查找", "E", "array binary-search", 55],
  [709, "to-lower-case", "转换成小写字母", "E", "string", 77],
  [977, "squares-of-a-sorted-array", "有序数组的平方", "E", "array two-pointers sorting", 68],
  [1480, "running-sum-of-1d-array", "一维数组的动态和", "E", "array prefix-sum", 88],
  [1672, "richest-customer-wealth", "最富有客户的资产总量", "E", "array matrix", 88],
  [2, "add-two-numbers", "两数相加", "M", "recursion linked-list math", 43],
  [3, "longest-substring-without-repeating-characters", "无重复字符的最长子串", "M", "hash-table string sliding-window", 39],
  [5, "longest-palindromic-substring", "最长回文子串", "M", "two-pointers string dynamic-programming", 38],
  [11, "container-with-most-water", "盛最多水的容器", "M", "greedy array two-pointers", 60],
  [15, "3sum", "三数之和", "M", "array two-pointers sorting", 37],
  [19, "remove-nth-node-from-end-of-list", "删除链表的倒数第 N 个结点", "M", "linked-list two-pointers", 47],
  [33, "search-in-rotated-sorted-array", "搜索旋转排序数组", "M", "array binary-search", 44],
  [34, "find-first-and-last-position-of-element-in-sorted-array", "在排序数组中查找元素的第一个和最后一个位置", "M", "array binary-search", 43],
  [48, "rotate-image", "旋转图像", "M", "array math matrix", 77],
  [53, "maximum-subarray", "最大子数组和", "M", "array divide-and-conquer dynamic-programming", 55],
  [54, "spiral-matrix", "螺旋矩阵", "M", "array matrix simulation", 50],
  [55, "jump-game", "跳跃游戏", "M", "greedy array dynamic-programming", 43],
  [56, "merge-intervals", "合并区间", "M", "array sorting", 50],
  [62, "unique-paths", "不同路径", "M", "math dynamic-programming", 68],
  [64, "minimum-path-sum", "最小路径和", "M", "array dynamic-programming matrix", 70],
  [75, "sort-colors", "颜色分类", "M", "array two-pointers sorting", 61],
  [78, "subsets", "子集", "M", "bit-manipulation array backtracking", 81],
  [198, "house-robber", "打家劫舍", "M", "array dynamic-programming", 54],
  [200, "number-of-islands", "岛屿数量", "M", "depth-first-search breadth-first-search array matrix", 60],
  [215, "kth-largest-element-in-an-array", "数组中的第K个最大元素", "M", "array divide-and-conquer sorting heap-priority-queue", 63],
  [238, "product-of-array-except-self", "除自身以外数组的乘积", "M", "array prefix-sum", 75],
  [300, "longest-increasing-subsequence", "最长递增子序列", "M", "array binary-search dynamic-programming", 55],
  [322, "coin-change", "零钱兑换", "M", "breadth-first-search array dynamic-programming", 48],
  [912, "sort-an-array", "排序数组", "M", "array divide-and-conquer sorting heap-priority-queue", 50],
  [4, "median-of-two-sorted-arrays", "寻找两个正序数组的中位数", "H", "array binary-search divide-and-conquer", 42],
  [42, "trapping-rain-water", "接雨水", "H", "stack array two-pointers dynamic-programming", 63],
];

// 难度 → 分数（和 skill.js 的能力分同一把尺子，刚学完数组大约 1000）：力扣简单 ~1100、中等 ~1500、困难 ~1900，再按通过率微调
function lcDiff(d, acRate) {
  const base = { E: 1100, M: 1500, H: 1900, EASY: 1100, MEDIUM: 1500, HARD: 1900 }[String(d).toUpperCase()] || 1500;
  if (acRate == null || isNaN(acRate)) return base;
  const r = acRate > 1 ? acRate : acRate * 100;   // 有的接口给 0.56，有的给 56
  return Math.round(base + Math.max(-180, Math.min(180, (55 - r) * 6)));
}
// Codeforces 的 rating 800 大约等于力扣简单偏易
const cfDiff = (rating) => (rating ? rating + 250 : 1500);

const lcUrl = (slug) => `https://leetcode.cn/problems/${slug}/`;
const cfUrl = (c, i) => `https://codeforces.com/problemset/problem/${c}/${i}`;

function seed() {
  return SEED_LC.map(([no, slug, title, d, tags, ac]) => ({
    id: "lc:" + slug, src: "lc", no: String(no), title, diff: lcDiff(d, ac), ac, level: { E: "简单", M: "中等", H: "困难" }[d],
    tags: [...new Set(tags.split(" ").map(tagName).filter(Boolean))], url: lcUrl(slug),
  }));
}

// ---------- 联网 ----------
function req(method, url, body, headers = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body == null ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const r = https.request({ method, hostname: u.hostname, path: u.pathname + u.search, timeout: timeoutMs,
      headers: { "User-Agent": "Mozilla/5.0 LaolaoCode-Desktop", Accept: "application/json", ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...headers } }, (res) => {
      let s = ""; res.setEncoding("utf8");
      res.on("data", (c) => { s += c; if (s.length > 3e7) r.destroy(new Error("太大了")); });
      res.on("end", () => { if (res.statusCode >= 400) return reject(new Error("网站返回 " + res.statusCode)); try { resolve(JSON.parse(s)); } catch (e) { reject(new Error("网站返回的不是数据（可能改版了）")); } });
    });
    r.on("timeout", () => r.destroy(new Error("连接超时")));
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

const LC_GQL = "https://leetcode.cn/graphql/";
const LC_LIST = `query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
    hasMore total questions { acRate difficulty frontendQuestionId paidOnly title titleCn titleSlug topicTags { slug } }
  }
}`;
async function fetchLeetcode(max = 3000) {
  const out = [];
  for (let skip = 0; skip < max; skip += 100) {
    const r = await req("POST", LC_GQL, { query: LC_LIST, variables: { categorySlug: "algorithms", skip, limit: 100, filters: {} } }, { Referer: "https://leetcode.cn/problemset/" });
    const d = r && r.data && r.data.problemsetQuestionList;
    if (!d || !Array.isArray(d.questions)) throw new Error("力扣的题目列表拿不到（可能改版了）");
    for (const q of d.questions) {
      if (q.paidOnly || !/^\d+$/.test(String(q.frontendQuestionId))) continue;   // 会员题、剑指 Offer 那种编号不要
      out.push({ id: "lc:" + q.titleSlug, src: "lc", no: String(q.frontendQuestionId), title: q.titleCn || q.title, diff: lcDiff(q.difficulty, q.acRate),
        level: { EASY: "简单", MEDIUM: "中等", HARD: "困难" }[String(q.difficulty).toUpperCase()] || "", ac: q.acRate,
        tags: [...new Set((q.topicTags || []).map((t) => tagName(t.slug)).filter(Boolean))], url: lcUrl(q.titleSlug) });
    }
    if (!d.hasMore) break;
  }
  if (!out.length) throw new Error("力扣没返回题目");
  return out;
}
// 你在力扣上最近做出来的题（公开的；要在力扣「个人主页」里能看到才行）
const LC_RECENT = `query recentACSubmissions($userSlug: String!) { recentACSubmissions(userSlug: $userSlug) { submitTime question { titleSlug difficulty } } }`;
async function leetcodeRecent(user) {
  const r = await req("POST", LC_GQL, { query: LC_RECENT, variables: { userSlug: user } }, { Referer: `https://leetcode.cn/u/${encodeURIComponent(user)}/` });
  const list = r && r.data && r.data.recentACSubmissions;
  if (!Array.isArray(list)) throw new Error((r && r.errors && r.errors[0] && r.errors[0].message) || "没找到这个力扣用户（要填个人主页地址里 /u/ 后面那一段）");
  return list.map((x) => ({ id: "lc:" + x.question.titleSlug, t: (+x.submitTime || 0) * 1000 }));
}

async function fetchCodeforces() {
  const r = await req("GET", "https://codeforces.com/api/problemset.problems");
  if (!r || r.status !== "OK") throw new Error("Codeforces 题目列表拿不到");
  return r.result.problems.filter((p) => p.rating && p.rating <= 2000 && p.type === "PROGRAMMING").map((p) => ({
    id: `cf:${p.contestId}${p.index}`, src: "cf", no: `${p.contestId}${p.index}`, title: p.name, diff: cfDiff(p.rating), level: String(p.rating),
    tags: [...new Set((p.tags || []).map(tagName).filter(Boolean))], url: cfUrl(p.contestId, p.index),
  }));
}
async function codeforcesSolved(handle) {
  const r = await req("GET", `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=1000`);
  if (!r || r.status !== "OK") throw new Error((r && r.comment) || "没找到这个 Codeforces 用户");
  const seen = new Map();
  for (const s of r.result) if (s.verdict === "OK" && s.problem && s.problem.contestId) { const id = `cf:${s.problem.contestId}${s.problem.index}`; if (!seen.has(id)) seen.set(id, (s.creationTimeSeconds || 0) * 1000); }
  return [...seen].map(([id, t]) => ({ id, t }));
}

// ---------- 本机缓存 ----------
class Bank {
  constructor(file) { this.file = file; this.data = { lc: null, cf: null, at: {}, err: {} }; try { Object.assign(this.data, JSON.parse(fs.readFileSync(file, "utf8"))); } catch (e) {} }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data)); } catch (e) {} }
  list() {
    const lc = this.data.lc && this.data.lc.length ? this.data.lc : seed();
    return lc.concat(this.data.cf || []);
  }
  status() { const lcN = (this.data.lc || []).length; return { lc: lcN || seed().length, lcLive: !!lcN, cf: (this.data.cf || []).length, at: this.data.at, err: this.data.err }; }
  stale(src, days = 7) { return !this.data.at[src] || Date.now() - this.data.at[src] > days * 864e5; }
  async refresh(src) {
    try {
      const l = src === "cf" ? await fetchCodeforces() : await fetchLeetcode();
      this.data[src] = l; this.data.at[src] = Date.now(); delete this.data.err[src]; this.save();
      return l.length;
    } catch (e) { this.data.err[src] = e.message; this.save(); throw e; }
  }
}

module.exports = { Bank, seed, tagName, lcDiff, cfDiff, leetcodeRecent, codeforcesSolved, fetchLeetcode, fetchCodeforces, SEED_LC };
