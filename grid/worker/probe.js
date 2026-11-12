// 体检：这台电脑的显卡、显存、驱动、温度、内存、硬盘、到调度中心的网速。
"use strict";
const os = require("os");
const fs = require("fs");
const { execFile } = require("child_process");

const run = (cmd, args, timeout = 8000) => new Promise((ok) => execFile(cmd, args, { timeout, windowsHide: true }, (e, out) => ok(e ? null : String(out))));

// nvidia-smi：Windows 上一般在 System32 或 NVSMI 目录
function smiPath() {
  if (process.platform !== "win32") return "nvidia-smi";
  for (const p of [process.env.SystemRoot && `${process.env.SystemRoot}\\System32\\nvidia-smi.exe`, "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe"]) if (p && fs.existsSync(p)) return p;
  return "nvidia-smi";
}

async function gpus(smi = smiPath()) {
  const out = await run(smi, ["--query-gpu=name,memory.total,memory.used,driver_version,temperature.gpu,utilization.gpu,power.draw,pcie.link.gen.max,pcie.link.width.max", "--format=csv,noheader,nounits"]);
  if (!out) return [];
  return out.trim().split(/\r?\n/).filter(Boolean).map((l) => {
    const [name, total, used, driver, temp, util, power, gen, width] = l.split(",").map((s) => s.trim());
    const n = (x) => (isFinite(+x) ? +x : null);
    return { name, vram: Math.round((n(total) || 0) / 1024 * 10) / 10, used: Math.round((n(used) || 0) / 1024 * 10) / 10, driver, temp: n(temp) == null ? null : Math.round(n(temp)), util: n(util), power: n(power), pcie: gen && width ? `PCIe ${gen}.0 x${width}` : "" };
  });
}
// 别的程序在用显卡吗（打游戏、剪视频）：除了我们自己的进程
async function gpuApps(smi = smiPath(), ours = []) {
  const out = await run(smi, ["--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader,nounits"]);
  if (!out) return [];
  return out.trim().split(/\r?\n/).filter(Boolean).map((l) => { const [pid, name, mem] = l.split(",").map((s) => s.trim()); return { pid: +pid, name, mem: +mem || 0 }; }).filter((a) => !ours.includes(a.pid));
}
async function disk(dir) {
  try { const s = await fs.promises.statfs(dir); return Math.round(s.bavail * s.bsize / 1e9); } catch (e) { return null; }
}

// 体检的结论：每一项 ok / warn / bad，加一句怎么办
async function full({ dir, server, fetchImpl = fetch, smi } = {}) {
  const g = await gpus(smi);
  const ramGB = Math.round(os.totalmem() / 2 ** 30);
  const freeGB = await disk(dir || os.homedir());
  const items = [];
  const gpu = g[0];
  if (!gpu) items.push({ k: "gpu", name: "显卡", state: "bad", value: "没找到 NVIDIA 显卡", tip: "装好 NVIDIA 显卡驱动后再体检；没有 N 卡也可以帮忙做人工审核和录表情" });
  else {
    items.push({ k: "gpu", name: "显卡", state: gpu.vram >= 8 ? "ok" : "warn", value: `${gpu.name} · ${gpu.vram}G 显存`, tip: gpu.vram >= 8 ? "" : "显存不到 8G，只能做小任务" });
    const dv = parseFloat(gpu.driver) || 0;
    items.push({ k: "driver", name: "显卡驱动", state: dv >= 572 ? "ok" : "bad", value: gpu.driver, tip: dv >= 572 ? "" : "50 系显卡要 572 以上的驱动（推荐最新的 Game Ready / Studio 驱动），到 NVIDIA 官网或 GeForce Experience 更新" });
    items.push({ k: "temp", name: "显卡温度", state: gpu.temp == null || gpu.temp < 80 ? "ok" : "warn", value: gpu.temp == null ? "—" : gpu.temp + "℃", tip: gpu.temp >= 80 ? "温度偏高：清清灰、机箱别贴墙" : "" });
    if (gpu.pcie) items.push({ k: "pcie", name: "显卡接口", state: "ok", value: gpu.pcie, tip: "" });
  }
  items.push({ k: "ram", name: "内存", state: ramGB >= 32 ? "ok" : ramGB >= 16 ? "warn" : "bad", value: ramGB + "G", tip: ramGB >= 32 ? "" : ramGB >= 16 ? "16G 能做大部分任务；大模型生成数据要 32G 以上" : "内存太小，只能做人工审核和录表情" });
  items.push({ k: "disk", name: "硬盘剩余", state: freeGB == null || freeGB >= 80 ? "ok" : freeGB >= 40 ? "warn" : "bad", value: freeGB == null ? "—" : freeGB + "G", tip: freeGB != null && freeGB < 80 ? "大模型和数据要 80G 左右：点下面「换个地方」放到空间大的盘（比如 D 盘）" : "" });
  let rtt = null, speed = null;
  if (server) {
    try {
      const t0 = Date.now(); const r = await fetchImpl(server + "/api/ping", { signal: AbortSignal.timeout(8000) }); await r.json(); rtt = Date.now() - t0;
    } catch (e) {}
    items.push({ k: "net", name: "到调度中心", state: rtt == null ? "bad" : rtt < 300 ? "ok" : "warn", value: rtt == null ? "连不上" : rtt + " 毫秒", tip: rtt == null ? "检查网络，或者问管理员调度中心开着没有" : rtt >= 300 ? "网络有点慢，不影响算，只是传文件慢" : "" });
  }
  const caps = { gpu: gpu ? gpu.name : "", vram: gpu ? gpu.vram : 0, ram: ramGB, disk: freeGB, os: process.platform === "win32" ? "windows" : process.platform, driver: gpu ? gpu.driver : "" };
  return { items, caps, gpus: g, rtt, speed, at: Date.now(), ok: !items.some((i) => i.state === "bad") };
}

module.exports = { gpus, gpuApps, full, disk, smiPath };
