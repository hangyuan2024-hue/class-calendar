// 只读检查：训练文件（存档、结果）为什么会「登记了但存储里找不到」。不改任何东西，不打印任何密钥。
//   在服务器上运行（要读环境文件里的 COS 配置，所以用 sudo）：
//   sudo bash -c 'set -a; . /etc/laolao-grid.env; set +a; node /opt/laolao/grid/server/diag-lost.js'
//   看什么：
//   1. 找不到的那些文件，同一个存储名字有没有被登记过不止一次 / 同一个任务有没有被几台电脑轮流算过
//      （名字固定 + 发上传地址就删旧的 → 第二次没传完，旧的就没了：这是代码里找到的漏洞，这里核对是不是它）
//   2. 找不到的文件，第一次是存在香港本机还是广州（香港本机的才会被那段代码删）
//   3. 每天有多少文件因为到了流量上限改存香港本机
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const fs = require("fs"), path = require("path");
const { DatabaseSync } = require("node:sqlite");
const Store = require("./store");
const env = process.env;
const dataDir = env.GRID_DATA || "/var/lib/laolao-grid";
const db = new DatabaseSync(path.join(dataDir, "grid.db"), { readOnly: true });
const all = (q, ...a) => db.prepare(q).all(...a), one = (q, ...a) => db.prepare(q).get(...a);
const local = Store.local(path.join(dataDir, "blobs"), "x", () => "");
const remote = env.GRID_COS_BUCKET ? Store.cos({ endpoint: env.GRID_COS_ENDPOINT, region: env.GRID_COS_REGION, bucket: env.GRID_COS_BUCKET, keyId: env.GRID_COS_KEY_ID, secret: env.GRID_COS_SECRET, prefix: env.GRID_COS_PREFIX, pathStyle: env.GRID_COS_PATHSTYLE === "1" }) : null;
const t8 = (ms) => (ms ? new Date(+ms + 8 * 3600e3).toISOString().replace("T", " ").slice(0, 16) : "?");
async function where(key) {
  let lo = false; try { lo = local.exists(key); } catch (e) {}
  if (lo) return "香港本机";
  if (!remote) return "找不到";
  try { const r = await fetch(remote.url("HEAD", key, 300), { method: "HEAD", signal: AbortSignal.timeout(15000) }); return r.status === 404 ? "找不到" : r.ok ? "广州" : `说不准(${r.status})`; } catch (e) { return "说不准(连不上)"; }
}
async function pmap(xs, n, fn) { const out = new Array(xs.length); let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) { const k = i++; out[k] = await fn(xs[k]); } })); return out; }
const ver = (() => { try { return require("child_process").execSync("git -C /opt/laolao log -1 --format=%h", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch (e) { return "?"; } })();

(async () => {
  console.log(`== 检查时间 ${t8(Date.now())}（北京时间），代码版本 ${ver}，存储：${remote ? "香港本机 + 广州 COS" : "只有香港本机"}`);

  // ---------- 1. 标成丢失的存档（新代码发现的）+ 已知丢的那个结果文件 ----------
  const lost = all("select * from ckpts where kind like 'lost-%' order by id");
  console.log(`\n== 已经发现找不到的存档：${lost.length} 个`);
  for (const c of lost) {
    const same = all("select id, step, kind, created, device_id from ckpts where key=? order by id", c.key);
    const t = one("select id, attempts, state from tasks where id=?", c.task_id) || {};
    const near = all("select step, created, device_id from ckpts where task_id=? and step between ? and ? order by id", c.task_id, (c.step || 0) - 60, (c.step || 0) + 60);
    console.log(`- 任务 #${c.task_id}（被领过 ${t.attempts} 次）第 ${c.step} 步：${c.key}\n    登记 ${same.length} 次：${same.map((x) => `${t8(x.created)} 电脑#${x.device_id}`).join("；")}\n    这个任务前后的存档：${near.map((x) => `第${x.step}步 ${t8(x.created).slice(5)} 电脑#${x.device_id}`).join("，")}`);
  }
  const known = all("select * from outputs where key like '%out-qa-math-12-176.jsonl' or name like '%qa-math-12-176%'");
  for (const o of known) console.log(`- 结果文件 ${o.key}（任务 #${o.task_id}）登记 ${t8(o.created)}，现在：${await where(o.key)}；同名登记 ${one("select count(*) n from outputs where key=?", o.key).n} 次`);

  // ---------- 2. 全部扫一遍：登记了的文件还在不在 ----------
  const cks = all("select key, min(created) created, count(*) n, count(distinct device_id) devs, max(task_id) task from ckpts where kind not like 'lost-%' group by key order by created desc limit 1500");
  const outs = all("select key, min(created) created, count(*) n, max(task_id) task from outputs where key like 'jobs/%' group by key order by created desc limit 4000");
  const rows = [...cks.map((r) => ({ ...r, what: "存档" })), ...outs.map((r) => ({ ...r, what: "结果" }))];
  process.stdout.write(`\n== 扫一遍最近登记的 ${rows.length} 个文件（存档 ${cks.length}、结果 ${outs.length}），看还在不在…`);
  const at = await pmap(rows, 12, (r) => where(r.key));
  rows.forEach((r, i) => (r.at = at[i]));
  const miss = rows.filter((r) => r.at === "找不到"), unsure = rows.filter((r) => /说不准/.test(r.at));
  console.log(`\n   在香港本机 ${rows.filter((r) => r.at === "香港本机").length}，在广州 ${rows.filter((r) => r.at === "广州").length}，找不到 ${miss.length}，说不准 ${unsure.length}`);
  // 同一个任务的结果文件里，名字被用过两次的（同一个任务算过不止一次）
  const multi = (r) => r.n > 1 || (r.task && (one("select attempts from tasks where id=?", r.task) || {}).attempts > 1);
  for (const r of miss.slice(0, 30)) {
    const t = one("select attempts, state from tasks where id=?", r.task) || {};
    console.log(`- 找不到：${r.what} ${r.key}\n    第一次登记 ${t8(r.created)}；同名登记 ${r.n} 次；这个任务被领过 ${t.attempts || "?"} 次（现在 ${t.state || "?"}）`);
  }
  if (miss.length) {
    const m2 = miss.filter(multi).length;
    console.log(`\n   找不到的 ${miss.length} 个里，${m2} 个是「同一个任务被领过不止一次 / 同名登记过不止一次」的（漏洞的样子）；${miss.length - m2} 个不是`);
    const ok2 = rows.filter((r) => r.at !== "找不到" && !/说不准/.test(r.at));
    console.log(`   对照：还在的 ${ok2.length} 个里，这个比例是 ${ok2.length ? Math.round((ok2.filter(multi).length / ok2.length) * 100) : 0}%`);
  }

  // ---------- 3. 每天的上传去向（到了流量上限改存香港本机的天） ----------
  const ud = path.join(dataDir, "cosuse");
  if (fs.existsSync(ud)) {
    console.log("\n== 最近每天上传去向（put = 传广州，putLocal = 到了上限改存香港本机）");
    for (const f of fs.readdirSync(ud).filter((x) => /^\d{4}-\d\d-\d\d\.json$/.test(x)).sort().slice(-10)) { try { const u = JSON.parse(fs.readFileSync(path.join(ud, f), "utf8")); console.log(`   ${f.slice(0, 10)}：传广州 ${u.put || 0}，改存香港 ${u.putLocal || 0}，下载 ${(u.bytes / 1073741824 || 0).toFixed(1)}G`); } catch (e) {} }
  }
  // 香港本机的训练文件（以前的、或者到了上限时存的）：同名再传就会被那段代码删
  let nLocal = 0; try { const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : nLocal++; }; walk(path.join(dataDir, "blobs", "jobs")); } catch (e) {}
  console.log(`\n== 香港本机现在存着 ${nLocal} 个训练文件`);
  console.log("\n（检查完了，没改任何东西）");
  db.close();
})().catch((e) => { console.error("检查出错：" + e.message); process.exit(1); });
