// 训练文件搬到单独的存储桶：把数据库里登记过、还在旧桶里的训练文件复制到新桶（只复制、不删旧桶里的任何东西）。
//   为什么搬：训练文件以前和安装包放在同一个桶（同一个 grid/ 文件夹），打包后清理旧安装包时被一起删光过（2026-11-18/19）。
//   在服务器上运行（要读环境文件里的 COS 配置）：
//     切换之前：sudo bash -c 'set -a; . /etc/laolao-grid.env; set +a; node /opt/laolao/grid/server/cos-move.js --to 新桶名'
//               （从现在配的旧桶复制到新桶；新桶要和旧桶同一个地域，子用户要能读旧桶、写新桶）
//     切换之后：sudo bash -c 'set -a; . /etc/laolao-grid.env; set +a; node /opt/laolao/grid/server/cos-move.js --from 旧桶名'
//               （把切换那一两分钟里落在旧桶的补过来）
//   加 --dry 只看要复制哪些、不动手。不打印任何密钥。
//   复制方式：先让腾讯云在桶之间直接复制（不经过这台服务器，快）；不行就由这台服务器下载再上传（慢，但一定行）。复制完核对大小。
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const Store = require("./store");

async function main(argv, env, opt = {}) {
  const say = opt.log || ((m) => console.log(m));
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const dry = argv.includes("--dry");
  const to = arg("--to"), from = arg("--from");
  if (!!to === !!from) throw new Error("要写 --to 新桶名（切换之前）或者 --from 旧桶名（切换之后），二选一");
  if (!env.GRID_COS_BUCKET) throw new Error("环境里没有 GRID_COS_BUCKET：用 sudo bash -c 'set -a; . /etc/laolao-grid.env; set +a; node …' 运行");
  const base = { endpoint: env.GRID_COS_ENDPOINT, region: env.GRID_COS_REGION, keyId: env.GRID_COS_KEY_ID, secret: env.GRID_COS_SECRET, prefix: env.GRID_COS_PREFIX, pathStyle: env.GRID_COS_PATHSTYLE === "1" };
  const src = Store.cos({ ...base, bucket: from || env.GRID_COS_BUCKET });
  const dst = Store.cos({ ...base, bucket: to || env.GRID_COS_BUCKET });
  if (src.bucket === dst.bucket) throw new Error("新桶和旧桶是同一个：" + src.bucket);
  const dataDir = opt.dataDir || env.GRID_DATA || "/var/lib/laolao-grid";
  const local = Store.local(path.join(dataDir, "blobs"), "x", () => "");
  const db = new DatabaseSync(path.join(dataDir, "grid.db"), { readOnly: true });
  const keys = [...new Set([
    ...db.prepare("select key from ckpts where kind not like 'lost-%' and key like 'jobs/%'").all().map((r) => r.key),
    ...db.prepare("select key from outputs where key like 'jobs/%'").all().map((r) => r.key),
    ...db.prepare("select key from device_logs where key like 'logs/%'").all().map((r) => r.key),
  ])].filter((k) => Store.okKey(k));
  db.close();
  say(`从 ${src.bucket} 复制到 ${dst.bucket}${dry ? "（只看不动手）" : ""}：数据库里登记过 ${keys.length} 个训练文件，先看哪些在旧桶里、新桶里还没有…`);
  const head = async (s, k) => { try { const r = await fetch(s.url("HEAD", k, 600), { method: "HEAD", signal: AbortSignal.timeout(20000) }); return r.ok ? { ok: true, size: +(r.headers.get("content-length") || 0), type: r.headers.get("content-type") || "" } : { status: r.status }; } catch (e) { return { status: 0 }; } };
  const todo = [], st = { local: 0, gone: 0, already: 0, unsure: 0 };
  let i = 0;
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (i < keys.length) {
      const k = keys[i++];
      if (local.exists(k)) { st.local++; continue; }
      const a = await head(src, k);
      if (!a.ok) { if (a.status === 404) st.gone++; else st.unsure++; continue; }
      const b = await head(dst, k);
      if (b.ok && b.size === a.size) { st.already++; continue; }
      todo.push({ k, size: a.size, type: a.type });
    }
  }));
  const mb = (n) => (n / 1048576).toFixed(1) + "M";
  say(`  在香港本机（不用搬）${st.local}，旧桶里已经没有 ${st.gone}，新桶里已经有了 ${st.already}，查不了 ${st.unsure}；要复制 ${todo.length} 个，共 ${mb(todo.reduce((s, x) => s + x.size, 0))}`);
  if (st.unsure) say(`  注意：有 ${st.unsure} 个查不了（多半是子用户的策略里还没给读旧桶 / 写新桶的权限，见 grid-store-policy.json）`);
  if (dry || !todo.length) return { ...st, todo: todo.length, copied: 0, failed: 0 };
  // 复制一个：先桶到桶（腾讯云里面直接复制），不行再经过这台服务器
  const srcPath = (k) => `${src.prefix}/${k}`.split("/").map((x) => encodeURIComponent(x)).join("/");
  async function copy(x) {
    for (const h of [{ "x-amz-copy-source": `/${src.bucket}/${srcPath(x.k)}` }, { "x-cos-copy-source": `${src.bucket}.cos.${base.region}.myqcloud.com/${srcPath(x.k)}` }]) {
      try {
        const r = await fetch(dst.url("PUT", x.k, 600, h), { method: "PUT", headers: h, signal: AbortSignal.timeout(120000) });
        const t = await r.text();
        if (r.ok && !/<Error>/.test(t)) { const b = await head(dst, x.k); if (b.ok && b.size === x.size) return "桶到桶"; }
      } catch (e) { /* 换下一种 */ }
    }
    const g = await fetch(src.url("GET", x.k, 6 * 3600), { signal: AbortSignal.timeout(6 * 3600e3) });
    if (!g.ok) throw new Error("从旧桶下载失败 " + g.status);
    const p = await fetch(dst.url("PUT", x.k, 6 * 3600), { method: "PUT", body: g.body, duplex: "half", headers: { "Content-Length": String(x.size), "Content-Type": x.type || "application/octet-stream" }, signal: AbortSignal.timeout(6 * 3600e3) });
    if (!p.ok) throw new Error("传到新桶失败 " + p.status + " " + (await p.text()).slice(0, 120));
    const b = await head(dst, x.k); if (!(b.ok && b.size === x.size)) throw new Error("传完核对大小不对");
    return "经过服务器";
  }
  let copied = 0, failed = 0, j = 0; const how = {};
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (j < todo.length) {
      const x = todo[j++];
      try { const w = await copy(x); how[w] = (how[w] || 0) + 1; copied++; if (copied % 20 === 0 || copied === todo.length) say(`  复制好 ${copied}/${todo.length}`); }
      catch (e) { failed++; say(`  ✗ ${x.k}：${e.message}`); }
    }
  }));
  say(`复制完了：成功 ${copied} 个（${Object.entries(how).map(([k, v]) => `${k} ${v}`).join("，")}），失败 ${failed} 个。旧桶里的东西一个没动。`);
  return { ...st, todo: todo.length, copied, failed, how };
}

if (require.main === module) main(process.argv.slice(2), process.env).then((r) => process.exit(r.failed ? 1 : 0), (e) => { console.error("出错：" + e.message); process.exit(1); });
module.exports = { main };
