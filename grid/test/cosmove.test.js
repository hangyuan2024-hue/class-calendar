// 训练文件搬到单独的存储桶（server/cos-move.js）：只复制登记过、旧桶里还有、新桶里还没有的；先桶到桶直接复制，不行就经过服务器；
//   复制完核对大小；旧桶里的东西一个不动；--dry 只看不动手。复制用的签名把 x-amz-copy-source 也签进去（不签真的 COS 会拒）。
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const ok = (m) => console.log("✓", m);
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-cosmove-"));
  const data = path.join(tmp, "data");
  const Server = require("../server");
  const app = Server.create({ data, noTick: true, env: {} });
  const db = app.core.db;
  const K = { a: "jobs/37/2122/ckpt-800-ckpt-800-aaaa1111.pt", b: "jobs/20/2500/out-x-bbbb2222.jsonl", gone: "jobs/37/2122/ckpt-746-ckpt-746.pt", loc: "jobs/1/1/old-local.pt", lost: "jobs/37/2122/ckpt-700-ckpt-700.pt", log: "logs/3/1731-log.txt", big: "jobs/37/2122/ckpt-900-ckpt-900-cccc3333.pt" };
  db.prepare("insert into ckpts(job_id,task_id,step,key,kind,created) values(37,2122,800,?,'part',1)").run(K.a);
  db.prepare("insert into ckpts(job_id,task_id,step,key,kind,created) values(37,2122,746,?,'part',1)").run(K.gone);
  db.prepare("insert into ckpts(job_id,task_id,step,key,kind,created) values(37,2122,700,?,'lost-part',1)").run(K.lost);
  db.prepare("insert into ckpts(job_id,task_id,step,key,kind,created) values(37,2122,900,?,'part',1)").run(K.big);
  db.prepare("insert into outputs(job_id,task_id,name,key,size,created) values(20,2500,'out-x.jsonl',?,3,1)").run(K.b);
  db.prepare("insert into outputs(job_id,task_id,name,key,size,created) values(1,1,'old.pt',?,3,1)").run(K.loc);
  db.prepare("insert into device_logs(device_id,key,name,created) values(3,?,'log.txt',1)").run(K.log);
  fs.mkdirSync(path.dirname(app.store.file(K.loc)), { recursive: true }); fs.writeFileSync(app.store.file(K.loc), "本机");
  app.close();
  // 假的 COS（路径式：/桶/grid/…）：复制要把 x-amz-copy-source 签进去；canCopy=false 时不支持桶到桶
  const B = { "old-b": new Map(), "new-b": new Map() }; let canCopy = true; const log = [];
  B["old-b"].set("grid/" + K.a, Buffer.from("存档800")); B["old-b"].set("grid/" + K.b, Buffer.from("数据")); B["old-b"].set("grid/" + K.lost, Buffer.from("x")); B["old-b"].set("grid/" + K.log, Buffer.from("日志")); B["old-b"].set("grid/" + K.big, Buffer.alloc(300000, 9));
  B["new-b"].set("grid/" + K.b, Buffer.from("数据"));   // 已经有了
  const cos = http.createServer((q, r) => {
    const u = new URL(q.url, "http://x"); const [, bucket, ...rest] = u.pathname.split("/"); const key = rest.map(decodeURIComponent).join("/"); const m = B[bucket];
    if (!m) return r.writeHead(404).end("<Error><Code>NoSuchBucket</Code></Error>");
    const signed = (u.searchParams.get("X-Amz-SignedHeaders") || "").split(";");
    if (q.method === "HEAD") return m.has(key) ? r.writeHead(200, { "content-length": m.get(key).length, "content-type": "application/octet-stream" }).end() : r.writeHead(404).end();
    if (q.method === "GET") return m.has(key) ? r.writeHead(200, { "content-length": m.get(key).length }).end(m.get(key)) : r.writeHead(404).end();
    if (q.method === "PUT") {
      const cs = q.headers["x-amz-copy-source"] || q.headers["x-cos-copy-source"];
      if (cs) {
        q.resume(); const hn = q.headers["x-amz-copy-source"] ? "x-amz-copy-source" : "x-cos-copy-source";
        if (!signed.includes(hn)) return r.writeHead(403).end("<Error><Code>AccessDenied</Code><Message>headers not signed</Message></Error>");
        if (!canCopy) return r.writeHead(501).end("<Error><Code>NotImplemented</Code></Error>");
        const sp = decodeURIComponent(cs).replace(/^\//, "").replace(/^[^/]*\.myqcloud\.com\//, "old-b/").split("/"); const sb = sp.shift(), sk = sp.join("/");
        if (!B[sb] || !B[sb].has(sk)) return r.writeHead(404).end("<Error><Code>NoSuchKey</Code></Error>");
        m.set(key, B[sb].get(sk)); log.push("copy " + key); return r.writeHead(200).end("<CopyObjectResult></CopyObjectResult>");
      }
      const bs = []; q.on("data", (c) => bs.push(c)); q.on("end", () => { m.set(key, Buffer.concat(bs)); log.push("put " + key); r.writeHead(200).end(); }); return;
    }
    r.writeHead(405).end();
  });
  await new Promise((d) => cos.listen(0, "127.0.0.1", d));
  const env = { GRID_COS_BUCKET: "old-b", GRID_COS_REGION: "ap-guangzhou", GRID_COS_ENDPOINT: `http://127.0.0.1:${cos.address().port}`, GRID_COS_KEY_ID: "id", GRID_COS_SECRET: "sk", GRID_COS_PREFIX: "grid", GRID_COS_PATHSTYLE: "1" };
  const M = require("../server/cos-move.js");
  const said = []; const L = { dataDir: data, log: (m) => said.push(m) };
  const snapshot = () => [...B["old-b"].entries()].map(([k, v]) => k + v.length).join();
  const old0 = snapshot();
  // --dry：只看
  let r = await M.main(["--to", "new-b", "--dry"], env, L);
  assert.equal(r.todo, 3); assert.equal(r.local, 1); assert.equal(r.gone, 1); assert.equal(r.already, 1); assert.equal(B["new-b"].size, 1, "--dry 不动手");
  // 真的复制：桶到桶
  r = await M.main(["--to", "new-b"], env, L);
  assert.equal(r.copied, 3); assert.equal(r.failed, 0); assert.equal(r.how["桶到桶"], 3);
  for (const k of [K.a, K.log, K.big]) assert.ok(B["new-b"].get("grid/" + k).equals(B["old-b"].get("grid/" + k)), "复制得一字不差：" + k);
  assert.ok(!B["new-b"].has("grid/" + K.lost), "标成丢失的不搬"); assert.ok(!B["new-b"].has("grid/" + K.loc), "香港本机的不搬");
  assert.equal(snapshot(), old0, "旧桶里一个都没动");
  assert.equal((await M.main(["--to", "new-b"], env, L)).todo, 0, "再跑一次：都有了，不重复复制");
  ok("切换之前 --to 新桶：只搬登记过、旧桶里还有、新桶里没有的（标成丢失的、香港本机的不搬）；桶到桶直接复制、一字不差；旧桶不动；--dry 只看；再跑不重复");
  // 腾讯云不支持桶到桶 / 被拒：经过服务器下载再上传
  B["new-b"].clear(); canCopy = false;
  r = await M.main(["--to", "new-b"], env, L);
  assert.equal(r.copied, 4); assert.equal(r.how["经过服务器"], 4); assert.ok(B["new-b"].get("grid/" + K.big).equals(B["old-b"].get("grid/" + K.big)));
  ok("桶到桶复制用不了：自动改成经过服务器下载再上传，传完核对大小");
  // 切换之后 --from 旧桶（环境里已经是新桶）
  canCopy = true; B["new-b"].delete("grid/" + K.a);
  r = await M.main(["--from", "old-b"], { ...env, GRID_COS_BUCKET: "new-b" }, L);
  assert.equal(r.copied, 1); assert.ok(B["new-b"].has("grid/" + K.a));
  await assert.rejects(M.main(["--to", "old-b"], env, L), /同一个/); await assert.rejects(M.main([], env, L), /二选一/);
  ok("切换之后 --from 旧桶：把切换那会儿落在旧桶的补过来；新旧写成同一个桶、不写方向都会拦住");
  cos.close();
  console.log("搬存储桶：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
