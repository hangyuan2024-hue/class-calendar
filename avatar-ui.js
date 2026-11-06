// 7.55 自己的头像（和小程序 1.23 一样，7.23 SQL：avatar_set / avatar_get）
//   「编辑资料」里换头像：选一张图片，裁成正方形、压成 200×200 的小图存到账号里，小程序、网页一起生效
//   左下角头像、「我的」卡片上显示自己的头像（没换过就还是名字的第一个字）
(function () {
  "use strict";
  const LS = "my_avatar_v1";
  const uid = () => (typeof currentUser !== "undefined" && currentUser ? currentUser.id : "");
  const cached = () => { try { const c = JSON.parse(localStorage.getItem(LS) || "null"); return c && c.uid === uid() ? c.img || "" : ""; } catch (e) { return ""; } };
  const keep = (img) => { try { localStorage.setItem(LS, JSON.stringify({ uid: uid(), img: img || "" })); } catch (e) {} };
  let img = "", loadedFor = "";

  function paint() {
    img = cached();
    document.querySelectorAll("#userChip .av, #meCard .av, .mavatar").forEach((a) => {
      if (img) { a.style.backgroundImage = `url("${img}")`; a.style.backgroundSize = "cover"; a.style.backgroundPosition = "center"; a.dataset.txt = a.dataset.txt || a.textContent; a.textContent = ""; }
      else if (a.style.backgroundImage) { a.style.backgroundImage = ""; if (a.dataset.txt) a.textContent = a.dataset.txt; }
    });
    const pv = document.getElementById("pfAvImg");
    if (pv) { pv.style.backgroundImage = img ? `url("${img}")` : ""; pv.textContent = img ? "" : "🙂"; const r = document.getElementById("pfAvReset"); if (r) r.hidden = !img; }
  }
  async function load() {
    const u = uid(); if (!u || typeof CCAuth === "undefined") return;
    if (loadedFor === u) { paint(); return; }
    loadedFor = u;
    try { const r = (await CCAuth.rpc("avatar_get", {})) || {}; keep((r[u] && r[u].img) || ""); } catch (e) { /* 服务器还没有 7.23：用本机的 */ }
    paint();
  }
  // 裁成正方形、200×200 的 JPEG，控制在 110KB 以内
  function squash(file) {
    return new Promise((ok, no) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        try {
          const s = Math.min(im.naturalWidth, im.naturalHeight), c = document.createElement("canvas"); c.width = c.height = 200;
          c.getContext("2d").drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, 0, 0, 200, 200);
          URL.revokeObjectURL(url);
          for (const q of [0.85, 0.65, 0.45]) { const d = c.toDataURL("image/jpeg", q); if (d.length <= 110000) return ok(d); }
          no(new Error("图片太大了，换一张小一点的"));
        } catch (e) { URL.revokeObjectURL(url); no(new Error("这张图片读不了，换一张试试")); }
      };
      im.onerror = () => { URL.revokeObjectURL(url); no(new Error("这张图片读不了，换一张试试")); };
      im.src = url;
    });
  }
  async function set(v) {
    try { await CCAuth.rpc("avatar_set", { img: v || "" }); }
    catch (e) { throw new Error(/avatar_set|PGRST202|Could not find/i.test(e.message || "") ? "头像功能要先在数据库执行 7.23 的 SQL" : e.message); }
    keep(v); paint();
  }
  // 「编辑资料」对话框最上面加一行：头像 + 换头像 + 恢复默认
  function mountProfile() {
    const f = document.getElementById("profForm"); if (!f || document.getElementById("pfAv")) return;
    const row = document.createElement("div"); row.id = "pfAv";
    row.style.cssText = "display:flex;align-items:center;gap:12px;margin:6px 0 10px";
    row.innerHTML = `<span id="pfAvImg" style="width:56px;height:56px;border-radius:50%;background:var(--hover,rgba(127,127,127,.15)) center/cover;display:grid;place-items:center;font-size:26px;flex-shrink:0"></span>
      <button type="button" class="small" id="pfAvPick">换头像</button><button type="button" class="small" id="pfAvReset" hidden>恢复默认</button><span class="meta" id="pfAvSt"></span>`;
    const h = f.querySelector("h3"); (h || f.firstChild).after(row);
    const st = (t) => { const e = document.getElementById("pfAvSt"); if (e) e.textContent = t || ""; };
    document.getElementById("pfAvPick").onclick = () => {
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
      inp.onchange = async () => { const fl = inp.files[0]; if (!fl) return; st("正在上传…"); try { await set(await squash(fl)); st("头像换好了 ✓"); } catch (e) { st(e.message); } };
      inp.click();
    };
    document.getElementById("pfAvReset").onclick = async () => { if (!confirm("恢复成默认的文字头像？")) return; try { await set(""); st("已恢复默认"); } catch (e) { st(e.message); } };
    paint();
  }
  // app.js 每次重画左下角头像后，把图片补上
  if (typeof window.renderUserChip === "function") {
    const orig = window.renderUserChip;
    window.renderUserChip = function () { const r = orig.apply(this, arguments); try { if (uid()) { if (loadedFor !== uid()) load(); else paint(); } } catch (e) {} return r; };
  }
  const boot = () => { mountProfile(); if (uid()) load(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  setTimeout(boot, 3000);
  window.CCAvatar = { load, paint, set };
})();
