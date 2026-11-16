// 训练答题大脑的循环（假的 torch，不用显卡）：见 qa_train_loop.py
"use strict";
const { spawnSync } = require("child_process");
const path = require("path");
const r = spawnSync(process.env.PYTHON || "python3", [path.join(__dirname, "qa_train_loop.py")], { stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
process.exit(r.status === 0 ? 0 : 1);
