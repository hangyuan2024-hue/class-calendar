// 捞小智 · 资料靠不靠谱：来源分档、页面检查、时效、去掉转载、网站信誉
//   查资料的地基：不信任何单个网页。每个网页先过这里：
//   · 分档（按问题类型）：1 权威（政府、学校、考试院、官方媒体、教材 / 官方文档）2 可靠（主流媒体、大教程站）3 参考（问答、博客、社区）
//     0 不要（内容农场、营销号聚合站）。同一个网站，问政策时和问编程时档位可以不一样
//   · 页面检查：登录页、验证页、404、正文太短、标题和问题对不上的不要
//   · 时效：问「今年 / 最新 / 某一年」的，按发布日期筛，旧的作废
//   · 转载：和另一个网页正文几乎一样的，只留更权威 / 更早的那家
//   · 信誉：每个网站被印证过多少次、被挑出错多少次，记下来（同档里靠谱的往前排）
"use strict";
const fs = require("fs");
const path = require("path");

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch (e) { return ""; } };
const under = (h, d) => h === d || h.endsWith("." + d);
// 注册域名（gaokao.chsi.com.cn → chsi.com.cn）：判断「两家是不是同一家」用
function siteOf(u) {
  const h = hostOf(u); if (!h) return "";
  const p = h.split(".");
  const two = /^(com|net|org|gov|edu|ac)\.cn$/.test(p.slice(-2).join("."));
  return p.slice(two ? -3 : -2).join(".");
}

// ---------- 问题类型 ----------
//   policy 政策规定通知（学校、教育部、考试）· admission 招生考试分数线 · news 新闻时事 · course 课程知识 · code 编程技术
//   health 健康医学 · law 法律 · general 其他事实
const TYPE_RE = [
  ["admission", /分数线|国家线|录取|招生|考研|高考|报名时间|准考证|复试|调剂|保研|专升本|四六级|四级|六级|考试时间|成绩查询/],
  ["policy", /政策|规定|通知|办法|条例|文件|要求|流程|怎么办理|申请|奖学金|助学金|补贴|学分|学籍|毕业|请假|校历|放假|开学|教务/],
  ["law", /法律|法规|法典|刑法|民法|合同法|劳动法|违法|判几年|诉讼|起诉/],
  ["health", /病|症状|药|医院|治疗|疫苗|感染|发烧|过敏|剂量|副作用/],
  ["code", /代码|编程|报错|error|exception|函数|python|java|c\+\+|c语言|javascript|sql|linux|git|编译|算法实现|bug/i],
  ["news", /新闻|最新|最近|今天|昨天|本周|发生了|事件|热点|发布会|宣布/],
  ["course", /定理|公式|原理|概念|定义|怎么推导|证明|是什么意思|区别|作用|原因|历史|朝代|作者|发明|元素|化学|物理|生物|地理/],
];
function typeOf(q) { for (const [t, re] of TYPE_RE) if (re.test(q)) return t; return "general"; }

// ---------- 分档表 ----------
const GOV = (h) => /\.gov\.cn$/.test(h) || h === "gov.cn";
const EDU = (h) => /\.edu\.cn$/.test(h);
const OFFICIAL_MEDIA = ["news.cn", "xinhuanet.com", "people.com.cn", "cctv.com", "cctv.cn", "chinanews.com", "chinanews.com.cn", "gmw.cn", "cnr.cn", "chinadaily.com.cn", "ce.cn", "youth.cn", "cri.cn", "china.com.cn", "qstheory.cn"];
const EXAM = ["chsi.com.cn", "neea.edu.cn", "eol.cn", "gaokao.cn", "moe.gov.cn"];
const MAIN_MEDIA = ["thepaper.cn", "bjnews.com.cn", "caixin.com", "yicai.com", "jiemian.com", "21jingji.com", "jfdaily.com", "xinmin.cn", "dzwww.com", "ynet.com", "huanqiu.com", "stcn.com", "cls.cn", "kankanews.com", "ifeng.com", "sina.com.cn", "163.com", "qq.com", "sohu.com"];
const TEXTBOOK = ["icourse163.org", "xuetangx.com", "zhihuishu.com", "chaoxing.com", "cnki.net", "wanfangdata.com.cn", "baike.baidu.com", "baike.com", "pep.com.cn", "nhc.gov.cn", "dxy.cn", "chinacdc.cn", "npc.gov.cn", "court.gov.cn", "flk.npc.gov.cn"];
const TECH_DOC = ["docs.python.org", "runoob.com", "w3school.com.cn", "developer.mozilla.org", "cppreference.com", "oschina.net", "gitee.com", "aliyun.com", "cloud.tencent.com", "huaweicloud.com", "learn.microsoft.com", "python.org", "biancheng.net"];
const COMMUNITY = ["zhihu.com", "csdn.net", "cnblogs.com", "juejin.cn", "jianshu.com", "51cto.com", "segmentfault.com", "douban.com", "bilibili.com", "tieba.baidu.com", "zhidao.baidu.com", "weibo.com", "toutiao.com", "baijiahao.baidu.com", "mp.weixin.qq.com", "xiaohongshu.com", "douyin.com", "kuaishou.com", "smzdm.com", "hupu.com"];
// 内容农场、聚合抄袭、营销号：不要
const BLOCK = ["360doc.com", "docin.com", "doc88.com", "book118.com", "wenku.baidu.com", "zybang.com", "xuexila.com", "ruiwen.com", "unjs.com", "oh100.com", "yjbys.com", "51test.net", "chazidian.com", "wenda.so.com", "iask.sina.com.cn", "kuaiwenyun.com", "jingyanlib.com", "bmcx.com", "zuowen8.com", "diyifanwen.com", "fwsir.com", "5068.com", "gkstk.com", "ixueshu.com"];
const inList = (h, list) => list.some((d) => under(h, d));

