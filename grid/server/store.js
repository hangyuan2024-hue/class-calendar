// 大文件（模型存档、训练数据、生成的图）放哪：
//   本机磁盘：调度中心自己存，下载 / 上传走 /blob/<key>?exp=…&sig=…（HMAC 签名的临时链接）
//   腾讯云 COS（S3 兼容）：调度中心只发「预签名」的临时链接，各台电脑直接和 COS 传，拿不到密钥，也不占调度中心的带宽
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const okKey = (k) => typeof k === "string" && k.length < 400 && /^[\w\-./]+$/.test(k) && !k.split("/").some((p) => p === ".." || p === "" || p === ".");

function local(dir, secret, base) {
  fs.mkdirSync(dir, { recursive: true });
  const sign = (method, key, exp) => crypto.createHmac("sha256", secret).update(`${method}\n${key}\n${exp}`).digest("base64url");
  const file = (key) => { if (!okKey(key)) throw new Error("文件名不对：" + key); return path.join(dir, ...key.split("/")); };
  return {
    kind: "local",
    url(method, key, ttl = 3600) {
      file(key);
      const exp = Math.floor(Date.now() / 1000) + ttl;
      return `${base()}/blob/${key}?exp=${exp}&sig=${sign(method, key, exp)}`;
    },
    check(method, key, exp, sig) {
      if (!okKey(key) || !exp || !sig) return false;
      if (+exp < Date.now() / 1000) return false;
      const want = Buffer.from(sign(method, key, exp));
      const got = Buffer.from(String(sig));
      return want.length === got.length && crypto.timingSafeEqual(want, got);
    },
    file,
    exists(key) { try { return fs.statSync(file(key)).isFile(); } catch (e) { return false; } },
    size(key) { try { return fs.statSync(file(key)).size; } catch (e) { return -1; } },
  };
}

// AWS SigV4 查询串预签名（COS 的 S3 兼容接口一样用）
// headers：要一起签名的请求头（比如存储桶之间复制用的 x-amz-copy-source）；不给就只签 host（和以前一样）
function presign({ endpoint, region, bucket, keyId, secret, method, key, ttl = 3600, now = new Date(), virtual = true, headers = null }) {
  const u = new URL(endpoint);
  const host = virtual ? `${bucket}.${u.host}` : u.host;
  const p = (virtual ? "" : `/${bucket}`) + "/" + key.split("/").map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())).join("/");
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const q = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${keyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(ttl),
    "X-Amz-SignedHeaders": "host",
  };
  const hs = Object.entries(headers || {}).map(([k, v]) => [String(k).toLowerCase().trim(), String(v).trim()]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (hs.length) q["X-Amz-SignedHeaders"] = ["host", ...hs.map((x) => x[0])].sort().join(";");
  const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const qs = Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k])}`).join("&");
  const canon = [["host", host], ...hs].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}:${v}\n`).join("");
  const creq = [method, p, qs, canon, q["X-Amz-SignedHeaders"], "UNSIGNED-PAYLOAD"].join("\n");
  const sts = ["AWS4-HMAC-SHA256", amzDate, scope, crypto.createHash("sha256").update(creq).digest("hex")].join("\n");
  const h = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
  const kSig = h(h(h(h("AWS4" + secret, day), region), "s3"), "aws4_request");
  const sig = crypto.createHmac("sha256", kSig).update(sts).digest("hex");
  return `${u.protocol}//${host}${p}?${qs}&X-Amz-Signature=${sig}`;
}

function cos(cfg) {
  const prefix = (cfg.prefix || "grid").replace(/\/+$/, "");
  return {
    kind: "cos", bucket: cfg.bucket, prefix,
    url(method, key, ttl = 3600, headers = null) {
      if (!okKey(key)) throw new Error("文件名不对：" + key);
      return presign({ endpoint: cfg.endpoint, region: cfg.region, bucket: cfg.bucket, keyId: cfg.keyId, secret: cfg.secret, method, key: `${prefix}/${key}`, ttl, virtual: !cfg.pathStyle, headers });
    },
  };
}

