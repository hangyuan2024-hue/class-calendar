// 捞捞编程 · 各门语言：在哪找编译器、怎么编译运行、新文件的模板
// 编译器的位置（按顺序找）：
//   1. 安装包自带：resources/toolchains/<名字>（C / C++ 用的 mingw64、Python）
//   2. 软件里一键下载的：用户数据目录/toolchains/<名字>（Java、Node.js、Go）
//   3. 开发时：电脑上已经装好的（PATH 里的 gcc、python3……），方便在 Linux / Mac 上测试
"use strict";
const fs = require("fs");
const path = require("path");

const WIN = process.platform === "win32";
const exe = (n) => (WIN ? n + ".exe" : n);

const LANGS = [
  {
    id: "c", name: "C", exts: [".c"], tool: "mingw64", cm: "text/x-csrc",
    bin: ["bin/gcc"], sys: ["gcc", "cc"],
    compiled: true,
    template: '#include <stdio.h>\n\nint main(void) {\n    printf("你好，捞捞！\\n");\n    return 0;\n}\n',
  },
  {
    id: "cpp", name: "C++", exts: [".cpp", ".cc", ".cxx"], tool: "mingw64", cm: "text/x-c++src",
    bin: ["bin/g++"], sys: ["g++", "c++"],
    compiled: true,
    template: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "你好，捞捞！" << endl;\n    return 0;\n}\n',
  },
  {
    id: "python", name: "Python", exts: [".py"], tool: "python", cm: "text/x-python",
    bin: WIN ? ["python"] : ["bin/python3"], sys: WIN ? ["python", "py"] : ["python3", "python"],
    template: 'print("你好，捞捞！")\n\nname = input("你叫什么名字？")\nprint("你好，" + name + "！")\n',
  },
  {
    id: "java", name: "Java", exts: [".java"], tool: "java", cm: "text/x-java",
    bin: ["bin/java"], sys: ["java"],
    template: 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println("你好，捞捞！");\n    }\n}\n',
  },
  {
    id: "javascript", name: "JavaScript", exts: [".js", ".mjs"], tool: "node", cm: "text/javascript",
    bin: WIN ? ["node"] : ["bin/node"], sys: ["node"],
    template: 'console.log("你好，捞捞！");\n',
  },
  {
    id: "go", name: "Go", exts: [".go"], tool: "go", cm: "text/x-go",
    bin: ["bin/go"], sys: ["go"],
    template: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("你好，捞捞！")\n}\n',
  },
];
const byId = Object.fromEntries(LANGS.map((l) => [l.id, l]));
function langOfFile(file) {
  const ext = path.extname(String(file || "")).toLowerCase();
  return LANGS.find((l) => l.exts.includes(ext)) || null;
}

// 在 PATH 里找一个程序
function which(name) {
  const dirs = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const names = WIN ? [name + ".exe", name + ".cmd", name] : [name];
  for (const d of dirs) for (const n of names) { const f = path.join(d, n); try { if (fs.statSync(f).isFile()) return f; } catch (e) {} }
  return null;
}

// dirs：{ bundled: resources/toolchains, user: 用户数据/toolchains }；allowSystem：开发时可以用电脑上装好的
function locate(lang, dirs, allowSystem) {
  const L = typeof lang === "string" ? byId[lang] : lang;
  if (!L) return null;
  for (const [where, base] of [["bundled", dirs.bundled], ["user", dirs.user]]) {
    if (!base) continue;
    const root = path.join(base, L.tool);
    for (const b of L.bin) { const f = path.join(root, exe(b)); if (fs.existsSync(f)) return { exe: f, root, where }; }
  }
  if (allowSystem) for (const n of L.sys) { const f = which(n); if (f) return { exe: f, root: path.dirname(path.dirname(f)), where: "system" }; }
  return null;
}

module.exports = { LANGS, byId, langOfFile, locate, which, WIN, exe };
