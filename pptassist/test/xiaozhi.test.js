// 成品展示「捞小智」：一个对话里讲题、做 PPT、办教务的事；换身份；成品第几版跟着训练出的新版走
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os"), http = require("http");
const LLM = require("../core/llm");
const XZ = require("../core/xiaozhi");
const PPTX = require("../core/pptx");
const ok = (m) => console.log("✓ " + m);

// 假的大模型：按最后一句话决定说什么 / 调哪个工具（和 llama-server 一样的流式接口）
function fakeLlama(port, st) {
  return new Promise((done) => {
    const srv = http.createServer((q, r) => {
      if (q.url === "/health") { r.writeHead(200, { "content-type": "application/json" }); return r.end('{"status":"ok"}'); }
      let b = ""; q.on("data", (c) => (b += c));
      q.on("end", () => {
        const body = JSON.parse(b || "{}"); st.reqs.push(body);
        const ms = body.messages || [], last = ms[ms.length - 1] || {};
        r.writeHead(200, { "content-type": "text/event-stream" });
        const send = (delta) => r.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
        const words = (s) => { for (const w of s.match(/.{1,4}/gs) || []) send({ content: w }); };
        const call = (name, args) => { send({ tool_calls: [{ index: 0, id: "c" + Date.now(), function: { name, arguments: JSON.stringify(args) } }] }); };
        const t = typeof last.content === "string" ? last.content : "";
        if (last.role === "tool") { const res = JSON.parse(last.content); words(res.error ? "办不了：" + res.error : /^(edit_slide|set_theme|format_text|set_text|check_ppt)$/.test(last.name) ? "改好了。" + (res.note || "") : last.name === "make_ppt" ? `做好了，一共 ${res.pages} 页。` : last.name === "apply_leave" ? `提交了，编号 ${res.id}，${res.status}。` : last.name === "get_timetable" ? `明天有 ${res.count} 次课。` : "办好了。"); }
        else if (/改成卡片/.test(t)) call("edit_slide", { slide: 2, layout: "cards", items: [{ head: "比较", body: "相邻两个数比较" }, { head: "交换", body: "大的往后换" }, { head: "重复", body: "一共 n-1 趟" }] });
        else if (/绿色/.test(t)) call("set_theme", { theme: "green" });
        else if (/标红/.test(t)) call("format_text", { slide: 0, find: "冒泡", color: "红", bold: true });
        else if (/检查/.test(t)) call("check_ppt", {});
        else if (/第一页标题/.test(t)) call("set_text", { slide: 1, shape: "title", lines: ["排序入门"] });
        else if (/明天有什么课/.test(t)) call("get_timetable", { day: 3 });
        else if (/请假/.test(t)) call("apply_leave", { type: "事假", from: "2026-11-19", to: "2026-11-19", reason: "家里有事" });
        else if (/审批/.test(t)) call("pending_approvals", {});
        else if (/PPT/.test(t)) call("make_ppt", { title: "冒泡排序", subtitle: "C 语言程序设计", slides: [{ title: "什么是冒泡排序", lines: ["相邻两个数比较", "大的往后换"] }, { title: "一趟排序的过程", lines: ["从头比到尾", "最大的沉到最后"] }, { title: "小结", lines: ["n 个数比 n-1 趟"] }] });
        else if (/乱来/.test(t)) call("no_such_tool", {});
        else words("先设未知数 $x$，列方程 $2x+3=11$，解得 $x=4$。答案：4");
        r.end("data: [DONE]\n\n");
      });
    });
    srv.listen(port, "127.0.0.1", () => done(srv));
  });
}

