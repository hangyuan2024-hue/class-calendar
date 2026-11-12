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
function presign({ endpoint, region, bucket, keyId, secret, method, key, ttl = 3600, now = new Date(), virtual = true }) {
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
  const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const qs = Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k])}`).join("&");
  const creq = [method, p, qs, `host:${host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const sts = ["AWS4-HMAC-SHA256", amzDate, scope, crypto.createHash("sha256").update(creq).digest("hex")].join("\n");
  const h = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
  const kSig = h(h(h(h("AWS4" + secret, day), region), "s3"), "aws4_request");
  const sig = crypto.createHmac("sha256", kSig).update(sts).digest("hex");
  return `${u.protocol}//${host}${p}?${qs}&X-Amz-Signature=${sig}`;
}

function cos(cfg) {
  const prefix = (cfg.prefix || "grid").replace(/\/+$/, "");
  return {
    kind: "cos",
    url(method, key, ttl = 3600) {
      if (!okKey(key)) throw new Error("文件名不对：" + key);
      return presign({ endpoint: cfg.endpoint, region: cfg.region, bucket: cfg.bucket, keyId: cfg.keyId, secret: cfg.secret, method, key: `${prefix}/${key}`, ttl });
    },
  };
}

module.exports = { local, cos, presign, okKey };
