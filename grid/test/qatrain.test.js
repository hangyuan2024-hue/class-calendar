// 训练答题大脑的循环（假的 torch，不用显卡）：见 qa_train_loop.py；存档变小（装了 PyTorch 才跑）：见 ckpt_small.py
"use strict";
const { spawnSync } = require("child_process");
const path = require("path");
for (const f of ["qa_train_loop.py", "ckpt_small.py"]) {
  const r = spawnSync(process.env.PYTHON || "python3", [path.join(__dirname, f)], { stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
  if (r.status !== 0) process.exit(1);
}
