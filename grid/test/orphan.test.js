// 软件上次退出 / 重启 / 更新时没收干净的配方（Windows 上子程序不跟着软件退出）：
//   还在后台训练、占着显卡，软件重新打开却显示「现在没有要算的」。
//   · 软件一打开就在后台收一遍（不挡着领任务）
//   · 没活的时候定期再看一眼
//   · 别的工位（第 2 块显卡 / CPU）自己的配方不误杀；手上正在跑的不杀
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawn } = require("child_process");
const Agent = require("../worker/agent");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms, what) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) throw new Error("等太久了：" + what); await sleep(50); } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-orphan-"));
  const work = path.join(tmp, "work"), lane = path.join(work, "gpu1");
  for (const d of [path.join(work, "recipes"), path.join(lane, "recipes")]) fs.mkdirSync(d, { recursive: true });
  // 一个「孤儿配方」：命令行里是这个工位的配方文件；另一个是第 2 块显卡工位自己的配方（不能动）
  // 用真的 Python 当「配方」（Windows 上只查名字是 python 的进程）
  const PY = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const fake = (dir) => { const c = spawn(PY, ["-c", "import time; time.sleep(600)", path.join(dir, "recipes", "abc.py")], { detached: process.platform !== "win32", stdio: "ignore", windowsHide: true }); c.unref(); return c.pid; };
  const orphan = fake(work), other = fake(lane);
  await sleep(200);
  assert(alive(orphan) && alive(other));

  // 真的列进程（Linux 读 /proc）
  if (process.platform === "linux" || process.platform === "win32") {
    const ps = await Agent.listProcs();
    assert(ps.some((p) => p.pid === orphan && p.cmd.includes(path.join(work, "recipes"))), "列得出孤儿配方的命令行");
    ok("能列出本机进程和命令行");
  }

  const logs = [];
  const a = Agent.create({ server: "http://127.0.0.1:9", token: "x", workDir: work, allowUnsigned: true, tickMs: 50, hbMs: 1e9, leaseEveryMs: 1e9,
    gpuInfo: async () => null, idleSecs: async () => 1e9, policy: { mode: "always" } });
  a.on("any", ({ k, v }) => { if (k === "log") logs.push(v.msg); });
  a.start();
  await until(() => !alive(orphan), 60000, "孤儿配方被收掉");   // Windows 上查进程（PowerShell）要几秒
  assert(alive(other), "别的工位自己的配方不动");
  assert(logs.some((l) => /不归软件管了/.test(l)), "日志里说清楚收掉了什么");
  await a.stop();
  ok("软件一打开就把上次留下的孤儿配方收掉（别的工位的不动）");

  // 不挡着领任务；手上正在跑的配方不算孤儿；只收命令行是自己配方文件夹的
  let listed = 0; const killed = [];
  const b = Agent.create({ server: "http://127.0.0.1:9", token: "x", workDir: path.join(tmp, "w2"), allowUnsigned: true, tickMs: 30,
    listProcs: async () => { listed++; return [{ pid: 424242, cmd: `python -u ${path.join(tmp, "w2", "recipes", "z.py")}` }, { pid: 434343, cmd: "python -u C:/别的程序/train.py" }]; },
    killProc: async (pid) => { killed.push(pid); } });
  b.start();
  await until(() => killed.length === 1, 3000, "收掉孤儿");
  assert.deepEqual(killed, [424242], "只收命令行是自己配方文件夹的");
  await b.stop();
  ok("只收命令行是这个工位配方文件夹的进程");

  if (process.platform === "win32") require("child_process").spawnSync("taskkill", ["/F", "/T", "/PID", String(other)], { windowsHide: true });
  else { try { process.kill(-other, "SIGKILL"); } catch (e) {} }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
