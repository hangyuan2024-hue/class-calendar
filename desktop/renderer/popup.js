// 3.3.3（网站 5.9.2）重要事项弹窗：老师、班委发布 / 修改班级事项时勾「📣 弹窗提醒全班」，
//   同学打开电脑版时弹出来，点「我知道了」以后不再弹（换设备也不弹）。接口在 5.9.2 的 SQL
"use strict";
const Pop59 = {
  items: new Set(), later: new Set(), at: 0, cid: "", busy: false,
  has(id) { return this.items.has(+id); },
  async refresh(cid) {
    const r = await api("popup_state", { p_cid: cid }, true);
    this.items = new Set(((r && r.items) || []).map(Number)); this.cid = cid; this.at = Date.now();
    return new Set(((r && r.acked) || []).map(Number));
  },
  async set(cid, id, on) { await api("popup_set", { p_cid: cid, p_item: +id, p_on: !!on }); on ? this.items.add(+id) : this.items.delete(+id); },
  async check(force) {
    const S = App.S;
    if (this.busy || !S || !S.loggedIn || !S.cid || overlayOpen() || (!force && Date.now() - this.at < 60000 && this.cid === S.cid)) return;
    this.busy = true;
    try {
      let acked; try { acked = await this.refresh(S.cid); } catch (e) { return; }      // 数据库还没升级：不弹
      const old = shiftDay(todayKey(), -1);
      const list = (S.items || []).filter((r) => this.items.has(+r.id) && !acked.has(+r.id) && !this.later.has(+r.id) && !(r.event_time && String(r.event_time).slice(0, 10) < old));
      for (let i = 0; i < list.length; i++) await this.show(list[i], i, list.length);
    } finally { this.busy = false; }
  },
  show(r, i, n) {
    return new Promise((done) => {
      const et = String(r.event_time || ""), day = et.slice(0, 10), tm = et.slice(11, 16);
      const when = day ? (day === todayKey() ? "今天" : dateCN(day)) + (tm ? " " + tm : "") : "";
      const meta = [when && "🕘 " + when, r.location && "📍 " + r.location, r.prepare && "🎒 " + r.prepare].filter(Boolean).join("　");
      const d = h(`<div class="dialog" role="dialog" style="max-width:440px">
        <div class="dbody" style="padding-top:22px">
          <span style="display:inline-block;padding:3px 12px;border-radius:999px;background:color-mix(in srgb,var(--bad) 14%,transparent);color:var(--bad);font-weight:800;font-size:13px">📣 重要${esc(r.msg_type || "通知")}</span>
          <h3 style="margin:12px 0 6px;font-size:20px">${esc(r.subject || r.summary || "通知")}</h3>
          ${meta ? `<div class="muted" style="font-size:13px">${esc(meta)}</div>` : ""}
          ${r.summary && r.summary !== r.subject ? `<div style="white-space:pre-wrap;line-height:1.65;margin-top:10px;max-height:40vh;overflow:auto">${esc(r.summary)}</div>` : ""}
        </div>
        <div class="dfoot"><small class="muted">${esc(App.className ? App.className() : "")}${n > 1 ? ` · ${i + 1}/${n}` : ""}</small><span class="grow"></span><button type="button" class="btn" data-a="later">稍后再看</button><button type="button" class="btn primary" data-a="ok">我知道了</button></div></div>`);
      let fin = false;
      const close = (ok) => {
        if (fin) return; fin = true;
        if (ok) api("popup_ack", { p_item: +r.id }, true).catch(() => {}); else this.later.add(+r.id);
        closeOverlay(); setTimeout(done, 200);
      };
      d.onclick = (e) => { const a = e.target.closest("[data-a]"); if (a) close(a.dataset.a === "ok"); };
      openOverlay(d, () => close(false));
    });
  },
};
// 打开后、切回窗口、每 3 分钟看一眼
setTimeout(() => Pop59.check(true), 4000);
setInterval(() => Pop59.check(), 180000);
window.addEventListener("focus", () => setTimeout(() => Pop59.check(), 800));
