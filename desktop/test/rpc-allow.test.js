// 界面里调用的服务器函数，都要在 core/remote.js 的白名单里（不然电脑版会报「不支持的操作」）
const fs = require("fs"), path = require("path");
const { RPC } = require("../core/remote.js");
const dir = path.join(__dirname, "..", "renderer"), bad = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
  const src = fs.readFileSync(path.join(dir, f), "utf8");
  for (const m of src.matchAll(/(?:\bapi\(|"api:rpc",\s*)"([a-z_0-9]+)"/g)) if (!RPC.has(m[1])) bad.push(f + ": " + m[1]);
}
if (bad.length) { console.error("✗ 白名单里没有：\n  " + [...new Set(bad)].join("\n  ")); process.exit(1); }
console.log("✓ 界面用到的服务器函数都在白名单里");
