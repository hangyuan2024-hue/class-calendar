// 训练用显存的上限：Windows 上至少留 1.3G（CUDA 自己、桌面、浏览器要用），别的程序又占了显存就往下收，不溢出到共享内存
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { execFileSync } = require("child_process");
const PY = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-gg-"));
fs.mkdirSync(path.join(tmp, "torch"));
fs.writeFileSync(path.join(tmp, "torch", "__init__.py"), "class _C:\n    free = int(6.7 * 2**30); total = 8 * 2**30; fracs = []\n    def mem_get_info(self): return (self.free, self.total)\n    def set_per_process_memory_fraction(self, f): self.fracs.append(f)\ncuda = _C()\n");
fs.writeFileSync(path.join(tmp, "t.py"), [
  "import os, time, torch",
  "import lg",
  "free, tot = lg.gpu_guard()",
  "cap = torch.cuda.fracs[-1] * 8",
  "assert abs(cap - 5.4) < 0.01, cap",
  "torch.cuda.free = int(0.2 * 2**30); time.sleep(0.3)",
  "one = torch.cuda.fracs[-1] * 8",
  "assert abs(one - 5.0) < 0.01, one",
  "time.sleep(0.2)",
  "assert torch.cuda.fracs[-1] * 8 == one, '冷却时间内不再收'",
  "print('OK %.1f %.1f' % (cap, one))",
].join("\n"));
const out = execFileSync(PY, [path.join(tmp, "t.py")], { env: { ...process.env, PYTHONPATH: tmp + path.delimiter + path.join(__dirname, "..", "py"), LG_VRAM_RESERVE: "1.3", LG_VRAM_WATCH_S: "0.05", LG_VRAM_COOL_S: "5", PYTHONIOENCODING: "utf-8" }, encoding: "utf8" });
if (!/OK 5\.4 5\.0/.test(out)) { console.error(out); process.exit(1); }
console.log("✓ 8G 显卡空着 6.7G：训练最多用 5.4G（以前 6.2G，一路涨到 7.7/8G 溢出到共享内存）；别的程序占了显存就收到 5.0G，30 秒内不连着收");
console.log("显存上限：全部通过");
