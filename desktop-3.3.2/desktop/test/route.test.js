// 两条线路：国内连不上自动换海外中转，并记住；海外那条也坏了再换回来
const { Api } = require("../core/api.js");
const assert = (c, m) => { if (!c) { console.error("✗ " + m); process.exit(1); } console.log("✓ " + m); };
(async () => {
  const P = "https://cn.example", A = "https://relay.example";
  let down = new Set([P]), saved = null, hits = [];
  const fetchImpl = async (url, o) => { hits.push(url); const host = url.slice(0, url.indexOf("/", 8)); if (down.has(host)) throw new TypeError("fetch failed"); return { ok: true, status: 200, text: async () => JSON.stringify({ ok: host }) }; };
  const routeStore = { load: () => saved, save: (i) => (saved = i) };
  const api = new Api({ url: P, alt: A, key: "k", store: { load: () => ({ access_token: "t", expires_at: Date.now() / 1000 + 3600 }), save() {} }, fetchImpl, routeStore });
  let r = await api.rpc("x", {});
  assert(r.ok === A && saved === 1, "国内连不上：自动换海外中转，并记住");
  hits = []; r = await api.rpc("y", {});
  assert(hits.length === 1 && hits[0].startsWith(A), "下一次直接走海外中转");
  down = new Set([A]); hits = [];
  r = await api.rpc("z", {});
  assert(r.ok === P && saved === 0, "海外中转坏了：换回国内，并记住");
  const api2 = new Api({ url: P, alt: A, key: "k", store: { load: () => null, save() {} }, fetchImpl, routeStore: { load: () => 1, save() {} } });
  down = new Set(); hits = []; await api2.anonRpc("a", {});
  assert(hits[0].startsWith(A), "打开时按记住的线路走");
  down = new Set([P, A]);
  try { await api.rpc("w", {}); assert(false, "两条都断：应该报错"); } catch (e) { assert(e.offline, "两条都断：提示网络连接失败"); }
})();
