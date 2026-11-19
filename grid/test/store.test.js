// 训练文件「新的放广州 COS、旧的留本机」（调度中心在香港，香港到内地晚上很慢）：
//   新上传的训练文件 → COS；旧文件、网页上传的录音、配方 → 本机；同名重传以新的为准；
//   每天下载上限到了新文件先存本机；自检；控制中心看得到；存档在 COS 上也能分段下、本机留的存档能核对
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const Server = require("../server");
const Agent = require("../worker/agent");
const FakeS3 = require("./fake_s3");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.env.NO_PROXY = process.env.no_proxy = "127.0.0.1,localhost";

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-store-"));
  const s3 = FakeS3.create(); const s3port = await s3.listen();
  const env = { GRID_COS_ENDPOINT: `http://127.0.0.1:${s3port}`, GRID_COS_REGION: "ap-guangzhou", GRID_COS_BUCKET: "laolao-test", GRID_COS_KEY_ID: "k", GRID_COS_SECRET: "s", GRID_COS_PATHSTYLE: "1", GRID_COS_DAILY_GB: "20" };
  const data = path.join(tmp, "data");
  // 以前（只用本机磁盘时）留下的文件
  const oldBody = crypto.randomBytes(5000);
  fs.mkdirSync(path.join(data, "blobs", "jobs", "1", "1"), { recursive: true });
  fs.writeFileSync(path.join(data, "blobs", "jobs", "1", "1", "ckpt-100-old.pt"), oldBody);

  let app = Server.create({ data, env, noTick: true });
  let port = await app.listen(0, "127.0.0.1");
  const fix = (u) => u.replace(/^http:\/\/127\.0\.0\.1:\d+\/blob\//, `http://127.0.0.1:${port}/blob/`);
  assert.equal(app.store.kind, "hybrid");

  // 1. 新上传的训练文件 → COS；网页上传的录音、配方 → 本机
  const put = app.store.url("PUT", "jobs/2/3/ckpt-200-a.pt", 600);
  assert.ok(put.startsWith(`http://127.0.0.1:${s3port}/laolao-test/grid/jobs/2/3/`), put);
  assert.ok(app.store.url("PUT", "logs/5/x.txt", 600).includes(`:${s3port}/`));
  assert.ok(app.store.url("PUT", "imports/1-a.m4a", 600).includes(`:${port}/blob/`), "网页上传的录音留本机（浏览器直接传 COS 会被跨域拦）");
  assert.ok(app.store.url("PUT", "recipes/x.py", 600).includes(`:${port}/blob/`));
  ok("新上传的训练文件、日志放 COS；控制中心网页上传的录音、配方留本机");

  // 2. 真的传上去、再下回来（客户端的下载：大文件分段、小文件一个请求）
  const big = crypto.randomBytes(20 * 1048576), bf = path.join(tmp, "big.pt");
  fs.writeFileSync(bf, big);
  await Agent.xfer("PUT", put, bf);
  assert.ok(s3.objs.get("grid/jobs/2/3/ckpt-200-a.pt").equals(big), "传到了 COS，文件名带 grid/ 前缀");
  assert.ok(!fs.existsSync(path.join(data, "blobs", "jobs", "2", "3", "ckpt-200-a.pt")), "香港本机没有");
  const get = app.store.url("GET", "jobs/2/3/ckpt-200-a.pt", 600);
  assert.ok(get.includes(`:${s3port}/`), "本机没有 → COS 的链接");
  s3.S.log.length = 0;
  const back = path.join(tmp, "back.pt");
  await Agent.xfer("GET", get, back);
  assert.ok(fs.readFileSync(back).equals(big));
  assert.ok(s3.S.log.filter((l) => /^GET .* bytes=/.test(l)).length >= 3, "大文件从 COS 分段下");
  ok("存档传到 COS、从 COS 分段下回来，一字不差（不经过香港）");

  // 3. 以前的文件还在本机：照旧从本机给
  const og = app.store.url("GET", "jobs/1/1/ckpt-100-old.pt", 600);
  assert.ok(og.includes(`:${port}/blob/`), og);
  const r0 = await fetch(fix(og)); assert.equal(r0.status, 200); assert.ok(Buffer.from(await r0.arrayBuffer()).equals(oldBody));
  ok("以前存在本机的文件照旧能下");

  // 4. 同名重传：拿了上传地址却没传（断网、关电脑）→ 旧的还在（以前是发地址就把旧的删了 → 两边都没有、404）；传完了以新的为准
  const pu = app.store.url("PUT", "jobs/1/1/ckpt-100-old.pt", 600);
  assert.ok(pu.includes(`:${port}/blob/`), "本机已经有这个名字：新的也传本机（传完一下子换掉），不先删旧的");
  const rk = await fetch(fix(app.store.url("GET", "jobs/1/1/ckpt-100-old.pt", 600))); assert.equal(rk.status, 200, "拿了地址还没传：旧的照样能下"); assert.ok(Buffer.from(await rk.arrayBuffer()).equals(oldBody));
  const newer = crypto.randomBytes(3000), nf = path.join(tmp, "newer.pt"); fs.writeFileSync(nf, newer);
  await Agent.xfer("PUT", fix(pu), nf);
  const r1 = await fetch(fix(app.store.url("GET", "jobs/1/1/ckpt-100-old.pt", 600))); assert.ok(Buffer.from(await r1.arrayBuffer()).equals(newer));
  ok("同一个名字重传：发上传地址时不删旧的（没传完旧的还在）；传完以新的为准");

  // 5. 自检：通的；策略没配写入 → 说清楚原因
  const token = app.core.adminToken();
  const api = async (p, b) => (await fetch(`http://127.0.0.1:${port}${p}`, { method: b ? "POST" : "GET", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined })).json();
  let t = await api("/api/admin/store/test", {});
  assert.ok(t.ok && t.head, JSON.stringify(t));
  s3.S.denyPut = true;
  t = await api("/api/admin/store/test", {});
  assert.ok(!t.ok && /传不上去：403 AccessDenied/.test(t.why) && /PutObject/.test(t.why), JSON.stringify(t));
  s3.S.denyPut = false;
  ok("自检：通了就说通了；写不进去说清楚是策略里缺 PutObject");

  // 6. 控制中心看得到今天的用量
  await sleep(300);
  let d = await api("/api/admin/dl?days=1");
  assert.equal(d.store.kind, "hybrid"); assert.ok(d.store.links >= 1 && d.store.put >= 2 && d.store.dailyGB === 20, JSON.stringify(d.store));
  assert.ok(d.store.gb >= 0.019, "按文件大小记了下载量：" + d.store.gb);
  ok(`控制中心：今天广州存储发出下载约 ${d.store.gb}G / 上限 20G，新文件 ${d.store.put} 个放广州`);

  // 7. 每天上限：到了以后新文件先存本机（不花钱），已经在 COS 上的照样能下；重启后今天的用量还记得；第二天恢复
  app.close(); await sleep(100);
  app = Server.create({ data, env: { ...env, GRID_COS_DAILY_GB: "0.01" }, noTick: true });
  port = await app.listen(0, "127.0.0.1");
  assert.ok(app.store.usage().gb >= 0.019 && app.store.usage().over, "重启后今天的用量还在：" + JSON.stringify(app.store.usage()));
  const p2 = app.store.url("PUT", "jobs/2/3/ckpt-300-a.pt", 600);
  assert.ok(p2.includes(`:${port}/blob/`), "到上限了：新文件存本机");
  assert.ok(app.store.url("GET", "jobs/2/3/ckpt-200-a.pt", 600).includes(`:${s3port}/`), "已经在 COS 上的只能从 COS 下");
  assert.equal(app.store.usage().putLocal, 1);
  ok("到了每天上限：新文件先存香港本机，已经在广州的照样能下；重启不丢今天的用量");

  // 8. 没配 COS：和以前一模一样（全在本机）
  app.close(); await sleep(100);
  app = Server.create({ data: path.join(tmp, "plain"), env: {}, noTick: true });
  port = await app.listen(0, "127.0.0.1");
  assert.equal(app.store.kind, "local");
  assert.ok(app.store.url("PUT", "jobs/9/9/x.pt", 600).includes("/blob/"));
  const t2 = await (await fetch(`http://127.0.0.1:${port}/api/admin/store/test`, { method: "POST", headers: { authorization: "Bearer " + app.core.adminToken(), "content-type": "application/json" }, body: "{}" })).json();
  assert.ok(!t2.ok && /还没配/.test(t2.why));
  app.close();
  ok("没配 COS：和以前一样全在本机");

  s3.close();
  console.log("训练文件存储：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