// → 1 权威 / 2 可靠 / 3 参考 / 0 不要
function tierOf(url, type = "general") {
  const h = hostOf(url); if (!h) return 0;
  if (inList(h, BLOCK)) return 0;
  const gov = GOV(h), edu = EDU(h), off = inList(h, OFFICIAL_MEDIA), exam = inList(h, EXAM), main = inList(h, MAIN_MEDIA), book = inList(h, TEXTBOOK), tech = inList(h, TECH_DOC), comm = inList(h, COMMUNITY);
  switch (type) {
    case "policy": case "admission":
      if (gov || edu || exam) return 1;
      if (off) return 2;
      return 3;
    case "news":
      if (off || gov) return 1;
      if (main) return 2;
      return 3;
    case "law":
      if (gov || under(h, "npc.gov.cn") || under(h, "court.gov.cn")) return 1;
      if (off || edu) return 2;
      return 3;
    case "health":
      if (gov || under(h, "nhc.gov.cn") || under(h, "chinacdc.cn")) return 1;
      if (under(h, "dxy.cn") || off || edu) return 2;
      return 3;
    case "code":
      if (tech) return 1;
      if (edu || under(h, "csdn.net") || under(h, "cnblogs.com") || under(h, "juejin.cn") || under(h, "segmentfault.com")) return 2;
      return 3;
    case "course":
      if (book || edu || gov) return 1;
      if (off || tech) return 2;
      return 3;
    default:
      if (gov || edu || off || book) return 1;
      if (main || exam || tech) return 2;
      return 3;
  }
}
const TIER_NAME = { 1: "权威", 2: "可靠", 3: "参考", 0: "不采用" };

// ---------- 页面检查 ----------
//   → null（可以用）/ 原因（为什么不用）
const JUNK = /请(先)?登录|登录后(查看|阅读)|扫码登录|安全验证|人机验证|验证码|访问(受限|过于频繁)|页面(不存在|找不到|已删除)|404 Not Found|Page Not Found|内容已(被)?删除|该内容(暂时)?无法查看|请开启 JavaScript|enable javascript|网页无法访问/i;
function pageProblem(p, qTerms = []) {
  if (!p || !p.text) return "没读到内容";
  const t = String(p.text), title = String(p.title || "");
  const head = (title + "\n" + t.slice(0, 400));
  if (JUNK.test(head) && t.length < 1500) return "登录页 / 验证页 / 打不开的页面";
  if (t.replace(/\s/g, "").length < 60) return "正文太短";   // 短讯也就一百来字，不能卡太死；登录页、空壳页上面已经挡了
  // 标题、正文都和问题一个词都对不上
  if (qTerms.length && !qTerms.some((w) => (title + t).toLowerCase().includes(w.toLowerCase()))) return "内容和问题对不上";
  return null;
}

