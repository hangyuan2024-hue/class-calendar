#!/usr/bin/env node
// 捞捞算力 · 调度中心
//   node server/index.js [--port 8787] [--data ./data] [--public https://你的域名]
// 第一次启动会打印管理员口令（控制中心登录用），也存在 data/admin.txt。
// 用 COS 存大文件：设环境变量 GRID_COS_ENDPOINT、GRID_COS_REGION、GRID_COS_BUCKET、GRID_COS_KEY_ID、GRID_COS_SECRET（可选 GRID_COS_PREFIX，默认 grid）
"use strict";
process.removeAllListeners("warning");
process.on("warning", (w) => { if (w.name !== "ExperimentalWarning") console.warn(w); });
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Core = require("./core");
const Store = require("./store");
const Cycle = require("./cycle");

function arg(name, d) { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : process.env["GRID_" + name.toUpperCase()] || d; }

function create(opt = {}) {
  const dataDir = path.resolve(opt.data || "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const core = Core.open(opt.dbFile || path.join(dataDir, "grid.db"), opt);
  let secret = core.kv.get("blobSecret");
  if (!secret) { secret = crypto.randomBytes(32).toString("hex"); core.kv.set("blobSecret", secret); }
  let publicBase = opt.public || "";
  const base = () => publicBase;
  const local = Store.local(path.join(dataDir, "blobs"), secret, base);
  const env = opt.env || process.env;
  const store = env.GRID_COS_BUCKET ? Store.cos({ endpoint: env.GRID_COS_ENDPOINT, region: env.GRID_COS_REGION, bucket: env.GRID_COS_BUCKET, keyId: env.GRID_COS_KEY_ID, secret: env.GRID_COS_SECRET, prefix: env.GRID_COS_PREFIX }) : local;
  const ADMIN_DIR = path.join(__dirname, "admin");
  const maxBlob = opt.maxBlob || 40e9;
  const cycle = Cycle.attach(core, opt);
  const tickTimer = opt.noTick ? null : setInterval(() => { try { cycle.tick(); } catch (e) {} }, opt.tickMs || 30000);
  // 老师端读的发布清单：每个文件给一个固定地址（/pub/<key>），真正下载时再转到临时链接
  const pubManifest = () => { const m = cycle.manifest(); for (const v of Object.values(m.models)) v.files = v.files.map((f) => ({ ...f, url: `${publicBase}/pub/${f.key}` })); return m; };

  const json = (res, code, obj) => { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": b.length, "cache-control": "no-store", "access-control-allow-origin": "*" }); res.end(b); };
  const body = (req, limit = 4e6) => new Promise((ok, bad) => {
    let n = 0; const cs = [];
    req.on("data", (c) => { n += c.length; if (n > limit) { bad(new Error("太大了")); req.destroy(); } else cs.push(c); });
    req.on("end", () => { try { ok(cs.length ? JSON.parse(Buffer.concat(cs).toString("utf8")) : {}); } catch (e) { bad(new Error("格式不对")); } });
    req.on("error", bad);
  });
  const tokenOf = (req) => (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const keyOk = (k, dev) => Store.okKey(k) && (/^(jobs|recipes|shared)\//.test(k));

  // 签名的链接，把 key 里的东西带上
  const signed = (payload) => {
    const out = { ...payload };
    delete out.meta;   // 训练用的东西（比如图片特征），不给审核界面
    for (const f of ["a", "b", "ref", "img", "audio", "video"]) if (typeof out[f] === "string" && Store.okKey(out[f])) out[f + "Url"] = store.url("GET", out[f], 3600);
    if (Array.isArray(out.imgs)) out.imgUrls = out.imgs.map((k) => store.url("GET", k, 3600));
    return out;
  };

  const routes = {
    // ---- 不用登录 ----
    "GET /api/ping": () => ({ ok: true, name: "捞捞算力", time: Date.now(), store: store.kind }),
    "POST /api/join": async (req, b) => core.join(b),
    // ---- 电脑（成员） ----
    "POST /api/hb": (req, b, dev) => core.heartbeat(dev, b),
    "POST /api/lease": (req, b, dev) => {
      const r = core.lease(dev, b.caps || {});
      if (r && r.recipe) r.recipe.url = store.url("GET", r.recipe.key, 3600);
      if (r && r.resume) r.resume.url = store.url("GET", r.resume.key, 3600);
      if (r && r.deps) for (const d of Object.values(r.deps)) d.outputs = (d.outputs || []).map((o) => ({ ...o, url: store.url("GET", o.key, 6 * 3600) }));
      if (r && r.files) r.fileUrls = Object.fromEntries(Object.entries(r.files).map(([k, v]) => [k, store.url("GET", v, 6 * 3600)]));
      if (r && r.task.kind === "merge") r.task.input.partUrls = (r.task.input.parts || []).map((k) => store.url("GET", k, 3600));
      return { task: r };
    },
    "POST /api/renew": (req, b, dev) => core.renew(dev, b),
    "POST /api/ckpt": (req, b, dev) => core.checkpoint(dev, b),
    "POST /api/done": (req, b, dev) => core.finish(dev, b),
    "POST /api/fail": (req, b, dev) => core.fail(dev, b),
    // 上传：要一个临时上传链接（放在 jobs/<任务>/<小任务>/ 下面）
    "POST /api/put": (req, b, dev) => {
      const name = String(b.name || "").replace(/[^\w.\-]/g, "_").slice(0, 120);
      if (!name || !b.job) throw new Error("缺文件名");
      const key = `jobs/${+b.job}/${b.task ? +b.task : "x"}/${b.prefix ? String(b.prefix).replace(/[^\w\-]/g, "") + "-" : ""}${name}`;
      return { key, url: store.url("PUT", key, 6 * 3600) };
    },
    "POST /api/get": (req, b, dev) => { if (!keyOk(b.key, dev)) throw new Error("没有权限"); return { url: store.url("GET", b.key, 3600) }; },
    "GET /api/me": (req, b, dev) => ({ device: { id: dev.id, name: dev.name }, member: { id: dev.member_id, name: dev.member_name, role: dev.role }, board: core.board().find((x) => x.id === dev.member_id) || null }),
    "GET /api/overview": (req, b, dev) => core.overview(false),
    "GET /api/board": () => core.board(),
    "POST /api/human/next": (req, b, dev) => ({ item: core.humanNext(dev, b.job) }),
    "POST /api/human/done": (req, b, dev) => core.humanDone(dev, b),
    "GET /api/review/next": (req, b, dev) => { const r = core.reviewNext(dev); return { item: r ? { id: r.id, job: r.job_name, kind: r.kind, need: r.need, votes: r.votes, payload: signed(JSON.parse(r.payload || "{}")) } : null }; },
    "POST /api/review/vote": (req, b, dev) => core.vote(dev, b),
    // 训练要用的审核结果：图片给下载地址（6 小时内有效）
    "POST /api/dataset": (req, b, dev) => ({ items: core.dataset(dev, b).map((it) => {
      const pl = { ...it.payload };
      for (const f of ["a", "b", "ref", "img", "audio"]) if (typeof pl[f] === "string" && /^[\w\-/.]+$/.test(pl[f]) && !/^https?:/.test(pl[f])) pl[f + "Url"] = store.url("GET", pl[f], 6 * 3600);
      return { ...it, payload: pl };
    }) }),
    // ---- 管理员（控制中心） ----
    "GET /api/admin/overview": () => ({ ...core.overview(true), store: store.kind, pubkey: core.kv.get("pubkey") || null }),
    "GET /api/admin/job": (req, b, dev, u) => {
      const d = core.jobDetail(+u.searchParams.get("id"));
      if (!d) throw new Error("没有这个任务");
      d.reviews = d.reviews.slice(0, 60).map((r) => ({ ...r, payload: r.payload ? signed(r.payload) : null }));
      d.thumbs = d.outputs.filter((o) => /\.(png|jpe?g|webp)$/i.test(o.name)).slice(0, 24).map((o) => ({ name: o.name, url: store.url("GET", o.key, 3600) }));
      return d;
    },
    "POST /api/admin/job": (req, b) => ({ id: core.createJob(b) }),
    "POST /api/admin/job/set": (req, b) => core.setJob(b.id, b),
    "POST /api/admin/job/retry": (req, b) => core.retry(b.id),
    "POST /api/admin/device/set": (req, b) => core.setDevice(b.id, b),
    "POST /api/admin/invite": (req, b) => { const inv = core.invite(b); const pub = core.kv.get("pubkey"); return { ...inv, link: inviteLink(b.server || publicBase, inv.code, pub) }; },
    "GET /api/admin/invites": () => core.invites(),
    "GET /api/admin/recipes": () => core.recipes(),
    // 配方：管理员在自己电脑上用私钥签好名，再传上来；各台电脑用邀请码里的公钥核对，签名不对不跑
    "POST /api/admin/recipe": async (req, b) => {
      const src = Buffer.from(String(b.source || ""), "utf8");
      const id = crypto.createHash("sha256").update(src).digest("hex");
      const pub = core.kv.get("pubkey");
      if (!pub) throw new Error("还没设管理员公钥（node tools/keys.js init）");
      if (!verify(pub, id, b.sig)) throw new Error("签名不对");
      const key = `recipes/${id}.py`;
      if (store.kind === "local") { fs.mkdirSync(path.dirname(local.file(key)), { recursive: true }); fs.writeFileSync(local.file(key), src); }
      else { const r = await fetch(store.url("PUT", key, 600), { method: "PUT", body: src }); if (!r.ok) throw new Error("传到 COS 失败：" + r.status); }
      return core.addRecipe({ id, name: b.name || "配方", key, sig: b.sig, meta: b.meta || {} });
    },
    "POST /api/admin/pubkey": (req, b) => { if (core.kv.get("pubkey") && !b.force) throw new Error("已经设过公钥了"); core.kv.set("pubkey", b.pubkey); return { ok: true }; },
    "GET /api/admin/recipe": (req, b, dev, u) => { const r = core.recipe(u.searchParams.get("id")); if (!r) throw new Error("没有"); return { ...r, source: store.kind === "local" && local.exists(r.key) ? fs.readFileSync(local.file(r.key), "utf8") : null, url: store.url("GET", r.key, 600) }; },
    "GET /api/admin/export": (req, b, dev, u) => ({ reviews: core.exportReviews(+u.searchParams.get("job")), outputs: core.outputs(+u.searchParams.get("job")) }),
    // 每日一轮、模型版本
    "GET /api/admin/cycle": () => cycle.view(),
    "POST /api/admin/pipeline": (req, b) => ({ id: cycle.setPipeline(b) }),
    "POST /api/admin/pipeline/run": (req, b) => ({ run: cycle.startRun(+(b.id || (core.db.prepare("select id from pipelines where name=?").get(String(b.name || "")) || {}).id), b.extra && b.extra.member ? `训练「${b.extra.member}」` : "管理员点了「现在跑一轮」", b.extra || {}) }),
    // 导入老师自己录的音频（手机录音机录的原文件）：先拿上传地址，传完再登记
    "POST /api/admin/import/start": (req, b) => {
      const name = String(b.name || "").replace(/[^\w.\-]/g, "_").slice(0, 100);
      if (!name || !/\.(wav|m4a|mp3|aac|flac|ogg|opus|webm|mp4|mov|amr)$/i.test(name)) throw new Error("只能导入音频或视频文件");
      const key = `imports/${Date.now()}-${name}`;
      return { key, url: store.url("PUT", key, 3600) };
    },
    "POST /api/admin/import/done": (req, b) => core.importVoice(b),
    "POST /api/admin/pipeline/enable": (req, b) => (cycle.setEnabled(+b.id, !!b.enabled), { ok: true }),
    "POST /api/admin/model/set": (req, b) => cycle.setModel(+b.id, b.state),
    "POST /api/admin/model/code": (req, b) => ({ name: String(b.name), code: cycle.codeOf(String(b.name), !!b.rotate) }),
    "POST /api/admin/ab": (req, b) => cycle.abStats(b.tag || "qv1"),
    "POST /api/admin/model/promote": (req, b) => cycle.promote(String(b.from), String(b.to), b.note),
    "POST /api/admin/geturl": (req, b) => { if (!Store.okKey(b.key)) throw new Error("文件名不对"); return { url: store.url("GET", b.key, 3600) }; },
  };

  async function handle(req, res) {
    const u = new URL(req.url, "http://x");
    if (!publicBase) publicBase = `http://${req.headers.host}`;
    try {
      if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, PUT" }); return res.end(); }
      if (u.pathname.startsWith("/blob/")) return blob(req, res, u);
      if (u.pathname === "/pub/models/manifest.json") return json(res, 200, pubManifest());
      // 不公开的模型（老师的声音）：凭声音码拿清单和文件
      const pm = /^\/pub\/private\/([\w-]{6,40})\/manifest\.json$/.exec(u.pathname);
      if (pm) {
        const m = cycle.privateManifest(pm[1]);
        if (!m) return json(res, 404, { error: "声音码不对" });
        for (const v of Object.values(m.models)) v.files = v.files.map((f) => ({ ...f, url: `${publicBase}/pub/${f.key}?c=${pm[1]}` }));
        return json(res, 200, m);
      }
      if (u.pathname.startsWith("/pub/")) {
        const key = decodeURIComponent(u.pathname.slice(5));
        const code = u.searchParams.get("c");
        if (!cycle.publicKeys().has(key) && !(code && cycle.privateKeys(code).has(key))) return json(res, 404, { error: "没有这个文件" });
        u.searchParams.delete("c");
        if (store.kind === "local") { u.searchParams.set("exp", String(Math.floor(Date.now() / 1000) + 600)); return blob(Object.assign(req, { method: req.method === "HEAD" ? "HEAD" : "GET" }), res, new URL(store.url("GET", key, 600))); }
        res.writeHead(302, { location: store.url("GET", key, 6 * 3600) }); return res.end();
      }
      if (u.pathname === "/" || u.pathname === "/admin") { res.writeHead(302, { location: "/admin/" }); return res.end(); }
      if (u.pathname.startsWith("/admin/")) return staticFile(res, ADMIN_DIR, u.pathname.slice(7) || "index.html");
      const route = routes[`${req.method} ${u.pathname}`];
      if (!route) return json(res, 404, { error: "没有这个接口" });
      const token = tokenOf(req);
      let dev = null;
      const open = u.pathname === "/api/ping" || u.pathname === "/api/join";
      if (!open) {
        if (u.pathname.startsWith("/api/admin/")) {
          if (!core.isAdmin(token)) { dev = core.auth(token); if (!dev || dev.role !== "admin") return json(res, 401, { error: "要管理员口令" }); }
        } else {
          dev = core.auth(token);
          if (!dev) return json(res, 401, { error: "这台电脑还没加入，或者被管理员移出了" });
        }
      }
      const b = req.method === "POST" ? await body(req) : {};
      const out = await route(req, b, dev, u);
      json(res, 200, out == null ? null : out);
    } catch (e) {
      json(res, 400, { error: e.message || String(e) });
    }
  }

  // 本机存储的上传 / 下载（带签名的临时链接）
  function blob(req, res, u) {
    const key = decodeURIComponent(u.pathname.slice(6));
    const method = req.method === "HEAD" ? "GET" : req.method;
    if (store.kind !== "local" || !local.check(method, key, u.searchParams.get("exp"), u.searchParams.get("sig"))) return json(res, 403, { error: "链接过期或不对" });
    const f = local.file(key);
    if (req.method === "PUT") {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const tmp = f + ".part-" + crypto.randomBytes(4).toString("hex");
      const w = fs.createWriteStream(tmp);
      let n = 0, bad = false;
      req.on("data", (c) => { n += c.length; if (n > maxBlob && !bad) { bad = true; req.destroy(); w.destroy(); fs.rm(tmp, () => {}); } });
      req.pipe(w);
      w.on("finish", () => { if (bad) return; fs.renameSync(tmp, f); json(res, 200, { ok: true, size: n }); });
      w.on("error", (e) => json(res, 500, { error: e.message }));
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      let st; try { st = fs.statSync(f); } catch (e) { return json(res, 404, { error: "没有这个文件" }); }
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
      const type = /\.(png)$/i.test(f) ? "image/png" : /\.jpe?g$/i.test(f) ? "image/jpeg" : /\.webm$/i.test(f) ? "audio/webm" : /\.wav$/i.test(f) ? "audio/wav" : /\.json$/i.test(f) ? "application/json" : /\.py$/.test(f) ? "text/plain; charset=utf-8" : "application/octet-stream";
      if (range) {
        const a = +range[1], z = range[2] ? +range[2] : st.size - 1;
        res.writeHead(206, { "content-type": type, "content-length": z - a + 1, "content-range": `bytes ${a}-${z}/${st.size}`, "accept-ranges": "bytes" });
        return req.method === "HEAD" ? res.end() : fs.createReadStream(f, { start: a, end: z }).pipe(res);
      }
      res.writeHead(200, { "content-type": type, "content-length": st.size, "accept-ranges": "bytes" });
      return req.method === "HEAD" ? res.end() : fs.createReadStream(f).pipe(res);
    }
    json(res, 405, { error: "不支持" });
  }
  function staticFile(res, dir, rel) {
    const f = path.join(dir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
    if (!f.startsWith(dir)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (e, d) => {
      if (e) { res.writeHead(404); return res.end("not found"); }
      const t = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(f)] || "application/octet-stream";
      res.writeHead(200, { "content-type": t, "cache-control": "no-cache" });
      res.end(d);
    });
  }

  const server = http.createServer(handle);
  return {
    core, store, server,
    listen(port, host) { return new Promise((ok) => server.listen(port, host, () => { if (!opt.public) publicBase = `http://${host === "0.0.0.0" || !host ? "127.0.0.1" : host}:${server.address().port}`; ok(server.address().port); })); },
    setPublic(u) { publicBase = u; },
    close() { clearInterval(tickTimer); server.close(); core.close(); },
    cycle,
  };
}

// ed25519：公钥是 32 字节的 base64url
function verify(pub, msgHex, sig) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pub, "base64url")]), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(msgHex, "utf8"), key, Buffer.from(String(sig || ""), "base64url"));
  } catch (e) { return false; }
}
// 邀请链接：一串字，里面有调度中心的地址、邀请码、管理员公钥（软件用它核对配方签名）
function inviteLink(server, code, pub) {
  return "LG1." + Buffer.from(JSON.stringify({ u: server, c: code, k: pub || "" })).toString("base64url");
}

module.exports = { create, verify, inviteLink };

if (require.main === module) {
  const app = create({ data: arg("data", "data"), public: arg("public", "") });
  const port = +arg("port", 8787);
  app.listen(port, arg("host", "0.0.0.0")).then((p) => {
    const t = app.core.adminToken();
    fs.writeFileSync(path.join(path.resolve(arg("data", "data")), "admin.txt"), `管理员口令（控制中心登录用，不要发给别人）：\n${t}\n`);
    console.log(`捞捞算力 · 调度中心已启动：端口 ${p}，存储：${app.store.kind === "cos" ? "腾讯云 COS" : "本机磁盘"}`);
    console.log(`控制中心：http://<这台服务器的地址>:${p}/admin/`);
    console.log(`管理员口令在 ${path.join(path.resolve(arg("data", "data")), "admin.txt")}`);
  });
}
