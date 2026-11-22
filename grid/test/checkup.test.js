// 检测报告（app/ppt/checkup.js，打包时从 pptassist/core 拷过来）：合作方的各种结果格式都能统一；合作方接口用得上就用、
//   连不上 / 不给用了 / 没同意发照片 → 自动换成捞捞自己的分析（看图 + 问卷）；导入文件（JSON / CSV，GBK 的也行）；
//   和上周比、看趋势；捞小智在对话里调这些工具；看图时大模型带上视觉组件（mmproj）
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const { spawn } = require("child_process");
const CK = require("../app/ppt/checkup.js");
const ok = (m) => console.log("✓", m);
const listen = (fn) => new Promise((d) => { const s = http.createServer(fn); s.listen(0, "127.0.0.1", () => d(s)); });
const IMG = "data:image/jpeg;base64," + Buffer.from("假的照片").toString("base64");

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-checkup-"));
  const P = CK.PROFILES.scalp;

  // ---------- 1. 各种样子的结果 → 统一格式 ----------
  {
    let r = CK.normalize({ 出油量: "轻度", 头屑程度: "正常", 敏感泛红: "正常", 发量密度: "正常", 发丝粗细: "正常", 水润度: "信息不足" }, P);
    assert.deepEqual(r.dims.map((d) => d.level), [3, 4, 4, 4, 4, null, null, null]);
    assert.equal(r.dims.length, 8); assert.equal(r.dims[0].name, "出油量"); assert.equal(r.dims[7].label, "信息不足");
    r = CK.normalize({ code: 0, data: { time: "2026-11-12 23:10:00", result: [{ code: "sebum", grade: 2, areas: ["前额", "头顶"] }, { code: "dandruff", grade: "normal" }, { code: "hair_density", grade: 4 }, { code: "scalp_temperature", name: "头皮温度", grade: "mild" }] } }, P);
    assert.equal(r.dims.find((d) => d.key === "oil").level, 2); assert.equal(r.dims.find((d) => d.key === "oil").regions.join("、"), "前额、头顶");
    assert.equal(r.dims.find((d) => d.key === "dandruff").level, 4); assert.equal(r.dims.find((d) => d.key === "density").level, 4);
    const extra = r.dims.find((d) => d.name === "头皮温度"); assert.ok(extra && extra.level === 3, "认不出的项目原样留下");
    assert.equal(new Date(r.at).getDate(), 12);
    // 分数越高越严重、自己定的等级字母：用「字段对应」说明
    r = CK.normalize({ list: [{ k: "oil", s: 80 }, { k: "redness", s: 10 }, { k: "moisture", g: "B" }] }, P, { items: "list", key: "k", level: "s", scoreHigherWorse: true });
    assert.equal(r.dims.find((d) => d.key === "oil").level, 1); assert.equal(r.dims.find((d) => d.key === "redness").level, 4);
    r = CK.normalize([{ name: "水润度", level: "B" }, { name: "出油", level: "A" }], P, { levels: { A: 4, B: 3 } });
    assert.equal(r.dims.find((d) => d.key === "moisture").level, 3); assert.equal(r.dims.find((d) => d.key === "oil").level, 4);
    assert.throws(() => CK.normalize({ hello: 1 }, P), /找不到检测项目/);
    ok("合作方结果的各种样子（平铺的中文、嵌套的英文代码、分数、字母等级）都统一成八项 1～4 级；认不出的项目原样留下；对不上的可以填「字段对应」");
  }

  // ---------- 2. 合作方接口：用得上就用；不行了自动换成我们自己的 ----------
  const hits = []; let mode = "ok";
  const partner = await listen((q, r) => {
    let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => {
      hits.push({ auth: q.headers.authorization, type: q.headers["content-type"], body: b });
      if (mode === "403") return r.writeHead(403).end("expired");
      if (mode === "down") return q.socket.destroy();
      r.writeHead(200, { "content-type": "application/json" });
      r.end(JSON.stringify({ data: { items: [{ code: "oil", level: "中度", parts: "头顶,后脑" }, { code: "dandruff", level: "轻度" }, { code: "redness", level: "正常" }, { code: "density", level: "正常" }] } }));
    });
  });
  const looked = [];
  const look = async (imgs, prompt) => { looked.push({ n: imgs.length, prompt }); return '好的：{"is_scalp": true, "oil": {"level": "轻度", "where": "头顶"}, "dandruff": {"level": "正常"}, "redness": {"level": "看不清"}, "density": {"level": "正常"}, "thickness": {"level": "正常"}, "follicle": {"level": "轻度"}, "strength": {"level": "看不清"}}'; };
  let T = new Date("2026-11-19T10:00:00");
  const c = CK.create({ dir: tmp, look, now: () => T });
  await assert.rejects(c.scan({ images: [IMG] }), /先同意/);
  c.setConfig({ consent: { local: true } });
  const url = `http://127.0.0.1:${partner.address().port}/api/scan`;
  c.setConfig({ partner: { url, token: "SECRET-TOKEN", name: "梳子团队" } });
  assert.equal(JSON.stringify(c.config()).includes("SECRET-TOKEN"), false, "口令不给界面");
  assert.equal(c.config().partner.hasToken, true);
  // 没同意把照片发给合作方：不发
  let r = await c.scan({ images: [IMG] });
  assert.equal(hits.length, 0, "没同意就不发照片"); assert.equal(r.source, "捞捞自己的分析（看照片 + 问卷，参考）"); assert.match(r.fallback, /没有同意/);
  c.setConfig({ consent: { partner: true } });
  T = new Date("2026-11-20T10:00:00");
  r = await c.scan({ images: [IMG, IMG] });
  assert.equal(hits.length, 1); assert.equal(hits[0].auth, "Bearer SECRET-TOKEN"); assert.match(hits[0].type, /json/);
  const sent = JSON.parse(hits[0].body); assert.equal(sent.images.length, 2); assert.equal(Buffer.from(sent.images[0], "base64").toString(), "假的照片");
  assert.equal(r.source, "梳子团队"); assert.equal(r.items[0].level, "中度"); assert.equal(r.items[0].regions, "头顶、后脑"); assert.equal(r.fallback, undefined);
  // 合作方不给用了（403）/ 连不上：自动换成我们自己的，照实写一笔
  mode = "403"; T = new Date("2026-11-21T10:00:00");
  r = await c.scan({ images: [IMG], answers: { moisture: "偶尔", strength: "很少" } });
  assert.match(r.fallback, /梳子团队的接口这次没用上.*403.*自动换成了捞捞自己的分析/); assert.match(r.source, /捞捞自己的分析/);
  const it = (n) => r.items.find((x) => x.name === n);
  assert.equal(it("出油量").level, "轻度"); assert.equal(it("出油量").regions, "头顶"); assert.equal(it("水润度").level, "轻度"); assert.equal(it("发丝强韧").level, "正常", "看图看不清的用问卷补");
  assert.equal(it("敏感泛红").level, "信息不足");
  mode = "down"; r = await c.scan({ images: [IMG] }); assert.match(r.fallback, /连不上/);
  await assert.rejects(c.scan({ images: [IMG], source: "partner" }), /连不上合作方接口/, "只用合作方：不悄悄换");
  mode = "ok";
  // multipart 也行
  c.setConfig({ partner: { body: "multipart", imageField: "file", extra: '{"device":"comb-01"}' } });
  await c.scan({ images: [IMG] });
  const last = hits[hits.length - 1]; assert.match(last.type, /multipart\/form-data/); assert.match(last.body, /name="device"\r\n\r\ncomb-01/); assert.match(last.body, /name="file"; filename="photo1.jpg"/);
  assert.throws(() => c.setConfig({ partner: { map: "{不是json" } }), /不是正确的 JSON/);
  assert.throws(() => c.setConfig({ partner: { url: "ftp://x" } }), /http/);
  ok("合作方接口：同意了才发照片，口令只在本机；接口 403 / 连不上 → 自动换成捞捞自己的分析（看图为准、问卷补看不清的）并照实说明；JSON 和表单上传两种发法");

  // ---------- 分区实拍：5 个部位 × 白光 / 偏振光 / 紫外光，发给合作方时每张都标上；读合作方按部位给的结果 ----------
  {
    const tags = CK.autoLabel(15);
    assert.deepEqual(tags.slice(0, 4), [{ zone: "front", light: "white" }, { zone: "front", light: "polarized" }, { zone: "front", light: "uv" }, { zone: "top", light: "white" }]);
    assert.deepEqual(tags[14], { zone: "back", light: "uv" });
    const set15 = tags.map((t, i) => ({ url: "data:image/jpeg;base64," + Buffer.from(`照片${i + 1}`).toString("base64"), ...t }));
    // 合作方按部位给结果：[{ zone, items }]
    mode = "zones";
    const zoneReply = { code: 0, data: { zones: [
      { zone: "前额", items: [{ code: "oil", level: "轻度" }, { code: "redness", level: "正常" }] },
      { zone: "头顶", items: [{ code: "oil", level: "中度", desc: "毛囊口油脂栓多" }, { code: "redness", level: "轻度" }, { code: "density", level: "轻度" }] },
      { zone: "左侧", items: [{ code: "oil", level: "正常" }] },
    ] } };
    const pz = await listen((q, res) => { let b = ""; q.on("data", (x) => (b += x)); q.on("end", () => { hits.push({ type: q.headers["content-type"], body: b }); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(zoneReply)); }); });
    c.setConfig({ partner: { url: `http://127.0.0.1:${pz.address().port}/scan`, body: "json", imageField: "images", extra: "{}" } });
    const r2 = await c.scan({ images: set15 });
    const sent = JSON.parse(hits[hits.length - 1].body);
    assert.equal(sent.images.length, 15, "15 张都发了（以前最多 6 张）");
    assert.deepEqual({ ...sent.images[4], image: undefined }, { zone: "top", zone_name: "头顶", light: "polarized", light_name: "偏振光", image: undefined });
    assert.equal(Buffer.from(sent.images[4].image, "base64").toString(), "照片5");
    const oil = r2.items.find((x) => x.name === "出油量");
    assert.equal(oil.level, "中度", "总等级：取最差的部位"); assert.equal(oil.regions, "头顶、前额"); assert.match(oil.zones, /前额轻度、头顶中度、左侧正常/); assert.match(oil.note, /头顶：毛囊口油脂栓多/);
    assert.equal(r2.items.find((x) => x.name === "敏感泛红").level, "轻度");
    // 合作方叫法不一样（部位、光源代码）、表单上传：字段名按「部位_光源」
    c.setConfig({ partner: { body: "multipart", imageField: "file", codes: { zones: { front: "qe", top: "dt" }, lights: { white: "W", polarized: "P", uv: "U" } } } });
    await c.scan({ images: set15.slice(0, 6) });
    const mb = hits[hits.length - 1].body;
    assert.match(mb, /name="qe_W"; filename="qe_W.jpg"/); assert.match(mb, /name="dt_U"/); assert.match(mb, /name="photos"\r\n\r\n\[\{"zone":"qe","zone_name":"前额","light":"W"/);
    // 同一个部位同一种光拍了两张：提示改
    await assert.rejects(c.scan({ images: [set15[0], { ...set15[1], light: "white" }] }), /「前额·白光」有两张/);
    // 合作方说照片不合格：原话转告重拍，不悄悄换成本机分析；要求拍全：发之前就拦住
    const bad = await listen((q, res) => { q.resume(); q.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ code: 1001, msg: "头顶·紫外光 模糊，请重拍" })); }); });
    c.setConfig({ partner: { url: `http://127.0.0.1:${bad.address().port}/scan`, body: "json" } });
    await assert.rejects(c.scan({ images: set15 }), /梳子团队说：头顶·紫外光 模糊，请重拍/);
    c.setConfig({ partner: { minPhotos: 15 } });
    const n0 = hits.length;
    await assert.rejects(c.scan({ images: set15.slice(0, 9) }), /要求拍够 15 张（现在 9 张）/);
    assert.equal(hits.length, n0, "没拍全不发");
    c.setConfig({ partner: { minPhotos: 0 } }); bad.close();
    // 合作方不用了：本机兜底挑白光那几张，告诉模型哪张是哪个部位
    c.setConfig({ source: "local" });
    looked.length = 0;
    await c.scan({ images: set15 });
    assert.equal(looked[0].n, 4); assert.match(looked[0].prompt, /第 1 张 前额（白光），第 2 张 头顶（白光），第 3 张 左侧（白光），第 4 张 右侧（白光）/);
    c.setConfig({ source: "auto", partner: { body: "json", imageField: "images", codes: "{}", url } });
    pz.close(); mode = "ok";
    assert.equal(c.plan().total, 15);
    ok("分区实拍：15 张按拍摄顺序自动标好「部位·光源」，发给合作方时每张都带上（JSON 或表单，叫法可以按合作方的改）；合作方按部位给的结果合成总等级（取最差的部位）、关注部位、每个部位各是什么；同一格拍两张会提示；合作方不用时本机挑白光照片兜底");
  }

  // 本机看图：不是头皮、一项都没看清
  {
    const c2 = CK.create({ dir: path.join(tmp, "c2"), look: async () => '{"is_scalp": false}' });
    c2.setConfig({ consent: { local: true } });
    await assert.rejects(c2.scan({ images: [IMG] }), /看不出头皮/);
    const c3 = CK.create({ dir: path.join(tmp, "c3"), look: async () => "我看不太清" });
    c3.setConfig({ consent: { local: true } });
    await assert.rejects(c3.scan({ images: [IMG] }), /没有按格式/);
    const c4 = CK.create({ dir: path.join(tmp, "c4") });       // 这台电脑没有看图模型：只用问卷
    c4.setConfig({ consent: { local: true } });
    const q = await c4.scan({ images: [IMG], answers: { oil: "一天", dandruff: "基本没有" } });
    assert.match(q.fallback, /只用问卷/); assert.equal(q.items[0].level, "中度");
    await assert.rejects(c4.scan({}), /没有可以分析的/);
    assert.ok(looked.every((l) => /只输出一个 JSON/.test(l.prompt) && l.n >= 1));
    ok("捞捞自己的分析：照片不是头皮、模型没按格式答 → 说清楚；没有看图模型就只用问卷");
  }

  // ---------- 3. 导入文件：JSON / CSV（Excel 另存的 GBK 也行） ----------
  {
    const f1 = path.join(tmp, "导出.csv");
    // 「日期,出油量,头屑程度,水润度 / 2026-11-01,轻度,正常,中度」的 GBK 编码（中文 Windows 上 Excel 另存 CSV 就是这样）
    fs.writeFileSync(f1, Buffer.from("c8d5c6da2cb3f6d3cdc1bf2ccdb7d0bcb3ccb6c82ccbaec8f3b6c80a323032362d31312d30312cc7e1b6c82cd5fdb3a32cd6d0b6c80a", "hex"));
    let n = c.importFile(f1);
    assert.equal(n.added, 1); assert.equal(n.reports[0].date, "2026-11-01"); assert.equal(n.reports[0].items.find((x) => x.name === "水润度").level, "中度");
    const f2 = path.join(tmp, "r.json");
    fs.writeFileSync(f2, JSON.stringify([{ data: { date: "2026-11-05", result: [{ code: "oil", grade: 3 }] } }, { data: { date: "2026-11-08", result: [{ code: "oil", grade: 4 }] } }]));
    n = c.importFile(f2); assert.equal(n.added, 2);
    assert.throws(() => c.importText("a,b\n1,2", "x.csv"), /认不出检测项目/);
    ok("导入合作方导出的文件：CSV（GBK 编码也认）、JSON（一份或好几份），日期按文件里的");
  }

  // ---------- 4. 和上周比、看趋势、记录、删除 ----------
  {
    const d = CK.create({ dir: path.join(tmp, "demo"), now: () => new Date("2026-11-19T20:00:00") });
    d.demo();
    const h = d.history(); assert.equal(h.count, 6); assert.ok(h.reports.every((x) => x.demo));
    const cmp = d.compare({});
    assert.equal(cmp.days, 7); assert.deepEqual(cmp.better, ["出油量（轻度 → 正常）", "头屑程度（轻度 → 正常）"]); assert.deepEqual(cmp.worse, ["水润度（轻度 → 中度）"]);
    assert.equal(cmp.items.find((x) => x.name === "毛囊堵塞").change, "这次没测出"); assert.equal(cmp.advice[0].name, "水润度", "退步的那一项给护理建议");
    assert.equal(cmp.demo, "这是虚构的演示数据"); assert.ok(cmp.radar.latest && cmp.radar.base);
    const c28 = d.compare({ days: 28 }); assert.ok(c28.days >= 28 && c28.better.length >= 3);
    const tr = d.trend({ item: "出油" }); assert.equal(tr.item, "出油量"); assert.equal(tr.trend, "在变好"); assert.equal(tr.points.length, 6);
    assert.ok(d.latest().advice.length >= 1);
    const v = d.view(); assert.equal(v.list.length, 6); assert.ok(v.radar.base, "界面默认和上周比");
    // 自己的一次（不是演示）比上一次差：给建议
    d.setConfig({ consent: { local: true } });
    const bad = d.importText(JSON.stringify({ 出油量: "重度", 头屑程度: "正常", 敏感泛红: "正常", 发量密度: "正常", 发丝粗细: "正常" }), "a.json");
    const cb = d.compare({ days: 0 }); assert.ok(cb.worse.some((x) => /^出油量（正常 → 重度）/.test(x))); assert.equal(cb.advice[0].name, "出油量"); assert.ok(cb.advice.some((a) => a.name === "提醒"), "有重度：提醒去看医生");
    assert.match(cb.mixed, /来源不一样/);
    d.remove(bad.reports[0].id); assert.equal(d.history().count, 6);
    ok("和上周比（6 天以前最近的那次）：哪几项进步 / 退步、没测出的单独说；看某一项的趋势；退步的给护理建议，重度提醒看医生；来源不同提醒仅供参考");
  }

  // 照片：存在本机，删除全部时一起删
  {
    const ph = path.join(tmp, "checkup", "photos");
    assert.ok(fs.readdirSync(ph).length >= 3);
    c.setConfig({ keepPhotos: false }); const n0 = fs.readdirSync(ph).length; await c.scan({ images: [IMG], source: "local" }); assert.equal(fs.readdirSync(ph).length, n0, "不留照片就不存");
    c.wipe(); assert.equal(fs.existsSync(ph), false); assert.equal(c.history().count, 0);
    ok("检测照片只存在本机（可以设成不留）；「全部删除」连照片一起删");
  }

  // ---------- 5. 捞小智：对话里查、比；看照片时大模型带上视觉组件 ----------
  {
    const Show = require("../app/show");
    const reqs = [];
    const llama = await listen((q, res) => {
      let b = ""; q.on("data", (x) => (b += x));
      q.on("end", () => {
        const body = JSON.parse(b || "{}"); reqs.push(body); res.writeHead(200, { "content-type": "text/event-stream" });
        const ms = body.messages || [], lastm = ms[ms.length - 1] || {}, t = typeof lastm.content === "string" ? lastm.content : "";
        const say = (w) => { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`); res.end("data: [DONE]\n\n"); };
        const callT = (name, args) => { res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c" + reqs.length, function: { name, arguments: JSON.stringify(args) } }] } }] })}\n\n`); res.end("data: [DONE]\n\n"); };
        if (Array.isArray(lastm.content) && lastm.content.some((x) => x.type === "image_url")) return say('{"is_scalp": true, "oil": {"level": "正常"}, "dandruff": {"level": "轻度", "where": "头顶"}, "density": {"level": "正常"}}');
        if (lastm.role === "user" && /上周/.test(t)) return callT("checkup_compare", { days: 7 });
        if (lastm.role === "tool") return say("头屑程度比上周好了，继续保持。这是护理参考，不是医学诊断。");
        say("你好。");
      });
    });
    const ensured = [];
    const llm = { ok: () => true, running: () => true, touch() {}, ensure: async (spec) => { ensured.push(spec); return `http://127.0.0.1:${llama.address().port}`; } };
    const ev = [];
    const sdir = path.join(tmp, "work", "show");
    const modelsFactory = () => ({ use: () => null, check: async () => {}, status: () => ({ current: {}, pending: {}, checked: 0 }), stop() {}, rollback() {} });
    const show = Show.create({ dir: () => sdir, server: () => "", llm, send: (e) => ev.push(e), busy: () => null, used: () => false, gsvDir: () => null, modelsFactory });
    show.checkupDemo();
    await show.send("和上周比有什么进步？要调整什么？");
    const toolDone = ev.find((e) => e.type === "tool" && e.stage === "done" && e.name === "checkup_compare");
    assert.ok(toolDone && toolDone.ok, "调了 checkup_compare"); assert.ok(toolDone.result.better.length >= 1); assert.equal(toolDone.result.radar, undefined, "给模型的结果不带雷达图（省上下文）");
    const sys = reqs[0].messages[0].content; assert.match(sys, /四、头皮检测报告/); assert.match(sys, /不是医学诊断/);
    assert.ok(reqs[0].tools.some((t) => t.function.name === "checkup_compare") && reqs[0].tools.some((t) => t.function.name === "get_timetable") === false, "说的是检测：带检测的工具，不带教务的（省上下文）");
    assert.ok(!ensured.some((s) => s.mmproj), "不看图就不带视觉组件");
    // 界面上传照片做一次检测：大模型带上视觉组件（mmproj）看图
    show.checkupConfig({ consent: { local: true } });
    const sc = await show.checkupScan({ images: [IMG] });
    assert.ok(ensured[ensured.length - 1].mmproj && /mmproj/.test(ensured[ensured.length - 1].mmproj.name), "看图：带上视觉组件");
    assert.equal(sc.report.items.find((x) => x.name === "头屑程度").level, "轻度"); assert.equal(sc.view.count, 7);
    // 这台电脑在算任务：看照片要显卡，先暂停；只答问卷不用
    const show2 = Show.create({ dir: () => path.join(tmp, "work2", "show"), server: () => "", llm, send: () => {}, busy: () => "答题数据工厂", used: () => false, gsvDir: () => null, modelsFactory });
    show2.checkupConfig({ consent: { local: true } });
    await assert.rejects(show2.checkupScan({ images: [IMG] }), /暂停计算/);
    assert.equal((await show2.checkupScan({ answers: { oil: "两天左右" } })).report.items[0].level, "轻度");
    show.shutdown(); show2.shutdown(); llama.close();
    ok("捞小智：问「和上周比有什么进步」→ 调 checkup_compare，按结果回答（提示词里有「不是医学诊断」）；看照片时才带上视觉组件；在算任务时不抢显卡（问卷照样能测）");
  }

  // ---------- 6. llmw：spec.mmproj → 下载视觉组件、启动时带 --mmproj；带不带算两种（换了要重开） ----------
  {
    const LLMW = require("../app/llmw");
    const blob = Buffer.alloc(1000, 7);
    const files = await listen((q, res) => { res.writeHead(200, { "Content-Length": blob.length }); res.end(blob); });
    const fake = path.join(tmp, "fake-llama.js");
    fs.writeFileSync(fake, `const http=require("http");const a=process.argv.slice(2);if(a[0]==="--list-devices"){process.exit(0);}const port=+a[a.indexOf("--port")+1];http.createServer((q,r)=>{r.writeHead(200);r.end("{}");}).listen(port,"127.0.0.1");`);
    const spawned = [];
    const L = LLMW.create({ exe: process.execPath, base: () => tmp, port: 19000 + Math.floor(Math.random() * 900), spawn: (exe, args, o) => { spawned.push(args); return spawn(process.execPath, [fake, ...args], o); } });
    const fu = `http://127.0.0.1:${files.address().port}`;
    const spec = { name: "M-Q4.gguf", urls: [fu + "/m.gguf"], ctx: 4096, slots: 1 };
    const said = [];
    await L.ensure(spec, (m) => said.push(m));
    assert.ok(!spawned[spawned.length - 1].includes("--mmproj"));
    await L.ensure({ ...spec, mmproj: { name: "mmproj-M-F16.gguf", urls: [fu + "/mm.gguf"] } }, (m) => said.push(m));
    const a = spawned[spawned.length - 1]; assert.equal(path.basename(a[a.indexOf("--mmproj") + 1]), "mmproj-M-F16.gguf");
    assert.ok(said.some((m) => /下载看图组件/.test(m)));
    await L.ensure({ ...spec, rpc: ["192.168.1.20:50052", "192.168.1.21:50052"] }, () => {});
    const r = spawned[spawned.length - 1]; assert.equal(r[r.indexOf("--rpc") + 1], "192.168.1.20:50052,192.168.1.21:50052", "局域网里几台合起来跑：带 --rpc");
    L.stop(); files.close();
    ok("本地大模型：要看图时下载视觉组件（mmproj）、带上 --mmproj 重新启动；不看图不带");
  }

  partner.close();
  console.log("检测报告：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
