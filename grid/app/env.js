// 训练环境：独立的 Python 3.11 + PyTorch（50 系显卡要 CUDA 12.8 版）+ 常用的包。
// 装在软件自己的文件夹里，不碰电脑上原来的 Python。每一步的输出实时送到界面（「实时代码反馈」）。
// 下载走国内镜像：Python 安装包（华为云 / npmmirror / python.org），PyTorch（阿里云 / 南大 / 官方），其它包（清华 / 阿里云）。
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { xfer } = require("../worker/agent");

const PY_VER = "3.11.9";
const PY_URLS = [
  `https://mirrors.huaweicloud.com/python/${PY_VER}/python-${PY_VER}-amd64.exe`,
  `https://registry.npmmirror.com/-/binary/python/${PY_VER}/python-${PY_VER}-amd64.exe`,
  `https://www.python.org/ftp/python/${PY_VER}/python-${PY_VER}-amd64.exe`,
];
const TORCH = [
  ["-f", "https://mirrors.aliyun.com/pytorch-wheels/cu128/"],
  ["--index-url", "https://mirror.nju.edu.cn/pytorch/whl/cu128"],
  ["--index-url", "https://download.pytorch.org/whl/cu128"],
];
const PIP = ["https://pypi.tuna.tsinghua.edu.cn/simple", "https://mirrors.aliyun.com/pypi/simple"];
const BASE_PKGS = ["numpy", "pillow", "safetensors", "tqdm"];

function create({ dir, onEvent, python: given }) {
  const pyDir = path.join(dir, "python");
  const pyExe = () => given || (process.platform === "win32" ? path.join(pyDir, "python.exe") : "python3");
  let child = null, cancelled = false;
  const say = (stage, msg, extra = {}) => onEvent && onEvent({ stage, msg, ...extra });

  const run = (cmd, args, stage) => new Promise((ok, bad) => {
    say(stage, "$ " + [path.basename(cmd), ...args].join(" "), { cmd: true });
    child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", PIP_DISABLE_PIP_VERSION_CHECK: "1" } });
    const pipe = (s) => { let b = ""; s.on("data", (d) => { b += d.toString("utf8"); let i; while ((i = b.search(/[\r\n]/)) >= 0) { const l = b.slice(0, i); b = b.slice(i + 1); if (l.trim()) say(stage, l); } }); };
    pipe(child.stdout); pipe(child.stderr);
    child.on("error", bad);
    child.on("exit", (c) => { child = null; c === 0 ? ok() : bad(new Error(`${path.basename(cmd)} 退出码 ${c}`)); });
  });
  const out = (cmd, args) => new Promise((ok) => execFile(cmd, args, { windowsHide: true, timeout: 60000 }, (e, so) => ok(e ? null : String(so))));

  // 现在装到哪一步了
  async function check() {
    const exe = pyExe();
    const r = await out(exe, ["-c", "import sys,json\nr={'python':sys.version.split()[0]}\ntry:\n import torch;r['torch']=torch.__version__;r['cuda']=torch.cuda.is_available();r['cudaVer']=torch.version.cuda\nexcept Exception as e: r['torchErr']=str(e)[:200]\ntry:\n import numpy;r['numpy']=numpy.__version__\nexcept Exception: pass\nprint(json.dumps(r))"]);
    if (!r) return { python: null, exe, ok: false };
    const j = JSON.parse(r.trim().split("\n").pop());
    return { ...j, exe, ok: !!(j.torch && j.cuda && j.numpy) };
  }

  async function install({ skipTorch } = {}) {
    cancelled = false;
    fs.mkdirSync(dir, { recursive: true });
    const exe = pyExe();
    // 1. Python
    if (!(await out(exe, ["--version"]))) {
      if (process.platform !== "win32") throw new Error("这台电脑不是 Windows：自己装好 Python 3.10 以上，在设置里选它");
      const inst = path.join(dir, `python-${PY_VER}-amd64.exe`);
      let got = false;
      for (const u of PY_URLS) {
        if (cancelled) throw new Error("取消了");
        try { say("python", "下载 Python " + PY_VER + "：" + new URL(u).host); await xfer("GET", u, inst, { onProgress: (a, b) => say("python", null, { progress: b ? a / b : 0 }) }); got = true; break; }
        catch (e) { say("python", "这个地址不行：" + e.message); }
      }
      if (!got) throw new Error("Python 安装包下载不下来，检查一下网络");
      say("python", "安装 Python（只装在捞捞算力自己的文件夹里）");
      await run(inst, ["/quiet", "InstallAllUsers=0", `TargetDir=${pyDir}`, "Include_launcher=0", "PrependPath=0", "Include_test=0", "Include_doc=0", "Shortcuts=0", "AssociateFiles=0"], "python");
      fs.rmSync(inst, { force: true });
    }
    say("python", "Python 好了", { done: true });
    // 2. 基础的包
    const pip = (args, stage) => run(exe, ["-m", "pip", "install", "--upgrade", ...args], stage);
    let ok = false;
    for (const idx of PIP) { try { await pip([...BASE_PKGS, "-i", idx], "pkgs"); ok = true; break; } catch (e) { if (cancelled) throw e; say("pkgs", "换一个镜像再试"); } }
    if (!ok) throw new Error("装 numpy 这些基础包失败");
    say("pkgs", "基础的包装好了", { done: true });
    // 3. PyTorch（CUDA 12.8 版，50 系显卡要它）
    if (!skipTorch) {
      ok = false;
      for (const src of TORCH) {
        try { await pip(["torch", "torchvision", ...src, "--extra-index-url", PIP[0]], "torch"); ok = true; break; }
        catch (e) { if (cancelled) throw e; say("torch", "换一个镜像再试"); }
      }
      if (!ok) throw new Error("PyTorch 装不上：换个时间再试，或者问管理员要离线安装包");
      say("torch", "PyTorch 装好了", { done: true });
    }
    return check();
  }
  // 配方要用的包（配方开头写 # requires: diffusers==0.35 transformers）
  async function ensure(pkgs) {
    if (!pkgs || !pkgs.length) return;
    for (const idx of PIP) { try { await run(pyExe(), ["-m", "pip", "install", ...pkgs, "-i", idx], "pkgs"); return; } catch (e) {} }
    throw new Error("装不上：" + pkgs.join(" "));
  }
  function cancel() { cancelled = true; if (child) try { child.kill(); } catch (e) {} }
  return { check, install, ensure, cancel, python: pyExe };
}

module.exports = { create, PY_VER };
