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
// 你的国内存储里的训练环境（Actions「AI 组件搬到国内存储」的 grid 组搬的）：清单在官网的 download/ai-mirror.json
const MIRROR = [
  "https://www.laolaokechengbiao.cn/download/ai-mirror.json",
  "https://cdn.jsdelivr.net/gh/hangyuan2024-hue/class-calendar@main/download/ai-mirror.json",
  "https://raw.githubusercontent.com/hangyuan2024-hue/class-calendar/main/download/ai-mirror.json",
];

function create({ dir, onEvent, python: given, mirror = MIRROR, fetchImpl, basePkgs = BASE_PKGS }) {
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

  // 国内存储里有的：Python 安装包（gridpy）、wheel（gridwheel）；读不到就是空的，照旧走镜像
  async function fromMirror() {
    for (const u of mirror || []) {
      try {
        const r = await (fetchImpl || fetch)(u + "?t=" + Date.now(), { signal: AbortSignal.timeout(10000) });
        if (!r.ok) continue;
        const m = await r.json();
        const all = Object.values((m && m.files) || {}).filter((x) => x.group === "grid" && /^https?:\/\//.test(x.url || ""));
        if (!all.length) continue;
        const ver = all.filter((x) => x.pkg === "gridwheel").map((x) => x.ver || "").sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop() || "";
        return { python: all.find((x) => x.pkg === "gridpy") || null, wheels: all.filter((x) => x.pkg === "gridwheel" && (x.ver || "") === ver) };
      } catch (e) {}
    }
    return { python: null, wheels: [] };
  }
  const sha256 = (f) => new Promise((ok, bad) => { const h = require("crypto").createHash("sha256"); fs.createReadStream(f).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", bad); });
  // 把国内存储里的 wheel 都下到 env/wheels（下过、大小对的跳过；核对 sha256）
  async function pullWheels(list) {
    const wd = path.join(dir, "wheels");
    fs.mkdirSync(wd, { recursive: true });
    const total = list.reduce((a, b) => a + (b.size || 0), 0);
    let done = 0;
    for (const w of list) {
      if (cancelled) throw new Error("取消了");
      const f = path.join(wd, w.name);
      let have = -1; try { have = fs.statSync(f).size; } catch (e) {}
      if (have !== w.size) {
        say("wheels", `从你的国内存储下载 ${w.name}（${(w.size / 1048576).toFixed(0)} MB）`);
        await xfer("GET", w.url, f, { onProgress: (a) => say("wheels", null, { progress: total ? (done + a) / total : 0 }) });
        if (w.sha256 && (await sha256(f)) !== w.sha256) { fs.rmSync(f, { force: true }); throw new Error(w.name + " 下载坏了，再点一次「一键安装」"); }
      }
      done += w.size || 0;
      say("wheels", null, { progress: total ? done / total : 1 });
    }
    say("wheels", `${list.length} 个安装包都下好了（${(total / 1073741824).toFixed(1)} G）`, { done: true });
    return wd;
  }

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
    const M = await fromMirror();
    if (M.wheels.length) say("python", `用你的国内存储（${M.wheels.length + (M.python ? 1 : 0)} 个文件），比公共镜像快`);
    // 1. Python
    if (!(await out(exe, ["--version"]))) {
      if (process.platform !== "win32") throw new Error("这台电脑不是 Windows：自己装好 Python 3.10 以上，在设置里选它");
      const inst = path.join(dir, `python-${PY_VER}-amd64.exe`);
      let got = false;
      for (const u of [M.python && M.python.url, ...PY_URLS].filter(Boolean)) {
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
    // 国内存储里有：全部 wheel 先下到本地，pip 只从本地装（不联网）
    // PyTorch 已经是 CUDA 版的就不下那 3G 了
    const cudaOf = async () => { const o = await out(exe, ["-c", "import torch;print(torch.version.cuda or 'cpu')"]); return o ? o.trim().split("\n").pop() : null; };
    let cv = skipTorch ? null : await cudaOf();
    const torchOk = (v) => !!(v && v !== "cpu" && parseFloat(v) >= 12.8);
    const needTorch = !skipTorch && !torchOk(cv);
    let wd = null;
    const want = needTorch ? M.wheels : M.wheels.filter((w) => !/^torch(vision)?-/i.test(w.name));
    if (want.length) { try { wd = await pullWheels(want); } catch (e) { if (cancelled) throw e; say("wheels", "国内存储下载出错，改走公共镜像：" + e.message); } }
    if (wd) { try { await pip([...basePkgs, "--no-index", "-f", wd], "pkgs"); ok = true; } catch (e) { if (cancelled) throw e; say("pkgs", "本地的包装不上，改走镜像"); } }
    if (!ok) for (const idx of PIP) { try { await pip([...basePkgs, "-i", idx], "pkgs"); ok = true; break; } catch (e) { if (cancelled) throw e; say("pkgs", "换一个镜像再试"); } }
    if (!ok) throw new Error("装 numpy 这些基础包失败");
    say("pkgs", "基础的包装好了", { done: true });
    // 3. PyTorch（CUDA 12.8 版，50 系显卡要它）
    //    坑：普通的 pip 源（清华、PyPI）上 Windows 的 torch 是「CPU 版」，混着源装就会装成看不到显卡的那个。
    //    所以：先从普通源装 torch 要的小包，再只从「CUDA 版」的源装 torch 本身（--no-deps），装完核对 torch.version.cuda
    if (!skipTorch) {
      if (torchOk(cv)) { say("torch", `已经有 CUDA ${cv} 版的 PyTorch`, { done: true }); return check(); }
      if (cv) { say("torch", cv === "cpu" ? "现在装的是 CPU 版的 PyTorch（看不到显卡），先删掉换 CUDA 版" : `现在的 PyTorch 是 CUDA ${cv}，50 系显卡要 12.8 以上，换掉`); await run(exe, ["-m", "pip", "uninstall", "-y", "torch", "torchvision"], "torch").catch(() => {}); }
      ok = false;
      if (wd && M.wheels.some((w) => /^torch-.*\+cu/i.test(w.name))) {
        try {
          say("torch", "从本地装 CUDA 版的 PyTorch（刚从你的国内存储下的）");
          await pip(["torch", "torchvision", "--no-index", "-f", wd], "torch");
          cv = await cudaOf();
          ok = !!(cv && cv !== "cpu");
        } catch (e) { if (cancelled) throw e; say("torch", "本地的装不上，改走镜像"); }
      }
      if (!ok) for (const idx of PIP) { try { await pip(["filelock", "typing-extensions", "sympy", "networkx", "jinja2", "fsspec", "-i", idx], "torch"); break; } catch (e) { if (cancelled) throw e; } }
      for (const src of ok ? [] : TORCH) {
        try {
          say("torch", "从 " + new URL(src[1]).host + " 下载 CUDA 版的 PyTorch（约 3G）");
          await pip(["torch", "torchvision", "--no-deps", "--force-reinstall", ...(src[0] === "-f" ? ["--no-index", "-f", src[1]] : ["--index-url", src[1]])], "torch");
          cv = await cudaOf();
          if (cv && cv !== "cpu") { ok = true; break; }
          say("torch", "装上的还是 CPU 版，换一个源");
        } catch (e) { if (cancelled) throw e; say("torch", "换一个镜像再试"); }
      }
      if (!ok) throw new Error("CUDA 版的 PyTorch 装不上：换个时间再试，或者问管理员要离线安装包");
      say("torch", `PyTorch 装好了（CUDA ${cv}）`, { done: true });
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