// ---------- 时效 ----------
// 网页的日期：读网页时取到的 date，没有就从网址（/2026/11/27、20261127、2026-11-27）找
function dateOf(p) {
  if (p && p.date && /^\d{4}-\d{2}-\d{2}/.test(p.date)) return p.date.slice(0, 10);
  const u = String((p && (p.url || p.src)) || "");
  // 先找完整的 20260314，再找 2026/03/14、2026-3-14（「202603/20260314」不能读成 3 月 20 日）
  const m = /(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/.exec(u) || /(?<!\d)(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})(?!\d)/.exec(u);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  return null;
}
// 问题对时效的要求：{ year?: 2026（要某一年的）, maxAgeDays?: 3（新闻要很新）} 或 null（不讲究）
function recencyOf(q, now = new Date(), type = typeOf(q)) {
  const y = now.getFullYear();
  const m = /(20\d{2})\s*年/.exec(q);
  if (m) return { year: +m[1] };
  if (/今年|本年度|这一届|今年的/.test(q)) return { year: y };
  if (/去年/.test(q)) return { year: y - 1 };
  if (/今天|今日|刚刚|昨天|昨日/.test(q)) return { maxAgeDays: 3 };
  if (/本周|这周|最近|最新|近期|现在/.test(q)) return { maxAgeDays: type === "news" ? 10 : 400 };
  if (type === "news") return { maxAgeDays: 30 };
  return null;
}
// 网页满不满足时效 → null（满足 / 不讲究）/ 原因
function staleProblem(p, rec, now = new Date()) {
  if (!rec) return null;
  const d = dateOf(p);
  const text = String((p && p.title) || "") + " " + String((p && p.text) || "").slice(0, 600);
  if (rec.year) {
    // 发布在前一年、但讲的是要的那一年（「2027 年高考报名」2026 年底就发了）→ 算数；更早的、或者没提到那一年的 → 旧了
    if (d && +d.slice(0, 4) < rec.year && !(+d.slice(0, 4) === rec.year - 1 && text.includes(String(rec.year)))) return `是 ${d.slice(0, 4)} 年的，要的是 ${rec.year} 年`;
    if (!d) { const ys = [...text.matchAll(/(20\d{2})\s*年/g)].map((x) => +x[1]); if (ys.length && !ys.includes(rec.year) && Math.max(...ys) < rec.year) return `说的是 ${Math.max(...ys)} 年的，要的是 ${rec.year} 年`; }
    return null;
  }
  if (rec.maxAgeDays) {
    if (!d) return null;   // 没日期的不硬删，排序时靠后
    const age = (now - new Date(d + "T00:00:00")) / 864e5;
    if (age > rec.maxAgeDays) return `${d} 发的，太旧了`;
  }
  return null;
}

// ---------- 转载：正文几乎一样的算一份 ----------
function shingles(t) {
  const s = String(t || "").replace(/[\s\p{P}]/gu, "").slice(0, 3000), out = new Set();
  for (let i = 0; i + 8 <= s.length; i++) out.add(s.slice(i, i + 8));   // 每个位置都取（转载常在开头加几个字，隔着取会整体错位）
  return out;
}
function similar(a, b) {
  const A = a instanceof Set ? a : shingles(a), B = b instanceof Set ? b : shingles(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}

// ---------- 网站信誉：被印证 / 被挑错的次数，存在本机（以后可以全校共享） ----------
function reputation(file) {
  let d = {};
  try { d = JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch (e) {}
  let dirty = false, t = null;
  const save = () => { if (!file || !dirty) return; dirty = false; try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + ".tmp", JSON.stringify(d)); fs.renameSync(file + ".tmp", file); } catch (e) {} };
  const later = () => { dirty = true; if (!t) { t = setTimeout(() => { t = null; save(); }, 2000); t.unref && t.unref(); } };
  return {
    // 印证过一次（ok）/ 被挑出错一次（bad）
    mark(url, good) { const s = siteOf(url); if (!s) return; const x = d[s] || (d[s] = { ok: 0, bad: 0 }); good ? x.ok++ : x.bad++; x.at = Date.now(); later(); },
    // 0~1，没记录的 0.5；次数少的往 0.5 靠（贝叶斯平滑）
    score(url) { const x = d[siteOf(url)]; return x ? (x.ok + 1) / (x.ok + x.bad + 2) : 0.5; },
    get: () => d,
    merge(other) { for (const [k, v] of Object.entries(other || {})) { const x = d[k] || (d[k] = { ok: 0, bad: 0 }); x.ok = Math.max(x.ok, +v.ok || 0); x.bad = Math.max(x.bad, +v.bad || 0); } later(); },
    flush: save,
  };
}

module.exports = { typeOf, tierOf, TIER_NAME, pageProblem, dateOf, recencyOf, staleProblem, shingles, similar, reputation, siteOf, hostOf, BLOCK };
