// 一键下载安装整合包：从国内存储下压缩包（断点续传、校验）→ 7-Zip 解压 → 找到解压出来的文件夹。
//   comfyui：ComfyUI 官方 Windows 整合包（AI 形象的引擎）
//   gsv：GPT-SoVITS 官方 Windows 整合包（声音克隆；50 系显卡用 gsv50 那一版）
//   hy3d：Hunyuan3D-2 WinPortable（AI 3D 形象）
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const DL = require("./dl");

const NAMES = { comfyui: "AI 引擎（ComfyUI）", gsv: "声音克隆（GPT-SoVITS）", hy3d: "AI 3D 形象（Hunyuan3D-2）" };
// 国内存储里还没有时的后备地址（只有 ComfyUI 有固定的「最新版」下载地址）
const FALLBACK = {
  comfyui: { name: "ComfyUI_windows_portable_nvidia.7z", urls: ["https://ghfast.top/", "https://gh-proxy.com/", ""].map((g) => g + "https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z") },
};
// 解压后大约要多少空间（压缩包大小的倍数）
const GROW = { comfyui: 3, gsv: 2.5, hy3d: 2.5 };
// 解压到哪个子文件夹（只用英文：GPT-SoVITS 这些整合包放在有中文的路径里会出错）
const SUB = { comfyui: "LaolaoAI-ComfyUI", gsv: "LaolaoAI-GPT-SoVITS", hy3d: "LaolaoAI-Hunyuan3D" };

function sevenZip() {
  try { return require("7zip-bin").path7za.replace(/app\.asar([\\/])/, "app.asar.unpacked$1"); } catch (e) { return process.platform === "win32" ? "7z.exe" : "7za"; }
}

// 7-Zip 解压，-bsp1 把百分比打到标准输出
function extract(archive, dir, { onProg, signal, bin } = {}) {
  return new Promise((ok, bad) => {
    const p = spawn(bin || sevenZip(), ["x", archive, "-o" + dir, "-y", "-bsp1", "-bso0"], { windowsHide: true });
    let err = "";
    const kill = () => { try { p.kill(); } catch (e) {} };
    if (signal) signal.addEventListener("abort", kill, { once: true });
    p.stdout.on("data", (d) => { const m = /(\d{1,3})%/.exec(d.toString()); if (m && onProg) onProg(+m[1] / 100); });
    p.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
    p.on("error", (e) => bad(new Error("解压程序没启动起来：" + e.message)));
    p.on("close", (c) => {
      if (signal && signal.aborted) return bad(new Error("已经停了"));
      if (c === 0) return ok();
      bad(new Error(/Can not open|is not archive|Unexpected end/i.test(err) ? "压缩包坏了（可能没下完整），删掉重新下载" : /space|磁盘|disk/i.test(err) ? "硬盘空间不够了" : "解压出错：" + err.trim().split("\n").pop()));
    });
  });
}

// 在解压出来的东西里找整合包的文件夹
function findRoot(dir, test, depth = 2) {
  if (test(dir)) return dir;
  if (depth <= 0) return null;
  let subs = []; try { subs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")); } catch (e) {}
  for (const e of subs) { const r = findRoot(path.join(dir, e.name), test, depth - 1); if (r) return r; }
  return null;
}
const TESTS = {
  comfyui: (d) => fs.existsSync(path.join(d, "ComfyUI", "main.py")),
  gsv: (d) => fs.existsSync(path.join(d, "api_v2.py")),
  hy3d: (d) => fs.existsSync(path.join(d, "hy3dgen")) || fs.existsSync(path.join(d, "Hunyuan3D-2", "hy3dgen")) || fs.existsSync(path.join(d, "python_standalone")),
};

// kind：comfyui / gsv / hy3d；parent：装到哪个文件夹里；gpu：显卡名字（50 系的 GPT-SoVITS 用另一版）
// onMsg({ stage: "download" | "check" | "extract", got, total, speed, p, i, n, name })
async function install(kind, parent, { mirror, gpu = "", onMsg, signal, fetch: doFetch, bin, extraSpace = 0 } = {}) {
  if (!NAMES[kind]) throw new Error("没有这个整合包");
  if (/[^\x00-\x7f]/.test(parent) || /\s/.test(parent)) throw new Error("选的文件夹路径里有中文或空格，整合包放在这种地方会出错：换一个只有英文和数字的文件夹（比如 D:\\AI）");
  let kk = kind;
  if (kind === "gsv" && /RTX\s*50\d0/i.test(gpu)) kk = "gsv50";
  let p = mirror ? (await mirror.pkg(kk)) || (kk !== kind ? await mirror.pkg(kind) : null) : null;
  let parts;
  if (p) parts = p.parts.map((x) => ({ name: x.name, size: x.size, sha256: x.sha256, urls: mirror.sources ? mirror.sources(x) : [x.url] }));
  else if (FALLBACK[kind]) parts = [{ name: FALLBACK[kind].name, size: 0, urls: FALLBACK[kind].urls }];
  else throw new Error(`国内存储里还没有${NAMES[kind]}的整合包：先在 GitHub 仓库的 Actions 里运行一次「AI 组件搬到国内存储」`);
  const size = parts.reduce((s, x) => s + (x.size || 0), 0);
  const need = size * GROW[kind] + extraSpace;
  const free = DL.freeBytes(parent);
  if (size && free < need) throw new Error(`这个盘的空间不够：要大约 ${Math.ceil(need / 1e9)}G，只剩 ${Math.floor(free / 1e9)}G。换一个空间大的盘（最好不是 C 盘）`);
  fs.mkdirSync(parent, { recursive: true });
  const home = path.join(parent, SUB[kind]);
  const dlDir = path.join(home, "_downloading");
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const x = parts[i], dest = path.join(dlDir, x.name);
    await DL.download(x.urls, dest, { fetch: doFetch, signal, want: { size: x.size, sha256: x.sha256 },
      onProg: (m) => onMsg && onMsg(m.checking ? { stage: "check", name: x.name, i, n: parts.length } : { stage: "download", name: x.name, i, n: parts.length, got: m.got, total: m.total, speed: m.speed }) });
    files.push(dest);
  }
  onMsg && onMsg({ stage: "extract", p: 0 });
  await extract(files[0], home, { onProg: (v) => onMsg && onMsg({ stage: "extract", p: v }), signal, bin });
  fs.rmSync(dlDir, { recursive: true, force: true });   // 压缩包删掉，省空间
  const root = findRoot(home, TESTS[kind], 3);
  if (!root) throw new Error("解压好了，但没找到" + NAMES[kind] + "的文件夹");
  return { dir: root, ver: p ? p.ver : "", size };
}

module.exports = { install, extract, findRoot, sevenZip, NAMES, FALLBACK, SUB };
