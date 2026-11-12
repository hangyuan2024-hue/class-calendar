// 客户端后台：加入、体检、跑通测试、挂机规则（空闲 / 定时 / 让给游戏 / 暂停）、录表情（存本机 → 上传 → 交）、审核；表情参数标准
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const E = require("../shared/expr");
const Server = require("../server");
const Agent = require("../worker/agent");
const { createService } = require("../app/service");
const PY = process.env.PYTHON || "python3";
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-live-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");

// ---- 表情参数：用一张「假脸」（478 个点）测：自然 → 张嘴、闭左眼、挑眉、转头 ----
function face(o = {}) {
  const P = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const set = (i, x, y) => (P[i] = { x, y });
  const yaw = o.yaw || 0;
  set(10, 0.5, 0.2); set(152, 0.5, 0.8); set(234, 0.3, 0.5); set(454, 0.7, 0.5); set(1, 0.5 + yaw, 0.52);
  set(33, 0.38, 0.42); set(133, 0.46, 0.42); set(362, 0.54, 0.42); set(263, 0.62, 0.42);
  const eo = o.closeL ? 0.002 : 0.012;
  set(159, 0.42, 0.42 - eo); set(145, 0.42, 0.42 + eo); set(386, 0.58, 0.408); set(374, 0.58, 0.432);
  const bu = o.brow ? 0.03 : 0;
  set(105, 0.42, 0.37 - bu); set(334, 0.58, 0.37 - bu); set(55, 0.46, 0.38); set(285, 0.54, 0.38);
  const jaw = o.jaw || 0;
  set(13, 0.5, 0.65 - jaw / 2); set(14, 0.5, 0.652 + jaw / 2); set(61, 0.44, 0.65); set(291, 0.56, 0.65); set(0, 0.5, 0.63); set(17, 0.5, 0.68 + jaw);
  set(468, 0.42, 0.42); set(473, 0.58, 0.42);
  return P.map((p) => ({ x: p.x * 960, y: p.y * 720 }));
}
{
  const n = E.neutral([E.raw(face()), E.raw(face())]);
  const at = (o) => Object.fromEntries(E.NAMES.map((k, i) => [k, E.params(E.raw(face(o)), n)[i]]));
  const z = at({});
  assert.ok(E.NAMES.every((k) => Math.abs(z[k]) < 0.05), "自然表情应该接近 0：" + JSON.stringify(z));
  assert.ok(at({ jaw: 0.06 }).jawOpen > 0.5);
  const c = at({ closeL: true }); assert.ok(c.blinkL > 0.6 && c.blinkR < 0.1);
  assert.ok(at({ brow: true }).browUpL > 0.5);
  assert.ok(Math.abs(at({ yaw: 0.06 }).headYaw) > 0.3);
  assert.equal(E.PARAMS.length, 14);
  assert.deepEqual(E.check({ frames: 100, faceFrames: 70, rms: 0.005, peak: 0.5, secs: 2, chars: 30 }).length, 3);
  ok("表情参数标准：自然≈0；张嘴、闭左眼（右眼不动）、挑眉、转头都认得出；录音质量检查（没拍到脸、太小声、太快）");
}

