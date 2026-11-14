// 捞捞算力 · 日志：每天一个文件（logs/2026-11-14.log），留 14 天；能按天看、搜、导出，控制中心能远程取
//   每行：时间 级别 [来源] 内容
"use strict";
const fs = require("fs");
const path = require("path");

const pad = (n) => String(n).padStart(2, "0");
const dayOf = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const timeOf = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

function create(o) {
  const dir = () => path.join(o.dir(), "logs");
  const keepDays = o.keepDays || 14;
  let buf = [], timer = null, lastClean = 0;
  const recent = [];   // 最近 2000 行放内存里，界面直接看

  function flush() {
    if (!buf.length) return;
    const lines = buf; buf = [];
    try {
      fs.mkdirSync(dir(), { recursive: true });
      const byDay = {};
      for (const l of lines) (byDay[dayOf(l.t)] = byDay[dayOf(l.t)] || []).push(l);
      for (const [d, ls] of Object.entries(byDay)) fs.appendFileSync(path.join(dir(), d + ".log"), ls.map(fmt).join("\n") + "\n");
    } catch (e) {}
    if (Date.now() - lastClean > 3600e3) { lastClean = Date.now(); clean(); }
  }
  const fmt = (l) => `${timeOf(l.t)} ${l.level === "error" ? "错误" : l.level === "warn" ? "注意" : "    "} [${l.src || "软件"}] ${String(l.msg).replace(/\r?\n/g, "\n          ")}`;
  function add(msg, level = "info", src = "") {
    const l = { t: Date.now(), msg: String(msg).slice(0, 4000), level, src };
    recent.push(l); if (recent.length > 2000) recent.shift();
    buf.push(l);
    if (!timer) timer = setTimeout(() => { timer = null; flush(); }, o.flushMs != null ? o.flushMs : 1000);
    if (o.onLine) try { o.onLine(l); } catch (e) {}
    return l;
  }
  function clean() {
    try {
      const keep = new Set(Array.from({ length: keepDays }, (_, i) => dayOf(Date.now() - i * 86400e3)));
      for (const f of fs.readdirSync(dir())) if (/^\d{4}-\d\d-\d\d\.log$/.test(f) && !keep.has(f.slice(0, 10))) fs.rmSync(path.join(dir(), f), { force: true });
    } catch (e) {}
  }
  function days() {
    try { return fs.readdirSync(dir()).filter((f) => /^\d{4}-\d\d-\d\d\.log$/.test(f)).map((f) => ({ day: f.slice(0, 10), size: fs.statSync(path.join(dir(), f)).size })).sort((a, b) => (a.day < b.day ? 1 : -1)); } catch (e) { return []; }
  }
  // 读某一天（默认今天）：q 搜关键字，level 只看错误 / 注意，最多 limit 行（从后往前）
  function read({ day, q = "", level = "", limit = 1000 } = {}) {
    flush();
    const d = /^\d{4}-\d\d-\d\d$/.test(day || "") ? day : dayOf();
    let lines = [];
    try { lines = fs.readFileSync(path.join(dir(), d + ".log"), "utf8").split("\n").filter(Boolean); } catch (e) {}
    if (level === "error") lines = lines.filter((l) => / 错误 /.test(l));
    if (level === "warn") lines = lines.filter((l) => / (错误|注意) /.test(l));
    if (q) { const k = String(q).toLowerCase(); lines = lines.filter((l) => l.toLowerCase().includes(k)); }
    return { day: d, total: lines.length, lines: lines.slice(-limit) };
  }
  // 导出：最近几天拼成一个文件（发给维护的人 / 控制中心远程取）
  function bundle(nDays = 3, extra = "") {
    flush();
    const out = [extra].filter(Boolean);
    for (const d of days().slice(0, nDays).reverse()) {
      try { out.push(`===== ${d.day} =====`, fs.readFileSync(path.join(dir(), d.day + ".log"), "utf8")); } catch (e) {}
    }
    const f = path.join(dir(), `捞捞算力日志-${dayOf()}-${Date.now() % 100000}.txt`);
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(f, out.join("\n"));
    return f;
  }
  return { add, flush, read, days, bundle, recent: (n = 300) => recent.slice(-n), dir, clean };
}

module.exports = { create, dayOf };
