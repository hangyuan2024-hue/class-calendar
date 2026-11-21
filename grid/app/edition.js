// 捞捞算力 · 版本：内部版（默认）还是通用版
//   通用版打包时（scripts/open.js）在 app/ 里写一个 edition.json：{ "open": true }
//   通用版：没有成品展示（捞小智另外有电脑版）、不带捞捞的训练配方；新版本查 grid-open-version.json；其余和内部版一样
"use strict";
const fs = require("fs");
const path = require("path");
function read(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir || __dirname, "edition.json"), "utf8")) || {}; } catch (e) { return {}; } }
const E = read();
module.exports = { open: !!E.open, name: E.open ? "通用版" : "", read };