(async () => {
  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 3000 });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());
  const plan = path.join(tmp, "plan.json");
  fs.writeFileSync(plan, JSON.stringify({ jobs: [
    { name: "录表情", kind: "record", params: { items: [{ lines: ["同学们好", "今天学冒泡排序"] }] } },
    { name: "画候选", kind: "map", recipe: path.join(__dirname, "..", "recipes", "demo_avatar.py"), params: { count: 2, reviewNeed: 1 } },
  ] }));
  const [recJob] = await Tools.plan(admin, plan);
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 5, server: url });

  // ---- 客户端后台：加入 ----
  const EV = [];
  let idle = 0, games = [];
  const svc = createService({ user: path.join(tmp, "me"), version: "t", python: PY, send: (ch, d) => EV.push({ ch, d }),
    idleSecs: async () => idle, agentOpt: { tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300, gpuInfo: async () => ({ temp: 60 }), gpuApps: async () => games } });
  let st = await svc.H.status();
  assert.equal(st.joined, false);
  await assert.rejects(svc.H.join("乱写的", "我"), /邀请链接不对/);
  st = await svc.H.join(inv.link, "小明", "测试电脑");
  assert.ok(st.joined && st.me.name === "小明" && st.deviceId);
  const pr = await svc.H.probe();
  assert.ok(pr.items.find((i) => i.k === "net").state === "ok");
  ok("加入训练网（邀请链接）、体检（这台没显卡，会提示；到调度中心的网速正常）");

  // ---- 挂机规则：默认空闲 5 分钟才算 ----
  await sleep(600);
  assert.equal(svc.agent().status().state, "waiting");
  assert.match(svc.agent().status().why, /空闲/);
  idle = 3600;
  for (let i = 0; i < 150 && app.core.jobDetail(2).state !== "done"; i++) await sleep(100);
  assert.equal(app.core.jobDetail(2).state, "done", "空闲了就算完了");
  idle = 0;
  await svc.H.setPolicy({ mode: "schedule", from: "00:00", to: "00:00" });
  await sleep(400);
  assert.match(svc.agent().status().why, /只在/);
  await svc.H.setPolicy({ mode: "always" });
  games = [{ pid: 1, name: "C:\\Games\\genshin.exe", mem: 3000 }];
  await sleep(400);
  assert.match(svc.agent().status().why, /在用显卡/);
  games = [];
  await svc.H.pause(true); await sleep(300);
  assert.equal(svc.agent().status().state, "paused");
  await svc.H.pause(false);
  ok("挂机规则：默认空闲 5 分钟才算；定时；有游戏占着显卡就让；暂停");

  // ---- 生成的图：本机预览（只给工作文件夹里的）----
  assert.ok(EV.some((e) => e.ch === "agent" && e.d.k === "image" && /^data:image\/png;base64,/.test(e.d.v.url)));
  assert.equal(await svc.H.thumb("/etc/passwd"), null);
  ok("刚生成的图送到界面（data:），别的文件读不到");

  // ---- 跑通测试（这台没装 PyTorch：说清楚）----
  const t = await svc.H.test();
  assert.equal(t.ok, false); assert.ok(/PyTorch|显卡/.test(t.why));
  assert.ok(EV.some((e) => e.ch === "test" && e.d.k === "source"));
  ok("跑通测试：没装 PyTorch / 看不到显卡时说清楚怎么办：" + t.why);

  // ---- 录表情 ----
  const r = await svc.H.recordNext(null);
  assert.equal(r.item.job.id, recJob);
  const params = { version: 1, names: E.NAMES, text: "同学们好", secs: 1.6, frames: [[0, ...E.params(E.raw(face()), null)]] };
  await svc.H.recordSave(r.item.task.id, 0, new Uint8Array([26, 69, 223, 163, 1, 2, 3]), params);
  await svc.H.recordSave(r.item.task.id, 1, new Uint8Array([26, 69, 223, 163, 4, 5]), { ...params, text: "今天学冒泡排序" });
  await svc.H.recordSubmit(r.item.task.id, r.item.job.id, 4.2);
  const rd = app.core.jobDetail(recJob);
  assert.equal(rd.state, "done"); assert.equal(rd.outputs.length, 4);
  const pj = rd.outputs.find((o) => /s000\.json$/.test(o.key));
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, "server", "blobs", ...pj.key.split("/")), "utf8")).names.length, 14);
  ok("录表情：每句的录音 + 表情参数先存本机，交的时候一起上传（没有视频）；任务完成");

  // ---- 审核 ----
  const rv = await svc.H.reviewNext();
  assert.ok(rv.item.payload.aUrl);
  await svc.H.vote(rv.item.id, "a");
  const board = await svc.H.board();
  assert.ok(board[0].name === "小明" && board[0].points > 0 && board[0].reviews === 1);
  ok("人工审核和贡献榜（算力 + 录表情 + 审核都有积分）");

  // ---- 被移出 ----
  app.core.setDevice(st.deviceId, { disabled: true });
  await sleep(800);
  assert.equal(svc.agent().status().state, "offline");
  assert.ok(EV.some((e) => e.ch === "kicked"));
  ok("管理员移出这台电脑：客户端马上知道，停下");

  await svc.shutdown(); app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("客户端：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
