// 捞捞 · PPT 操作工厂的「练习场」：程序随机做一份课件 + 出一道老师式的要求（带标准答案）→ 模型调工具真的去改 → 程序打开改完的文件判对错
//   · 改 PPT 用的就是捞捞PPT助手自己的那一套（pptedit.js + agent.js 的 runPpt），练的和老师用的一模一样
//   · 工具说明、系统提示也是 agent.js 里的原文（训练时给模型看的和老师那边一字不差）
//   · 判对错只看文件：标题是不是那几个字、别的页有没有被误改、颜色是不是红的、页数对不对……不靠模型自己说
//   · 课件全是程序编的（课本上的公开知识点 + 随机版式，故意弄乱：页数、长句、混着表格公式），不用任何老师的真课件
//   · split：train 练习用；exam 考试用（种子不重叠）；ood 考「没练过的」：没练过的工具（复制页、放到最前面、定成具体字号）、没练过的版式（代码页、金句页）
// 训练配方（Python）通过命令行用它：node pptlab.js → 每行一个 JSON 命令，每行回一个 JSON（见文件最后）
"use strict";
const D = require("./deck");
const EDIT = require("./pptedit");
const AGENT = require("./agent");

// ---------- 随机数（同一个种子出同一道题：考试的题每次都一样）----------
function rng(seed) {
  let a = (Number(seed) >>> 0) ^ 0x9e3779b9;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (xs) => xs[Math.floor(next() * xs.length)];
  const shuffle = (xs) => { const o = xs.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; };
  return { next, int, pick, shuffle };
}

// ---------- 课本上的公开知识点（编课件用）----------
const TOPICS = [
  ["数学", "一元二次方程", ["判别式", "求根公式", "配方法", "因式分解", "韦达定理"], "x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}"],
  ["数学", "勾股定理", ["直角三角形", "斜边", "勾股数", "逆定理", "面积法"], "a^2+b^2=c^2"],
  ["数学", "二次函数", ["顶点", "对称轴", "开口方向", "最值", "图像平移"], "y=a(x-h)^2+k"],
  ["数学", "等差数列", ["公差", "通项公式", "前n项和", "等差中项", "递推"], "a_n=a_1+(n-1)d"],
  ["数学", "三角函数", ["正弦", "余弦", "周期", "诱导公式", "单位圆"], "\\sin^2\\alpha+\\cos^2\\alpha=1"],
  ["数学", "导数", ["切线斜率", "单调性", "极值", "求导法则", "最值问题"], "f'(x)=\\lim_{\\Delta x\\to 0}\\frac{f(x+\\Delta x)-f(x)}{\\Delta x}"],
  ["数学", "概率初步", ["随机事件", "古典概型", "频率", "互斥事件", "树状图"], "P(A)=\\frac{m}{n}"],
  ["物理", "牛顿第二定律", ["加速度", "合力", "质量", "受力分析", "单位换算"], "F=ma"],
  ["物理", "欧姆定律", ["电流", "电压", "电阻", "串联电路", "并联电路"], "I=\\frac{U}{R}"],
  ["物理", "动能定理", ["动能", "做功", "合外力", "变力做功", "多过程问题"], "W=\\frac{1}{2}mv_2^2-\\frac{1}{2}mv_1^2"],
  ["物理", "光的折射", ["折射角", "入射角", "折射率", "全反射", "临界角"], "n=\\frac{\\sin i}{\\sin r}"],
  ["化学", "化学反应速率", ["浓度", "温度", "催化剂", "接触面积", "平均速率"], "v=\\frac{\\Delta c}{\\Delta t}"],
  ["化学", "物质的量", ["摩尔", "摩尔质量", "阿伏加德罗常数", "气体摩尔体积", "物质的量浓度"], "n=\\frac{m}{M}"],
  ["化学", "氧化还原反应", ["氧化剂", "还原剂", "电子转移", "化合价", "配平"], "2Na+Cl_2=2NaCl"],
  ["生物", "光合作用", ["叶绿体", "光反应", "暗反应", "二氧化碳", "影响因素"], "6CO_2+6H_2O\\to C_6H_{12}O_6+6O_2"],
  ["生物", "细胞分裂", ["有丝分裂", "减数分裂", "染色体", "纺锤体", "细胞周期"], ""],
  ["语文", "议论文写作", ["论点", "论据", "论证方法", "开头结尾", "素材积累"], ""],
  ["语文", "古诗词鉴赏", ["意象", "意境", "修辞手法", "表达技巧", "思想感情"], ""],
  ["英语", "定语从句", ["关系代词", "关系副词", "先行词", "限制性", "非限制性"], ""],
  ["英语", "现在完成时", ["have done", "since", "for", "already", "yet"], ""],
  ["历史", "辛亥革命", ["武昌起义", "中华民国", "三民主义", "历史意义", "局限性"], ""],
  ["地理", "大气环流", ["三圈环流", "气压带", "风带", "季风", "气候影响"], ""],
  ["信息技术", "冒泡排序", ["相邻比较", "交换", "趟数", "时间复杂度", "优化"], "O(n^2)"],
  ["信息技术", "二分查找", ["有序数组", "中间位置", "缩小范围", "循环条件", "时间复杂度"], "O(\\log n)"],
];
const LINE_T = ["{t}的概念要先记清楚", "用{t}解决实际问题", "{t}常见的错误要注意", "先画图，再找{t}", "{t}和课本例题对照着看", "做完题回头检查{t}", "{t}是这一节的重点", "考试常考{t}的变形"];
const LONG_T = "{t}在实际应用中需要结合具体情境仔细分析，不能生搬硬套公式，还要注意单位和适用条件";
const BODY_T = ["一句话说清{t}是什么", "{t}的关键是找准条件", "从例题里总结{t}的规律", "{t}容易和相近的概念混"];
const CODE = { "冒泡排序": "for (i = 0; i < n - 1; i++)\n  for (j = 0; j < n - 1 - i; j++)\n    if (a[j] > a[j + 1]) swap(&a[j], &a[j + 1]);", "二分查找": "while (lo <= hi) {\n  mid = (lo + hi) / 2;\n  if (a[mid] == x) return mid;\n  if (a[mid] < x) lo = mid + 1; else hi = mid - 1;\n}" };
const fill = (s, t) => s.replace(/\{t\}/g, t);

