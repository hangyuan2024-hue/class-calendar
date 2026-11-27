// 查实了再回答（core/sources.js + core/research.js）：来源分档、页面检查、时效、转载、空位印证、说法打架、云端审稿、知识卡片
"use strict";
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const S = require("../core/sources");
const R = require("../core/research");
const G = require("../core/ground");
const ok = (m) => console.log("✓", m);
const NOW = Date.parse("2026-11-27T10:00:00+08:00");
const pad = (s) => s + "　相关说明：本页内容仅供参考，具体以官方发布为准。考生应及时关注报考院校发布的复试通知，按要求准备材料，按时参加复试。".repeat(2);

(async () => {
  // ---------- 来源分档（同一个网站，按问题类型档位不同） ----------
  assert.equal(S.typeOf("2026 年考研国家线是多少"), "admission");
  assert.equal(S.typeOf("python 报错 KeyError 怎么办"), "code");
  assert.equal(S.typeOf("今天有什么新闻"), "news");
  assert.equal(S.tierOf("https://yz.chsi.com.cn/kyzx/a.html", "admission"), 1);
  assert.equal(S.tierOf("https://www.moe.gov.cn/x", "policy"), 1);
  assert.equal(S.tierOf("https://jwc.xx.edu.cn/x", "policy"), 1);
  assert.equal(S.tierOf("https://www.news.cn/x", "news"), 1);
  assert.equal(S.tierOf("https://www.thepaper.cn/x", "news"), 2);
  assert.equal(S.tierOf("https://www.zhihu.com/question/1", "news"), 3);
  assert.equal(S.tierOf("https://docs.python.org/3/x", "code"), 1);
  assert.equal(S.tierOf("https://blog.csdn.net/x", "code"), 2, "问编程时 CSDN 可靠");
  assert.equal(S.tierOf("https://blog.csdn.net/x", "policy"), 3, "问政策时 CSDN 只是参考");
  assert.equal(S.tierOf("https://wenku.baidu.com/view/1", "course"), 0);
  assert.equal(S.tierOf("https://www.360doc.com/a", "general"), 0);
  assert.equal(S.tierOf("not a url"), 0);
  assert.equal(S.siteOf("https://gaokao.chsi.com.cn/a"), "chsi.com.cn");
  assert.equal(S.siteOf("https://jwc.abc.edu.cn/a"), "abc.edu.cn");
  assert.equal(S.siteOf("https://news.sina.com.cn/a"), "sina.com.cn");
  ok("来源分档：按问题类型分 权威 / 可靠 / 参考 / 不采用；内容农场直接不要；按注册域名判断是不是同一家");

  // ---------- 页面检查、时效、转载 ----------
  const terms = ["国家", "分数"];
  assert.equal(S.pageProblem({ title: "登录", text: "请先登录后查看全文" + "x".repeat(200) }, terms), "登录页 / 验证页 / 打不开的页面");
  assert.equal(S.pageProblem({ title: "a", text: "国家线 短" }, terms), "正文太短");
  assert.equal(S.pageProblem({ title: "菜谱", text: "红烧肉的做法".repeat(40) }, terms), "内容和问题对不上");
  assert.equal(S.pageProblem({ title: "2026 国家线", text: pad("国家线分数") }, terms), null);
  assert.equal(S.pageProblem({ title: "登录说明", text: "请先登录" + "国家线分数".repeat(400) }, terms), null, "长文章里提到「登录」不算登录页");
  assert.equal(S.dateOf({ url: "https://a.cn/2026/03/14/x.html" }), "2026-03-14");
  assert.equal(S.dateOf({ url: "https://a.cn/x", date: "2025-12-01T08:00" }), "2025-12-01");
  assert.equal(S.dateOf({ url: "https://a.cn/x/123" }), null);
  assert.equal(S.dateOf({ url: "https://yz.chsi.com.cn/kp/202603/20260314/1.html" }), "2026-03-14");
  assert.equal(S.dateOf({ url: "https://a.cn/article/202611271234567" }), null, "长数字串不当日期");
  const now = new Date(NOW);
  assert.deepEqual(S.recencyOf("2026 年国家线", now), { year: 2026 });
  assert.deepEqual(S.recencyOf("今年国家线多少", now), { year: 2026 });
  assert.deepEqual(S.recencyOf("今天的新闻", now), { maxAgeDays: 3 });
  assert.equal(S.recencyOf("勾股定理是什么", now), null);
  const y26 = { year: 2026 };
  assert.ok(/2024 年/.test(S.staleProblem({ url: "https://a.cn/2024/03/01/x" }, y26, now)));
  assert.equal(S.staleProblem({ url: "https://a.cn/2025/12/01/x", text: "2026年全国硕士研究生招生考试报名" }, y26, now), null, "前一年底发的、讲的是要的那一年：算数");
  assert.ok(S.staleProblem({ url: "https://a.cn/2025/12/01/x", text: "2025年复试线" }, y26, now));
  assert.ok(/2023/.test(S.staleProblem({ url: "https://a.cn/x", title: "2023年国家线公布" }, y26, now)), "没日期就看正文里说的是哪年");
  assert.ok(/太旧/.test(S.staleProblem({ url: "https://a.cn/2026/10/01/x" }, { maxAgeDays: 3 }, now)));
  assert.equal(S.staleProblem({ url: "https://a.cn/x" }, { maxAgeDays: 3 }, now), null, "没日期的不硬删");
  const art = "教育部发布2026年全国硕士研究生招生考试考生进入复试的初试成绩基本要求，计算机科学与技术学术学位总分273分，单科满分100分的科目38分，满分大于100分的科目57分。";
  assert.ok(S.similar(art, "转载：" + art + "（来源：研招网）") > 0.8);
  assert.ok(S.similar(art, "二食堂周末营业时间为早上七点到晚上八点，一食堂周末不营业，三食堂照常营业到晚上九点。") < 0.2);
  ok("页面检查：登录页、正文太短、和问题对不上的不要；时效：要某一年的按日期 / 正文年份筛，新闻按天数；转载按正文重合判断");

  // ---------- 网站信誉 ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "research-"));
  const rep = S.reputation(path.join(dir, "rep.json"));
  assert.equal(rep.score("https://a.zhihu.com/x"), 0.5);
  rep.mark("https://a.zhihu.com/x", true); rep.mark("https://www.zhihu.com/y", true); rep.mark("https://b.zhihu.com", false);
  assert.equal(rep.score("https://zhihu.com"), 3 / 5);
  rep.flush();
  assert.equal(S.reputation(path.join(dir, "rep.json")).score("https://zhihu.com"), 3 / 5, "存下来了，下次还在");
  rep.merge({ "zhihu.com": { ok: 10, bad: 0 } });
  assert.equal(rep.score("https://zhihu.com"), 11 / 13);
  ok("网站信誉：被印证 / 被挑错按网站记，次数少的往中间靠；能和别处（全校）合并");

  // ---------- 出主意 ----------
  const rp = R.rulePlan("请问2026年计算机考研国家线是多少？");
  assert.equal(rp.need, "facts"); assert.equal(rp.type, "admission"); assert.equal(rp.slots.length, 1);
  assert.equal(R.rulePlan("帮我写一篇关于秋天的作文").need, "chat");
  assert.equal(R.rulePlan("你好呀").need, "chat");
  const pp = R.parsePlan('好的：{"need":"facts","type":"admission","queries":["a","b","c","d"],"sites":["https://yz.chsi.com.cn/abc","乱写的"],"slots":[{"key":"总分","ask":"总分是多少"},{"key":"","ask":"x"}],"outline":["要点一"]}', "q");
  assert.deepEqual(pp.queries, ["a", "b", "c"]); assert.deepEqual(pp.sites, ["yz.chsi.com.cn"]); assert.deepEqual(pp.slots, [{ key: "总分", ask: "总分是多少" }]);
  assert.equal(R.parsePlan("不是 JSON", "q"), null);
  assert.deepEqual(R.parsePlan('{"need":"facts"}', "问题").slots, [{ key: "答案", ask: "问题" }], "云端没给空位：整个问题当一个");
  ok("出主意：云端的 JSON 程序再整理（搜索词最多 3 个、网站只留域名、空位缺字段的扔掉）；没有云端按规则出");

  // ---------- 摘录：抄的必须真是资料里的话 ----------
  const passage = "教育部公布了分数线。计算机科学与技术学术学位总分273分，单科满分100分的科目38分。其他学科另见附件。";
  assert.equal(R.verifyQuote("计算机科学与技术学术学位总分273分", passage), "计算机科学与技术学术学位总分273分");
  assert.equal(R.verifyQuote("「计算机科学与技术学术学位 总分273分」", passage), "计算机科学与技术学术学位 总分273分", "多了引号、空格：还是原话");
  assert.equal(R.verifyQuote("计算机科学与技术学术学位的总分是273分", passage), "计算机科学与技术学术学位总分273分，单科满分100分的科目38分。", "改了几个字：换成资料里最像的那句原话");
  assert.equal(R.verifyQuote("计算机学硕总分是300分以上", passage), null, "编的：作废");
  assert.equal(R.verifyQuote("没有", passage), null);
  ok("摘录：小模型只照抄原话，程序比对 —— 原样在的用；改了几个字的换回资料原句；编的作废");

  // ---------- 印证规则 ----------
  const c = (site, tier, quote) => ({ site, tier, quote, rep: 0.5, url: "https://" + site + "/x" });
  assert.equal(R.agree("总分273分", "总分为 273 分"), "same");
  assert.equal(R.agree("总分273分", "总分280分"), "conflict");
  assert.equal(R.agree("2026年总分273分", "2026年总分280分"), "conflict", "年份不算一致");
  assert.equal(R.agree("一等奖 8000 元，10 月评选", "一等奖 6000 元，10 月评选"), "conflict", "有一个数字一样也不行");
  assert.equal(R.agree("总分273分", "总分273分，单科38分"), "same", "多说了一个数不算打架");
  assert.equal(R.slotState([]).state, "none");
  assert.equal(R.slotState([c("chsi.com.cn", 1, "总分273分")]).state, "ok");
  assert.equal(R.slotState([c("zhihu.com", 3, "总分273分")]).state, "single", "只有一家参考网站：不算查实");
  assert.equal(R.slotState([c("zhihu.com", 3, "总分273分"), c("zhihu.com", 3, "总分是273分")]).state, "single", "同一个网站说两遍不算印证");
  const two = R.slotState([c("zhihu.com", 3, "总分273分"), c("csdn.net", 3, "今年总分为273分")]);
  assert.equal(two.state, "ok"); assert.equal(two.why, "两个网站说法一致");
  assert.equal(R.slotState([c("zhihu.com", 3, "总分273分"), c("csdn.net", 3, "总分280分")]).state, "single", "两个参考网站打架：都不算");
  assert.equal(R.slotState([c("moe.gov.cn", 1, "总分273分"), c("thepaper.cn", 2, "总分280分")]).state, "conflict", "权威和可靠打架：要判");
  ok("印证：权威来源一家就算；不是权威的要两个不同网站说法一致（数字一样）；权威 / 可靠之间数字不一样 → 打架");

  // ---------- 整条流水线（假网页、假本机模型、假云端） ----------
  const CHSI = "https://yz.chsi.com.cn/kyzx/kp/202603/20260314/1.html";
  const PAGES = {
    "https://www.sohu.com/a/2026x": { title: "转载｜2026考研国家线公布", text: pad("转载：" + art + "（来源：研招网）") },
    [CHSI]: { title: "2026年全国硕士研究生招生考试考生进入复试的初试成绩基本要求", text: pad(art) },
    "https://www.eol.cn/kaoyan/2024/03/12/x.html": { title: "2024年考研国家线", text: pad("2024年计算机科学与技术国家线总分 280 分。") },
    "https://yjs.abc.edu.cn/login": { title: "统一身份认证", text: "请先登录后查看。国家线分数" + "　".repeat(300) },
    "https://wenku.baidu.com/view/1": { title: "国家线文档", text: pad(art) },
  };
  const searches = [], reads = [];
  const web = {
    search: async (q, o = {}) => {
      searches.push(q + (o.site ? "@" + o.site : ""));
      if (/复试分数线/.test(q) || o.site === "chsi.com.cn") return [{ title: "研招网", url: CHSI }];
      return ["https://www.eol.cn/kaoyan/2024/03/12/x.html", "https://yjs.abc.edu.cn/login", "https://wenku.baidu.com/view/1", "https://www.sohu.com/a/2026x"].map((url) => ({ title: PAGES[url].title, url }));
    },
    read: async (u) => { reads.push(u); if (!PAGES[u]) throw new Error("404"); return { url: u, ...PAGES[u] }; },
  };
  const llmSeen = [];
  const llm = { chat: async (ms, opt) => {
    const sys = ms[0].content, user = ms[1].content;
    llmSeen.push({ sys, user, mode: opt.mode });
    if (sys === R.QUOTE_SYS) { const m = /总分\s*\d+分/.exec(user); return { content: m ? user.slice(user.indexOf("计算机"), user.indexOf("分，单科") + 1) : "没有" }; }
    if (sys === G.ANSWER_SYS) return { content: "2026 年计算机科学与技术学术学位国家线总分是 273 分。[1]单科满分 100 分的科目是 38 分。[1]总分比去年低了 5 分。[1]" };
    if (sys === G.CHECK_SYS) return { content: "第1句：有据[1]\n第2句：有据[1]\n第3句：无据" };
    throw new Error("没想到的调用");
  } };
  const cloudSeen = [];
  let reviewFix = '[{"i":1,"fix":"删"}]';
  const cloud = { ok: () => true, chat: async (ms, opt) => {
    cloudSeen.push({ sys: ms[0].content, user: ms[1].content, opt });
    const u = { usage: { prompt_tokens: 100, completion_tokens: 20 } };
    if (ms[0].content.startsWith("你是查资料的策划")) return { ...u, content: '{"need":"facts","type":"admission","queries":["2026 考研国家线 计算机","2026 考研 复试分数线 计算机 学硕"],"sites":["chsi.com.cn"],"slots":[{"key":"总分","ask":"2026年计算机科学与技术学硕国家线总分是多少"}],"outline":["总分","单科线"]}' };
    if (ms[0].content.startsWith("你是审稿人")) return { ...u, content: reviewFix };
    throw new Error("云端没想到的调用：" + ms[0].content.slice(0, 20));
  } };
  const cards = R.cards(path.join(dir, "cards.json"), { now: () => NOW });
  const steps = [];
  const rs = R.create({ llm, cloud, web, reputation: rep, cards, now: () => NOW, onStep: (m) => steps.push(m) });
  const q = "2026年计算机学硕考研国家线总分多少？";
  const r = await rs.answer(q);
  // 云端只看到问题
  assert.equal(cloudSeen[0].user, q); assert.equal(cloudSeen[0].opt.think, false);
  assert.ok(/2026 年 11 月/.test(cloudSeen[0].sys), "告诉云端现在是哪年");
  // 读了哪些、扔了哪些
  assert.ok(!reads.includes("https://wenku.baidu.com/view/1"), "内容农场连读都不读");
  const why = Object.fromEntries(r.rejected.map((x) => [x.url, x.why]));
  assert.ok(/内容农场/.test(why["https://wenku.baidu.com/view/1"]));
  assert.ok(/2024 年/.test(why["https://www.eol.cn/kaoyan/2024/03/12/x.html"]), "旧的（2024 年）作废");
  assert.ok(/登录页/.test(why["https://yjs.abc.edu.cn/login"]));
  assert.ok(/同一篇（转载）/.test(why["https://www.sohu.com/a/2026x"]), "搜狐那篇是研招网的转载：记在研招网名下");
  assert.equal(r.rounds, 2, "第一轮只有一家参考网站（转载），换搜索词再查一轮；第二轮权威来源印证了就停");
  assert.equal(searches.length, 2);
  // 空位
  assert.equal(r.slots[0].state, "ok"); assert.equal(r.slots[0].site, "chsi.com.cn"); assert.equal(r.slots[0].tier, 1);
  assert.equal(r.slots[0].quote, "计算机科学与技术学术学位总分273分");
  // 写回答：资料只给了查实的那段，提纲带上了；编的那句被核对删了，云端审稿说「删」
  const gw = llmSeen.find((x) => x.sys === G.ANSWER_SYS);
assert.ok(gw.user.startsWith("资料：\n[1] （2026年全国硕士研究生招生考试考生进入复试的初试成绩基本要求｜chsi.com.cn·权威，2026-03-14）"));
  assert.ok(gw.user.includes("（回答时照资料覆盖这几点：总分；单科线）"));
  assert.ok(!gw.user.includes("sohu"), "转载的那份不重复给");
  assert.equal(r.text, "2026 年计算机科学与技术学术学位国家线总分是 273 分。[1]单科满分 100 分的科目是 38 分。[1]");
  assert.deepEqual(r.sources.map((s) => [s.src, s.tier]), [[CHSI, 1]]);
  assert.equal(r.abstained, false);
  assert.deepEqual(r.usage, { in: 200, out: 40, calls: 2 }, "云端一共两次：出主意、审稿");
  assert.ok(rep.score(CHSI) > 0.5, "被采用的网站信誉 +1");
  ok("流水线：云端只看问题出主意 → 内容农场不读、旧的 / 登录页扔掉、转载合并到原发网站 → 第一轮没查实换词再查、查实就停 → 照查实的资料写、逐句核对 → 回答带权威出处");

  // ---------- 知识卡片：同样的问题再问，不联网、不花云端 ----------
  assert.equal(cards.list().length, 1);
  const before = [searches.length, cloudSeen.length];
  const r2 = await rs.answer("2026年考研计算机学硕国家线总分多少");
  assert.ok(r2.fromCard); assert.deepEqual([searches.length, cloudSeen.length - 1], before, "只多了审稿（核对没过的那句），没联网、没出主意");
  assert.ok(/273/.test(r2.text));
  assert.equal(cards.find("2025年考研计算机学硕国家线总分多少"), null, "年份不一样：不用这张卡");
  assert.equal(cards.find("考研英语怎么复习"), null);
  const later = R.cards(path.join(dir, "cards.json"), { now: () => NOW + 121 * 864e5 });
  assert.equal(later.find(q), null, "招生考试类的卡片 120 天过期");
  ok("知识卡片：查实过的同类问题直接用当时核实的资料；年份不同不用；按类型过期");

  // ---------- 云端审稿：改的句子也要过程序检查 ----------
  reviewFix = '[{"i":1,"fix":"总分比去年低了 7 分。[1]"},{"i":2,"fix":"单科满分大于100分的科目57分。[1]"}]';
  const r3 = await rs.answer(q, { fresh: true });
  assert.ok(!/低了 7 分/.test(r3.text), "云端改的句子数字资料里没有：不用");
  assert.ok(/单科满分大于100分的科目57分。\[1\]$/.test(r3.text), "资料里有的：补上");
  ok("云端审稿：只把核对没过的句子发过去让它照资料改；改回来的句子数字、出处还要程序再查");

  // ---------- 说法打架、没印证、什么都没查到 ----------
  const P2 = { "https://www.thepaper.cn/a": "据报道，今年某校奖学金一等奖金额为 8000 元，评选在 10 月进行，学生需提交申请表。", "https://www.bjnews.com.cn/b": "某校发布通知：今年一等奖学金金额为 6000 元，评选在 10 月进行，学生需提交申请表。" };
  const web2 = { search: async () => Object.keys(P2).map((url) => ({ title: "某校奖学金", url })), read: async (u) => ({ url: u, title: "某校奖学金金额", text: P2[u] + (/thepaper/.test(u) ? "记者走访发现，不少同学对奖学金评定细则并不了解，有学生表示希望学校公开更多评审信息，便于大家提前准备。" : "通知要求各学院在规定时间内完成初审，并将名单报学生工作部复核，公示期为五个工作日，有异议可向学工部反映。") }) };
  const llm2 = { chat: async (ms) => {
    const sys = ms[0].content, user = ms[1].content;
    if (sys === R.QUOTE_SYS) { const m = /[^。]*一等奖[^。]*元/.exec(user.slice(0, user.indexOf("问题："))); return { content: m ? m[0] : "没有" }; }
    if (sys === G.ANSWER_SYS) return { content: "评选在 10 月进行。[1]" };
    if (sys === G.CHECK_SYS) return { content: "第1句：有据[1]" };
  } };
  const plan2 = { need: "facts", type: "news", queries: ["某校 一等奖学金 金额"], sites: [], slots: [{ key: "一等奖金额", ask: "某校一等奖学金金额是多少" }], outline: [] };
  const r4 = await R.create({ llm: llm2, web: web2, now: () => NOW }).answer("某校一等奖学金多少钱", { plan: plan2 });
  assert.equal(r4.slots[0].state, "conflict", JSON.stringify([r4.rejected, r4.slots, r4.pages]));
  assert.ok(/thepaper\.cn（可靠）说「[^」]*8000 元[^」]*」；bjnews\.com\.cn（可靠）说「[^」]*6000 元[^」]*」|bjnews\.com\.cn（可靠）说「[^」]*6000 元[^」]*」；thepaper\.cn（可靠）说「[^」]*8000 元[^」]*」/.test(r4.text), "没有云端：两家说法程序摆出来：" + r4.text);
  assert.ok(/说法不一致，请以官方发布为准/.test(r4.text));
  const judged = [];
  const cloud2 = { chat: async (ms) => { judged.push(ms[1].content); const two = ms[1].content.split("\n").findIndex((l) => /6000/.test(l)); return { content: `{"pick":${two},"why":"学校发布的通知"}` }; } };
  const r5 = await R.create({ llm: llm2, web: web2, cloud: cloud2, now: () => NOW }).answer("某校一等奖学金多少钱", { plan: plan2 });
  assert.equal(judged.length, 1); assert.ok(judged[0].includes("8000") && judged[0].includes("6000") && judged[0].length < 300, "云端只看到那两句原话");
  assert.equal(r5.slots[0].state, "ok"); assert.ok(/6000/.test(r5.slots[0].quote)); assert.ok(/云端判定/.test(r5.slots[0].why));

  const web3 = { search: async () => [{ title: "x", url: "https://www.zhihu.com/q/1" }], read: async (u) => ({ url: u, title: "某校奖学金", text: pad("回答：听说某校一等奖学金是 9000 元。") }) };
  const r6 = await R.create({ llm: llm2, web: web3, now: () => NOW }).answer("某校一等奖学金多少钱", { plan: { ...plan2, type: "general" } });
  assert.equal(r6.slots[0].state, "single"); assert.ok(/只在 zhihu\.com 查到，没找到第二个来源印证/.test(r6.text));

  const web4 = { search: async () => [{ title: "x", url: "https://www.360doc.com/1" }, { title: "y", url: "https://a.cn/404" }], read: async () => { throw new Error("404"); } };
  const r7 = await R.create({ llm: llm2, web: web4, now: () => NOW }).answer("某校一等奖学金多少钱", { plan: plan2 });
  assert.ok(r7.abstained && r7.text.startsWith(G.ABSTAIN) && /都不能用/.test(r7.text), r7.text);
  assert.equal((await R.create({ llm: llm2, web: web4 }).answer("帮我写一篇作文")).skip, true, "不用查事实的问题：不查");
  ok("说法打架：没云端就把两家说法都摆出来，有云端只发那两句原话请它判；只有一家参考网站的标明没印证；什么都没查到老实说，并说明为什么");

  // ---------- 接进捞小智：问事实 → 先查实，回答直接给出（带来源卡片）；不是事实的照常交给模型 ----------
  const XZ = require("../core/xiaozhi");
  const ev = [], agentCalls = [];
  const llmX = { start: async () => {}, chat: (ms, opt) => {
    if (ms[0].content === R.QUOTE_SYS || ms[0].content === G.ANSWER_SYS || ms[0].content === G.CHECK_SYS) { assert.equal(opt.model, "local", "查实的几步都用本机模型"); return llm.chat(ms, opt); }
    agentCalls.push(ms[ms.length - 1].content);
    const p = Promise.resolve({ content: "你好呀，我是捞小智。", tool_calls: [] }); p.abort = () => {}; return p;
  } };
  searches.length = 0;
  const xz = XZ.create({ dir: path.join(dir, "xz"), llm: llmX, now: () => new Date(NOW), mindmap: false, researchWeb: web, grid: { status: () => ({}) }, onEvent: (e) => ev.push(e) });
  await xz.send(q);
  assert.equal(agentCalls.length, 0, "查实了：不再让模型自己答一遍");
  const card = ev.find((e) => e.type === "tool" && e.name === "research" && e.stage === "done");
  assert.ok(card && card.result.research.slots[0].state === "ok" && card.result.research.rejected.length >= 3, JSON.stringify(ev.filter((e) => e.type !== "delta").slice(0, 30)).slice(0, 2500));
  const said = ev.filter((e) => e.type === "delta").map((e) => e.text).join("");
  assert.ok(/273 分。\[1\]/.test(said) && /来源：\n\[1\] .*chsi\.com\.cn.*（https:\/\/yz\.chsi\.com\.cn/.test(said), said);
  assert.ok(ev[ev.length - 1].type === "done");
  const h = xz.history();
  assert.deepEqual(h.slice(-2).map((m) => m.role), ["user", "assistant"]); assert.equal(h[h.length - 1].content, said, "记进对话历史，接着聊能接上");
  assert.ok(searches.some((x) => /@chsi\.com\.cn$/.test(x)), "没有云端出主意：按规则查，查不实就去权威网站里搜");
  await xz.send("你好");
  assert.equal(agentCalls.length, 1, "打招呼：照常交给模型");
  const bad = xz.sourceBad(CHSI);
  assert.ok(bad.ok && bad.cards >= 1, "点了「来源不对」：用过它的知识卡片作废");
  ok("接进捞小智：问事实先查实，直接给出核对过的回答和来源（不让模型再说一遍）；打招呼照常；「来源不对」会降信誉、删卡片");

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("research：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
