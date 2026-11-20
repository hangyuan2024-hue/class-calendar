// 远程协助：管理员在控制中心发起 → 对方电脑弹窗问 → 同意了才开始；画面、鼠标键盘经调度中心转发；
//   只看模式不执行操作（中转和对方电脑各挡一次）；拒绝 / 设置里关掉 / 任何一边结束都马上停；同一个请求不会问两次。
//   同局域网：找到对方、直接发起，画面不经过调度中心；看画面的接口只给本机 + 钥匙。
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const Server = require("../server");
const { createService } = require("../app/service");
const Relay = require("../shared/assist-relay");
const Inject = require("../app/inject");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms, what) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) throw new Error("等太久了：" + (typeof what === "function" ? what() : what)); await sleep(30); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-assist-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");
const JPG = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");

(async () => {
  // ---------- 中转本身：过期、只看模式不收操作、口令不对不行 ----------
  {
    let t = 1000;
    const R = Relay.create({ now: () => t, noTimer: true, waitMs: 20 });
    const s = R.start({ device: 1, name: "A", mode: "control" });
    assert.throws(() => R.answer({ s: s.id, token: "错的", ok: true }), /会话不对/);
    t += 91e3; R.sweep();
    assert.strictEqual(R.get(s.id).state, "expired");
    const v = R.start({ device: 2, name: "B", mode: "view" });
    R.answer({ s: v.id, token: v.token, ok: true, mode: "control" });
    assert.strictEqual(R.get(v.id).mode, "view", "请求只看，对方点了操控也只给看");
    assert.ok(R.input(v.id, [{ t: "move", x: 0.5, y: 0.5 }]).dropped);
    assert.deepStrictEqual((await R.take({ s: v.id, token: v.token })).ev, []);
    R.frame({ s: v.id, token: v.token, jpeg: "abc", w: 10, h: 10 });
    t += 61e3; R.sweep();
    assert.strictEqual(R.get(v.id).state, "ended", "发起的人一分钟没来看：结束");
    ok("中转：对方 90 秒不回应就取消；只看模式收不了操作；会话口令不对不能冒充；发起的人关了窗口自动结束");
  }
  assert.deepStrictEqual(Inject.clean([{ t: "move", x: 9, y: -3 }, { t: "key", vk: 17, down: 1 }, { t: "rm -rf" }, { t: "text", s: "你好" }]), [{ t: "move", x: 1, y: 0 }, { t: "key", vk: 17, down: true }, { t: "text", s: "你好" }]);
  ok("执行操作前只认鼠标、按键、打字几种，数值夹在范围里");

  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 5000 });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 5, server: url });
  const A = (p, b) => Tools.api(admin, p, b, b ? "POST" : "GET");

  // 被协助的电脑：弹窗由 answerWith 决定；截屏、执行操作都是假的，记下来
  let answerWith = "control", asked = 0, live = null, ended = null;
  const injected = [], caps = [];
  const svc = createService({ user: path.join(tmp, "me"), version: "t", send: () => {},
    agentOpt: { tickMs: 100, hbMs: 200, leaseEveryMs: 100000, gpuInfo: async () => null, gpuApps: async () => [] },
    assistAsk: async (q) => { asked++; caps.push(q); return answerWith; },
    capture: async () => ({ jpeg: JPG, w: 1600, h: 900 }),
    injectorFactory: () => ({ send: (e) => injected.push(...Inject.clean(e)), close() {} }),
    assistLive: (x) => { live = x; }, assistEnd: (x) => { ended = x; },
    assistOpt: { fps: 20 } });
  await svc.H.join(inv.link, "小红", "笔记本");
  const devId = (await svc.H.status()).deviceId;

  // ---------- 控制中心发起 → 对方同意（查看和操控）→ 看到画面 → 鼠标键盘过去 → 管理员结束 ----------
  {
    const r = await A("/api/admin/device/assist", { id: devId, mode: "control" });
    await until(() => live, 8000, "对方同意");
    assert.strictEqual(asked, 1); assert.strictEqual(caps[0].by, "管理员"); assert.strictEqual(caps[0].mode, "control");
    let v = await A(`/api/admin/assist/view?s=${r.s}&after=0`);
    if (!v.frame) v = await A(`/api/admin/assist/view?s=${r.s}&after=0`);
    assert.strictEqual(v.state, "live"); assert.strictEqual(v.mode, "control");
    assert.strictEqual(Buffer.from(v.frame.jpeg, "base64").toString("hex"), JPG.toString("hex"));
    assert.strictEqual(v.frame.w, 1600);
    await A("/api/admin/assist/input", { s: r.s, ev: [{ t: "move", x: 0.25, y: 0.5 }, { t: "down", b: 0, x: 0.25, y: 0.5 }, { t: "up", b: 0, x: 0.25, y: 0.5 }, { t: "text", s: "同学你好" }, { t: "key", vk: 13, down: true }] });
    await until(() => injected.length >= 5, 5000, () => "操作送到：" + JSON.stringify(injected));
    assert.deepStrictEqual(injected.map((e) => e.t), ["move", "down", "up", "text", "key"]);
    assert.strictEqual(injected[3].s, "同学你好");
    await A("/api/admin/assist/end", { s: r.s });
    await until(() => ended, 5000, "对方那边也停了");
    assert.strictEqual(ended.why, "对方结束了");
    const n = injected.length;
    await sleep(300);
    assert.strictEqual(injected.length, n);
    const evs = app.core.db.prepare("select msg from events order by id").all().map((x) => x.msg).join("\n");
    assert.match(evs, /管理员 请求远程协助「小红 · 笔记本」/); assert.match(evs, /同意了远程协助（查看和操控）/); assert.match(evs, /远程协助「小红 · 笔记本」结束：管理员结束了/);
    ok("控制中心发起：对方弹窗同意后才开始；画面过来、点击和打字（中文）过去；管理员点结束，对方马上停；动态里留了记录");
  }

  // ---------- 对方只允许查看：操作一律不执行 ----------
  {
    live = null; ended = null; answerWith = "view";
    const r = await A("/api/admin/device/assist", { id: devId, mode: "control" });
    await until(() => live, 8000, "对方同意");
    assert.strictEqual(live.mode, "view");
    const before = injected.length;
    const x = await A("/api/admin/assist/input", { s: r.s, ev: [{ t: "text", s: "不该出现" }] });
    assert.ok(x.dropped);
    await sleep(300);
    assert.strictEqual(injected.length, before);
    svc.H.assistEnd();
    await until(async () => (await A(`/api/admin/assist/status?s=${r.s}`)).state === "ended", 5000, "对方点结束");
    assert.strictEqual((await A(`/api/admin/assist/status?s=${r.s}`)).why, "你点了结束");
    ok("对方只允许查看：管理员发的操作一个都不执行；对方点红条上的「结束协助」，管理员那边马上看到结束了");
  }

  // ---------- 拒绝 / 设置里关掉（不弹窗直接拒绝）----------
  {
    answerWith = null;
    const r = await A("/api/admin/device/assist", { id: devId, mode: "control" });
    await until(async () => (await A(`/api/admin/assist/status?s=${r.s}`)).state === "rejected", 8000, "拒绝");
    await svc.H.setSettings({ assist: false });
    const k = asked;
    const r2 = await A("/api/admin/device/assist", { id: devId, mode: "view" });
    await until(async () => (await A(`/api/admin/assist/status?s=${r2.s}`)).state === "rejected", 8000, "自动拒绝");
    assert.strictEqual(asked, k, "关掉以后不弹窗");
    await svc.H.setSettings({ assist: true });
    ok("对方点拒绝：不开始；对方在设置里关了「允许远程协助」：直接拒绝，连窗都不弹");
  }

  // ---------- 同局域网：两台电脑直接连，画面不经过调度中心 ----------
  {
    const disco = 40000 + Math.floor(Math.random() * 20000);
    let bAsk = 0, bLive = null;
    const bInj = [];
    // 同一台电脑上开两个：各听各的 UDP 端口（Windows 上两个程序共用一个端口时，发过来的只有一个收得到）
    const mk = (name, dp, extra) => createService({ user: path.join(tmp, name), version: "t", send: () => {}, lan: true, lanOpt: { port: 0, host: "127.0.0.1", discoPort: dp }, ...extra });
    const me = mk("lanA", disco + 1, {});
    const peer = mk("lanB", disco, { assistAsk: async () => { bAsk++; return "control"; }, capture: async () => ({ jpeg: JPG, w: 800, h: 600 }),
      injectorFactory: () => ({ send: (e) => bInj.push(...Inject.clean(e)), close() {} }), assistLive: (x) => { bLive = x; }, assistOpt: { fps: 20 } });
    await sleep(300);
    const list = await me.lan.discover({ ms: 400, targets: [`127.0.0.1:${disco}`] });
    const p = list.find((x) => x.port === peer.lan.port());
    assert.ok(p, "找到了对方：" + JSON.stringify(list));
    assert.ok(p.accepts);
    let opened = null;
    const r = await me.lan.assist(p, "control");
    opened = r.url;
    await until(() => bLive, 8000, "对方同意");
    assert.strictEqual(bAsk, 1); assert.match(bLive.where, /同一局域网/);
    const base = `http://127.0.0.1:${me.lan.port()}`;
    const key = new URLSearchParams(opened.split("#")[1]).get("k");
    const v = await (await fetch(`${base}/lan/v/view?s=${r.s}&after=0`, { headers: { "x-lan-key": key } })).json();
    const v2 = v.frame ? v : await (await fetch(`${base}/lan/v/view?s=${r.s}&after=0`, { headers: { "x-lan-key": key } })).json();
    assert.strictEqual(v2.state, "live"); assert.ok(v2.frame && v2.frame.w === 800);
    assert.strictEqual((await fetch(`${base}/lan/v/view?s=${r.s}`, { headers: { "x-lan-key": "guessed-key" } })).status, 403, "没有钥匙看不了");
    assert.strictEqual((await fetch(`${base}/viewer.html`)).status, 200);
    await fetch(`${base}/lan/v/input`, { method: "POST", headers: { "x-lan-key": key, "content-type": "application/json" }, body: JSON.stringify({ s: r.s, ev: [{ t: "wheel", d: -120 }] }) });
    await until(() => bInj.some((e) => e.t === "wheel"), 5000, "滚轮送到");
    await fetch(`${base}/lan/v/end`, { method: "POST", headers: { "x-lan-key": key, "content-type": "application/json" }, body: JSON.stringify({ s: r.s }) });
    await until(() => !peer.assistDev.current(), 5000, "对方停了");
    await me.shutdown(); await peer.shutdown();
    ok(`同局域网：广播找到对方（${p.name}），点一下发请求，对方同意后画面直接传到本机窗口、滚轮过去；没有本机钥匙看不了；结束后对方马上停`);
  }

  await svc.shutdown();
  app.close();
  console.log("远程协助：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
