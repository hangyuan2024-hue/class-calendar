// 捞捞编程 · 一键安装 Java、Node.js（JavaScript）、Go
// 先用国内镜像，不行再换官方地址；断点续传；装在用户数据目录/toolchains/<名字>，不改系统 PATH、不碰别的软件。
// C / C++（mingw64）和 Python 在安装包里自带（打包时 GitHub Actions 下载好放进 resources/toolchains）。
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { downloadFile, fetchText } = require("./net");

const TOOLS = {
  java: {
    name: "Java（JDK 21）", size: "约 190 MB", minBytes: 120e6, check: ["bin/java.exe", "bin/java"],
    sources: [
      { index: "https://mirrors.tuna.tsinghua.edu.cn/Adoptium/21/jdk/x64/windows/", pattern: /OpenJDK21U-jdk_x64_windows_hotspot_[\d._]+\.zip/g },
      { index: "https://mirrors.ustc.edu.cn/adoptium/releases/temurin21-binaries/LatestRelease/", pattern: /OpenJDK21U-jdk_x64_windows_hotspot_[\d._]+\.zip/g },
      { url: "https://mirrors.huaweicloud.com/openjdk/21/openjdk-21_windows-x64_bin.zip" },
      { url: "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse" },
    ],
  },
  node: {
    name: "JavaScript（Node.js 20）", size: "约 30 MB", minBytes: 20e6, check: ["node.exe", "bin/node"],
    sources: [
      { url: "https://registry.npmmirror.com/-/binary/node/v20.18.1/node-v20.18.1-win-x64.zip" },
      { url: "https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/v20.18.1/node-v20.18.1-win-x64.zip" },
      { url: "https://nodejs.org/dist/v20.18.1/node-v20.18.1-win-x64.zip" },
    ],
  },
  go: {
    name: "Go 1.23", size: "约 75 MB", minBytes: 50e6, check: ["bin/go.exe", "bin/go"],
    sources: [
      { url: "https://golang.google.cn/dl/go1.23.4.windows-amd64.zip" },
      { url: "https://mirrors.aliyun.com/golang/go1.23.4.windows-amd64.zip" },
      { url: "https://go.dev/dl/go1.23.4.windows-amd64.zip" },
    ],
  },
};

function installed(tool, userDir) {
  const t = TOOLS[tool]; if (!t) return false;
  return t.check.some((c) => fs.existsSync(path.join(userDir, tool, c)));
}

// 镜像目录页里挑最新的文件名
async function resolve(src) {
  if (src.url) return src.url;
  const html = await fetchText(src.index, 15000);
  const names = [...new Set(String(html).match(src.pattern) || [])];
  if (!names.length) throw new Error("镜像里没找到安装包");
  const ver = (n) => (n.match(/\d+/g) || []).map(Number);
  names.sort((a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; });
  return new URL(names[names.length - 1], src.index).href;
}

// Windows 10 起自带的 tar.exe 能解 zip；Linux / Mac 上测试用 tar / unzip
function extract(file, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const zip = /\.zip$/i.test(file) || (() => { try { const b = Buffer.alloc(2); const fd = fs.openSync(file, "r"); fs.readSync(fd, b, 0, 2, 0); fs.closeSync(fd); return b.toString() === "PK"; } catch (e) { return false; } })();
  const [cmd, args] = process.platform === "win32" || !zip ? ["tar", ["-xf", file, "-C", dest]] : ["unzip", ["-q", "-o", file, "-d", dest]];
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; p.stderr.on("data", (d) => (err += d));
    p.on("error", rej);
    p.on("close", (c) => (c === 0 ? res() : rej(new Error("解压失败：" + err.slice(-300)))));
  });
}

// 解压出来的东西外面通常套一层文件夹（jdk-21.0.5+11、node-v20…、go）：找到真正的那一层
function findRoot(dir, check, depth = 0) {
  if (check.some((c) => fs.existsSync(path.join(dir, c)))) return dir;
  if (depth > 2) return null;
  for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); if (fs.statSync(p).isDirectory()) { const r = findRoot(p, check, depth + 1); if (r) return r; } }
  return null;
}

// onProgress({ phase: "download"|"extract"|"done", got, total, source })
async function install(tool, userDir, onProgress = () => {}, signal = {}) {
  const t = TOOLS[tool]; if (!t) throw new Error("没有这个工具：" + tool);
  if (installed(tool, userDir)) return path.join(userDir, tool);
  const dl = path.join(userDir, ".downloads"); fs.mkdirSync(dl, { recursive: true });
  let lastErr = null, file = null;
  for (const src of t.sources) {
    if (signal.aborted) throw new Error("已取消");
    try {
      const url = await resolve(src);
      const host = new URL(url).host;
      const dest = path.join(dl, tool + ".zip");
      await downloadFile(url, dest, (got, total) => onProgress({ phase: "download", got, total, source: host }), signal);
      if (fs.statSync(dest).size < t.minBytes) { fs.rmSync(dest, { force: true }); throw new Error("下载的文件不完整"); }
      file = dest; break;
    } catch (e) {
      lastErr = e;
      if (signal.aborted) throw e;
      try { fs.rmSync(path.join(dl, tool + ".zip.part"), { force: true }); } catch (e2) {}   // 换一个地址就从头下
    }
  }
  if (!file) throw new Error("下载失败：" + (lastErr ? lastErr.message : "所有地址都连不上") + "。检查一下网络，再点一次会接着下");
  onProgress({ phase: "extract" });
  const tmp = path.join(userDir, ".tmp-" + tool);
  fs.rmSync(tmp, { recursive: true, force: true });
  await extract(file, tmp);
  const root = findRoot(tmp, t.check);
  if (!root) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error("安装包里没找到程序，可能下载坏了，再试一次"); }
  const target = path.join(userDir, tool);
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(root, target);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(file, { force: true });
  onProgress({ phase: "done" });
  return target;
}

function uninstall(tool, userDir) { fs.rmSync(path.join(userDir, tool), { recursive: true, force: true }); }

module.exports = { TOOLS, installed, install, uninstall, extract, findRoot, resolve };
