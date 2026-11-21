// 捞小智 × 捞捞思维导图（core/mindmap.js）：
//   用导图模块自己的本机服务（learn/mindmap/server.js，原样跑，不改它的代码）核对：
//   列出、读成大纲、照大纲新建（导图模块自己的格式检查 normalize 能通过、编辑器能打开）、在节点下接着加；服务没开时读写电脑版的导图文件夹；
//   导图当「先核对再回答」的资料；捞小智的工具
"use strict";
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), net = require("net");
const { spawn } = require("child_process");
const MM = require("../core/mindmap");
const G = require("../core/ground");
const MOD = path.join(__dirname, "..", "..", "learn", "mindmap");
const FMT = require(path.join(MOD, "js", "mindmap-interchange.js"));   // 导图模块自己的格式检查（只在测试里用来核对）
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mm-"));
  // ---------- 大纲 ↔ 导图（离线） ----------
  const outline = "- 定义\n  - 一组类型相同的变量\n  - 下标从 0 开始\n- 用法\n  - 遍历：for 循环\n  - 越界：结果不确定\n- 和指针的关系";
  const map = MM.fromTree(MM.parseOutline(outline, "C 语言数组"), { title: "C 语言数组" });
  const norm = FMT.normalize(map);
  assert.equal(norm.nodes.length, 8); assert.equal(norm.edges.filter((e) => e.kind === "hierarchy").length, 7, "导图模块自己的格式检查能通过，上下级一条不多");
  assert.equal(MM.toOutline(map, { notes: false }), "- C 语言数组\n" + outline.split("\n").map((l) => "  " + l).join("\n"));
  assert.ok(Object.keys(map.pos).length === 8 && Object.values(map.pos).every((p) => isFinite(p.x) && isFinite(p.y)), "每个节点都排好了位置");
  const nested = { id: "old1", title: "老导图", nodes: [{ id: "r", text: "光合作用", note: "<b>重点</b>", children: [{ id: "a", text: "光反应", children: [{ id: "b", text: "产生 ATP" }] }] }] };
  assert.equal(MM.toOutline(nested), "- 光合作用\n  （备注：重点）\n  - 光反应\n    - 产生 ATP");
  ok("大纲 ↔ 导图：生成的 map.json 过得了导图模块自己的格式检查；读回来层级、顺序不变；老的嵌套格式、备注也认");

  // ---------- 导图模块自己的服务（原样跑） ----------
  const port = await freePort(), store = path.join(tmp, "maps");
  const srv = spawn(process.execPath, [path.join(MOD, "server.js")], { env: { ...process.env, MM_PORT: String(port), MM_STORAGE_DIR: store }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 100 && !/已启动/.test(log); i++) await sleep(100);
  assert.ok(/已启动/.test(log), "导图服务起不来：" + log);
  try {
    const mm = MM.create({ ports: [port + 1, port], dirs: [path.join(tmp, "none")] });
    assert.equal(await mm.find(), port, "找到导图服务（跳过不是导图的端口）");
    assert.deepEqual((await mm.list()).maps, []);
    const r = await mm.make("C 语言数组", outline);
    assert.equal(r.via, "service"); assert.equal(r.nodes, 8);
    assert.ok(fs.existsSync(path.join(store, r.id, "map.json")), "存进了导图模块自己的文件夹");
    const back = await mm.get(r.id);
    FMT.normalize(back);
    assert.equal((await mm.list()).maps[0].title, "C 语言数组");
    const a = await mm.add("数组", "用法", "- 初始化\n  - int a[3] = {1, 2, 3};");
    assert.equal(a.added, 2); assert.equal(a.under, "用法");
    const o2 = MM.toOutline(await mm.get(r.id));
    assert.ok(/ {4}- 越界：结果不确定\n {4}- 初始化\n {6}- int a\[3\]/.test(o2), o2);
    FMT.normalize(await mm.get(r.id));
    await assert.rejects(mm.add("数组", "不存在的节点", "- x"), /没有「不存在的节点」/);
    await assert.rejects(mm.resolve("量子力学"), /没找到.*C 语言数组/);
    ok("连上导图模块自己的服务：新建的导图存进它的文件夹、它自己读得回来；按名字找；在「用法」下面接着加，加完格式照样合格");

    // ---------- 当资料：先核对再回答 ----------
    const cs = await mm.chunks();
    assert.ok(cs.some((c) => /用法/.test(c.title) && /越界/.test(c.text)) && cs.every((c) => c.src === "思维导图：C 语言数组"));
    const g = G.create({ sources: [mm], llm: { chat: async (ms, opt) => (opt.mode === "ground" ? { content: "数组越界的结果是不确定的。[1]" } : { content: "第1句：有据[1]" }) } });
    const ans = await g.answer("数组越界会怎么样");
    assert.equal(ans.text, "数组越界的结果是不确定的。[1]"); assert.equal(ans.sources[0].src, "思维导图：C 语言数组");
    ok("导图按分支切段，当「先核对再回答」的资料：回答出处标着是哪张导图");

    // ---------- 捞小智的工具 ----------
    const T = Object.fromEntries(mm.tools().map((t) => [t.name, t]));
    assert.deepEqual(Object.keys(T), ["mindmap_list", "mindmap_read", "mindmap_make", "mindmap_add"]);
    assert.equal((await T.mindmap_list.run({})).total, 1);
    assert.ok(/初始化/.test((await T.mindmap_read.run({ map: "C 语言数组" })).outline));
    const mk = await T.mindmap_make.run({ title: "冒泡排序", outline: "- 思路\n  - 相邻比较\n- 复杂度\n  - O(n^2)" });
    assert.ok(mk.ok && /导图库/.test(mk.where));
    ok("捞小智的四个工具：列出、读、新建、接着加");
  } finally { srv.kill(); }

  // ---------- 服务没开：读写电脑版的导图文件夹 ----------
  const mm2 = MM.create({ ports: [await freePort()], dirs: [store] });
  const l2 = await mm2.list();
  assert.equal(l2.via, "files"); assert.equal(l2.maps.length, 2);
  assert.ok(/初始化/.test(MM.toOutline(await mm2.get((await mm2.resolve("数组")).id))));
  const r2 = await mm2.make("光合作用", "- 光反应\n- 暗反应");
  assert.equal(r2.via, "files"); FMT.normalize(JSON.parse(fs.readFileSync(path.join(store, r2.id, "map.json"), "utf8")));
  ok("导图服务没开：直接读电脑版的导图文件夹；新建的导图写成它的格式，下次打开导图库就有");

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("捞小智 × 捞捞思维导图：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
