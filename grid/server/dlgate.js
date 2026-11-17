// 捞捞 · 下载门口：安装包、AI 组件这些大文件不再从 COS 直接公开下载，统一走调度中心的 /dl/<文件>
//   · 只给中国大陆的 IP（IP 段见 china-ip.txt，每周自动更新）：通过了就 302 转到 COS 的临时链接（几个小时后失效，转发出去也没用）
//   · 海外的 IP：不给（403），软件会自己换 GitHub 下载；网页上告诉他去 GitHub
//   · 刹车：同一个 IP 一天最多下多少、同一个文件同一个 IP 一天最多下几遍（装不上反复重下的电脑在这里被拦住）、全站一天最多多少（到了就停，账单封顶）
//   · 记账：每天下了多少、谁下的、下的什么、拦了多少，控制中心 / 接口看得到（/api/admin/dl）
// 桶要改成「私有读」（只留 download/ 下面的小版本文件公开），不然别人绕过这里直接下还是扣钱。
// 环境变量（/etc/laolao-grid.env）：
//   DL_COS_ENDPOINT / DL_COS_REGION / DL_COS_BUCKET / DL_COS_KEY_ID / DL_COS_SECRET  放安装包的桶（只要「读」的权限）；不填就用 GRID_COS_* 那一套
//   DL_DAILY_GB   全站一天最多发出去多少 GB（默认 50，约 25 元）      DL_IP_GB  一个 IP 一天最多（默认 40）
//   DL_REPEAT     同一个文件同一个 IP 一天最多下几遍（默认 4）           DL_ALLOW  放行哪些地区：CN（默认）
//   DL_PREFIXES   哪些文件夹可以下（默认 ai/,android/,code/,desktop/,ppt/,grid-dl/）
"use strict";
const fs = require("fs");
const path = require("path");
const net = require("net");
const Store = require("./store");

const LIST_URLS = {
  v4: ["https://raw.githubusercontent.com/gaoyifan/china-operator-ip/ip-lists/china.txt", "https://cdn.jsdelivr.net/gh/gaoyifan/china-operator-ip@ip-lists/china.txt"],
  v6: ["https://raw.githubusercontent.com/gaoyifan/china-operator-ip/ip-lists/china6.txt", "https://cdn.jsdelivr.net/gh/gaoyifan/china-operator-ip@ip-lists/china6.txt"],
};
const GB = 1024 ** 3;
const PRICE = 0.5;   // 腾讯云 COS 外网下行，大约 0.5 元 / GB（只用来估算，以账单为准）

