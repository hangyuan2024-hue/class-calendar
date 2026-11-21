// 捞小智的形象卡片：照片 → Q版立绘 → 3D 小人（全部在这台电脑上做）；导入做好的 avatar.glb；换回机器人；一键删除
//   做好 / 换了以后发 lg-avatar 事件，show.js 把舞台上的形象换掉
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  if (!$("#avCard")) return;
  const call = (m, ...a) => window.lg.call(m, ...a);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const msgOf = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '\w+': (Error: )?/, "");
  const toast = (t, err) => { const el = $("#toast"); if (!el) return; el.textContent = t; el.className = "toast" + (err ? " err" : ""); el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), err ? 6000 : 2800); };
  let A = null, busy = false;
  const changed = () => window.dispatchEvent(new CustomEvent("lg-avatar"));
  function paint() {
    if (!A) return;
    $("#avNow").textContent = A.use === "3d" ? "老师的 3D 小人" : "机器人捞小智";
    $("#avRobot").hidden = A.use !== "3d";
    const on = (s, ok, can) => { const el = document.querySelector(`.av-st[data-s="${s}"]`); el.classList.toggle("done", !!ok); el.classList.toggle("off", !can); };
    on("engine", A.ready, true); on("photo", A.photo, A.ready); on("draw", A.figure, A.ready && A.photo); on("build", A.has3d && A.use === "3d", A.ready && A.figure);
    $("#avInstall").textContent = A.ready ? "✓ 装好了" : "装 3D 引擎"; $("#avInstall").disabled = A.ready || busy;
    $("#avPhoto").textContent = A.photo ? "换一张照片" : "选照片";
    for (const id of ["avPhoto", "avDraw", "avBuild", "avWipe"]) $("#" + id).disabled = busy;
    $("#avStop").hidden = !busy;
  }
  const refresh = async () => { try { A = await call("showAvatar"); paint(); } catch (e) {} };
  const run = (fn, ok) => async () => {
    if (busy) return;
    busy = true; paint(); $("#avMsg").textContent = "";
    try { const r = await fn(); if (ok) ok(r); } catch (e) { toast(msgOf(e), true); $("#avMsg").textContent = "没成：" + msgOf(e); }
    finally { busy = false; await refresh(); }
  };
  $("#avMake").onclick = () => { $("#avSteps").hidden = !$("#avSteps").hidden; refresh(); };
  $("#avInstall").onclick = run(() => call("showAvatarInstall"), () => toast("3D 引擎装好了"));
  $("#avPhoto").onclick = run(async () => { if (!$("#avConsent").checked) throw new Error("要先勾选上面的授权"); return call("showAvatarPhoto", { ok: true }); });
  $("#avDraw").onclick = run(() => call("showAvatarStylize", { n: 3 }), (urls) => showCands(urls || []));
  $("#avBuild").onclick = run(() => call("showAvatarBuild", {}), (r) => { toast("3D 小人做好了，已经换上"); if (r && r.notes && r.notes.length) $("#avMsg").textContent = r.notes.join("；"); changed(); });
  $("#avImport").onclick = run(() => call("showAvatarImport"), (r) => { if (r) { toast("换上了导入的 3D 形象"); changed(); } });
  $("#avRobot").onclick = run(() => call("showAvatarUse", "robot"), () => changed());
  $("#avWipe").onclick = run(async () => { if (!confirm("照片、立绘、3D 模型全部删掉，授权也撤回？")) return null; const r = await call("showAvatarWipe"); $("#avCands").innerHTML = ""; changed(); toast("都删掉了"); return r; });
  $("#avStop").onclick = () => call("showAvatarCancel").catch(() => {});
  function showCands(urls) {
    $("#avCands").innerHTML = urls.map((u, i) => `<img src="${esc(u)}" data-i="${i}" title="用这一张做 3D">`).join("");
    $("#avCands").querySelectorAll("img").forEach((im) => (im.onclick = async () => {
      try { await call("showAvatarChoose", +im.dataset.i); $("#avCands").querySelectorAll("img").forEach((x) => x.classList.toggle("on", x === im)); await refresh(); toast("选好了：点「做成 3D」"); } catch (e) { toast(msgOf(e), true); }
    }));
  }
  window.lg.on("show", (e) => { if (e && e.type === "avatar") { $("#avMsg").textContent = e.text + (e.p != null ? `（${Math.round(e.p * 100)}%）` : ""); } });
  refresh(); call("showAvatarCands").then((u) => { if (u && u.length) showCands(u); }).catch(() => {});
})();