// 一份课件：train 只用常见的版式；ood 的课件里混着没练过的版式（代码页、金句页）
const TRAIN_LAYOUTS = ["bullets", "bullets", "cards", "steps", "compare", "table", "summary", "section"];
const OOD_LAYOUTS = ["code", "statement"];
function makeSpec(R, split) {
  const [subj, topic, terms, formula] = R.pick(TOPICS);
  const n = R.int(3, split === "train" ? 9 : 8);
  const pages = [];
  const used = new Set();
  const title = (base) => { let x = base, k = 2; while (used.has(x)) x = base + "（" + k++ + "）"; used.add(x); return x; };
  for (let i = 0; i < n; i++) {
    let L = R.pick(TRAIN_LAYOUTS);
    if (split === "ood" && i === 1 + (n > 3 ? R.int(0, 1) : 0)) L = R.pick(OOD_LAYOUTS);
    if (L === "code" && !CODE[topic]) L = "statement";
    const t = R.pick(terms);
    const messy = R.next() < 0.2;
    let p;
    if (L === "bullets" || L === "summary") {
      const k = R.int(3, messy ? 6 : 5);
      p = { layout: L, title: title(L === "summary" ? "课堂小结" : R.pick([`${t}是什么`, `理解${t}`, `${t}的要点`, `再看${t}`, `${topic}：${t}`])), lines: R.shuffle(LINE_T).slice(0, k).map((s) => fill(s, R.pick(terms))) };
      if (messy) p.lines[0] = fill(LONG_T, t);
    } else if (L === "cards") p = { layout: L, title: title(`${topic}的几个概念`), items: R.shuffle(terms).slice(0, R.int(3, 4)).map((x) => ({ head: x, body: fill(R.pick(BODY_T), x) })) };
    else if (L === "steps") p = { layout: L, title: title(`怎么用${t}`), items: ["读题找条件", `写出${t}`, "代入计算", "检查答案"].slice(0, R.int(3, 4)).map((h, j) => ({ head: `第${"一二三四"[j]}步`, body: h })) };
    else if (L === "compare") { const [a, b] = R.shuffle(terms); p = { layout: L, title: title(`${a}和${b}`), left: { head: a, lines: [fill(R.pick(BODY_T), a), `${a}的例子`] }, right: { head: b, lines: [fill(R.pick(BODY_T), b), `${b}的例子`] } }; }
    else if (L === "table") p = { layout: L, title: title(`${topic}知识表`), table: [["知识点", "要点"], ...R.shuffle(terms).slice(0, 3).map((x) => [x, fill(R.pick(BODY_T), x)])] };
    else if (L === "section") p = { layout: L, title: title(`第${"一二三"[R.int(0, 2)]}部分 ${t}`), sub: subj };
    else if (L === "code") p = { layout: L, title: title(`${topic}的代码`), code: CODE[topic], lang: "C", lines: ["先看循环条件", "再看每一步做什么"] };
    else p = { layout: "statement", title: title(`记住${t}`), sub: fill(R.pick(BODY_T), t) };
    pages.push(p);
  }
  return { subj, topic, terms, formula, theme: R.pick(["blue", "blue", "warm", "mono", "berry"]), pages };
}

