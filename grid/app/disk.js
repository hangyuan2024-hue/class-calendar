// 捞捞算力 · 硬盘和缓存：各部分占多少、清理用不到的、硬盘快满了提醒
"use strict";
const fs = require("fs");
const path = require("path");

async function sizeOf(p, limit = 200000) {
  let total = 0, n = 0;
  const walk = async (d) => {
    let ents;
    try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch (e) { try { total += (await fs.promises.stat(d)).size; } catch (e2) {} return; }
    for (const e of ents) {
      if (++n > limit) return;
      const f = path.join(d, e.name);
      if (e.isDirectory()) await walk(f);
      else if (e.isFile()) { try { total += (await fs.promises.stat(f)).size; } catch (e2) {} }
    }
  };
  await walk(p);
  return total;
}

async function free(p) {
  try { const s = await fs.promises.statfs(p); return s.bavail * s.bsize; } catch (e) { return null; }
}

// parts：[{ id, name, path, clean: "可以删" | "不能删" | "旧的可以删", note }]
function create(o) {
  const parts = () => o.parts().filter((x) => x.path);
  async function report() {
    const out = [];
    for (const p of parts()) out.push({ ...p, bytes: fs.existsSync(p.path) ? await sizeOf(p.path) : 0 });
    const f = await free(o.base());
    return { parts: out, free: f, base: o.base(), low: f != null && f < (o.lowGB || 20) * 1e9 };
  }
  // 清理一部分：tasks 只删算完的（正在算的留着）、超过 keepDays 天的；cache 整个删；logs 只留今天
  async function clean(id) {
    const p = parts().find((x) => x.id === id);
    if (!p || !p.cleanable) throw new Error("这一项不能删");
    const before = fs.existsSync(p.path) ? await sizeOf(p.path) : 0;
    if (p.cleanable === "old") await cleanOld(p.path, p.keepDays != null ? p.keepDays : 0, p.keep || (() => false));
    else { for (const e of fs.existsSync(p.path) ? fs.readdirSync(p.path) : []) { if (p.keep && p.keep(path.join(p.path, e))) continue; fs.rmSync(path.join(p.path, e), { recursive: true, force: true }); } }
    const after = fs.existsSync(p.path) ? await sizeOf(p.path) : 0;
    return { id, freed: Math.max(0, before - after) };
  }
  async function cleanOld(dir, keepDays, keep) {
    const cut = Date.now() - keepDays * 86400e3;
    for (const e of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      const f = path.join(dir, e);
      if (keep(f)) continue;
      let st; try { st = fs.statSync(f); } catch (e2) { continue; }
      if (st.mtimeMs < cut) fs.rmSync(f, { recursive: true, force: true });
    }
  }
  return { report, clean, cleanOld, free };
}

module.exports = { create, sizeOf, free };
