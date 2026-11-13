#!/usr/bin/env node
// 捞捞算力 · 管理员命令行（在你自己的电脑上用；私钥只存在你电脑上）
//   node tools/grid.js login <调度中心地址> <管理员口令>     第一次：记住地址和口令，生成签名用的密钥，把公钥告诉调度中心
//   node tools/grid.js publish <配方.py> [名字]             签名并上传一个配方，打印配方编号
//   node tools/grid.js job <计划.json>                      按计划建任务（见 plans/demo.json）
//   node tools/grid.js invite [备注] [--admin] [--uses 5]   发邀请链接
//   node tools/grid.js plan <计划.json>                       按计划建任务（只运行一次，运行两次会建两份）
//   node tools/grid.js voice 老师名字                         训练这位老师的声音（用她录的和导入的录音）
//   node tools/grid.js voice-import 老师名字 录音文件...      导入手机录音机录的原文件
//   node tools/grid.js laolao-voice [SSB0xxx] [--shift 2] [--male]   训捞捞智能体的专属声音（公开录音 AISHELL-3 + 变声；先 cycle plans/laolao-voice.json）
//   node tools/grid.js ab                                    新 Q版插件在审核里和现在的比，胜率多少
//   node tools/grid.js promote                               新插件转正（qversion-lora-test → qversion-lora，老师端换上）
//   node tools/grid.js cycle <自动训练.json> [--now]          设自动训练 / 每日一轮（签名上传用到的配方）；--now 马上跑一轮（训练一次）
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const HOME = process.env.LG_ADMIN_HOME || path.join(os.homedir(), ".laolao-grid");
const CFG = path.join(HOME, "admin.json");
const load = () => { try { return JSON.parse(fs.readFileSync(CFG, "utf8")); } catch (e) { return {}; } };
const save = (c) => { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(CFG, JSON.stringify(c, null, 1), { mode: 0o600 }); };

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64url");
  return { pub, priv: privateKey.export({ format: "pem", type: "pkcs8" }) };
}
const sign = (priv, msg) => crypto.sign(null, Buffer.from(msg, "utf8"), crypto.createPrivateKey(priv)).toString("base64url");

