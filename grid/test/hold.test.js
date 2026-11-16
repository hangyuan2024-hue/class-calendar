// 一台电脑自己的环境坏了（配方要的包装不上、显存被占、慢得不正常）：
//   不能 2 秒一个把任务挨个领来弄「失败」（以前这样把一千多个画 Q版 的任务都记了一次失败）
//   → 任务不记失败、还给调度中心；这台电脑歇一会儿再试；报错里写清楚为什么
"use strict";
process.removeAllListeners("warning");
process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const Server = require("../server");
const Agent = require("../worker/agent");
const Env = require("../app/env");

const PY = process.env.PYTHON || "python3";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-hold-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms, what) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) throw new Error("等太久了：" + what); await sleep(50); } };

(async () => {
  // ---------- 训练环境：装好的包不再叫 pip；装不上要说清楚原因 ----------
  {
    const cmds = [];
    const env = Env.create({ dir: path.join(tmp, "env"), python: PY, onEvent: (e) => { if (e.cmd) cmds.push(e.msg); } });
    assert.deepStrictEqual(await env.missing(["pip", "pip>=1", "pip<1", "laolao-no-such-pkg>=2"]), ["pip<1", "laolao-no-such-pkg>=2"]);
    await env.ensure(["pip>=1"]);
    assert.strictEqual(cmds.length, 0);
    ok("配方要的包已经装好、版本也对：不叫 pip（不联网也能开始算）");
    const gone = Env.create({ dir: path.join(tmp, "env2"), python: path.join(tmp, "nowhere", "python.exe") });
    await assert.rejects(() => gone.ensure(["transformers>=4.45,<5"]), /装不上：transformers>=4\.45,<5（训练环境的 Python 不在了.*一键安装/);
    ok("训练环境的 Python 不在了：报错里直接说「重装训练环境」，不是一句没头没尾的「装不上」");
    // pip 报硬盘满了 → 说人话，不再换镜像白试
    const fake = path.join(tmp, "fakepy.py");
    fs.writeFileSync(fake, "import sys\nif '-c' in sys.argv: print('[\"x\"]'); sys.exit(0)\nprint(\"ERROR: Could not install packages due to an OSError: [Errno 28] No space left on device\", file=sys.stderr); sys.exit(1)\n");
    const sh = path.join(tmp, process.platform === "win32" ? "fakepy.cmd" : "fakepy.sh");
    fs.writeFileSync(sh, process.platform === "win32" ? `@"${PY}" "${fake}" %*\r\n` : `#!/bin/sh\nexec ${PY} "${fake}" "$@"\n`, { mode: 0o755 });
    if (process.platform !== "win32") {
      const n = []; const full = Env.create({ dir: path.join(tmp, "env3"), python: sh, onEvent: (e) => { if (e.cmd) n.push(1); } });
      await assert.rejects(() => full.ensure(["x"]), /装不上：x（硬盘满了/);
      assert.strictEqual(n.length, 1);
      ok("硬盘满了：报错写「硬盘满了：去清理 / 搬到别的盘」，不再换镜像白试");
    }
  }

  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 5000 });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 10, server: url });
  const join = (n) => Agent.join(inv.link, n, { name: n + "的电脑", info: { gpu: "RTX 5060", vram: 8 } });
  const tasksOf = async (id) => (await Tools.api(admin, "/api/admin/job?id=" + id, null, "GET")).tasks;

  // ---------- 包装不上：任务不记失败，这台电脑歇着，修好了接着算 ----------
  {
    const rc = path.join(tmp, "need_pkg.py");
    fs.writeFileSync(rc, "# requires: laolao-some-pkg>=1\nimport lg\nt = lg.task()\nlg.done(ok=1)\n");
    const planFile = path.join(tmp, "p1.json");
    fs.writeFileSync(planFile, JSON.stringify({ jobs: [{ name: "要装包的任务", kind: "map", recipe: rc, params: { count: 6 }, priority: 3 }] }));
    const [jobId] = await Tools.plan(admin, planFile);
    let broken = true, tries = 0;
    const cred = await join("丁");
    const a = Agent.create({ server: cred.server, token: cred.token, pubkey: cred.pubkey, workDir: path.join(tmp, "a"), python: PY, caps: { gpu: "RTX 5060", vram: 8, ram: 32 }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300,
      holdMin: [0.03, 0.03], ensure: async (pkgs) => { tries++; if (broken) throw new Error("装不上：" + pkgs.join(" ") + "（硬盘满了：到「设置 → 硬盘」清理一下）"); } });
    const states = []; a.on("state", (s) => states.push(s));
    a.start();
    await until(() => states.some((s) => /现在算不了.*硬盘满了.*分钟后自动再试/.test(s.why || "")), 8000, "歇着");
    await sleep(900);
    assert.ok(tries <= 2, "歇着的时候不再一个接一个地领：" + tries);
    let ts = await tasksOf(jobId);
    assert.ok(ts.every((t) => !t.errors && t.state !== "failed"), "任务不记失败");
    ok(`配方要的包装不上：任务一个都没记失败（以前一轮记 6 个），这台电脑歇着（只试了 ${tries} 次），状态里写着原因和几分钟后再试`);
    broken = false;
    await until(async () => (await tasksOf(jobId)).every((t) => t.state === "done"), 30000, "修好了接着算");
    ok("过一会儿自动再试：环境好了，6 个任务照常算完");
    await a.stop();
  }

  // ---------- 配方说「这台电脑现在算不了」（显存被占、慢得不正常）：一样处理 ----------
  {
    const rc = path.join(tmp, "unfit.py");
    fs.writeFileSync(rc, "import lg, sys\nt = lg.task()\nlg.unfit('显存只空着 3.0G：关掉占显存的程序再算')\nsys.exit(1)\n");
    const planFile = path.join(tmp, "p2.json");
    fs.writeFileSync(planFile, JSON.stringify({ jobs: [{ name: "显存不够的任务", kind: "map", recipe: rc, params: { count: 3 }, priority: 3 }] }));
    const [jobId] = await Tools.plan(admin, planFile);
    const cred = await join("贺");
    const a = Agent.create({ server: cred.server, token: cred.token, pubkey: cred.pubkey, workDir: path.join(tmp, "b"), python: PY, caps: { gpu: "RTX 4060", vram: 8, ram: 32 }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300, holdMin: [10] });
    const states = []; a.on("state", (s) => states.push(s));
    let n = 0; a.on("task", () => n++);
    a.start();
    await until(() => states.some((s) => /现在算不了：显存只空着 3\.0G/.test(s.why || "")), 10000, "歇着");
    await sleep(600);
    const ts = await tasksOf(jobId);
    assert.strictEqual(n, 1);
    assert.ok(ts.every((t) => !t.errors && t.state === "queued"), JSON.stringify(ts.map((t) => [t.state, t.errors])));
    ok("配方发现显存被占 / 慢得不正常：任务不记失败、留给别的电脑，这台电脑歇着");
    a.setManual("on");
    await until(() => n >= 2, 5000, "点开始马上再试");
    ok("修好以后点「开始」：不用等，马上再试");
    await a.stop();
  }

  // ---------- 旧版客户端（不会说 env）报「装不上」：调度中心也不记任务失败；以前记错的清掉 ----------
  {
    const rc = path.join(tmp, "plain.py");
    fs.writeFileSync(rc, "import lg\nt = lg.task()\nlg.done(ok=1)\n");
    const planFile = path.join(tmp, "p3.json");
    fs.writeFileSync(planFile, JSON.stringify({ jobs: [{ name: "旧客户端", kind: "map", recipe: rc, params: { count: 2 }, priority: 9 }] }));
    const [jobId] = await Tools.plan(admin, planFile);
    const cred = await join("旧");
    const api = (p, b) => fetch(cred.server + p, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + cred.token }, body: JSON.stringify(b) }).then((r) => r.json());
    const L = await api("/api/lease", { caps: { gpu: "x", vram: 8 } });
    await api("/api/fail", { task: L.task.id, error: "装配方要的包：transformers>=4.45,<5\n出错：装不上：transformers>=4.45,<5" });
    const ts = await tasksOf(jobId);
    assert.ok(ts.every((t) => !t.errors));
    ok("旧版客户端报「装不上」：调度中心认得出来，也不记任务失败");
  }
  await app.close();
  console.log("环境坏了不连累任务：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
