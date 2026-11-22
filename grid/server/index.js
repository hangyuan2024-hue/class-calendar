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
const Gate = require("./dlgate");
const Relay = require("./dlrelay");
const AssistRelay = require("../shared/assist-relay");

function arg(name, d) { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : process.env["GRID_" + name.toUpperCase()] || d; }

// 签名包要签的训练计划（以及它们用到的配方）
const SIGN_PLANS = ["qa", "chat", "ground", "frontier", "base", "ppt", "vision"];
function signSrc(root = path.join(__dirname, "..")) {
  const out = [], seen = new Set();
  const put = (rel) => {
    if (seen.has(rel)) return;
    const f = path.join(root, rel);
    if (!fs.existsSync(f)) return;
    seen.add(rel);
    const text = fs.readFileSync(f, "utf8");
    out.push({ path: rel, sha256: require("crypto").createHash("sha256").update(text, "utf8").digest("hex"), text });
  };
  for (const n of SIGN_PLANS) {
    const rel = "plans/" + n + ".json";
    put(rel);
    try { for (const st of JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")).stages || []) if (st.recipeFile) put(path.posix.join("recipes", path.basename(st.recipeFile))); } catch (e) {}
  }
  put("tools/grid.js");
  return { plans: SIGN_PLANS.map((n) => "plans/" + n + ".json").filter((p) => seen.has(p)), files: out };
}

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
  // 配了腾讯云 COS（GRID_COS_*）：默认「新文件放 COS、旧文件留本机」（见 store.js 的 hybrid）；GRID_COS_MODE=all 全部放 COS
  const remote = env.GRID_COS_BUCKET ? Store.cos({ endpoint: env.GRID_COS_ENDPOINT, region: env.GRID_COS_REGION, bucket: env.GRID_COS_BUCKET, keyId: env.GRID_COS_KEY_ID, secret: env.GRID_COS_SECRET, prefix: env.GRID_COS_PREFIX, pathStyle: env.GRID_COS_PATHSTYLE === "1" }) : null;
  const store = !remote ? local : env.GRID_COS_MODE === "all" ? remote : Store.hybrid(local, remote, {
    dailyGB: env.GRID_COS_DAILY_GB, dir: dataDir, log: (m) => console.log(m),
    remotePut: (k) => /^(jobs|logs)\//.test(k),   // 各台电脑传的训练文件、日志放 COS；控制中心网页上传的录音、配方照旧本机（浏览器直接传 COS 会被跨域拦）
    sizeOf: async (key) => { try { const r = await fetch(remote.url("HEAD", key, 300), { method: "HEAD", signal: AbortSignal.timeout(15000) }); return r.ok ? +(r.headers.get("content-length") || 0) : -1; } catch (e) { return -1; } },
  });
  const ADMIN_DIR = path.join(__dirname, "admin");
  const maxBlob = opt.maxBlob || 40e9;
  const cycle = Cycle.attach(core, opt);
  // 下载门口：安装包、AI 组件只给中国大陆的 IP，转到 COS 的临时链接（见 dlgate.js）
  // 通用版（别人自己搭的调度中心，server/edition.json 里 open: true）：不搬捞捞的安装包，也不开下载门口
  const OPEN = opt.open != null ? !!opt.open : (() => { try { return !!JSON.parse(fs.readFileSync(path.join(__dirname, "edition.json"), "utf8")).open; } catch (e) { return false; } })();
  const relay = Relay.create({ env, dataDir, noTimer: !!opt.noTick || OPEN, ...(opt.relay || {}), log: (m) => { try { core.event && core.event("info", m); } catch (e) {} console.log(m); } });
  const gate = Gate.create({ env, dataDir, relay, ...(OPEN ? { noRefresh: true } : {}), ...(opt.gate || {}), log: (m) => { try { core.event && core.event("info", m); } catch (e) {} console.log(m); } });
  const tickTimer = opt.noTick ? null : setInterval(() => { try { cycle.tick(); } catch (e) {} try { core.dailyBrief(); } catch (e) {} }, opt.tickMs || 30000);
  // 老师端读的发布清单：每个文件给一个固定地址（/pub/<key>），真正下载时再转到临时链接
  const pubManifest = () => { const m = cycle.manifest(); for (const v of Object.values(m.models)) v.files = v.files.map((f) => ({ ...f, url: `${publicBase}/pub/${f.key}` })); return m; };

  const dlManifest = (req) => {
    const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https" ? "https" : "http";
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    const m = cycle.manifest(), out = { updated: m.updated, models: {} };
    for (const [name, v] of Object.entries(m.models)) out.models[name] = { version: v.version, metrics: v.metrics, at: v.at,
      files: v.files.map((f, i) => ({ name: f.name, size: f.size, sha256: f.sha256, url: `${proto}://${host}/dl/models/${encodeURIComponent(name)}/${v.version}/${i}${(path.extname(String(f.key || "")) || "").replace(/[^\w.]/g, "")}` })) };
    return out;
  };
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

  // 存储里确定没有这个文件：true；在：false；说不准（网络问题、没权限）：null —— 说不准的时候当作还在，不随便扔存档
  async function blobGone(key) {
    try {
      if (local.exists(key)) return false;
      if (!remote || store.kind === "local") return true;
      const r = await fetch(remote.url("HEAD", key, 300), { method: "HEAD", signal: AbortSignal.timeout(15000) });
      return r.status === 404 ? true : r.ok ? false : null;
    } catch (e) { return null; }
  }
  // 看门狗：广州存储里放一个小文件，每 20 分钟看一眼还在不在。捞捞算力自己从来不删训练文件，它不见了 = 有别的程序在删这个桶里的东西
  //   （2026-11-18 出过事：打包上传安装包后的清理（.github/workflows/cn-upload.sh）按「grid/ 文件夹只留最新 3 个」删，把 grid/jobs/ 的训练文件全删了，过了一天才发现）
  //   → 控制中心的动态里报警、服务器日志里写清楚，再放一个新的接着看
  const CANARY = "jobs/_canary/keep-me.txt";
  let canaryPlanted = false;
  async function canary() {
    if (!remote) return { skip: true };
    let r = null;
    try { r = await fetch(remote.url("HEAD", CANARY, 300), { method: "HEAD", signal: AbortSignal.timeout(15000) }); } catch (e) { return { unsure: true }; }
    if (r.ok) { canaryPlanted = true; return { ok: true }; }
    if (r.status !== 404) return { unsure: true, status: r.status };
    let alarm = false;
    if (canaryPlanted) {
      alarm = true;
      const m = "警告：广州存储里的训练文件被别的程序删了（看门狗文件不见了；捞捞算力自己不删）。查一下有没有别的程序在清理 / 同步这个存储桶（打包后清理旧安装包的脚本、带 --delete 的同步、桶的生命周期规则）";
      console.log(m); try { core.event("warn", m); } catch (e) {}
    }
    try {
      const body = `捞捞算力看门狗：别删我。放进来的时间 ${new Date().toISOString()}\n`;
      const p = await fetch(remote.url("PUT", CANARY, 300), { method: "PUT", headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Length": String(Buffer.byteLength(body)) }, body, signal: AbortSignal.timeout(15000) });
      canaryPlanted = p.ok;
    } catch (e) { /* 下次再放 */ }
    return { alarm, planted: canaryPlanted };
  }
  const canaryTimer = opt.noTick || !remote ? null : setInterval(() => canary().catch(() => {}), opt.canaryMs || 20 * 60e3);
  if (canaryTimer && canaryTimer.unref) canaryTimer.unref();
  if (!opt.noTick && remote) setTimeout(() => canary().catch(() => {}), 10e3).unref();
  // 远程协助：调度中心只转发画面和鼠标键盘；对方电脑每次都弹窗问，同意了才开始（见 shared/assist-relay.js）
  const assist = AssistRelay.create({ noTimer: !!opt.noTick, ...(opt.assist || {}), log: (m) => { try { core.event("info", m); } catch (e) {} } });
  const mySession = (b, dev) => { const x = assist.get(b.s); if (!x || x.device !== dev.id) throw new Error("协助会话不对"); return b; };
  const routes = {
    // ---- 远程协助 ----
    "POST /api/admin/device/assist": (req, b) => {
      const d = core.db.prepare("select d.id, d.name, d.last_seen, m.name as member from devices d left join members m on m.id=d.member_id where d.id=? and d.disabled=0").get(+b.id);
      if (!d) throw new Error("没有这台电脑");
      const s = assist.start({ device: d.id, name: `${d.member || ""} · ${d.name}`, by: String(b.by || "管理员").slice(0, 40), mode: b.mode });
      core.sendCommand(d.id, "assist", { s: s.id, token: s.token, mode: s.mode, by: s.by });
      return { s: s.id, online: Date.now() - (d.last_seen || 0) < 60e3 };
    },
    "GET /api/admin/assist/status": (req, b, dev, u) => assist.status(u.searchParams.get("s")),
    "GET /api/admin/assist/view": (req, b, dev, u) => assist.view(u.searchParams.get("s"), +u.searchParams.get("after") || 0),
    "POST /api/admin/assist/input": (req, b) => assist.input(b.s, b.ev),
    "POST /api/admin/assist/end": (req, b) => assist.end(b.s, "管理员结束了"),
    // 客户端分批更新：看每个新版推到哪一档；停推的看过了没问题可以接着推（stage: half / all），也能手动停（paused）
    "GET /api/admin/brief": () => core.brief(),
    // 签名包要签的那几份训练计划和它们用到的配方（调度中心自己这份代码里的，git pull 以后就是最新的）：签名电脑拉下来列给管理员确认
    "GET /api/admin/src": () => signSrc(),
    "GET /api/admin/rollouts": () => core.rollouts(),
    "POST /api/admin/rollout": (req, b) => core.setRollout(b.version, b.stage),
    "GET /api/admin/assist/list": () => assist.list(),
    "POST /api/assist/answer": (req, b, dev) => assist.answer(mySession(b, dev)),
    "POST /api/assist/frame": (req, b, dev) => assist.frame(mySession(b, dev)),
    "POST /api/assist/take": (req, b, dev) => assist.take(mySession(b, dev)),
    "POST /api/assist/end": (req, b, dev) => assist.end(mySession(b, dev).s, b.why ? String(b.why).slice(0, 60) : "对方结束了", b.token),
    // ---- 不用登录 ----
    "GET /api/ping": () => ({ ok: true, name: "捞捞算力", time: Date.now(), store: store.kind }),
    "POST /api/join": async (req, b) => core.join(b),
    // ---- 电脑（成员） ----
    // proto：调度中心认得哪些新东西（2 = CPU 工位、按真正空着的显存派活、分批推新版）。客户端的新功能要调度中心认得才打开
    "POST /api/hb": (req, b, dev) => {
      // 记下电脑上网的出口地址（同一个出口 + 同一个网段的，才让它们互相测局域网）
      if (b && b.info && typeof b.info === "object") b.info.pubip = String(req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0] || req.socket.remoteAddress || "").trim().slice(0, 60);
      const r = core.heartbeat(dev, b) || {};
      return { ...r, ...core.lanExtras(dev, b && b.info), proto: 3 };
    },
    "POST /api/lan-report": (req, b, dev) => core.lanReport(dev, b),
    "GET /api/admin/lan": () => core.lanView(),
    "POST /api/lease": async (req, b, dev) => {
      const r = core.lease(dev, b.caps || {});
      // 发存档之前先核对它在存储里还在：确定不在了（404）就标掉、退回更早的存档（或者从头算），不让所有电脑一起卡在同一个 404 上
      for (let i = 0; r && r.resume && i < 8; i++) {
        if ((await blobGone(r.resume.key)) !== true) break;
        console.log(`任务 #${r.task.id} 的存档 ${r.resume.key} 在存储里找不到了：标成丢失，换更早的存档`);
        r.resume = core.lostCkpt(r.task.id, r.resume.key);
      }
      if (r && r.recipe) r.recipe.url = store.url("GET", r.recipe.key, 3600);
      if (r && r.resume) r.resume.url = store.url("GET", r.resume.key, 12 * 3600);   // 存档几百 M，网慢时要下很久：链接给 12 小时，别下到一半过期
      if (r && r.deps) for (const d of Object.values(r.deps)) d.outputs = (d.outputs || []).map((o) => ({ ...o, url: store.url("GET", o.key, 6 * 3600) }));
      if (r && r.files) r.fileUrls = Object.fromEntries(Object.entries(r.files).map(([k, v]) => [k, store.url("GET", v, 6 * 3600)]));
      if (r && r.task.kind === "merge") r.task.input.partUrls = (r.task.input.parts || []).map((k) => store.url("GET", k, 3600));
      return { task: r };
    },
    "POST /api/renew": (req, b, dev) => core.renew(dev, b),
    // 登记之前核对文件真的在存储里（确定不在才拒）：不让数据库里记一个根本没存上的文件
    "POST /api/ckpt": async (req, b, dev) => { if (Store.okKey(b.key) && (await blobGone(b.key)) === true) throw new Error("存档文件在存储里找不到（没传完？）：这个存档不算，下一个存档照常交"); return core.checkpoint(dev, b); },
    "POST /api/done": async (req, b, dev) => {
      const keys = new Set();
      for (const o of Array.isArray(b.outputs) ? b.outputs : []) if (o && Store.okKey(o.key) && /^jobs\//.test(o.key)) keys.add(o.key);
      for (const v of Object.values((b.result && typeof b.result === "object") ? b.result : {})) if (typeof v === "string" && Store.okKey(v) && /^jobs\//.test(v)) keys.add(v);
      const ks = [...keys].slice(0, 400), gone = [];
      for (let i = 0; i < ks.length; i += 8) (await Promise.all(ks.slice(i, i + 8).map(async (k) => ((await blobGone(k)) === true ? k : null)))).forEach((k) => k && gone.push(k));
      if (gone.length) { console.log(`任务 #${b.task} 交结果：${gone.length} 个结果文件在存储里找不到（${gone.slice(0, 3).join("、")}）：不收，重算`); throw new Error(`结果文件没存上（${gone.length} 个，比如 ${gone[0].split("/").pop()}）：这次不算，重新算一遍`); }
      return core.finish(dev, b);
    },
    "POST /api/fail": (req, b, dev) => core.fail(dev, b),
    // 上传：要一个临时上传链接（放在 jobs/<任务>/<小任务>/ 下面）
    "POST /api/put": (req, b, dev) => {
      const name = String(b.name || "").replace(/[^\w.\-]/g, "_").slice(0, 120);
      if (!name || !b.job) throw new Error("缺文件名");
      // 每次上传都是一个新名字（结尾加一段随机的）：同一个任务重来、两台电脑交同名文件，都不会盖掉 / 删掉已经登记的那一份
      //   以前名字是固定的（jobs/任务/编号/out-xxx.jsonl）：同名再传时旧的会被删（见 store.js），新的没传完 → 已经登记的文件就没了（404）
      const ext = (/\.[\w]{1,12}$/.exec(name) || [""])[0], stem = name.slice(0, name.length - ext.length);
      const key = `jobs/${+b.job}/${b.task ? +b.task : "x"}/${b.prefix ? String(b.prefix).replace(/[^\w\-]/g, "") + "-" : ""}${stem}-${crypto.randomBytes(4).toString("hex")}${ext}`;
      return { key, url: store.url("PUT", key, 6 * 3600) };
    },
    "POST /api/get": (req, b, dev) => { if (!keyOk(b.key, dev)) throw new Error("没有权限"); return { url: store.url("GET", b.key, 3600) }; },
    // 遥控命令做完了；交日志（拿一个上传地址：logs/<电脑>/<时间>-文件名）；这台电脑自己的贡献统计
    "POST /api/cmd/done": (req, b, dev) => core.commandDone(dev, b),
    "POST /api/lane": (req, b, dev) => core.laneDevice(dev, b),
    "POST /api/update-gate": (req, b, dev) => core.updateGate(dev, b),
    "POST /api/logs/put": (req, b, dev) => { const name = String(b.name || "log.txt").replace(/[^\w.\-]/g, "_").slice(-80); const key = `logs/${dev.id}/${Date.now()}-${name}`; return { key, url: store.url("PUT", key, 3600) }; },
    "GET /api/me/stats": (req, b, dev, u) => core.stats(Math.min(60, +u.searchParams.get("days") || 14), dev.id),
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
    // 控制中心遥控某台电脑：开始 / 停止 / 自动 / 立刻更新 / 重启软件 / 交日志 / 清理缓存 / 重新体检 / 改设置
    "POST /api/admin/device/cmd": (req, b) => core.sendCommand(+b.id, String(b.cmd || ""), b.args || null),
    "GET /api/admin/device": (req, b, dev, u) => { const id = +u.searchParams.get("id"); return { commands: core.commandsOf(id), logs: core.deviceLogs(id).map((l) => ({ ...l, url: store.url("GET", l.key, 1800) })), stats: core.stats(14, id) }; },
    "GET /api/admin/stats": (req, b, dev, u) => core.stats(Math.min(90, +u.searchParams.get("days") || 14)),
    // 模型各版的评测成绩（画「越训越好」的曲线）
    "GET /api/admin/model/history": (req, b, dev, u) => cycle.history ? cycle.history(String(u.searchParams.get("name") || "")) : [],
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
      if (store.kind !== "cos") { fs.mkdirSync(path.dirname(local.file(key)), { recursive: true }); fs.writeFileSync(local.file(key), src); }
      else { const r = await fetch(store.url("PUT", key, 600), { method: "PUT", body: src }); if (!r.ok) throw new Error("传到 COS 失败：" + r.status); }
      return core.addRecipe({ id, name: b.name || "配方", key, sig: b.sig, meta: b.meta || {} });
    },
    "POST /api/admin/pubkey": (req, b) => { if (core.kv.get("pubkey") && !b.force) throw new Error("已经设过公钥了"); core.kv.set("pubkey", b.pubkey); return { ok: true }; },
    "GET /api/admin/recipe": (req, b, dev, u) => { const r = core.recipe(u.searchParams.get("id")); if (!r) throw new Error("没有"); return { ...r, source: store.kind !== "cos" && local.exists(r.key) ? fs.readFileSync(local.file(r.key), "utf8") : null, url: store.url("GET", r.key, 600) }; },
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
    // 控制中心「老师的声音」
    "GET /api/admin/voices": () => {
      const ms = core.db.prepare("select name, max(version) as version from models where name like 'voice-%' and state='released' group by name").all();
      const runs = core.db.prepare("select r.id, r.state, r.created, json_extract(r.result,'$.extra.voiceOf') as who from runs r join pipelines p on p.id=r.pipeline_id where p.name='声音训练' order by r.id desc limit 200").all();
      return core.voices().map((v) => ({ ...v, model: (ms.find((m) => m.name === "voice-" + v.member) || {}).version || null, run: runs.find((r) => r.who === v.member) || null }));
    },
    "POST /api/admin/member/add": (req, b) => core.addMember(b.name),
    "POST /api/admin/pipeline/enable": (req, b) => (cycle.setEnabled(+b.id, !!b.enabled), { ok: true }),
    "POST /api/admin/model/set": (req, b) => cycle.setModel(+b.id, b.state),
    "POST /api/admin/model/code": (req, b) => ({ name: String(b.name), code: cycle.codeOf(String(b.name), !!b.rotate) }),
    "POST /api/admin/ab": (req, b) => cycle.abStats(b.tag || "qv1"),
    "POST /api/admin/model/promote": (req, b) => cycle.promote(String(b.from), String(b.to), b.note),
    // 配好 COS 以后自检：往 COS 传一个小文件、读回来、核对（grid-cos.sh 用）
    "POST /api/admin/store/test": async () => {
      if (!remote) return { ok: false, why: "还没配 GRID_COS_*" };
      const key = `jobs/0/selftest/${Date.now()}.txt`, body = "laolao " + crypto.randomBytes(8).toString("hex");
      const step = async (what, fn) => { try { return await fn(); } catch (e) { throw new Error(what + "：" + (e.message || e)); } };
      try {
        const put = await step("传", () => fetch(remote.url("PUT", key, 300), { method: "PUT", body, signal: AbortSignal.timeout(20000) }));
        if (!put.ok) return { ok: false, why: `传不上去：${put.status} ${((await put.text()).match(/<Code>([^<]+)/) || [])[1] || ""}（看看子用户的策略里有没有 PutObject、资源是不是 grid/jobs/*）` };
        const get = await step("读", () => fetch(remote.url("GET", key, 300), { signal: AbortSignal.timeout(20000) }));
        if (!get.ok) return { ok: false, why: `读不回来：${get.status} ${((await get.text()).match(/<Code>([^<]+)/) || [])[1] || ""}（策略里要有 GetObject）` };
        if ((await get.text()) !== body) return { ok: false, why: "读回来的内容不对" };
        const head = await step("问大小", () => fetch(remote.url("HEAD", key, 300), { method: "HEAD", signal: AbortSignal.timeout(20000) }));
        return { ok: true, head: head.ok, kind: store.kind, why: head.ok ? "" : "问不到文件大小（策略里加上 HeadObject，不然每天的流量统计不准）" };
      } catch (e) { return { ok: false, why: e.message }; }
    },
    "GET /api/admin/dl": (req, b, dev, u) => ({ ...gate.stats(+u.searchParams.get("days") || 7), relay: relay.status(), store: { kind: store.kind, ...(store.usage ? store.usage() : {}) } }),
    "POST /api/admin/dl/relay": (req, b, dev, u) => (u.searchParams.get("wait") === "0" ? relay.kick() : relay.run()),
    "POST /api/admin/geturl": (req, b) => { if (!Store.okKey(b.key)) throw new Error("文件名不对"); return { url: store.url("GET", b.key, 3600) }; },
  };

  async function handle(req, res) {
    const u = new URL(req.url, "http://x");
    if (!publicBase) publicBase = `http://${req.headers.host}`;
    try {
      if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, PUT" }); return res.end(); }
      if (u.pathname.startsWith("/blob/")) return blob(req, res, u);
      // 捞小智电脑版读的公开发布清单（走 dl 域名的 HTTPS；只给公开发布的模型，不带存储路径和备注）
      if (u.pathname === "/dl/models/manifest.json") return json(res, 200, dlManifest(req));
      const dm = /^\/dl\/models\/([\w.-]{1,60})\/(\d{1,9})\/(\d{1,3})(\.[\w]{1,10})?$/.exec(u.pathname);
      if (dm) {
        const m = cycle.manifest().models[dm[1]];
        const f = m && String(m.version) === dm[2] ? m.files[+dm[3]] : null;
        if (!f || !cycle.publicKeys().has(f.key)) return json(res, 404, { error: "没有这个文件" });
        if (store.kind === "local" || (store.kind === "hybrid" && local.exists(f.key))) return blob(Object.assign(req, { method: req.method === "HEAD" ? "HEAD" : "GET" }), res, new URL(store.url("GET", f.key, 600)));
        res.writeHead(302, { location: store.url("GET", f.key, 6 * 3600) }); return res.end();
      }
      if (u.pathname.startsWith("/dl/") && OPEN) return json(res, 404, { error: "没有这个文件" });
      if (u.pathname.startsWith("/dl/")) { let key; try { key = decodeURIComponent(u.pathname.slice(4)); } catch (e) { key = ""; } return await gate.handle(req, res, key, Gate.clientIp(req)); }
      if (req.method === "PUT" && u.pathname === "/api/admin/upload") return upload(req, res, u);
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
        if (store.kind === "local" || (store.kind === "hybrid" && local.exists(key))) { u.searchParams.set("exp", String(Math.floor(Date.now() / 1000) + 600)); return blob(Object.assign(req, { method: req.method === "HEAD" ? "HEAD" : "GET" }), res, new URL(store.url("GET", key, 600))); }
        res.writeHead(302, { location: store.url("GET", key, 6 * 3600) }); return res.end();
      }
      if (u.pathname === "/" || u.pathname === "/admin") { res.writeHead(302, { location: "/admin/" }); return res.end(); }
      if (u.pathname === "/admin/assist.html") return staticFile(res, path.join(__dirname, "..", "shared"), "assist-viewer.html");
      if (u.pathname.startsWith("/admin/")) return staticFile(res, ADMIN_DIR, u.pathname.slice(7) || "index.html");
      // 下载要用的文件的后备路：电脑直连存储下不动（域名查不到、被加速器 / 安全软件拦了）→ 经调度中心转一道。只给它自己正在算的那个任务要用的文件
      if (req.method === "GET" && u.pathname === "/api/input") {
        const d = core.auth(tokenOf(req));
        if (!d) return json(res, 401, { error: "要先加入" });
        const key = core.inputKey(d, u.searchParams.get("task"), u.searchParams.get("k"));
        if (!key) return json(res, 404, { error: "不是你正在算的任务要用的文件" });
        const src = new URL(store.url("GET", key, 600));
        if (store.kind === "local" || (store.kind === "hybrid" && local.exists(key))) return blob(Object.assign(req, { method: "GET" }), res, src);
        let r;
        try { r = await fetch(src.href, { signal: AbortSignal.timeout(120000) }); } catch (e) { return json(res, 502, { error: "调度中心也连不上存储：" + e.message }); }
        if (!r.ok) return json(res, r.status === 404 ? 404 : 502, { error: "存储报错 " + r.status });
        res.writeHead(200, { "content-type": "application/octet-stream", ...(r.headers.get("content-length") ? { "content-length": r.headers.get("content-length") } : {}) });
        for await (const ch of r.body) res.write(ch);
        return res.end();
      }
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
      if (res.headersSent) { try { res.destroy(); } catch (e2) {} return; }   // 已经开始回了（比如文件发到一半出错）：断开就行，不能让整个调度中心崩掉
      json(res, 400, { error: e.message || String(e) });
    }
  }

  // 控制中心网页上传讲课视频 / 录音：PUT /api/admin/upload?member=名字&name=文件名（body 就是文件）→ 存好、登记成这位老师的录音
  async function upload(req, res, u) {
    try {
      if (!core.isAdmin(tokenOf(req))) { const d = core.auth(tokenOf(req)); if (!d || d.role !== "admin") { req.resume(); return json(res, 401, { error: "要管理员口令" }); } }
      const member = String(u.searchParams.get("member") || "");
      const orig = String(u.searchParams.get("name") || "").slice(0, 120);
      const name = orig.replace(/[^\w.\-]/g, "_").slice(-100);
      if (!/\.(wav|m4a|mp3|aac|flac|ogg|opus|webm|mp4|mov|mkv|avi|flv|amr)$/i.test(name)) { req.resume(); return json(res, 400, { error: "只能传音频或视频文件" }); }
      if (!core.db.prepare("select 1 from members where name=?").get(member)) { req.resume(); return json(res, 400, { error: "先登记这位老师" }); }
      const len = +req.headers["content-length"] || 0;
      if (!len) { req.resume(); return json(res, 400, { error: "文件是空的" }); }
      const key = `imports/${Date.now()}-${crypto.randomBytes(3).toString("hex")}-${name}`;
      if (store.kind !== "cos") {
        const f = local.file(key);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        await new Promise((ok, bad) => { const w = fs.createWriteStream(f); req.pipe(w); w.on("finish", ok); w.on("error", bad); req.on("error", bad); });
      } else {
        // 边收边转给 COS（预签名 PUT，要带 content-length）
        const dst = new URL(store.url("PUT", key, 6 * 3600));
        await new Promise((ok, bad) => {
          const out = (dst.protocol === "https:" ? require("https") : require("http")).request(dst, { method: "PUT", headers: { "content-length": String(len) } }, (r) => {
            let t = ""; r.on("data", (c) => { if (t.length < 400) t += c; }); r.on("end", () => (r.statusCode < 300 ? ok() : bad(new Error("存到 COS 失败：" + r.statusCode + " " + t.slice(0, 200)))));
          });
          out.on("error", bad); req.on("error", (e) => { out.destroy(e); bad(e); });
          req.pipe(out);
        });
      }
      core.importVoice({ member, key, name: orig || name, size: len });
      json(res, 200, { ok: true, key, size: len });
    } catch (e) { json(res, 400, { error: e.message || String(e) }); }
  }

  // 本机存储的上传 / 下载（带签名的临时链接）
  function blob(req, res, u) {
    const key = decodeURIComponent(u.pathname.slice(6));
    const method = req.method === "HEAD" ? "GET" : req.method;
    if (store.kind === "cos" || !local.check(method, key, u.searchParams.get("exp"), u.searchParams.get("sig"))) return json(res, 403, { error: "链接过期或不对" });
    const f = local.file(key);
    if (req.method === "PUT") {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const tmp = f + ".part-" + crypto.randomBytes(4).toString("hex");
      const w = fs.createWriteStream(tmp);
      let n = 0, bad = false;
      req.on("data", (c) => { n += c.length; if (n > maxBlob && !bad) { bad = true; req.destroy(); w.destroy(); fs.rm(tmp, () => {}); } });
      req.pipe(w);
      // 换成正式名字。Windows 上目标文件正被别人读着（或者同一个文件同时传了两遍）时改名会被拒绝（EPERM / EBUSY）：
      // 等一下再试；实在不行，目标已经在而且一样大就算传好了。绝不能让一次改名失败把整个调度中心弄崩
      w.on("finish", () => {
        if (bad) return;
        let tries = 0;
        const put = () => fs.rename(tmp, f, (e) => {
          if (!e) return json(res, 200, { ok: true, size: n });
          if (["EPERM", "EBUSY", "EACCES"].includes(e.code) && ++tries < 20) return setTimeout(put, 100);
          fs.stat(f, (e2, st) => { fs.rm(tmp, () => {}); if (!e2 && st.size === n) json(res, 200, { ok: true, size: n }); else json(res, 500, { error: "存文件失败：" + e.message }); });
        });
        put();
      });
      w.on("error", (e) => json(res, 500, { error: e.message }));
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      let st; try { st = fs.statSync(f); } catch (e) { return json(res, 404, { error: "没有这个文件" }); }
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
      const type = /\.(png)$/i.test(f) ? "image/png" : /\.jpe?g$/i.test(f) ? "image/jpeg" : /\.webm$/i.test(f) ? "audio/webm" : /\.wav$/i.test(f) ? "audio/wav" : /\.json$/i.test(f) ? "application/json" : /\.py$/.test(f) ? "text/plain; charset=utf-8" : "application/octet-stream";
      if (range) {
        // 要的范围超过文件大小：按文件实际大小给（新版客户端第一下要「前 8M」，小文件也这么要）；起点都超了回 416
        const a = +range[1], z = Math.min(range[2] ? +range[2] : st.size - 1, st.size - 1);
        if (a > z) { res.writeHead(416, { "content-range": `bytes */${st.size}` }); return res.end(); }
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
    canary,
    assist,
    close() { assist.close(); clearInterval(tickTimer); clearInterval(canaryTimer); gate.close(); relay.close(); if (store.close) store.close(); server.close(); core.close(); },
    gate, relay,
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

module.exports = { create, verify, inviteLink, signSrc, SIGN_PLANS };

if (require.main === module) {
  const app = create({ data: arg("data", "data"), public: arg("public", "") });
  const port = +arg("port", 8787);
  app.listen(port, arg("host", "0.0.0.0")).then((p) => {
    const t = app.core.adminToken();
    fs.writeFileSync(path.join(path.resolve(arg("data", "data")), "admin.txt"), `管理员口令（控制中心登录用，不要发给别人）：\n${t}\n`);
    console.log(`捞捞算力 · 调度中心已启动：端口 ${p}，存储：${app.store.kind === "cos" ? "腾讯云 COS" : app.store.kind === "hybrid" ? `新文件放腾讯云 COS、旧文件在本机磁盘（COS 每天下载上限 ${app.store.usage().dailyGB}G）` : "本机磁盘"}`);
    console.log(`控制中心：http://<这台服务器的地址>:${p}/admin/`);
    console.log(`管理员口令在 ${path.join(path.resolve(arg("data", "data")), "admin.txt")}`);
  });
}