async function build(spec) {
  const d0 = await EDIT.load(await D.blank({ theme: spec.theme, title: spec.topic, now: new Date(0) }));
  let at = 0;
  await d0.addDesigned(0, { layout: "cover", title: spec.topic, sub: spec.subj + "课" }, { first: true }); at = 1;
  for (const p of spec.pages) { const r = await d0.addDesigned(at, p, { first: false }); at += r.pages || 1; }
  return EDIT.load(await d0.save());   // 重新打开：做课件的过程不算「改动」（撤销不会撤到它）
}

// ---------- 读出一份的样子（判对错用）----------
const runsText = (xml, pred) => [...xml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)].filter((m) => pred(m[1])).map((m) => (/<a:t>([\s\S]*?)<\/a:t>/.exec(m[1]) || [])[1] || "").join("");
// 捞小智排的页：字号倍数记在框的名字里（lz:版式|title?fs=1.15）；排版引擎会按倍数重新排，单看字号不准
const fsOf = (xml) => { const m = /\?fs=([\d.]+)/.exec(xml); return m ? +m[1] : 1; };
const sum = (xs) => xs.reduce((u, v) => u + v, 0);
const sizes = (xml) => [...xml.matchAll(/<a:rPr\b[^>]*\ssz="(\d+)"/g)].map((m) => +m[1]);
async function snap(d) {
  const ol = await d.outline(), pages = [];
  for (const s of ol) { const xml = await d.xml(s.no); pages.push({ no: s.no, title: s.title, layout: s.layout || "", texts: s.texts, formulas: s.formulas || 0, tables: s.tables || 0, notes: String(await d.notes(s.no) || ""), xml }); }
  return { pages, theme: (await d.theme()).key, edits: d.history().length };
}
const titles = (sn) => sn.pages.map((p) => p.title);
const sameExcept = (a, b, skip) => {   // 除了 skip 里的页（按原来的页码），别的页一个字都不能动
  const bad = a.pages.filter((p) => !skip.includes(p.no)).filter((p) => { const q = b.pages.find((x) => x.title === p.title); return !q || q.xml !== p.xml; });
  return bad.length ? `第 ${bad.map((p) => p.no).join("、")} 页不该动却被改了` : null;
};

