#!/usr/bin/env node
// 捞捞算力 · 管理员命令行（在你自己的电脑上用；私钥只存在你电脑上）
//   node tools/grid.js login <调度中心地址> <管理员口令>     第一次：记住地址和口令，生成签名用的密钥，把公钥告诉调度中心
//   node tools/grid.js publish <配方.py> [名字]             签名并上传一个配方，打印配方编号
//   node tools/grid.js job <计划.json>                      按计划建任务（见 plans/demo.json）
//   node tools/grid.js invite [备注] [--admin] [--uses 5]   发邀请链接
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

module.exports = { keypair, sign, publish, plan, login, api };

if (require.main === module) {
  const [cmd, ...a] = process.argv.slice(2);
  const c = load();
  const need = () => { if (!c.server || !c.token) { console.error("先 login：node tools/grid.js login <调度中心地址> <管理员口令>"); process.exit(1); } };
  (async () => {
    if (cmd === "login") await login(a[0], a[1]);
    else if (cmd === "publish") { need(); console.log(await publish(c, a[0], a[1])); }
    else if (cmd === "job") { need(); await plan(c, a[0]); }
    else if (cmd === "invite") {
      need();
      const uses = a.includes("--uses") ? +a[a.indexOf("--uses") + 1] : 1;
      const r = await api(c, "/api/admin/invite", { note: a.find((x) => !x.startsWith("--") && !/^\d+$/.test(x)) || "", role: a.includes("--admin") ? "admin" : "member", maxUses: uses, server: c.server });
      console.log(`邀请码 ${r.code}（${new Date(r.expires).toLocaleString()} 前有效）\n把下面这一串发给他，在「捞捞算力」里粘贴：\n${r.link}`);
    } else console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 7).join("\n").replace(/^\/\/ ?/gm, ""));
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
