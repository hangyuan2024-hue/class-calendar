#!/usr/bin/env node
// 打包 / 启动前：从网站仓库拷共用的文件进来（账号接口、服务器地址），把编辑器（CodeMirror）拷进界面目录。
//   · ../desktop/core/api.js  → core/api.js       捞捞课程表电脑版的登录、接口（同一个账号）
//   · ../config.js            → core/site-config.js  服务器地址
//   · node_modules/codemirror → renderer/vendor/codemirror
"use strict";
const fs = require("fs"), path = require("path");
const HERE = path.resolve(__dirname, ".."), SITE = path.resolve(HERE, "..");
const cp = (a, b) => { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); };
cp(path.join(SITE, "desktop", "core", "api.js"), path.join(HERE, "core", "api.js"));
cp(path.join(SITE, "config.js"), path.join(HERE, "core", "site-config.js"));
const CM = path.join(HERE, "node_modules", "codemirror");
if (fs.existsSync(CM)) {
  const files = ["lib/codemirror.js", "lib/codemirror.css", "mode/clike/clike.js", "mode/python/python.js", "mode/javascript/javascript.js", "mode/go/go.js",
    "addon/edit/matchbrackets.js", "addon/edit/closebrackets.js", "addon/selection/active-line.js", "addon/comment/comment.js",
    "addon/hint/show-hint.js", "addon/hint/show-hint.css", "addon/hint/anyword-hint.js", "addon/search/searchcursor.js", "addon/search/search.js",
    "addon/dialog/dialog.js", "addon/dialog/dialog.css", "theme/idea.css", "theme/material-darker.css", "LICENSE"];
  for (const f of files) cp(path.join(CM, f), path.join(HERE, "renderer", "vendor", "codemirror", f));
} else if (!fs.existsSync(path.join(HERE, "renderer", "vendor", "codemirror", "lib", "codemirror.js"))) {
  throw new Error("缺少编辑器：先在 coder 目录运行 npm install");
}
for (const d of ["resources/toolchains", "resources/llama", "resources/models"]) fs.mkdirSync(path.join(HERE, d), { recursive: true });
console.log("捞捞编程：准备好了");
