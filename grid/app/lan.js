// 捞捞算力 · 同局域网一键远程协助
//   · 找人：往局域网广播一句「谁在？」（UDP 47820），开着捞捞算力的电脑回自己的名字、端口、允不允许协助
//   · 发起：点某台电脑 →（这台电脑自己开一个协助中转，见 shared/assist-relay.js）→ 告诉对方「来找我」
//     → 对方弹窗问同不同意 → 同意了，画面直接送到这台电脑（不经过调度中心，更快），在本机的窗口里看、操控
//   · 安全：只接受局域网地址（10.x / 172.16-31.x / 192.168.x / 127.x）发来的请求；对方每次都要点同意；
//     看画面的接口只给本机（127.0.0.1）+ 每次打开软件随机生成的钥匙；对方往回送画面要凭这次会话的口令
"use strict";
const http = require("http");
const dgram = require("dgram");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Relay = require("../shared/assist-relay");

const DISCO = 47820;
const PRIVATE = /^(::ffff:)?(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)|^::1$/;
const isPrivate = (ip) => PRIVATE.test(String(ip || ""));
const v4 = (ip) => String(ip || "").replace(/^::ffff:/, "");

function create(o = {}) {
  const log = o.log || (() => {});
  const me = () => (o.me ? o.me() : { name: os.hostname(), member: "" });
  const viewKey = crypto.randomBytes(18).toString("base64url");
  const relay = Relay.create({ log: (m) => log(m), ...(o.relayOpt || {}) });
  const VIEWER = o.viewerFile || path.join(__dirname, "..", "shared", "assist-viewer.html");
  let srv = null, udp = null, port = 0, id = crypto.randomBytes(6).toString("hex");

  const json = (res, code, obj) => { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": b.length, "cache-control": "no-store" }); res.end(b); };
  const body = (req, limit = 4e6) => new Promise((ok, bad) => {
    let n = 0; const cs = [];
    req.on("data", (c) => { n += c.length; if (n > limit) { bad(new Error("太大了")); req.destroy(); } else cs.push(c); });
    req.on("end", () => { try { ok(cs.length ? JSON.parse(Buffer.concat(cs).toString("utf8")) : {}); } catch (e) { bad(new Error("格式不对")); } });
    req.on("error", bad);
  });

  async function handle(req, res) {
    const u = new URL(req.url, "http://x");
    const ip = req.socket.remoteAddress;
    try {
      if (!isPrivate(ip)) return json(res, 403, { error: "只接受局域网里的电脑" });
      const local = /^(::ffff:)?127\.|^::1$/.test(ip);
      // ---- 给本机看画面的窗口：页面 + 取画面 / 发操作 / 结束（只给本机 + 钥匙）----
      if (u.pathname === "/viewer.html") {
        if (!local) return json(res, 403, { error: "只给本机" });
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return res.end(fs.readFileSync(VIEWER));
      }
      if (u.pathname.startsWith("/lan/v/")) {
        if (!local || req.headers["x-lan-key"] !== viewKey) return json(res, 403, { error: "钥匙不对" });
        const p = u.pathname.slice(7), b = req.method === "POST" ? await body(req) : {};
        if (p === "status") return json(res, 200, await relay.status(u.searchParams.get("s")));
        if (p === "view") return json(res, 200, await relay.view(u.searchParams.get("s"), +u.searchParams.get("after") || 0));
        if (p === "input") return json(res, 200, relay.input(b.s, b.ev));
        if (p === "end") return json(res, 200, relay.end(b.s, "你结束了"));
        return json(res, 404, { error: "没有这个接口" });
      }
      // ---- 被协助的电脑往这台送画面、取操作（凭会话口令）----
      if (u.pathname.startsWith("/lan/d/") && req.method === "POST") {
        const p = u.pathname.slice(7), b = await body(req);
        if (p === "answer") return json(res, 200, relay.answer(b));
        if (p === "frame") return json(res, 200, relay.frame(b));
        if (p === "take") return json(res, 200, await relay.take(b));
        if (p === "end") return json(res, 200, relay.end(b.s, b.why ? String(b.why).slice(0, 60) : "对方结束了", b.token));
        return json(res, 404, { error: "没有这个接口" });
      }
      // ---- 别人请求协助这台电脑：弹窗问（同意不同意由 o.onAsk 决定），马上回「收到」----
      if (u.pathname === "/lan/ask" && req.method === "POST") {
        const b = await body(req);
        const from = String(b.from || "同局域网的电脑").slice(0, 60);
        const rport = +b.port;
        if (!(rport > 0 && rport < 65536) || !b.s || !b.token) return json(res, 400, { error: "请求不完整" });
        // 画面只送回发请求的那台电脑（用它连过来的地址，不信请求里写的地址）
        const base = `http://${v4(ip).includes(":") ? "[" + v4(ip) + "]" : v4(ip)}:${rport}`;
        const transport = (name, x) => post(`${base}/lan/d/${name}`, x, name === "take" ? 20000 : 15000);
        if (o.onAsk) Promise.resolve(o.onAsk({ transport, s: String(b.s), token: String(b.token), mode: b.mode === "view" ? "view" : "control", by: from, where: `同一局域网（${v4(ip)}）` })).catch((e) => log("局域网协助请求出错：" + e.message));
        return json(res, 200, { ok: true });
      }
      if (u.pathname === "/lan/ping") return json(res, 200, { laolao: 1, ...me(), id, accepts: o.accepts ? !!o.accepts() : true });
      json(res, 404, { error: "没有这个接口" });
    } catch (e) { if (!res.headersSent) json(res, 400, { error: e.message }); }
  }

  async function post(url, b, timeout = 15000) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}), signal: AbortSignal.timeout(timeout) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "对方回 " + r.status);
    return j;
  }

  // 开：HTTP（协助用，默认 47821，被占了换一个）+ UDP（回应「谁在？」）
  async function start() {
    if (srv) return port;
    srv = http.createServer(handle);
    srv.requestTimeout = 0; srv.headersTimeout = 30000;
    const want = o.port != null ? o.port : 47821;
    port = await new Promise((ok, bad) => {
      srv.once("error", (e) => { if (e.code === "EADDRINUSE" && want) { srv.listen(0, o.host || "0.0.0.0", () => ok(srv.address().port)); } else bad(e); });
      srv.listen(want, o.host || "0.0.0.0", () => ok(srv.address().port));
    });
    try {
      udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
      udp.on("error", (e) => { log("局域网找人（UDP）没开起来：" + e.message); try { udp.close(); } catch (e2) {} udp = null; });
      udp.on("message", (m, r) => {
        const s = String(m);
        if (!s.startsWith("LAOLAO-WHO?") || !isPrivate(r.address)) return;
        const nonce = s.slice(11, 40);
        const reply = Buffer.from(JSON.stringify({ laolao: 1, ...me(), id, port, accepts: o.accepts ? !!o.accepts() : true, nonce }));
        udp.send(reply, r.port, r.address);
      });
      await new Promise((ok) => udp.bind(o.discoPort != null ? o.discoPort : DISCO, () => { try { udp.setBroadcast(true); } catch (e) {} ok(); }));
    } catch (e) { udp = null; }
    log(`局域网远程协助已开：端口 ${port}`);
    return port;
  }

  // 找人：广播（每块网卡的广播地址 + 255.255.255.255），收 1.5 秒的回话
  async function discover({ ms = 1500, targets } = {}) {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const nonce = crypto.randomBytes(6).toString("hex");
    const found = new Map();
    sock.on("message", (m, r) => {
      try {
        const j = JSON.parse(String(m));
        if (!j || j.laolao !== 1 || j.nonce !== nonce || j.id === id) return;
        found.set(j.id, { id: j.id, name: j.name, member: j.member || "", ip: r.address, port: j.port, accepts: j.accepts !== false });
      } catch (e) {}
    });
    await new Promise((ok) => sock.bind(0, () => { try { sock.setBroadcast(true); } catch (e) {} ok(); }));
    const dst = targets || [...new Set(["255.255.255.255", ...broadcasts()])];
    const msg = Buffer.from("LAOLAO-WHO?" + nonce);
    // 目标可以写「地址:端口」（同一台电脑上开两个做测试时用；真的局域网里都是 47820）
    for (const a of dst) { const m = /^(.+):(\d+)$/.exec(a); try { sock.send(msg, m ? +m[2] : DISCO, m ? m[1] : a); } catch (e) {} }
    await new Promise((ok) => setTimeout(ok, ms));
    try { sock.close(); } catch (e) {}
    return [...found.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  function broadcasts() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
      if (a.family !== "IPv4" || a.internal || !isPrivate(a.address)) continue;
      const ip = a.address.split(".").map(Number), mk = a.netmask.split(".").map(Number);
      out.push(ip.map((x, i) => (x & mk[i]) | (~mk[i] & 255)).join("."));
    }
    return out;
  }

  // 发起：在本机开会话 → 叫对方来连 → 返回本机看画面的地址
  async function assist(peer, mode = "control") {
    if (!srv) await start();
    const s = relay.start({ name: `${peer.member ? peer.member + " · " : ""}${peer.name || peer.ip}`, by: `${me().member ? me().member + " · " : ""}${me().name}`, mode });
    try { await post(`http://${peer.ip}:${peer.port}/lan/ask`, { from: `${me().member ? me().member + " 的 " : ""}${me().name}`, port, s: s.id, token: s.token, mode: s.mode }, 8000); }
    catch (e) { relay.end(s.id, "没连上对方：" + e.message); throw new Error("连不上对方的电脑：" + e.message + "（对方要开着捞捞算力；Windows 防火墙弹窗时选「允许」）"); }
    return { s: s.id, url: `http://127.0.0.1:${port}/viewer.html#s=${encodeURIComponent(s.id)}&k=${encodeURIComponent(viewKey)}&name=${encodeURIComponent(s.name)}` };
  }

  function stop() { try { relay.close(); } catch (e) {} try { srv && srv.close(); } catch (e) {} try { udp && udp.close(); } catch (e) {} srv = null; udp = null; }
  return { start, stop, discover, assist, relay, port: () => port, viewKey: () => viewKey, _post: post };
}

module.exports = { create, isPrivate };