// ---------- 题目 ----------
// 每一种：make(R, spec, sn) → { user, setup?, history?, check(before, after, x) → null（对）或者为什么错 }
//   x：{ reply 最后说的话, calls 调过的工具名 }
const THEME_NAMES = [["绿色", "green"], ["紫色", "berry"], ["橙色", "orange"], ["黑板风格", "board"], ["深色", "dark"], ["蓝色", "blue"]];
const PHR = ["我们来看", "这一节", "注意", "例题"];
const pickPage = (R, sn, ok = () => true) => { const c = sn.pages.filter((p) => p.no > 1 && ok(p)); return c.length ? R.pick(c) : null; };
const said = (x) => (String(x.reply || "").trim().length >= 2 ? null : "最后没有用一句话告诉老师做了什么");
const FAM = {
  title(R, spec, sn) {
    const p = pickPage(R, sn), to = R.pick(["今天学什么", `${R.pick(spec.terms)}怎么用`, "先想一想", "重点回顾", `${spec.topic}的应用`]);
    if (to === p.title) return null;
    return { ref: [["set_text", { slide: p.no, shape: "title", lines: [to] }]], user: R.pick([`把第 ${p.no} 页的标题改成「${to}」`, `第${p.no}页标题换成：${to}`, `第 ${p.no} 页的标题不好，改成“${to}”吧`]),
      check: (a, b, x) => (b.pages[p.no - 1].title !== to ? `第 ${p.no} 页的标题现在是「${b.pages[p.no - 1].title}」` : sameExcept(a, b, [p.no]) || said(x)) };
  },
  replace_all(R, spec, sn) {
    const all = sn.pages.map((p) => p.texts.join("") + p.title).join("");
    const w = spec.terms.find((t) => all.split(t).length > 2);
    if (!w) return null;
    const to = w + R.pick(["（重点）", "的知识", "概念"]);
    return { ref: [["replace_text", { find: w, replace: to }]], user: R.pick([`把整份 PPT 里的「${w}」都换成「${to}」`, `全文的“${w}”统一改成“${to}”`]),
      check: (a, b, x) => { const left = b.pages.map((p) => (p.texts.join("") + p.title).split(to).join("")).join(""); return left.includes(w) ? `还有没换掉的「${w}」` : !b.pages.some((p) => (p.texts.join("") + p.title).includes(to)) ? `一处「${to}」都没有` : said(x); } };
  },
  relayout(R, spec, sn) {
    const p = pickPage(R, sn, (q) => ["bullets", "cards"].includes(q.layout));
    if (!p) return null;
    const [L, word] = R.pick([["compare", "两栏对比"], ["steps", "步骤"], ["cards", "卡片"], ["table", "表格"]]);
    if (L === p.layout) return null;
    return { ref: [["get_slide", { slide: p.no }], ["edit_slide", L === "compare" ? { slide: p.no, layout: L, left: { head: spec.terms[0], lines: [spec.terms[0] + "的要点"] }, right: { head: spec.terms[1], lines: [spec.terms[1] + "的要点"] } } : L === "table" ? { slide: p.no, layout: L, table: [["知识点", "要点"], ...spec.terms.slice(0, 3).map((x) => [x, x + "的要点"])] } : { slide: p.no, layout: L, items: spec.terms.slice(0, 3).map((x) => ({ head: x, body: x + "的要点" })) }]], user: R.pick([`把第 ${p.no} 页改成${word}的样子`, `第 ${p.no} 页换成${word}版式`, `第${p.no}页用${word}来排`]),
      check: (a, b, x) => (b.pages[p.no - 1].layout !== L ? `第 ${p.no} 页现在是「${b.pages[p.no - 1].layout}」，不是${word}` : b.pages.length !== a.pages.length ? "页数变了" : said(x)) };
  },
  theme(R, spec, sn) {
    const [word, key] = R.pick(THEME_NAMES);
    if (key === sn.theme) return null;
    return { ref: [["set_theme", { theme: key }]], user: R.pick([`整份换成${word}的`, `配色改成${word}`, `换个${word}的主题`]), check: (a, b, x) => (b.theme !== key ? `配色现在是 ${b.theme}，不是${word}` : said(x)) };
  },
  add_page(R, spec, sn) {
    const p = pickPage(R, sn), t = R.pick(spec.terms), k = R.int(2, 4);
    return { ref: [["add_slide", { after: p.no, layout: "bullets", title: `理解${t}`, lines: [`${t}的定义`, `${t}的用法`, `${t}的例题`, `${t}的易错点`].slice(0, k) }]], user: R.pick([`在第 ${p.no} 页后面加一页，讲「${t}」，写 ${k} 条要点`, `第${p.no}页后面插一页讲${t}，${k}条要点就行`]),
      check: (a, b, x) => { if (b.pages.length !== a.pages.length + 1) return `页数从 ${a.pages.length} 变成了 ${b.pages.length}`; const q = b.pages[p.no]; if (!q.title.includes(t) && !q.texts.join("").includes(t)) return `第 ${p.no + 1} 页没讲「${t}」`; if (q.texts.length < k) return `要 ${k} 条要点，只有 ${q.texts.length} 条`; return said(x); } };
  },
  delete_ask(R, spec, sn) {
    const p = pickPage(R, sn);
    return { ref: [], refReply: `确定要删第 ${p.no} 页「${p.title}」吗？`, user: R.pick([`第 ${p.no} 页删了吧`, `把第 ${p.no} 页删掉`]),
      check: (a, b, x) => (b.pages.length !== a.pages.length ? "老师没确认就删了（规矩：删页前先问一句）" : /确定|确认|吗|？|\?/.test(x.reply || "") ? null : "没有问老师确不确定要删") };
  },
  delete_confirm(R, spec, sn) {
    const p = pickPage(R, sn);
    return { ref: [["delete_slide", { slide: p.no }]], history: [{ role: "user", content: `把第 ${p.no} 页删掉` }, { role: "assistant", content: `确定要删第 ${p.no} 页「${p.title}」吗？` }], user: R.pick(["确定", "对，删吧", "嗯，删掉"]),
      check: (a, b, x) => (b.pages.length !== a.pages.length - 1 ? "页数没少一页" : b.pages.some((q) => q.title === p.title) && a.pages.filter((q) => q.title === p.title).length === 1 ? `「${p.title}」那一页还在` : said(x)) };
  },
  move(R, spec, sn) {
    if (sn.pages.length < 4) return null;
    const p = pickPage(R, sn), to = R.int(2, sn.pages.length);
    if (to === p.no) return null;
    return { ref: [["move_slide", { slide: p.no, to }]], user: R.pick([`把第 ${p.no} 页挪到第 ${to} 页`, `第${p.no}页放到第${to}页的位置`]),
      check: (a, b, x) => (b.pages[to - 1].title !== p.title ? `第 ${to} 页现在是「${b.pages[to - 1].title}」` : b.pages.length !== a.pages.length ? "页数变了" : said(x)) };
  },
  notes(R, spec, sn) {
    const p = pickPage(R, sn), t = `这一页先请同学说说对${R.pick(spec.terms)}的理解`;
    return { ref: [["set_notes", { slide: p.no, text: t }]], user: R.pick([`给第 ${p.no} 页写备注：${t}`, `第${p.no}页备注里写上“${t}”`]),
      check: (a, b, x) => (!b.pages[p.no - 1].notes.includes(t.slice(0, 10)) ? `第 ${p.no} 页的备注里没有这句话` : sameExcept(a, b, [p.no]) || said(x)) };
  },
  formula(R, spec, sn) {
    if (!spec.formula || /O\(/.test(spec.formula)) return null;
    const p = pickPage(R, sn, (q) => ["bullets", "cards", "compare"].includes(q.layout));
    if (!p) return null;
    return { ref: [["insert_formula", { slide: p.no, latex: spec.formula }]], user: R.pick([`在第 ${p.no} 页插入公式 ${spec.formula}`, `第${p.no}页加一个公式：$${spec.formula}$`]),
      check: (a, b, x) => (b.pages[p.no - 1].formulas !== a.pages[p.no - 1].formulas + 1 ? `第 ${p.no} 页没有多一个公式` : sameExcept(a, b, [p.no]) || said(x)) };
  },
  format(R, spec, sn) {
    const p = pickPage(R, sn, (q) => q.texts.some((t) => t.length >= 6));
    if (!p) return null;
    const line = R.pick(p.texts.filter((t) => t.length >= 6)), k = R.int(0, Math.max(0, line.length - 4)), w = line.slice(k, k + R.int(3, 4));
    if (/\s/.test(w)) return null;
    const [cw, hex] = R.pick([["标红", "D92D20"], ["标成蓝色", "1D4ED8"]]);
    return { ref: [["format_text", { slide: p.no, find: w, color: hex === "D92D20" ? "红" : "蓝" }]], user: R.pick([`把第 ${p.no} 页的「${w}」${cw}`, `第${p.no}页里“${w}”这几个字${cw}`]),
      check: (a, b, x) => (!runsText(b.pages[p.no - 1].xml, (r) => r.includes(`val="${hex}"`)).includes(w) ? `第 ${p.no} 页的「${w}」没有变颜色` : sameExcept(a, b, [p.no]) || said(x)) };
  },
  font(R, spec, sn) {
    const p = pickPage(R, sn), big = R.next() < 0.5;
    return { ref: [["set_font_size", { slide: p.no, scale: big ? 1.15 : 0.87 }]], user: R.pick([`第 ${p.no} 页的字${big ? "大" : "小"}一点`, `把第${p.no}页的字调${big ? "大" : "小"}些`]),
      check: (a, b, x) => { const f0 = fsOf(a.pages[p.no - 1].xml), f1 = fsOf(b.pages[p.no - 1].xml), s0 = sum(sizes(a.pages[p.no - 1].xml)), s1 = sum(sizes(b.pages[p.no - 1].xml));
        const up = f1 > f0 + 1e-6 || (f1 === f0 && s1 > s0), down = f1 < f0 - 1e-6 || (f1 === f0 && s1 < s0);
        return big ? (up ? said(x) : "字没有变大") : (down ? said(x) : "字没有变小"); } };
  },
  table(R, spec, sn) {
    const p = pickPage(R, sn, (q) => q.layout === "bullets");
    if (!p) return null;
    const [u, v] = R.shuffle(spec.terms);
    return { ref: [["insert_table", { slide: p.no, rows: [["知识点", "例子"], [u, u + "的例子"], [v, v + "的例子"]] }]], user: `在第 ${p.no} 页放一张表格，两列：知识点、例子；两行分别是${u}和${v}`,
      check: (a, b, x) => (b.pages[p.no - 1].tables !== a.pages[p.no - 1].tables + 1 && !(b.pages[p.no - 1].layout === "table" && a.pages[p.no - 1].layout !== "table") ? `第 ${p.no} 页没有多一张表格` : said(x)) };
  },
  undo(R, spec, sn) {
    const p = pickPage(R, sn), to = "随便写的标题";
    return { ref: [["undo", {}]], setup: [["set_text", { slide: p.no, shape: "title", lines: [to] }]], history: [
      { role: "user", content: `把第 ${p.no} 页标题改成「${to}」` },
      { role: "assistant", content: "", tool_calls: [{ id: "call_0", type: "function", function: { name: "set_text", arguments: JSON.stringify({ slide: p.no, shape: "title", lines: [to] }) } }] },
      { role: "tool", tool_call_id: "call_0", name: "set_text", content: "$SETUP0" },
      { role: "assistant", content: `第 ${p.no} 页的标题改成了「${to}」。` }], user: R.pick(["不对，改回去", "刚才那一步撤销", "还是原来的好，撤销吧"]),
      before: "setup0", check: (a, b, x) => (b.pages[p.no - 1].title !== p.title ? `第 ${p.no} 页的标题没有改回「${p.title}」` : said(x)) };
  },
  multi(R, spec, sn) {
    const p = pickPage(R, sn), to = "本节重点", [word, key] = R.pick(THEME_NAMES.filter(([, k]) => k !== sn.theme));
    if (p.title === to) return null;
    return { ref: [["set_text", { slide: p.no, shape: "title", lines: [to] }], ["set_theme", { theme: key }]], user: `两件事：第 ${p.no} 页标题改成「${to}」，然后整份换成${word}的`,
      check: (a, b, x) => (b.pages[p.no - 1].title !== to ? `第 ${p.no} 页标题没改` : b.theme !== key ? "配色没换" : said(x)) };
  },
  chat(R, spec, sn) {
    const t = R.pick(spec.terms);
    return { ref: [], refReply: `讲${t}可以先从一个生活里的例子引入，再给出定义，最后配一道例题让学生自己试。`, user: R.pick([`顺便问一下，${t}一般怎么给学生讲？`, `${t}是什么意思？简单说说`]),
      check: (a, b, x) => (b.edits !== a.edits ? "老师只是问问题，却改了 PPT" : String(x.reply || "").length < 10 ? "没好好回答" : null) };
  },
  // ---- 下面三种只在 ood（考「没练过的」）里出：练的时候一次都没见过这些工具 ----
  copy(R, spec, sn) {
    const p = pickPage(R, sn);
    return { ref: [["copy_slide", { slide: p.no }]], user: `把第 ${p.no} 页复制一份`, check: (a, b, x) => (b.pages.length !== a.pages.length + 1 || b.pages[p.no].title.replace(/（.*$/, "") !== p.title.replace(/（.*$/, "") ? "没有在后面多出一份一样的" : said(x)) };
  },
  front(R, spec, sn) {
    const t = R.pick(spec.terms);
    return { ref: [["add_slide", { after: 0, layout: "bullets", title: `理解${t}`, lines: [`${t}的定义`, `${t}的用法`, `${t}的例题`] }]], user: `在最前面加一页，讲「${t}」，三条要点`, check: (a, b, x) => (b.pages.length !== a.pages.length + 1 ? "页数没多一页" : !(b.pages[0].title + b.pages[0].texts.join("")).includes(t) ? "第 1 页不是新加的那一页" : said(x)) };
  },
  font_exact(R, spec, sn) {
    const p = pickPage(R, sn, (q) => q.layout === "bullets");
    if (!p) return null;
    const pt = R.pick([20, 24, 28]);
    return { ref: [["get_slide", { slide: p.no }], ["set_font_size", { slide: p.no, shape: "$LINE1", size: pt }]], user: `第 ${p.no} 页第一条要点的字号定成 ${pt} 磅`, check: (a, b, x) => (!sizes(b.pages[p.no - 1].xml).includes(pt * 100) ? `第 ${p.no} 页没有 ${pt} 磅的字` : said(x)) };
  },
};
const TRAIN_FAM = ["title", "title", "replace_all", "relayout", "relayout", "theme", "add_page", "add_page", "delete_ask", "delete_confirm", "move", "notes", "formula", "format", "format", "font", "table", "undo", "multi", "multi", "chat"];
const OOD_FAM = ["copy", "front", "font_exact", "title", "relayout", "format"];

// ---------- 一道题 ----------
// seed 决定一切；split：train / exam / ood（exam 的种子从 1e9 开始、ood 从 2e9 开始，和练习的不重叠）
const tasks = new Map();
let nextId = 1;
async function task(seed, split = "train") {
  for (let tryN = 0; tryN < 40; tryN++) {
    const R = rng(seed * 131 + tryN + (split === "exam" ? 1e9 : split === "ood" ? 2e9 : 0));
    const spec = makeSpec(R, split);
    let d;
    try { d = await build(spec); } catch (e) { continue; }
    const sn = await snap(d);
    sn.theme = spec.theme;
    const fam = R.pick(split === "ood" ? OOD_FAM : TRAIN_FAM);
    const t = FAM[fam](R, spec, sn);
    if (!t) continue;
    const pre = [];
    for (const [name, a] of t.setup || []) pre.push(await AGENT.runPpt(d, name, a, []));
    const before = t.before === "setup0" ? sn : await snap(d);
    const history = (t.history || []).map((m) => (m.content === "$SETUP0" ? { ...m, content: JSON.stringify(pre[0]).slice(0, 6000) } : m));
    // 参考做法里要先看了才知道的（比如「第一条要点是第几个框」）：现在就查好
    const ref = [];
    for (const [name, a] of t.ref || []) {
      if (a.shape === "$LINE1") { const sl = await d.slide(a.slide), x = sl.shapes.find((y) => y.name === "第 1 条要点"); if (!x) { ref.length = 0; break; } ref.push([name, { ...a, shape: String(x.shape) }]); }
      else ref.push([name, a]);
    }
    if ((t.ref || []).length && !ref.length) continue;
    const id = nextId++;
    tasks.set(id, { d, t, before, fam, split, seed, ref });
    const system = AGENT.SYSTEM + `\n\n现在打开的 PPT：${spec.topic}.pptx，一共 ${sn.pages.length} 页。`;
    return { id, fam, split, system, tools: AGENT.toolSchema(), messages: [...history, { role: "user", content: t.user }], nref: ref.length };
  }
  throw new Error("出不了题（种子 " + seed + "）");
}
async function tool(id, name, args) {
  const k = tasks.get(id);
  if (!k) throw new Error("没有这道题：" + id);
  return AGENT.runPpt(k.d, name, args || {}, []);
}
// 程序写的示范：按参考做法一步步调工具（真的改），每一步配一句汇报，最后一句总结。
//   模型几次都没做对的题，用它当示范（对错照样由 check 判过才算）
async function demo(id) {
  const k = tasks.get(id);
  if (!k) throw new Error("没有这道题：" + id);
  const msgs = [], said = [];
  let n = 0;
  for (const [name, a] of k.ref) {
    const cid = "call_" + n++;
    msgs.push({ role: "assistant", content: "", tool_calls: [{ id: cid, type: "function", function: { name, arguments: JSON.stringify(a) } }] });
    let res; try { res = await AGENT.runPpt(k.d, name, a, []); } catch (e) { res = { error: e.message }; }
    msgs.push({ role: "tool", tool_call_id: cid, name, content: JSON.stringify(res).slice(0, 6000) });
    if (!AGENT.READS.has(name)) said.push(AGENT.say(name, a));
  }
  const reply = k.t.refReply || (said.length ? "好了：" + said.join("，") + "。" : "好的。");
  msgs.push({ role: "assistant", content: reply });
  return { messages: msgs, reply, calls: k.ref.map((x) => x[0]) };
}
async function check(id, reply, calls) {
  const k = tasks.get(id);
  if (!k) throw new Error("没有这道题：" + id);
  const after = await snap(k.d);
  after.theme = (await k.d.theme()).key;
  let why;
  try { why = k.t.check(k.before, after, { reply: reply || "", calls: calls || [] }); } catch (e) { why = "判不了：" + e.message; }
  return { ok: !why, why: why || null, fam: k.fam };
}

module.exports = { task, tool, check, demo, close: (id) => tasks.delete(id), rng, makeSpec, TOPICS, FAM, TRAIN_FAM, OOD_FAM };

// ---------- 命令行：给训练配方（Python）用 ----------
// 每行一个命令：{"op":"task","seed":1,"split":"train"} / {"op":"tool","id":1,"name":"set_text","args":{...}} / {"op":"check","id":1,"reply":"...","calls":[...]} / {"op":"close","id":1}
// 每行回一个：{"ok":true,...结果} 或 {"ok":false,"error":"..."}
if (require.main === module) {
  const rl = require("readline").createInterface({ input: process.stdin });
  let chain = Promise.resolve();
  rl.on("line", (line) => {
    chain = chain.then(async () => {
      let m; try { m = JSON.parse(line); } catch (e) { return; }
      let out;
      try {
        if (m.op === "task") out = { ok: true, ...(await task(+m.seed || 0, m.split || "train")) };
        else if (m.op === "tool") out = { ok: true, result: await tool(m.id, m.name, m.args) };
        else if (m.op === "demo") out = { ok: true, ...(await demo(m.id)) };
        else if (m.op === "check") { const c = await check(m.id, m.reply, m.calls); out = { ok: true, pass: c.ok, why: c.why, fam: c.fam }; }
        else if (m.op === "close") { tasks.delete(m.id); out = { ok: true }; }
        else if (m.op === "ping") out = { ok: true, pong: 1 };
        else out = { ok: false, error: "不认得的命令：" + m.op };
      } catch (e) { out = { ok: false, error: String(e && e.message || e) }; }
      process.stdout.write(JSON.stringify(out) + "\n");
    });
  });
  rl.on("close", () => { chain.then(() => process.exit(0)); });
}