// 新文件放广州 COS、旧文件留在本机磁盘（调度中心在香港：香港到内地晚上只有十几 KB/s，几百 M 的存档要下几个小时）
//   · 各台电脑上传（PUT）：直接传到 COS（广州），不经过香港
//   · 下载（GET）：本机磁盘上有（以前的文件、调度中心自己写的配方 / 录音）→ 照旧本机；没有 → COS 的临时链接
//   · COS 往外下载要流量费：每发一个下载链接，按文件大小记一笔（宁可多记：假设都下完了），
//     今天记满 dailyGB → 新上传的改回存本机磁盘（慢，但不花钱），第二天恢复。已经在 COS 上的文件只能从 COS 下
function hybrid(loc, remote, opt = {}) {
  const dailyGB = opt.dailyGB != null ? +opt.dailyGB : 20;
  const dir = opt.dir ? path.join(opt.dir, "cosuse") : null;
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const sizeOf = opt.sizeOf || (() => Promise.resolve(-1));
  const toRemote = opt.remotePut || (() => true);   // 哪些新文件放 COS（各台电脑传的训练文件）；别的（网页上传的录音、配方）留本机
  const log = opt.log || (() => {});
  const day = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);   // 按北京时间算天
  let today = day(), use = { bytes: 0, links: 0, put: 0, putLocal: 0, warned: false };
  const file = (d) => dir && path.join(dir, d + ".json");
  try { if (dir) use = { ...use, ...JSON.parse(fs.readFileSync(file(today), "utf8")) }; } catch (e) {}
  const sizes = new Map();   // key → 字节（问过 COS 的；最多记 5000 个）
  let dirty = false;
  const roll = () => { const d = day(); if (d !== today) { flush(); today = d; use = { bytes: 0, links: 0, put: 0, putLocal: 0, warned: false }; } };
  function flush() { if (!dir || !dirty) return; dirty = false; try { fs.writeFileSync(file(today), JSON.stringify(use)); } catch (e) {} }
  const timer = setInterval(flush, 30000); if (timer.unref) timer.unref();
  const over = () => dailyGB > 0 && use.bytes >= dailyGB * 1073741824;
  function count(key) {
    roll(); use.links++; dirty = true;
    const add = (n) => {
      if (!(n > 0)) return;
      roll(); use.bytes += n; dirty = true;
      if (over() && !use.warned) { use.warned = true; log(`广州存储今天的下载流量到上限了（约 ${dailyGB}G）：新上传的文件先存香港本机，明天恢复`); }
    };
    if (sizes.has(key)) return add(sizes.get(key));
    sizeOf(key).then((n) => { if (n > 0) { if (sizes.size > 5000) sizes.delete(sizes.keys().next().value); sizes.set(key, n); } add(n); }, () => {});
  }
  return {
    kind: "hybrid",
    url(method, key, ttl = 3600) {
      if (!okKey(key)) throw new Error("文件名不对：" + key);
      if (method === "PUT") {
        if (!toRemote(key)) return loc.url(method, key, ttl);
        // 同一个名字本机已经有了：新的也传到本机，传完一下子换掉旧的（先写临时文件再改名）。
        //   以前这里是「先把本机的旧文件删掉、再让它传到 COS」：发了地址就删，新的要是没传完（断网、关电脑、换了一台电脑），
        //   已经登记过的文件就两边都没有了 → 下载 404、所有电脑卡住。现在上传的名字每次都不一样（index.js），这里一般碰不到；碰到了也不删
        if (loc.exists(key)) return loc.url(method, key, ttl);
        roll(); dirty = true;
        if (over()) { use.putLocal++; return loc.url(method, key, ttl); }
        use.put++; sizes.delete(key);
        return remote.url(method, key, ttl);
      }
      if (loc.exists(key)) return loc.url(method, key, ttl);
      if (method === "GET") count(key);
      return remote.url(method, key, ttl);
    },
    // 调度中心自己读写的（配方、老师传的录音、/pub/ 转发）：本机磁盘
    check: loc.check, file: loc.file, exists: loc.exists, size: loc.size,
    onLocal: (key) => loc.exists(key),
    usage() { roll(); return { day: today, gb: +(use.bytes / 1073741824).toFixed(2), links: use.links, put: use.put, putLocal: use.putLocal, dailyGB, over: over() }; },
    close() { clearInterval(timer); flush(); },
  };
}

module.exports = { local, cos, hybrid, presign, okKey };
