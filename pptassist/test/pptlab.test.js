// PPT 操作工厂的练习场：出的题判得出对错（不改就判错、照参考做法改就判对）、同一个种子出同一道题、考试的题和练习的不重叠、命令行能用
"use strict";
const assert = require("assert");
const path = require("path");
const { spawn } = require("child_process");
const L = require("../core/pptlab");
const AGENT = require("../core/agent");
const ok = (m) => console.log("✓", m);

(async () => {
  const seen = {}, users = { train: new Set(), exam: new Set() };
  for (const split of ["train", "exam", "ood"]) for (let s = 0; s < 60; s++) {
    const t = await L.task(s, split);
    seen[split + ":" + t.fam] = 1;
    if (users[split]) users[split].add(t.system + t.messages.map((m) => m.content).join("|"));
    const c0 = await L.check(t.id, "好的。", []);
    if (!["delete_ask", "chat"].includes(t.fam)) assert.ok(!c0.ok, `${split} ${s} ${t.fam}：什么都没改却判对了`);
    const d = await L.demo(t.id);
    const c1 = await L.check(t.id, d.reply, d.calls);
    assert.ok(c1.ok, `${split} ${s} ${t.fam}：照参考做法改了却判错：${c1.why}`);
    L.close(t.id);
  }
  ok("每一道题：什么都不改判错；照参考做法真的去改，判对");
  for (const f of L.TRAIN_FAM) assert.ok(seen["train:" + f] || ["move", "chat", "delete_confirm", "table", "formula"].includes(f), "练习里出不到：" + f);
  for (const f of ["copy", "front", "font_exact"]) { assert.ok(seen["ood:" + f], "「没练过的」考试里出不到：" + f); assert.ok(!L.TRAIN_FAM.includes(f), f + " 不该出现在练习里"); }
  ok("练习覆盖十几种改法；复制页、放到最前面、定成具体字号只在「没练过的」考试里出");
  const a = await L.task(7, "exam"), b = await L.task(7, "exam");
  assert.deepStrictEqual(a.messages, b.messages); assert.equal(a.system, b.system);
  assert.equal([...users.exam].filter((x) => users.train.has(x)).length, 0, "考试的题和练习的重了");
  ok("同一个种子出同一道题（考试每次都一样）；考试的题和练习的不重叠");
  assert.deepStrictEqual(a.tools, AGENT.toolSchema()); assert.ok(a.system.startsWith(AGENT.SYSTEM));
  ok("给模型看的工具说明、系统提示和捞捞PPT助手里的一字不差");

  // 命令行：训练配方（Python）就是这么用的
  const p = spawn(process.execPath, [path.join(__dirname, "..", "core", "pptlab.js")], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
  let buf = ""; const waiters = [];
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); waiters.shift()(JSON.parse(l)); } });
  const ask = (m) => new Promise((r) => { waiters.push(r); p.stdin.write(JSON.stringify(m) + "\n"); });
  const t = await ask({ op: "task", seed: 3, split: "train" });
  assert.ok(t.ok && t.id && t.messages.length);
  const bad = await ask({ op: "tool", id: t.id, name: "get_slide", args: { slide: 99 } });
  assert.ok(bad.ok === false && /没有第 99 页/.test(bad.error));
  const ol = await ask({ op: "tool", id: t.id, name: "get_outline", args: {} });
  assert.ok(ol.ok && Array.isArray(ol.result));
  const dm = await ask({ op: "demo", id: t.id });
  const ck = await ask({ op: "check", id: t.id, reply: dm.reply, calls: dm.calls });
  assert.ok(ck.ok && ck.pass === true && ck.why === null, JSON.stringify(ck));
  p.stdin.end();
  await new Promise((r) => p.on("close", r));
  ok("命令行：出题、调工具（出错照实回）、示范、判对错");
  console.log("PPT 操作练习场：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