async function api(c, p, body) {
  const r = await fetch(c.server + p, { method: body ? "POST" : "GET", headers: { authorization: "Bearer " + c.token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "出错 " + r.status);
  return j;
}

async function login(server, token) {
  const c = { ...load(), server: server.replace(/\/+$/, ""), token };
  if (!c.priv) Object.assign(c, keypair());
  save(c);
  try { await api(c, "/api/admin/pubkey", { pubkey: c.pub }); console.log("已经把签名公钥告诉调度中心"); }
  catch (e) { if (/设过/.test(e.message)) console.log("调度中心已经有公钥了（要换就加 --force）"); else throw e; }
  return c;
}
async function publish(c, file, name, meta = {}) {
  const src = fs.readFileSync(file, "utf8");
  const id = crypto.createHash("sha256").update(Buffer.from(src, "utf8")).digest("hex");
  const r = await api(c, "/api/admin/recipe", { source: src, sig: sign(c.priv, id), name: name || path.basename(file, ".py"), meta: { file: path.basename(file), ...meta } });
  return r.id;
}
// 计划文件：{ "jobs": [ { "name", "stage", "kind", "recipe": "recipes/xx.py", "params", "req", "priority" } ] }
async function plan(c, file) {
  const p = JSON.parse(fs.readFileSync(file, "utf8"));
  const out = [];
  for (const j of p.jobs) {
    const recipe = j.kind === "record" ? null : await publish(c, path.resolve(path.dirname(file), j.recipe), j.recipeName || j.name);
    const r = await api(c, "/api/admin/job", { ...j, recipe });
    out.push(r.id);
    console.log(`建好任务 #${r.id}「${j.name}」`);
  }
  return out;
}

// 每日一轮：{ name, at, stages: [{ key, kind, recipe: 名字, recipeFile: 配方.py, params, after }], publish }
async function cycle(c, file) {
  const p = JSON.parse(fs.readFileSync(file, "utf8"));
  const done = new Set();
  for (const s of p.stages) {
    if (s.recipeFile && !done.has(s.recipe)) { await publish(c, path.resolve(path.dirname(file), s.recipeFile), s.recipe); done.add(s.recipe); }
  }
  const spec = { ...p, stages: p.stages.map(({ recipeFile, ...s }) => s) };
  const r = await api(c, "/api/admin/pipeline", spec);
  console.log(p.mode === "continuous" ? `「${p.name}」设好了（#${r.id}）：不定时间，大家开着就算${p.stages.some((x) => x.when && !x.when.manual) ? "；攒够了自动训练（控制中心能看进度、能「现在训练一次」）" : p.stages.some((x) => x.when) ? "；在控制中心点「现在训练一次」才训练" : ""}` : `每日一轮「${p.name}」设好了（#${r.id}）：每天 ${p.at || "18:30"} 自动开始`);
  return r.id;
}

module.exports = { keypair, sign, publish, plan, login, api, cycle };

if (require.main === module) {
  const [cmd, ...a] = process.argv.slice(2);
  const c = load();
  const need = () => { if (!c.server || !c.token) { console.error("先 login：node tools/grid.js login <调度中心地址> <管理员口令>"); process.exit(1); } };
  (async () => {
    if (cmd === "login") await login(a[0], a[1]);
    else if (cmd === "publish") { need(); console.log(await publish(c, a[0], a[1])); }
    else if (cmd === "job" || cmd === "plan") { need(); await plan(c, a[0]); }
    // 新 Q版插件在审核里比得怎么样；比得好就转正（老师端换上）
    else if (cmd === "ab") { need(); const s = await api(c, "/api/admin/ab", { tag: a[0] || "qv1" }); console.log(`新插件 vs 现在的：比过 ${s.total} 组，新的赢 ${s.test}、现在的赢 ${s.cur}、差不多 ${s.same}、都不行 ${s.bad}${s.winRate == null ? "" : `；新的胜率 ${Math.round(s.winRate * 100)}%`}`); }
    // 训练某位老师的声音（先把「声音训练」流水线设好：cycle plans/voice-train.json）
    else if (cmd === "voice") { need(); if (!a[0]) throw new Error("用法：node tools/grid.js voice 老师名字"); const r = await api(c, "/api/admin/pipeline/run", { name: "声音训练", extra: { member: a[0], voiceOf: a[0] } }); console.log(`开始训练「${a[0]}」的声音（第 ${r.run} 轮）：等有空的电脑来领，控制中心能看进度`); }
    // 捞捞智能体的专属声音：网上公开的高质量录音（AISHELL-3，Apache-2.0）+ 升几个半音（音色一起变），不是哪位真人老师的声音；公开发布，老师端自动下载
    else if (cmd === "voice-open" || cmd === "laolao-voice") {
      need();
      const spk = a.find((x) => /^SSB\d+$/i.test(x));
      const sh = a.indexOf("--shift");
      const extra = { member: "捞捞", ...(spk ? { speaker: spk.toUpperCase() } : {}), ...(a.includes("--male") ? { gender: "male" } : {}), ...(sh >= 0 ? { shift: +a[sh + 1] || 0 } : {}) };
      const r = await api(c, "/api/admin/pipeline/run", { name: "捞捞声音", extra });
      console.log(`开始训练捞捞的专属声音（第 ${r.run} 轮${spk ? "，用 " + spk.toUpperCase() : ""}${sh >= 0 ? "，升 " + (+a[sh + 1] || 0) + " 个半音" : ""}）：领到的电脑先下约 20 分钟的录音棚录音，再训练；控制中心能听 3 句试听。训好自动发给老师端（「AI 改 PPT」里勾「捞捞说话」）`);
    }
    // 导入老师用手机录音机录的原文件（不是微信 / QQ 语音）：node tools/grid.js voice-import 老师名字 文件1 [文件2 ...]
    else if (cmd === "voice-import") {
      need();
      const [who, ...fs_] = a;
      if (!who || !fs_.length) throw new Error("用法：node tools/grid.js voice-import 老师名字 录音文件 [更多文件]");
      for (const f of fs_) {
        const name = path.basename(f);
        const st = await api(c, "/api/admin/import/start", { name: name.replace(/[^\w.\-]/g, "_") || "audio.m4a" });
        const r = await fetch(st.url, { method: "PUT", body: fs.readFileSync(f) });
        if (!r.ok) throw new Error("上传失败：" + r.status);
        await api(c, "/api/admin/import/done", { member: who, key: st.key, name, size: fs.statSync(f).size });
        console.log(`导入了「${name}」（${(fs.statSync(f).size / 1e6).toFixed(1)}M）→ ${who}`);
      }
    }
    // 某位老师的声音码（发给这位老师，在捞捞PPT助手「我的声音」里填上）；--new 换一个（旧的作废）
    else if (cmd === "voice-code") { need(); const r = await api(c, "/api/admin/model/code", { name: "voice-" + a[0], rotate: a.includes("--new") }); console.log(`「${a[0]}」的声音码：${r.code}\n只发给${a[0]}本人；在捞捞PPT助手「我的声音」里填上，就能用捞捞训练的声音。泄露了用 --new 换一个。`); }
    else if (cmd === "promote") { need(); const r = await api(c, "/api/admin/model/promote", { from: a[0] || "qversion-lora-test", to: a[1] || "qversion-lora" }); console.log(`转正了：「${a[1] || "qversion-lora"}」第 ${r.version} 版，老师端会自动换上`); }
    else if (cmd === "cycle") { need(); const id = await cycle(c, a[0]); if (a.includes("--now")) { const r = await api(c, "/api/admin/pipeline/run", { id }); console.log(`现在就跑第 ${r.run} 轮`); } }
    else if (cmd === "invite") {
      need();
      const uses = a.includes("--uses") ? +a[a.indexOf("--uses") + 1] : 1;
      const r = await api(c, "/api/admin/invite", { note: a.find((x) => !x.startsWith("--") && !/^\d+$/.test(x)) || "", role: a.includes("--admin") ? "admin" : "member", maxUses: uses, server: c.server });
      console.log(`邀请码 ${r.code}（${new Date(r.expires).toLocaleString()} 前有效）\n把下面这一串发给他，在「捞捞算力」里粘贴：\n${r.link}`);
    } else console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 8).join("\n").replace(/^\/\/ ?/gm, ""));
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
