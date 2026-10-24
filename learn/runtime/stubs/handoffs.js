// 导图交接的临时口令：本机版放在内存里；网页版的 Service Worker 随时可能被浏览器停掉，所以存进虚拟磁盘（2 天后过期）
const fs = require("node:fs");
const FILE = "/app/state/handoffs.json";
function load() { try { return JSON.parse(fs.readFileSync(FILE, "utf8")) || {}; } catch (e) { return {}; } }
function save(o) { fs.mkdirSync("/app/state", { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(o)); }
module.exports = {
  get(k) { const o = load(), v = o[k]; return v && Date.now() - (v.__at || 0) < 2 * 864e5 ? v : undefined; },
  set(k, v) { const o = load(); for (const key of Object.keys(o)) if (Date.now() - (o[key].__at || 0) > 2 * 864e5) delete o[key]; o[k] = { ...v, __at: Date.now() }; save(o); return this; },
  has(k) { return !!this.get(k); },
  delete(k) { const o = load(); const had = k in o; delete o[k]; save(o); return had; },
};