// ---------- IP 段 ----------
function v4n(ip) { const p = ip.split(".").map(Number); return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]; }
function v6n(ip) {
  let [a, b] = ip.split("::");
  const part = (s) => (s ? s.split(":") : []);
  let L = part(a), R = b == null ? [] : part(b);
  const tail = (arr) => { const x = arr[arr.length - 1]; if (x && x.includes(".")) { const n = v4n(x); arr.splice(-1, 1, (n >>> 16).toString(16), (n & 0xffff).toString(16)); } };
  tail(L); tail(R);
  const all = b == null ? L : [...L, ...Array(8 - L.length - R.length).fill("0"), ...R];
  return all.reduce((acc, h) => (acc << 16n) + BigInt(parseInt(h || "0", 16)), 0n);
}
function parseList(text) {
  const v4 = [], v6 = [];
  for (const line of String(text).split(/\r?\n/)) {
    const s = line.trim(); if (!s || s[0] === "#") continue;
    const [ip, bitsS] = s.split("/"), bits = +bitsS;
    if (net.isIPv4(ip) && bits >= 0 && bits <= 32) { const a = v4n(ip), n = 2 ** (32 - bits); v4.push([a - (a % n), a - (a % n) + n - 1]); }
    else if (net.isIPv6(ip) && bits >= 0 && bits <= 128) { const a = v6n(ip), n = 1n << BigInt(128 - bits); v6.push([a - (a % n), a - (a % n) + n - 1n]); }
  }
  const merge = (arr) => { arr.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)); const out = []; for (const r of arr) { const l = out[out.length - 1]; if (l && r[0] <= l[1] + (typeof r[0] === "bigint" ? 1n : 1)) { if (r[1] > l[1]) l[1] = r[1]; } else out.push([r[0], r[1]]); } return out; };
  return { v4: merge(v4), v6: merge(v6) };
}
function inRanges(rs, x) { let lo = 0, hi = rs.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (x < rs[m][0]) hi = m - 1; else if (x > rs[m][1]) lo = m + 1; else return true; } return false; }
const cleanIp = (ip) => String(ip || "").trim().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1").replace(/%.*$/, "");
function isPrivate(ip) {
  if (net.isIPv4(ip)) { const n = v4n(ip); return [["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16], ["127.0.0.0", 8], ["100.64.0.0", 10], ["169.254.0.0", 16]].some(([b, m]) => (n >>> (32 - m)) === (v4n(b) >>> (32 - m))); }
  if (net.isIPv6(ip)) { const x = v6n(ip); return x === 1n || (x >> 121n) === 0x7en /* fc00::/7 */ || (x >> 118n) === 0x3fan /* fe80::/10 */; }
  return false;
}

// 访问者的 IP：直接连进来的就是它；前面有本机的 Caddy（HTTPS）时看它带过来的 X-Forwarded-For（最右边那个是 Caddy 看到的）。
// 不是本机转过来的 X-Forwarded-For 一律不信（不然海外的人自己写一个国内 IP 就过了）
function clientIp(req) {
  const r = String((req.socket && req.socket.remoteAddress) || "");
  if (/^(127\.|::1$|::ffff:127\.)/.test(r) && req.headers["x-forwarded-for"]) { const xs = String(req.headers["x-forwarded-for"]).split(",").map((x) => x.trim()).filter(Boolean); return xs[xs.length - 1] || r; }
  return r;
}

// ---------- 门口 ----------
function create(o) {
  const env = o.env || process.env;
  const E = (k, d) => (env["DL_" + k] != null && env["DL_" + k] !== "" ? env["DL_" + k] : env["GRID_" + k] != null && env["GRID_" + k] !== "" ? env["GRID_" + k] : d);
  const cos = { endpoint: E("COS_ENDPOINT"), region: E("COS_REGION"), bucket: E("COS_BUCKET"), keyId: E("COS_KEY_ID"), secret: E("COS_SECRET") };
  const ready = !!(cos.endpoint && cos.region && cos.bucket && cos.keyId && cos.secret);
  const num = (k, d) => { const v = +(env["DL_" + k] || ""); return v > 0 ? v : d; };
  const cfg = { dailyGB: num("DAILY_GB", 50), ipGB: num("IP_GB", 40), repeat: num("REPEAT", 4), ttl: num("TTL", 6 * 3600),
    allow: String(env.DL_ALLOW || "CN").toUpperCase().split(/[,\s]+/).filter(Boolean),
    prefixes: String(env.DL_PREFIXES || "ai/,android/,code/,desktop/,ppt/,grid-dl/").split(/[,\s]+/).filter(Boolean),
    github: env.DL_GITHUB || "https://github.com/hangyuan2024-hue/class-calendar/releases" };
  const dir = path.join(o.dataDir, "dl"); fs.mkdirSync(dir, { recursive: true });
  const now = o.now || (() => Date.now());
  const log = o.log || (() => {});
  const doFetch = o.fetch || fetch;
  const presign = o.presign || ((method, key, ttl) => Store.presign({ ...cos, method, key, ttl }));

  // IP 段：数据文件夹里有新的用新的，没有用自带的；每周去更新一次
  const LOCAL = path.join(dir, "china-ip.txt"), BUNDLED = path.join(__dirname, "china-ip.txt");
  let lists = { v4: [], v6: [] }, listAt = 0;
  function loadLists() { for (const f of [LOCAL, BUNDLED]) { try { const l = parseList(fs.readFileSync(f, "utf8")); if (l.v4.length > 1000) { lists = l; listAt = fs.statSync(f).mtimeMs; return f; } } catch (e) {} } return null; }
  loadLists();
  async function refreshLists() {
    const get = async (urls) => { for (const u of urls) { try { const r = await doFetch(u, { signal: AbortSignal.timeout(30000) }); if (r.ok) { const t = await r.text(); if (t.split("\n").length > 500) return t; } } catch (e) {} } return null; };
    const [a, b] = await Promise.all([get(LIST_URLS.v4), get(LIST_URLS.v6)]);
    if (!a) return false;
    const text = `# 自动更新：${new Date(now()).toISOString()}\n${a}\n${b || ""}`;
    if (parseList(text).v4.length < 1000) return false;
    fs.writeFileSync(LOCAL + ".tmp", text); fs.renameSync(LOCAL + ".tmp", LOCAL); loadLists();
    log(`下载门口：国内 IP 段更新了（IPv4 ${lists.v4.length} 段，IPv6 ${lists.v6.length} 段）`);
    return true;
  }
  const timer = o.noRefresh ? null : setInterval(() => { if (now() - listAt > 7 * 86400e3) refreshLists().catch(() => {}); }, 6 * 3600e3);
  if (timer && timer.unref) timer.unref();
  if (!o.noRefresh && now() - listAt > 7 * 86400e3) setTimeout(() => refreshLists().catch(() => {}), 20000).unref();

  function region(ip) {
    ip = cleanIp(ip);
    if (!ip) return "??";
    if (isPrivate(ip)) return "LAN";
    if (net.isIPv4(ip)) return inRanges(lists.v4, v4n(ip)) ? "CN" : "XX";
    if (net.isIPv6(ip)) return inRanges(lists.v6, v6n(ip)) ? "CN" : "XX";
    return "??";
  }

  // ---------- 记账（按北京时间分天） ----------
  const dayOf = (t) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
  let day = null, U = null, dirty = false;
  const fileOf = (d) => path.join(dir, `${d}.json`);
  function usage() {
    const d = dayOf(now());
    if (d !== day) { flush(); day = d; try { U = JSON.parse(fs.readFileSync(fileOf(d), "utf8")); } catch (e) { U = { day: d, bytes: 0, n: 0, ip: {}, files: {}, refused: {}, foreign: {} }; }
      // 只留 60 天
      try { for (const f of fs.readdirSync(dir)) if (/^\d{4}-\d\d-\d\d\.json$/.test(f) && f < dayOf(now() - 60 * 86400e3) + ".json") fs.rmSync(path.join(dir, f), { force: true }); } catch (e) {} }
    return U;
  }
  function flush() { if (!dirty || !U) return; try { fs.writeFileSync(fileOf(U.day) + ".tmp", JSON.stringify(U)); fs.renameSync(fileOf(U.day) + ".tmp", fileOf(U.day)); dirty = false; } catch (e) {} }
  const ft = setInterval(flush, o.flushMs || 10000); if (ft.unref) ft.unref();

  // 文件多大（问一下 COS，记 6 小时）
  const sizes = new Map();
  async function sizeOf(key) {
    const c = sizes.get(key); if (c && now() - c.at < 6 * 3600e3) return c.size;
    let size = null;
    try {
      const r = await doFetch(presign("HEAD", key, 300), { method: "HEAD", signal: AbortSignal.timeout(15000) });
      if (r.status === 404) size = -1; else if (r.ok) size = +(r.headers.get("content-length") || 0) || null;
    } catch (e) {}
    if (size != null) sizes.set(key, { size, at: now() });
    return size;
  }
  // 这一次大概要下多少（Range 里写了就按 Range 算）
  function want(range, size) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range || "").trim());
    const S = size > 0 ? size : 512 * 1024 * 1024;
    if (!m) return S;
    if (m[1] === "" && m[2] !== "") return Math.min(S, +m[2]);
    const a = +m[1] || 0, b = m[2] === "" ? S - 1 : Math.min(S - 1, +m[2]);
    return Math.max(0, b - a + 1);
  }

  const okPath = (key) => Store.okKey(key) && cfg.prefixes.some((p) => key.startsWith(p));
  const say = (res, code, text, why) => { const b = Buffer.from(text + "\n"); res.writeHead(code, { "content-type": "text/plain; charset=utf-8", "content-length": b.length, "cache-control": "no-store", "access-control-allow-origin": "*", "x-lz-dl": why }); res.end(b); };
  const refuse = (ip, why) => { const u = usage(); u.refused[why] = (u.refused[why] || 0) + 1; if (why === "foreign") u.foreign[ip] = (u.foreign[ip] || 0) + 1; dirty = true; };

  // GET/HEAD /dl/<key>
  async function handle(req, res, key, ipRaw) {
    const ip = cleanIp(ipRaw);
    if (req.method !== "GET" && req.method !== "HEAD") return say(res, 405, "只能下载", "method");
    if (!okPath(key)) return say(res, 404, "没有这个文件", "path");
    if (!ready) return say(res, 503, "下载门口还没配好存储（DL_COS_*），先从 GitHub 下：" + cfg.github, "nocfg");
    const rg = region(ip);
    if (!(rg === "LAN" || cfg.allow.includes(rg))) { refuse(ip, "foreign"); return say(res, 403, "这个下载线路只对中国大陆开放。海外请从 GitHub 下载：" + cfg.github + "\nThis mirror serves mainland China only. Please download from GitHub: " + cfg.github, "foreign"); }
    const size = await sizeOf(key);
    if (size === -1) return say(res, 404, "没有这个文件", "missing");
    const n = req.method === "HEAD" ? 0 : want(req.headers.range, size);
    const u = usage();
    if (u.bytes + n > cfg.dailyGB * GB) { refuse(ip, "budget"); if (!u.braked) { u.braked = now(); dirty = true; log(`下载门口：今天已经发出 ${(u.bytes / GB).toFixed(1)}G，到了上限 ${cfg.dailyGB}G，暂停国内线路到明天`); } return say(res, 429, `今天国内下载线路的流量用完了，明天再来；着急的话先从 GitHub 下：${cfg.github}`, "budget"); }
    const fk = u.files[key] || (u.files[key] = { n: 0, bytes: 0, by: {} });
    const mine = fk.by[ip] || 0;
    if (size > 50 * 1024 * 1024 && mine + n > cfg.repeat * size) { refuse(ip, "repeat"); return say(res, 429, `这个文件这个网络今天已经下了 ${Math.floor(mine / size)} 遍，一般是安装反复失败：先看看软件里的报错，明天会自动恢复`, "repeat"); }
    const me = u.ip[ip] || 0;
    if (me + n > cfg.ipGB * GB) { refuse(ip, "ip"); return say(res, 429, `这个网络今天下得太多了（${(me / GB).toFixed(1)}G），明天再来；着急的话先从 GitHub 下：${cfg.github}`, "ip"); }
    if (n) { u.bytes += n; u.n++; u.ip[ip] = me + n; fk.n++; fk.bytes += n; fk.by[ip] = mine + n; dirty = true; }
    res.writeHead(302, { location: presign(req.method === "HEAD" ? "HEAD" : "GET", key, cfg.ttl), "cache-control": "no-store", "access-control-allow-origin": "*", "x-lz-dl": "ok" });
    res.end();
  }

  // 控制中心看的：最近几天每天发出去多少、估计多少钱、谁下得最多、下的什么、拦了多少
  function stats(days = 7) {
    flush();
    const out = [];
    for (let i = 0; i < Math.min(60, Math.max(1, days)); i++) {
      const d = dayOf(now() - i * 86400e3); let x = null;
      try { x = d === day && U ? U : JSON.parse(fs.readFileSync(fileOf(d), "utf8")); } catch (e) {}
      if (!x) { out.push({ day: d, gb: 0, yuan: 0, n: 0 }); continue; }
      const top = (obj, k = 10) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, k);
      out.push({ day: d, gb: +(x.bytes / GB).toFixed(2), yuan: +((x.bytes / GB) * PRICE).toFixed(2), n: x.n, refused: x.refused,
        ips: top(x.ip).map(([ip, b]) => ({ ip, gb: +(b / GB).toFixed(2), region: region(ip) })),
        files: Object.entries(x.files).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 10).map(([k, v]) => ({ key: k, gb: +(v.bytes / GB).toFixed(2), n: v.n, ips: Object.keys(v.by).length })),
        foreign: top(x.foreign, 10).map(([ip, n]) => ({ ip, n })) });
    }
    return { ready, limits: { dailyGB: cfg.dailyGB, ipGB: cfg.ipGB, repeat: cfg.repeat, allow: cfg.allow }, ipList: { v4: lists.v4.length, v6: lists.v6.length, at: listAt }, price: PRICE, days: out };
  }

  return { handle, stats, region, refreshLists, ready, close() { clearInterval(timer); clearInterval(ft); flush(); } };
}

module.exports = { create, parseList, inRanges, v4n, v6n, cleanIp, clientIp };
