// 在浏览器里跑客户端界面（测试 / 截图用）：起一个调度中心 + 几台模拟电脑在算示例任务，再起「我的电脑」的客户端后台，界面走 HTTP
//   node test/ui-server.js <界面端口> <调度中心端口>
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
const Server = require("../server");
const Agent = require("../worker/agent");
const { createService } = require("../app/service");
const uiPort = +process.argv[2] || 8901, srvPort = +process.argv[3] || 8902;
const PY = process.env.PYTHON || "python3";
const ROOT = path.join(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-ui-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");

(async () => {
  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 8000 });
  await app.listen(srvPort, "127.0.0.1");
  const url = `http://127.0.0.1:${srvPort}`;
  const admin = await Tools.login(url, app.core.adminToken());
  fs.writeFileSync(path.join(tmp, "admin-token.txt"), app.core.adminToken());
  const slow = +(process.env.SLOW || 1);
  const plan = path.join(tmp, "plan.json");
  fs.writeFileSync(plan, JSON.stringify({ jobs: [
    { name: "生成 Q版候选（第一批）", stage: "阶段 1 · 数据", kind: "map", recipe: path.join(ROOT, "recipes/demo_avatar.py"), params: { count: 40, reviewNeed: 2, sleep: 0.6 * slow }, priority: 1 },
    { name: "录表情（讲课 30 段）", stage: "阶段 1 · 数据", kind: "record", params: { items: Array.from({ length: 30 }, (_, i) => ({ lines: ["同学们好，今天我们来学习冒泡排序。", "大家先看这一组数：五、三、八、一。", "相邻的两个数比较，大的往后换。", "第一轮结束，最大的数就到了最后。", "这就是冒泡排序的基本思路，大家记住了吗？"] })) } },
    { name: "声音→表情 模型（接力训练）", stage: "阶段 2 · 训练", kind: "relay", recipe: path.join(ROOT, "recipes/demo_relay.py"), params: { totalSteps: 3000, segSteps: 600, ckptEvery: 50, sleep: 0.03 * slow }, priority: 3 },
    { name: "捞捞Q版 插件（三台一起训）", stage: "阶段 3 · Q版模型", kind: "diloco", recipe: path.join(ROOT, "recipes/demo_diloco.py"), params: { rounds: 30, width: 3, innerSteps: 60, minDone: 2, roundSecs: 30, sleep: 0.05 * slow }, priority: 2 },
  ] }));
  await Tools.plan(admin, plan);
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 20, server: url });
  const invAdmin = await Tools.api(admin, "/api/admin/invite", { maxUses: 1, role: "admin", server: url });
  // 三位同事的电脑
  const others = [["张三", "家里台式机"], ["李四", "游戏本"], ["王五", "书房电脑"]];
  for (const [n, d] of others) {
    const j = await Agent.join(inv.link, n, { name: d, info: { gpu: "NVIDIA GeForce RTX 5060", vram: 8, ram: 32 } });
    const a = Agent.create({ server: url, token: j.token, pubkey: j.pubkey, workDir: path.join(tmp, "w-" + n), python: PY, caps: { gpu: "NVIDIA GeForce RTX 5060", vram: 8, ram: 32 }, tickMs: 400, hbMs: 1500, renewMs: 1500,
      gpuInfo: async () => ({ name: "NVIDIA GeForce RTX 5060", vram: 8, used: 5.6 + Math.random(), temp: 66 + Math.round(Math.random() * 6), util: 88 + Math.round(Math.random() * 10), power: 128 + Math.random() * 10, driver: "581.57" }) });
    a.start();
  }
  // 我的电脑：真的客户端后台
  const EV = [];
  const user = path.join(tmp, "me");
  const svc = createService({ user, version: "test", python: PY, send: (ch, d) => { EV.push({ ch, d }); if (EV.length > 3000) EV.splice(0, 1000), (EV.base = (EV.base || 0) + 1000); },
    agentOpt: { tickMs: 400, hbMs: 1500, renewMs: 1500, gpuInfo: async () => ({ name: "NVIDIA GeForce RTX 5060", vram: 8, used: 6.1, temp: 71, util: 93, power: 131, driver: "581.57" }), gpuApps: async () => [] } });
  fs.writeFileSync(path.join(tmp, "invite.txt"), invAdmin.link);
  console.log(JSON.stringify({ tmp, url, invite: invAdmin.link, adminToken: app.core.adminToken() }));
  const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".png": "image/png", ".data": "application/octet-stream", ".binarypb": "application/octet-stream" };
  const RR = path.join(ROOT, "app", "renderer");
  http.createServer((q, r) => {
    if (q.url.startsWith("/events")) {
      const since = +(new URL(q.url, "http://x").searchParams.get("since") || 0), base = EV.base || 0;
      r.setHeader("content-type", "application/json");
      return r.end(JSON.stringify({ next: base + EV.length, ev: EV.slice(Math.max(0, since - base)) }));
    }
    if (q.method === "POST" && q.url === "/call") {
      let b = ""; q.on("data", (c) => (b += c));
      return q.on("end", async () => {
        try {
          const { method, args } = JSON.parse(b);
          const a = args.map((x) => (x && x.__b64 ? new Uint8Array(Buffer.from(x.__b64, "base64")) : x));
          if (!Object.prototype.hasOwnProperty.call(svc.H, method)) throw new Error("不支持：" + method);
          const res = await svc.H[method](...a);
          r.end(JSON.stringify({ ok: true, r: res === undefined ? null : res }));
        } catch (e) { r.end(JSON.stringify({ ok: false, e: e.message })); }
      });
    }
    const f = path.join(RR, decodeURIComponent(q.url.split("?")[0]).replace(/^\/$/, "/index.html"));
    if (!f.startsWith(RR) || !fs.existsSync(f)) { r.statusCode = 404; return r.end(); }
    r.setHeader("Content-Type", TYPES[path.extname(f)] || "application/octet-stream"); fs.createReadStream(f).pipe(r);
  }).listen(uiPort);
})().catch((e) => { console.error(e); process.exit(1); });
