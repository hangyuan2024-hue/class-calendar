// 捞捞编程 · 皮肤商店：换掉「画出来」3D 舞台上的数据小兵
//   皮肤是官网 code-skins/ 下的一份份 .json（格式见 code-skins/README.md），主进程负责去拿（界面不能联网）；
//   每张卡片上是一个小的 3D 舞台，直接用这款皮肤站三个小兵给你看；点「使用」马上换，存在设置里，拖出去的小窗口也跟着换。
"use strict";
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const I = window.ICON, STAGE = window.LaoStage;
  const call = (m, ...a) => window.cc.call(m, ...a);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (t) => (window.LC && window.LC.toast ? window.LC.toast(t) : null);
  const listeners = new Set();
  let previews = [], open = false;

  const current = () => (STAGE ? STAGE.getSkin() : null);
  // 用上这款皮肤：舞台马上换、存进设置、告诉别的地方（拖出去的小窗口）
  async function use(spec) {
    if (!STAGE) return;
    const s = STAGE.setSkin(spec);
    try { await call("setSettings", { skin: s.id === "robot" ? null : spec }); } catch (e) {}
    for (const f of listeners) try { f(s.id === "robot" ? null : spec); } catch (e) {}
    return s;
  }
  // 启动时：把上次用的皮肤穿上
  function boot(settings) { if (STAGE && settings && settings.skin) STAGE.setSkin(settings.skin); }

  function el() {
    let root = $("#skinStore"); if (root) return root;
    root = document.createElement("div"); root.id = "skinStore"; root.className = "skin-store hud"; root.hidden = true;
    root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "皮肤商店");
    root.innerHTML = `
      <div class="ss-box">
        <div class="ss-head">
          <span class="viz-title">${I("shirt", 18)}<b>皮肤商店</b><small>SKINS</small></span>
          <span class="ss-sub">换掉「画出来」里的数据小兵</span>
          <span class="grow"></span>
          <button class="btn sm ghost" id="ssImport" title="用自己电脑上的皮肤文件（.json）试穿">${I("upload", 14)}导入皮肤文件</button>
          <button class="ic-btn" id="ssClose" title="关掉（Esc）" aria-label="关掉">${I("x", 18)}</button>
        </div>
        <div class="ss-note" id="ssNote"></div>
        <div class="ss-grid" id="ssGrid"></div>
        <div class="ss-foot">想上架自己做的皮肤？皮肤就是一份 .json：发到官网的 <code>code-skins/</code> 文件夹，写进 <code>index.json</code>，所有同学的皮肤商店里就能看到。格式见 <code>code-skins/README.md</code>。</div>
      </div>`;
    document.body.appendChild(root);
    $("#ssClose").onclick = close;
    root.addEventListener("mousedown", (e) => { if (e.target === root) close(); });
    root.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } });
    $("#ssImport").onclick = async () => {
      try { const sk = await call("pickSkinFile"); if (!sk) return; const s = await use(sk); paint(lastList, lastInfo); toast && toast(`已换上「${s.name}」`); }
      catch (e) { toast ? toast("这个文件用不了：" + e.message) : alert(e.message); }
    };
    $("#ssGrid").onclick = async (e) => {
      const b = e.target.closest("[data-use]"); if (!b) return;
      const spec = b.dataset.use === "robot" ? null : lastList.find((s) => s.id === b.dataset.use);
      const s = await use(spec); paint(lastList, lastInfo); toast && toast(`已换上「${s.name}」`);
    };
    return root;
  }

  let lastList = [], lastInfo = {};
  function clearPreviews() { for (const p of previews) try { p.dispose(); } catch (e) {} previews = []; }
  function paint(list, info) {
    lastList = list; lastInfo = info || {};
    clearPreviews();
    const cur = current(), curId = cur ? cur.id : "robot";
    const all = [STAGE ? STAGE.ROBOT : { id: "robot", name: "数据小兵", author: "捞捞", desc: "原版的小机器人" }, ...list.filter((s) => s.id !== "robot")];
    // 正在用的皮肤不在商店里（比如导入的文件）：也放一张卡片
    if (cur && curId !== "robot" && !all.some((s) => s.id === curId)) all.splice(1, 0, cur);
    $("#ssGrid").innerHTML = all.map((s) => {
      const on = s.id === curId;
      return `<div class="ss-card${on ? " on" : ""}">
        <div class="ss-pre" data-pre="${esc(s.id)}"></div>
        <div class="ss-meta"><b>${esc(s.name)}</b>${s.version ? `<small>v${esc(s.version)}</small>` : ""}<span class="grow"></span>${on ? `<span class="ss-tag">正在用</span>` : ""}</div>
        <p>${esc(s.desc || "")}</p>
        <div class="ss-acts"><span class="ss-by">${s.author ? "作者：" + esc(s.author) : ""}</span><span class="grow"></span>
          <button class="btn sm ${on ? "ghost" : "pri"}" data-use="${esc(s.id)}" ${on ? "disabled" : ""}>${on ? "已穿上" : "使用"}</button></div>
      </div>`;
    }).join("");
    const note = $("#ssNote");
    note.hidden = !info || info.online !== false;
    if (info && info.online === false) note.textContent = list.length ? "连不上皮肤商店，下面是上次看到的皮肤（已经下好的照样能用）。" : "连不上皮肤商店（" + (info.error || "网络不通") + "），等联网了再来看看。";
    // 小预览：三个高矮不一的小兵站着
    if (STAGE && STAGE.webgl()) for (const box of document.querySelectorAll("#ssGrid [data-pre]")) {
      const id = box.dataset.pre, spec = id === "robot" ? STAGE.ROBOT : all.find((s) => s.id === id);
      const st = STAGE.create(box, { skin: spec, mini: true, sfx: false });
      if (st) { st.set({ a: [4, 9, 6], sorted: [] }); previews.push(st); }
    }
  }

  async function show() {
    const root = el(); root.hidden = false; open = true;
    root.tabIndex = -1; root.focus();
    paint(lastList, { online: true });
    $("#ssNote").hidden = false; $("#ssNote").textContent = "正在打开皮肤商店…";
    let r; try { r = await call("skinStore"); } catch (e) { r = { online: false, error: e.message, skins: [] }; }
    if (!open) return;
    paint(r.skins || [], r);
  }
  function close() { const root = $("#skinStore"); if (root) root.hidden = true; open = false; clearPreviews(); }

  window.LaoSkins = { show, close, use, boot, onChange: (f) => listeners.add(f), get current() { return current(); } };
})();
