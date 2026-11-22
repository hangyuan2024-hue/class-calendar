// 网络慢：「领任务」的请求要好久才回来。以前下一轮又发一个，调度中心对已经领了任务的电脑把同一个任务再给一遍，
//   同一个任务开了两份（两份训练抢一块显卡），先结束的那份把状态改成「现在没有要算的」，另一份其实还在算。
//   现在：同一时间只发一个领任务请求；手上有任务就不再开第二份；一个结束了、手上还有别的在算，状态照实写「在算」
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const Agent = require("../worker/agent");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-onelease-"));
  let leases = 0, inflight = 0, maxInflight = 0;
  const L = { task: { id: 7, kind: "map", seq: 0, input: {} }, job: { id: 3, name: "答题训练", kind: "map", params: {} }, recipe: { id: "a".repeat(64), name: "qa_train", sig: "x", url: "" }, resume: null };
  const srv = http.createServer((req, res) => {
    let body = ""; req.on("data", (d) => (body += d));
    req.on("end", async () => {
      const send = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
      if (req.url.startsWith("/api/lease")) {
        leases++; inflight++; maxInflight = Math.max(maxInflight, inflight);
        await sleep(600);   // 网络慢：比两轮领任务的间隔还长
        inflight--;
        return send({ task: { ...L, recipe: { ...L.recipe, url: `http://127.0.0.1:${srv.address().port}/recipe` } } });   // 调度中心对已经领了任务的电脑：还是给同一个
      }
      if (req.url.startsWith("/recipe")) return;   // 配方一直下不完：任务一直在手上
      send({});
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  let tasks = 0;
  const a = Agent.create({ server: url, token: "x", workDir: path.join(tmp, "w"), allowUnsigned: true, noSweep: true, tickMs: 30, leaseEveryMs: 100, hbMs: 1e9,
    gpuInfo: async () => null, idleSecs: async () => 1e9, policy: { mode: "always" }, dlTries: 1, retryMs: 0 });
  a.on("any", ({ k, v }) => { if (k === "task") tasks++; if (process.env.DBG && (k === "log" || k === "state")) console.log(k, JSON.stringify(v).slice(0, 160)); });
  a.start();
  await sleep(2500);
  assert.equal(maxInflight, 1, "同一时间只发一个领任务的请求");
  assert.equal(tasks, 1, "同一个任务只开一份");
  assert.equal(a.status().state, "busy", "手上有任务：状态是「在算」");
  ok(`网络慢也只领一次、只开一份（领任务请求 ${leases} 次，同时最多 ${maxInflight} 个）`);
  a.stop().catch(() => {});
  srv.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  console.log("全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
