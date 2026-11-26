// 多个助手一起干活（core/team.js）+ 省 token（agent.js 压缩历史、xiaozhi.js 提示词不变的部分在前）
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os");
const TEAM = require("../core/team");
const AG = require("../core/agent");
const ok = (m) => console.log("✓ " + m);
const P = (v, ms = 20) => { const p = new Promise((r) => setTimeout(() => r(v), ms)); p.abort = () => {}; return p; };

(async () => {
  // ---------- 助手们同时做：干活模型、不带历史、只能查、限长、出错照实交 ----------
  const calls = []; let live = 0, peak = 0;
  const llm = { chat: (msgs, opt) => {
    calls.push({ msgs, opt }); live++; peak = Math.max(peak, live);
    const u = msgs[1].content, done = (v) => { const p = P(v, 30); p.then(() => live--); return p; };
    if (/第 3 件/.test(u)) { const p = Promise.reject(new Error("网断了")); p.abort = () => {}; live--; return p; }
    if (/第 1 件/.test(u) && msgs.length === 2) return done({ content: "", tool_calls: [{ id: "t1", function: { name: "web_search", arguments: '{"q":"A 校"}' } }] });
    if (/第 2 件/.test(u)) return done({ content: "长".repeat(5000), tool_calls: [] });
    return done({ content: "结论：" + u.slice(0, 10), tool_calls: [] });
  } };
  const ran = [];
  const tools = [{ name: "web_search", desc: "搜", params: { q: { type: "string" } }, run: async (a) => { ran.push(a.q); return { hits: ["x"] }; } },
    { name: "apply_leave", desc: "请假", params: {}, run: async () => { throw new Error("不该被调"); } }];
  const ev = [];
  const team = TEAM.create({ llm, tools: () => tools, worker: () => "deepseek/deepseek-flash", workerName: () => "DeepSeek · Flash", onEvent: (e) => ev.push(e), concurrency: 2 });
  await assert.rejects(team.run({ tasks: [{ title: "一件", todo: "做" }] }), /至少两件/);
  const r = await team.run({ goal: "比较三所学校的计算机专业", tasks: [{ title: "A 校", todo: "查 A 校" }, { title: "B 校", todo: "查 B 校" }, { title: "C 校", todo: "查 C 校" }, { title: "D 校", todo: "查 D 校" }] });
  assert.equal(r.helpers, 4); assert.equal(r.ok, 3); assert.equal(r.results[2].ok, false); assert.match(r.results[2].error, /网断了/);
  assert.ok(r.results[1].result.length < 1700 && /后面省了/.test(r.results[1].result), "每份结果限长");
  assert.match(r.results[0].result, /结论/); assert.deepEqual(ran, ["A 校"], "助手能联网查");
  assert.ok(calls.every((c) => c.opt.model === "deepseek/deepseek-flash" && c.opt.think === false), "用干活模型、不开思考");
  assert.ok(calls.every((c) => c.msgs.length <= 4 && /总任务：比较三所学校/.test(c.msgs[1].content)), "不带整段对话，只有总任务和自己那一件");
  const names = new Set(calls.flatMap((c) => (c.opt.tools || []).map((t) => t.function.name))); assert.ok(names.has("web_search") && !names.has("apply_leave"), "只能查、不能办");
  assert.ok(peak <= 2, "同时做的不超过设定的个数（" + peak + "）");
  assert.ok(ev.some((e) => e.stage === "plan" && e.tasks.length === 4) && ev.filter((e) => e.stage === "done").length === 4, "进度报给界面");
  ok("多个助手同时做：用便宜的干活模型、不开思考、只拿总任务和自己那件；只能查不能办；结果限长；做不成的照实交；同时做几个可以设");

  const solo = TEAM.create({ llm, tools: () => [], worker: () => "local", concurrency: 3 }); peak = 0;
  await solo.run({ tasks: [{ title: "甲", todo: "做甲" }, { title: "乙", todo: "做乙" }] }); assert.equal(peak, 1, "本机模型一次只做一件");
  ok("干活模型是本机：一件一件做");

  // ---------- 省 token：上一句以前的长工具结果、长回答压短；超过预算从最早的丢 ----------
  const seen = [];
  const big = "课表".repeat(2000);
  const fake = { start: async () => {}, chat: (msgs, opt) => { seen.push(JSON.parse(JSON.stringify(msgs))); const last = msgs[msgs.length - 1];
    if (last.role === "user" && /课表/.test(last.content)) return P({ content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "get_timetable", arguments: "{}" } }] }, 1);
    return P({ content: last.role === "tool" ? "长回答".repeat(800) : "好的", tool_calls: [] }, 1); } };
  const ag = AG.create({ llm: fake, deck: () => null, ppt: false, tools: [{ name: "get_timetable", desc: "课表", params: {}, run: async () => ({ text: big }) }], system: "规则", maxResult: 6000 });
  await ag.send("看看我的课表");
  const first = seen[seen.length - 1]; assert.ok(first.find((m) => m.role === "tool").content.length > 3900, "这一句里工具结果是全的");
  await ag.send("那明天呢");
  const after = seen[seen.length - 1];
  assert.ok(after.find((m) => m.role === "tool").content.length < 400, "上一句的工具结果压短了"); assert.ok(after.filter((m) => m.role === "assistant" && m.content.length > 1300).length === 0, "上一句的长回答也压短了");
  assert.ok(!JSON.stringify(after).includes('"_c"'), "内部标记不发出去");
  const ag2 = AG.create({ llm: { start: async () => {}, chat: (msgs) => { seen.push(msgs); return P({ content: "答".repeat(1000), tool_calls: [] }, 1); } }, deck: () => null, ppt: false, tools: [], system: "规则", maxChars: 6000 });
  for (let i = 0; i < 12; i++) await ag2.send("第 " + i + " 个问题");
  const last = seen[seen.length - 1]; const chars = last.reduce((n, m) => n + String(m.content).length, 0);
  assert.ok(chars < 8000, "超过预算从最早的丢（" + chars + " 字）"); assert.match(last[last.length - 1].content, /第 11 个问题/); assert.equal(last[1].role, "user");
  ok("省 token：上一句以前的长工具结果只留开头、长回答截短（每问一句压一次，缓存照样命中）；对话太长从最早的一问一答开始丢");

  // ---------- 捞小智：大任务带上 team_work；提示词不变的规则在前、这一句的情况在最后 ----------
  const XZ = require("../core/xiaozhi");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xz-team-"));
  const x = XZ.create({ dir, llm: { start: async () => {}, chat: () => P({ content: "好", tool_calls: [] }, 1) }, web: false, mindmap: false });
  await x.ready();
  assert.ok(x.tools.some((t) => t.name === "team_work"));
  assert.ok(!x.pick("明天有什么课？").has("team_work")); assert.ok(x.pick("帮我对比一下三门选修课哪门好").has("team_work"));
  x.setTeam(true); assert.ok(x.pick("你好").has("team_work"), "开了「多个助手一起做」就一直带"); x.setTeam(false);
  ok("捞小智：说的是大任务（对比、整理、一整套…）或者开了「多个助手一起做」才带上 team_work，平时不带（省上下文）");
  console.log("多个助手 + 省 token：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
