#!/usr/bin/env node
// 捞捞算力 · 命令行版（给租来的 Linux 显卡用：没有界面，开着就领任务，按小时用完就退）
//
//   1. 租一台带 NVIDIA 显卡的 Linux（AutoDL / 恒源云这类，选 PyTorch 镜像），装 Node 22：
//        curl -fsSL https://npmmirror.com/mirrors/node/v22.22.0/node-v22.22.0-linux-x64.tar.xz | tar -xJ -C /opt && export PATH=/opt/node-v22.22.0-linux-x64/bin:$PATH
//   2. 拿到代码（只要 grid 文件夹）：git clone --depth 1 <仓库> && cd <仓库>/grid
//   3. 加入（控制中心发一个邀请链接）：node tools/worker.js join "LG1.xxxx" "租的4090"
//   4. 开始算：node tools/worker.js run            （Ctrl+C 停：正在算的交给别人从存档接着算，不丢）
//        --python python3     用哪个 Python（默认 python3；镜像里自带 PyTorch 的那个）
//        --work /root/lg      放任务文件的地方（默认 ~/laolao-grid-work，数据盘更好）
//        --llama /path/llama-server   要做「本地大模型」的任务时给出 llama-server 的路径
//        --hours 4            最多算几个小时（到点算完手上这个就停，免得忘了关机多花钱）
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const Agent = require("../worker/agent");
const Probe = require("../worker/probe");

const HOME = process.env.LG_WORKER_HOME || path.join(os.homedir(), ".laolao-grid");
const CFG = path.join(HOME, "worker.json");
const PIP = ["https://pypi.tuna.tsinghua.edu.cn/simple", "https://mirrors.aliyun.com/pypi/simple", "https://pypi.org/simple"];
const arg = (a, k, d) => { const i = a.indexOf(k); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
const say = (m) => console.log(new Date().toTimeString().slice(0, 8), m);

function pipInstall(py, pkgs) {
  return (async () => {
    for (const idx of PIP) {
      const ok = await new Promise((r) => { const p = spawn(py, ["-m", "pip", "install", "-q", ...pkgs, "-i", idx], { stdio: "inherit" }); p.on("exit", (c) => r(c === 0)); p.on("error", () => r(false)); });
      if (ok) return;
    }
    throw new Error("装不上：" + pkgs.join(" "));
  })();
}

async function join(a) {
  const [invite, name, dev] = a;
  if (!invite || !name) throw new Error('用法：node tools/worker.js join "邀请链接" "名字" [电脑名]');
  const j = await Agent.join(invite, name, { name: dev || os.hostname(), os: process.platform });
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(CFG, JSON.stringify({ server: j.server, token: j.token, pubkey: j.pubkey, member: j.member && j.member.name }, null, 1), { mode: 0o600 });
  say(`加入了：${j.server}（${name}）。下一步：node tools/worker.js run`);
  return j;
}

async function run(a, o = {}) {
  if (!fs.existsSync(CFG)) throw new Error("还没加入：先 node tools/worker.js join ...");
  const cfg = JSON.parse(fs.readFileSync(CFG, "utf8"));
  const py = arg(a, "--python", "python3");
  const work = path.resolve(arg(a, "--work", path.join(os.homedir(), "laolao-grid-work")));
  const hours = +arg(a, "--hours", 0);
  const llamaExe = arg(a, "--llama", null);
  fs.mkdirSync(work, { recursive: true });
  const pr = o.probe || (await Probe.full({ dir: work, server: cfg.server }));
  for (const it of pr.items) say(`体检 · ${it.name}：${it.value}${it.tip ? "（" + it.tip + "）" : ""}`);
  let llm = null;
  if (llamaExe) llm = require("../app/llmw").create({ exe: llamaExe, base: () => work });
  const caps = { ...pr.caps, llm: !!(llm && llm.ok()), rented: true };
  const ag = Agent.create({ server: cfg.server, token: cfg.token, pubkey: cfg.pubkey, workDir: work, python: py, caps, llm,
    ensure: (pkgs) => pipInstall(py, pkgs), version: "cli", policy: { mode: "always", yieldGames: false, maxTemp: 88 }, ...(o.agentOpt || {}) });
  ag.on("any", ({ k, v }) => {
    if (k === "log") say(v.msg || v);
    else if (k === "task") say(`领到任务：「${v.job.name}」`);
    else if (k === "progress" && v.note) process.stdout.write(`\r${Math.round((v.p || 0) * 100)}% ${v.note}`.slice(0, 160).padEnd(100) + "\r");
  });
  ag.setManual("on");   // 租来的就是用来算的：一直算
  ag.start();
  say(`开始算：${pr.caps.gpu || "（没找到显卡）"} · ${pr.caps.vram}G 显存。Ctrl+C 停止`);
  const stop = async (why) => { say(why + "：正在算的交给别人从存档接着算…"); await ag.stop(); say("停好了，可以关机了"); if (!o.noExit) process.exit(0); };
  process.on("SIGINT", () => stop("停止"));
  process.on("SIGTERM", () => stop("停止"));
  if (hours > 0) setTimeout(() => stop(`到了 ${hours} 小时`), hours * 3600e3).unref();
  return ag;
}

if (require.main === module) {
  const [cmd, ...a] = process.argv.slice(2);
  (cmd === "join" ? join(a) : cmd === "run" ? run(a) : Promise.reject(new Error("用法：node tools/worker.js join|run ...")))
    .catch((e) => { console.error("出错了：" + e.message); process.exit(1); });
}

module.exports = { join, run };
