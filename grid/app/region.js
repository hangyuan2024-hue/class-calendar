// 捞捞算力 · 在国内还是国外：决定组件先从哪下（国内 → 你的腾讯云 COS；国外 → 你的 GitHub）
//   自动判断：同时连一下国内存储和 GitHub（各 5 秒），看谁通、谁快；都通而且差不多快，看电脑的时区（中国时区算国内）
//   结果记一天；设置里可以手动定死「国内」「国外」
"use strict";
const PROBES = {
  cn: ["https://laolao-1518432293.cos.ap-guangzhou.myqcloud.com/download/grid-version.json", "https://www.laolaokechengbiao.cn/download/grid-version.json"],
  global: ["https://api.github.com/repos/hangyuan2024-hue/class-calendar", "https://github.com/hangyuan2024-hue/class-calendar"],
};

function create(o = {}) {
  const doFetch = o.fetch || fetch;
  const probes = o.probes || PROBES;
  const log = o.log || (() => {});
  let busy = null;
  async function timeOf(urls) {
    for (const u of urls) {
      const t = Date.now();
      try { const r = await doFetch(u + (u.includes("?") ? "&" : "?") + "t=" + t, { method: "GET", signal: AbortSignal.timeout(o.timeoutMs || 5000), redirect: "follow" }); if (r.status < 500) { try { await r.arrayBuffer(); } catch (e) {} return Date.now() - t; } } catch (e) {}
    }
    return null;
  }
  const tzCn = () => { try { return /^Asia\/(Shanghai|Chongqing|Harbin|Urumqi|Chungking|Hong_Kong|Macau|Taipei)$/.test(Intl.DateTimeFormat().resolvedOptions().timeZone) || new Date().getTimezoneOffset() === -480; } catch (e) { return false; } };
  async function detect(force) {
    const pref = o.pref ? o.pref() : "auto";
    if (pref === "cn" || pref === "global") return pref;
    const saved = o.get ? o.get() : null;
    if (!force && saved && saved.at && Date.now() - saved.at < 86400e3 && saved.region) return saved.region;
    if (busy) return busy;
    busy = (async () => {
      const [cn, gl] = await Promise.all([timeOf(probes.cn), timeOf(probes.global)]);
      let r;
      if (gl == null && cn != null) r = "cn";
      else if (cn == null && gl != null) r = "global";
      else if (cn == null && gl == null) r = tzCn() ? "cn" : "global";
      else if (gl > cn * 2.5) r = "cn";
      else if (cn > gl * 2.5) r = "global";
      else r = tzCn() ? "cn" : "global";
      o.set && o.set({ region: r, at: Date.now(), cnMs: cn, ghMs: gl });
      log(`判断下载源：国内存储 ${cn == null ? "连不上" : cn + "ms"}，GitHub ${gl == null ? "连不上" : gl + "ms"} → ${r === "cn" ? "国内（从 COS 下）" : "国外（从 GitHub 下）"}`);
      return r;
    })().finally(() => { busy = null; });
    return busy;
  }
  // 现在用哪个（没测过就按时区猜；软件启动半分钟后会测一次）
  function current() {
    const pref = o.pref ? o.pref() : "auto";
    if (pref === "cn" || pref === "global") return pref;
    const saved = o.get ? o.get() : null;
    if (saved && saved.region) return saved.region;
    return tzCn() ? "cn" : "global";
  }
  // 一个组件的几个地址按地区排好：cn 优先国内存储，global 优先 GitHub
  function order(src) {
    const r = current();
    const cos = [].concat(src.cos || []), gh = [].concat(src.gh || []), up = [].concat(src.upstream || []);
    return (r === "cn" ? [...cos, ...gh, ...up] : [...gh, ...up, ...cos]).filter(Boolean);
  }
  return { detect, current, order, info: () => ({ pref: o.pref ? o.pref() : "auto", ...(o.get ? o.get() || {} : {}), current: current() }) };
}

module.exports = { create, PROBES };