(async () => {
  const port = 19000 + Math.floor(Math.random() * 900), st = { reqs: [] };
  const srv = await fakeLlama(port, st);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xz-"));
  const llm = LLM.create({ dir: tmp, exe: process.execPath, port, minBytes: 4 });
  fs.writeFileSync(path.join(tmp, "Qwen3VL-4B-Instruct-Q4_K_M.gguf"), "GGUF....");
  fs.writeFileSync(path.join(tmp, "mmproj-Qwen3VL-4B-Instruct-F16.gguf"), "GGUF....");
  const NOW = new Date(2026, 10, 17, 10, 0);
  let gridSt = { current: {}, pending: {}, checked: 0 };
  const ev = [];
  const xz = XZ.create({ dir: path.join(tmp, "show"), llm, now: () => NOW, grid: { status: () => gridSt }, onEvent: (e) => ev.push(e) });
  const said = () => ev.filter((e) => e.type === "delta").map((e) => e.text).join("");
  const steps = () => ev.filter((e) => e.type === "tool" && e.stage === "done");

  // 1. 讲题：直接回答；系统提示里有身份、今天、明天，带着做 PPT 和教务的全部工具，不带改 PPT 的那一套
  await xz.send("解方程 2x+3=11");
  assert.match(said(), /答案：4/);
  const sys = st.reqs[0].messages[0].content, names = st.reqs[0].tools.map((t) => t.function.name);
  assert.match(sys, /捞小智/); assert.match(sys, /今天是 2026-11-17 周二/); assert.match(sys, /明天是 2026-11-18/); assert.match(sys, /学生 /);
  assert.ok(names.includes("make_ppt") && names.includes("apply_leave") && names.includes("get_timetable") && !names.includes("set_text") && names.includes("web_search") && names.includes("answer_from_sources") && names.length === 19);
  ok("讲题：直接回答；系统提示里写着现在是谁、今天几号第几周、明天几号；带着做 PPT、教务办事、联网和查资料核对的 19 个工具");

  // 2. 办事：查课表、请假（真的写进了教务后端）
  ev.length = 0; await xz.send("明天有什么课");
  assert.equal(steps()[0].name, "get_timetable"); assert.ok(steps()[0].ok && steps()[0].result.classes.every((c) => c.weekday === "周三"));
  assert.match(said(), /明天有 \d+ 次课/); assert.match(steps()[0].say, /周三的课表/);
  ev.length = 0; await xz.send("我明天后天要请假");
  const lv = steps()[0]; assert.ok(lv.ok && lv.changed && /^QJ20261117/.test(lv.result.id));
  assert.equal(xz.campus.myRequests(xz.campus.identities().student).count, 1);
  ok("办事：查明天的课表、提交请假（教务后端里多了一条申请，回话里有编号和审批到哪一步）");

  // 3. 换身份：辅导员看到等他批的；对话重新开始；没权限的事办不了
  const w = xz.setRole("teacher");
  assert.equal(w.role, "teacher"); assert.equal(xz.history().length, 0); assert.equal(w.roles.length, 3);
  ev.length = 0; await xz.send("有没有要我审批的");
  assert.equal(steps()[0].result.count, 1);
  assert.match(st.reqs[st.reqs.length - 1].messages[0].content, /教师 /);
  ev.length = 0; await xz.send("帮我请假");
  assert.equal(steps()[0].ok, false); assert.match(steps()[0].result.error, /只有学生/); assert.match(said(), /办不了/);
  assert.throws(() => xz.setRole("校长"), /身份只有/);
  ok("换身份：换成辅导员能看到刚才那条请假等他批；教师去请假 → 后端按权限拒绝，照实告诉他");

  // 4. 做 PPT：真的出了一份能打开的 .pptx
  ev.length = 0; await xz.send("帮我做一份讲冒泡排序的 PPT");
  const mk = steps()[0]; assert.ok(mk.ok, JSON.stringify(mk.result)); assert.equal(mk.result.pages, 4); assert.match(mk.say, /做一份 PPT「冒泡排序」（4 页）/);
  const lp = xz.lastPpt(); assert.ok(fs.existsSync(lp.file) && /冒泡排序-\d{4}-\d{6}\.pptx$/.test(lp.file));
  const info = await PPTX.read(fs.readFileSync(lp.file));
  assert.equal(info.slides.length, 4);
  assert.ok(JSON.stringify(info.slides[0]).includes("冒泡排序") && JSON.stringify(info.slides[0]).includes("C 语言程序设计") && JSON.stringify(info.slides[2]).includes("最大的沉到最后"));
  await assert.rejects(() => xz.makePpt({ title: "x", slides: [] }), /至少要有一页/);
  ev.length = 0; await xz.send("乱来");
  assert.equal(steps()[0].ok, false);
  ok("做 PPT：按大纲从头做出一份 4 页的 .pptx（标题页 + 每页标题和要点），文件能读回来；模型乱调不存在的工具也不会崩");

  // 4b. 做完接着改：说怎么改就怎么改，每一步都存盘，界面上的预览跟着变
  const EDIT = require("../core/pptedit");
  const onDisk = async () => (await EDIT.load(fs.readFileSync(xz.lastPpt().file)));
  assert.equal(mk.result.theme, "学院蓝"); assert.match(mk.result.outline[0], /^1\. 冒泡排序（封面）$/); assert.match(mk.result.note, /还想改哪里直接说/);
  let sl = await xz.slides(); assert.equal(sl.pages, 4); assert.equal(sl.svgs.length, 4); assert.ok(sl.svgs.every((x) => x.startsWith("<svg"))); assert.equal(sl.themes.length, 8); assert.equal(await xz.slides(sl.rev), null);
  ev.length = 0; await xz.send("把第 2 页改成卡片");
  let rq = st.reqs[st.reqs.length - 1], tn = rq.tools.map((x) => x.function.name);
  assert.ok(tn.includes("edit_slide") && tn.includes("set_theme") && tn.includes("make_ppt") && !tn.includes("apply_leave") && tn.includes("web_search") && tn.length === 23);
  assert.match(rq.messages[0].content, /现在手上的 PPT：「冒泡排序」，一共 4 页/); assert.match(rq.messages[0].content, /改 PPT 的规矩/);
  assert.ok(steps()[0].ok && steps()[0].changed, JSON.stringify(steps()[0].result)); assert.match(steps()[0].say, /重排第 2 页，换成「卡片」/);
  assert.equal((await (await onDisk()).outline())[1].layout, "cards");
  const sl2 = await xz.slides(sl.rev); assert.ok(sl2 && sl2.rev > sl.rev && sl2.svgs[1].includes("相邻两个数比较"));
  ev.length = 0; await xz.send("整份换成绿色的"); assert.equal((await (await onDisk()).theme()).key, "green");
  ev.length = 0; await xz.send("把冒泡标红"); assert.ok(steps()[0].result.count >= 2);
  ev.length = 0; await xz.send("检查一遍"); assert.equal(steps()[0].name, "check_ppt"); assert.equal(steps()[0].changed, false); assert.equal(typeof steps()[0].result.ok, "boolean");
  // 中间问一句教务的事：带的是教务的工具；再说 PPT 的事又换回来
  ev.length = 0; await xz.send("明天有什么课"); tn = st.reqs[st.reqs.length - 1].tools.map((x) => x.function.name);
  assert.ok(tn.includes("get_timetable") && !tn.includes("edit_slide") && tn.includes("web_search") && tn.length === 19);
  // 老师正开着这个文件（Windows 上写不进去）：另存成新名字，告诉她
  const f0 = xz.lastPpt().file, w0 = fs.writeFileSync; let locked = 0;
  fs.writeFileSync = (f, ...a) => { if (f === f0) { locked++; const e = new Error("EBUSY: resource busy or locked"); e.code = "EBUSY"; throw e; } return w0(f, ...a); };
  ev.length = 0; try { await xz.send("把第一页标题改一下"); } finally { fs.writeFileSync = w0; }
  assert.equal(locked, 1); assert.match(steps()[0].result.note, /另存成了/); assert.ok(xz.lastPpt().file !== f0 && /-改2\.pptx$/.test(xz.lastPpt().file));
  assert.equal((await (await onDisk()).outline())[0].title, "排序入门"); assert.match(said(), /另存成了/);
  // 界面上直接点的：换配色、撤销
  await xz.pptTheme("dark"); assert.equal((await (await onDisk()).theme()).key, "dark");
  const u = await xz.pptUndo(); assert.match(u.undone, /换成「深色」配色/); assert.equal((await (await onDisk()).theme()).key, "green");
  // 重开：上次那份还在手上，接着改
  const xz3 = XZ.create({ dir: path.join(tmp, "show"), llm, now: () => NOW, grid: { status: () => gridSt } });
  await xz3.ready(); assert.equal(xz3.lastPpt().file, xz.lastPpt().file); assert.equal(xz3.lastPpt().pages, 4); assert.ok([...xz3.pick("字大一点")].includes("set_font_size"));
  // 打开老师自己的 PPT 让它改：原文件不动，改的存在展示的文件夹里
  const src = path.join(__dirname, "fixtures", "sample.pptx"), h0 = fs.readFileSync(src).toString("base64").length;
  const op = await xz.openPpt(src); assert.equal(op.title, "sample"); assert.equal(op.own, false); assert.ok(op.file.startsWith(path.join(tmp, "show", "ppt")) && /sample-改-/.test(op.file));
  ev.length = 0; await xz.send("整份换成绿色的"); assert.ok(steps()[0].ok); assert.equal(fs.readFileSync(src).toString("base64").length, h0);
  assert.match(st.reqs[st.reqs.length - 1].messages[0].content, /现在手上的 PPT：「sample」/);
  sl = await xz.slides(); assert.ok(sl.pages >= 3 && sl.designed === false && sl.svgs[0].includes("排序"));
  ok("做完接着改：换版式 / 换配色 / 标红 / 检查，每一步都存盘、预览跟着变；文件被占着就另存；重开还在；老师自己的 PPT 也能打开来改（原文件不动）");

  // 4c. 考一考：8 道题真的做一遍，程序核对，记下来
  const ex = await xz.pptExam();
  assert.equal(ex.total, 8); assert.equal(ex.items.length, 8); assert.ok(ex.items[0].tools.includes("make_ppt"));
  assert.match(ex.items[0].why, /要 8 页左右，做了 4 页/);       // 假模型只做 4 页：程序核对出来了
  assert.ok(ex.items.find((i) => i.what === "换配色").ok); assert.ok(ex.items.find((i) => i.what === "中间问教务的事").ok);
  assert.ok(ex.score >= 2 && ex.score < 8); assert.deepEqual(xz.lastExam().score, ex.score);
  ok(`考一考：8 道题真的让模型做、改，程序核对（假模型 ${ex.score}/8，第一题页数不够被查出来），成绩记下来`);

  // 5. 成品第几版：哪一样出了新版就记一笔，只涨不跌；重开还在
  let p = xz.product();
  assert.equal(p.build, 0); assert.equal(p.parts.length, 9); assert.ok(["chat-lora", "ppt-lora", "vision-lora"].every((k) => p.parts.some((x) => x.key === k))); assert.ok(p.parts.every((x) => !x.ready));
  gridSt = { current: { "qa-lora": { version: 12, metrics: { acc: 0.71, base_acc: 0.64 } }, "laolao-voice": { version: 3, metrics: {} } }, pending: { "qa-lora": 13 }, checked: 5 };
  p = xz.product();
  assert.equal(p.build, 2); const qa = p.parts.find((x) => x.key === "qa-lora");
  assert.ok(qa.ready && qa.version === 12 && qa.metric === 0.71 && qa.base === 0.64 && qa.pending === 13);
  assert.equal(xz.product().build, 2);
  gridSt.current["qa-lora"] = { version: 13, metrics: { acc: 0.74, base_acc: 0.64 } };
  p = xz.product(); assert.equal(p.build, 3); assert.deepEqual([p.log[0].key, p.log[0].from, p.log[0].to, p.log[0].metric], ["qa-lora", 12, 13, 0.74]);
  const xz2 = XZ.create({ dir: path.join(tmp, "show"), llm, now: () => NOW, grid: { status: () => gridSt } });
  assert.equal(xz2.product().build, 3);
  assert.equal(xz2.campus.myRequests(xz2.campus.identities().student).count, 1);
  ok("成品第几版：答题大脑出了第 13 版（答对率 71% → 74%）→ 成品从第 2 版变第 3 版，记一笔；没变化不重复记；重开还在");

  llm.stop(); srv.close();
  {
    const X = require("../core/xiaozhi");
    const r = X.polish([{ title: "冒泡排序是什么", lines: ["相邻两个数比较", "大的往后换"] }, { title: "代码", lines: ["for (i = 0; i < n; i++)", "  if (a[j] > a[j + 1]) swap(a, j);"] },
      { title: "一轮怎么走", lines: ["第一步：比较相邻两个数", "第二步：前面大就交换", "第三步：往后挪一位"] }, { title: "要点一", lines: ["甲"] }, { title: "三个指标", lines: ["时间复杂度：数据多了慢多少", "空间复杂度：占多少内存", "稳定性：相等的顺序变不变"] }, { title: "要点二", lines: ["乙"] }]);
    assert.equal(r[1].layout, "code"); assert.match(r[1].code, /swap/);
    assert.equal(r[2].layout, "steps"); assert.deepEqual(r[2].items.map((x) => x.head), ["比较相邻两个数", "前面大就交换", "往后挪一位"].map((h) => h.length > 10 ? h : h).map((h, i) => r[2].items[i].head));
    assert.equal(r[4].layout, "cards"); assert.equal(r[4].items[0].head, "时间复杂度");
    assert.equal(r[r.length - 1].layout, "summary"); assert.ok(r[r.length - 1].lines.length >= 3);
    console.log("✓ 做 PPT 前理一理：代码写进要点 → 代码页；第一步第二步 → 步骤图；连着三页要点 → 中间换成卡片；没有小结 → 补一页小结");
  }
  {
    const X = require("../core/xiaozhi");
    const d = X.days2w(new Date("2026-11-21T10:00:00+08:00").getTime());
    assert.match(d, /2026-11-21 本周六（今天）/); assert.match(d, /2026-11-27 下周五/); assert.ok(!/2026-11-20/.test(d), "过去的日子不列");
    console.log("✓ 提示里列出这两周每一天是星期几：「下周五」直接照抄 2026-11-27，不让小模型自己算");
  }
  console.log("成品展示「捞小智」：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
