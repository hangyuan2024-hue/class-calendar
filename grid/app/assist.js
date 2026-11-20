// 捞捞算力 · 远程协助（被协助的这一边）
//   收到请求（管理员通过调度中心发来，或者同局域网的同学直接发来）→ 弹窗问你：允许查看和操控 / 只允许查看 / 拒绝
//   → 同意了：屏幕最上面一直有红条「正在被 xx 远程协助」和「结束」按钮；每秒送几帧屏幕画面；
//     允许操控时，把对方的鼠标键盘在这台电脑上执行（只看模式这里也会再挡一次，不只靠中转）
//   → 你点「结束」、对方结束、网断了 30 秒、设置里关掉：马上停
//   一次只能有一个协助；设置里关了「允许远程协助」就直接拒绝，不弹窗。
"use strict";

function create(o = {}) {
  const log = o.log || (() => {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let cur = null;
  const seen = new Set();   // 同一个请求只处理一次（调度中心 2 分钟没收到回话会再发一遍）

  // req：{ transport(name, body) → Promise, s, token, mode, by, where }
  //   返回值在「回话」之后就给（远程命令要马上回，不然调度中心以为没收到会再发一次）；协助本身在后台接着跑
  async function handle(req) {
    const t = req.transport;
    if (seen.has(req.s)) return "这个请求已经处理过了";
    seen.add(req.s); if (seen.size > 200) seen.delete(seen.values().next().value);
    const no = async (why) => { try { await t("answer", { s: req.s, token: req.token, ok: false }); } catch (e) {} log(`远程协助请求（${req.by || "?"}）：${why}`); return why; };
    if (cur) return no("已经在被别人协助，先结束那个");
    if (o.allowed && !o.allowed()) return no("设置里关了「允许远程协助」，自动拒绝了");
    const want = req.mode === "view" ? "view" : "control";
    let pick = null;
    // 弹窗最多等 85 秒（中转那边 90 秒没回话就取消了）
    try { pick = await o.ask({ by: req.by || "管理员", mode: want, where: req.where || "", timeoutMs: o.askMs || 85000 }); } catch (e) { pick = null; }
    if (!pick) return no("你拒绝了");
    if (want === "view") pick = "view";   // 对方只请求看，就只给看
    let r;
    try { r = await t("answer", { s: req.s, token: req.token, ok: true, mode: pick }); } catch (e) { return `回话没送到：${e.message}`; }
    if (!r || r.state !== "live") return `这次请求已经结束了（${r && r.state}）`;
    const c = cur = { s: req.s, token: req.token, mode: r.mode === "view" ? "view" : "control", by: req.by || "管理员", t, stopped: false, started: Date.now() };
    log(`开始被「${c.by}」远程协助（${c.mode === "view" ? "只看" : "查看和操控"}）`);
    try { o.onLive && o.onLive({ by: c.by, mode: c.mode, where: req.where || "", end: () => stop(c, "你点了结束") }); } catch (e) {}
    frames(c).catch((e) => stop(c, "送画面出错：" + e.message));
    if (c.mode === "control") inputs(c).catch((e) => stop(c, "执行操作出错：" + e.message));
    return `同意了（${c.mode === "view" ? "只看" : "查看和操控"}）`;
  }

  // 网络抖一下不算：连续 30 秒都送不出去才结束
  async function call(c, name, body) {
    const t0 = Date.now();
    for (;;) {
      if (c.stopped) return { state: "stopped" };
      try { return await c.t(name, { s: c.s, token: c.token, ...body }); }
      catch (e) { if (Date.now() - t0 > (o.netMs || 30000)) throw new Error("网络断了"); await sleep(1000); }
    }
  }
  const gone = (st) => st === "ended" ? "对方结束了" : st === "gone" ? "会话没了" : st === "expired" ? "超时了" : "对方结束了";

  async function frames(c) {
    const fps = o.fps || 4;
    let idle = 0;
    while (!c.stopped) {
      const t0 = Date.now();
      let cap = null;
      try { cap = await o.capture(o.maxW || 1600); } catch (e) { log("截屏没成功：" + e.message); }
      if (c.stopped) break;
      if (cap && cap.jpeg) {
        const r = await call(c, "frame", { jpeg: Buffer.isBuffer(cap.jpeg) ? cap.jpeg.toString("base64") : String(cap.jpeg), w: cap.w, h: cap.h });
        if (c.stopped) break;
        if (r.state !== "live") return stop(c, gone(r.state));
        idle = r.viewer === false ? idle + 1 : 0;   // 对方没在看（窗口切走了）：少送一点
      }
      const per = 1000 / (idle > 3 ? 1 : fps);
      await sleep(Math.max(30, per - (Date.now() - t0)));
    }
  }

  async function inputs(c) {
    const inj = c.inj = o.injector ? o.injector() : null;
    while (!c.stopped) {
      const r = await call(c, "take", {});
      if (c.stopped) break;
      if (r.state !== "live") return stop(c, gone(r.state));
      if (c.mode !== "control" || !inj) continue;           // 只看：一律不执行
      if (r.ev && r.ev.length) { try { inj.send(r.ev); } catch (e) { log("执行操作没成功：" + e.message); } }
    }
  }

  function stop(c, why) {
    if (!c || c.stopped) return;
    c.stopped = true;
    if (cur === c) cur = null;
    try { c.inj && c.inj.close(); } catch (e) {}
    c.t("end", { s: c.s, token: c.token, why }).catch(() => {});
    const mins = Math.max(1, Math.round((Date.now() - c.started) / 60e3));
    log(`远程协助结束：${why}（${mins} 分钟）`);
    try { o.onEnd && o.onEnd({ why, by: c.by }); } catch (e) {}
  }

  return { handle, end: (why = "你点了结束") => stop(cur, why), current: () => (cur ? { by: cur.by, mode: cur.mode, started: cur.started } : null) };
}

module.exports = { create };
