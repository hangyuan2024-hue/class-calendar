// 插件页「模型」：接自己的模型（DeepSeek、通义千问、智谱、Kimi、硅基流动、自定义 OpenAI 兼容接口），填 Key、试一下、查它有哪些模型；
//   多个助手一起做时用哪个模型、要不要思考。改完发 lg-models，对话框下面的模型下拉跟着变
//   Key 输入框平时是空的（界面拿不到完整的 Key），只显示后四位；填了新的才换
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  if (!$("#mdCard")) return;
  const call = (m, ...a) => window.lg.call(m, ...a);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const msgOf = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '\w+': (Error: )?/, "");
  const toast = (t, err) => { const el = $("#toast"); if (!el) return; el.textContent = t; el.className = "toast" + (err ? " err" : ""); el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), err ? 6000 : 2800); };
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(msgOf(e), true); } };
  const changed = () => window.dispatchEvent(new CustomEvent("lg-models"));
  let C = null;

  function row(p) {
    const extra = p.models.filter((m) => m.id === m.name).map((m) => m.id).join(", ");
    return `<div class="md-p${p.keySet ? " on" : ""}" data-id="${esc(p.id)}">
      <div class="t"><b>${esc(p.name)}</b><span class="st">${p.keySet ? `已接上（Key …${esc(p.keyTail)}${p.keyFromEnv ? "，来自环境变量" : ""}）` : "没接"}</span><span class="grow"></span>${p.site ? `<span class="muted small">在 ${esc(p.site.replace(/^https?:\/\//, ""))} 申请 Key</span>` : ""}</div>
      ${p.custom ? `<div class="md-f"><input data-k="name" placeholder="起个名字（比如：学校的模型）" value="${esc(p.name === "自定义（OpenAI 兼容接口）" ? "" : p.name)}"><input data-k="base" placeholder="接口地址，比如 https://xxx.com/v1" value="${esc(p.base)}"></div>` : ""}
      <div class="md-f"><input data-k="key" type="password" autocomplete="off" spellcheck="false" placeholder="${p.keySet ? "要换 Key 就填新的" : "API Key"}"><input data-k="models" placeholder="加模型名（可不填，逗号隔开）" value="${esc(extra)}"></div>
      <div class="md-ms muted small">${p.models.length ? "能选：" + p.models.map((m) => esc(m.name)).join("、") : "还没有模型：点「查有哪些模型」，或者自己填模型名"}</div>
      <div class="btns"><button class="btn small primary" data-a="save">保存</button><button class="btn small" data-a="test"${p.keySet && p.models.length ? "" : " disabled"}>试一下</button><button class="btn small" data-a="list"${p.keySet ? "" : " disabled"}>查有哪些模型</button>${p.keySet && !p.keyFromEnv ? `<span class="grow"></span><button class="btn small ghost" data-a="del">删掉</button>` : ""}</div>
    </div>`;
  }
  function paint() {
    if (!C) return;
    $("#mdNow").textContent = "现在用：" + C.currentName;
    // 正在填的那一家不重画（免得填了一半的字没了）
    const focus = document.activeElement && document.activeElement.closest && document.activeElement.closest(".md-p");
    if (!focus) $("#mdList").innerHTML = C.providers.map(row).join("");
    const w = $("#mdWorker");
    w.innerHTML = `<option value="">自动（${esc(C.workerName)}）</option>` + C.choices.map((x) => `<option value="${esc(x.value)}">${esc(x.name)}</option>`).join("");
    w.value = C.worker || "";
    $("#shThink").value = C.think;
  }
  const refresh = async () => { try { C = await call("showCloud"); paint(); } catch (e) {} };

  $("#mdList").addEventListener("click", guard(async (e) => {
    const b = e.target.closest("button[data-a]"); if (!b) return;
    const box = b.closest(".md-p"), id = box.dataset.id, v = (k) => { const el = box.querySelector(`[data-k="${k}"]`); return el ? el.value.trim() : null; };
    const p = C.providers.find((x) => x.id === id);
    if (b.dataset.a === "save") {
      const q = { id };
      if (v("key")) q.key = v("key");
      if (v("models") != null) q.models = v("models");
      if (p.custom) { q.base = v("base"); q.name = v("name"); }
      C = await call("showCloudSet", { provider: q }); document.activeElement.blur(); paint(); changed();
      toast(C.providers.find((x) => x.id === id).keySet ? `${p.name} 接上了：对话框下面能选它的模型` : "保存好了");
      return;
    }
    if (b.dataset.a === "test") {
      b.disabled = true; b.textContent = "正在试…";
      try { const m = p.models[0].id, r = await call("showCloudTest", `${id}/${m}`); toast(`连上了：${r.model}，${(r.ms / 1000).toFixed(1)} 秒回了「${r.reply}」`); await refresh(); }
      finally { b.disabled = false; b.textContent = "试一下"; }
      return;
    }
    if (b.dataset.a === "list") {
      b.disabled = true; b.textContent = "正在查…";
      try {
        const r = await call("showCloudModels", id);
        const el = box.querySelector(".md-ms");
        el.innerHTML = (r.from === "api" ? `它有 ${r.models.length} 个模型（点一个加进下拉）：` : "没查到（这家可能不支持查），常用的：") + r.models.slice(0, 60).map((m) => `<a class="md-add" data-m="${esc(m)}">${esc(m)}</a>`).join(" ");
      } finally { b.disabled = false; b.textContent = "查有哪些模型"; }
      return;
    }
    if (b.dataset.a === "del") { if (!confirm(`删掉 ${p.name} 的 Key？`)) return; C = await call("showCloudSet", { provider: { id, remove: true } }); paint(); changed(); toast("删掉了"); }
  }));
  // 点查到的模型名：加进「自己加的模型名」并保存
  $("#mdList").addEventListener("click", guard(async (e) => {
    const a = e.target.closest(".md-add"); if (!a) return;
    const box = a.closest(".md-p"), id = box.dataset.id, inp = box.querySelector('[data-k="models"]');
    const have = inp.value.split(/[,，\s]+/).filter(Boolean); if (!have.includes(a.dataset.m)) have.push(a.dataset.m);
    C = await call("showCloudSet", { provider: { id, models: have.join(",") } }); paint(); changed(); toast(`加上了 ${a.dataset.m}：对话框下面能选`);
  }));
  $("#mdWorker").onchange = guard(async () => { C = await call("showCloudSet", { worker: $("#mdWorker").value }); paint(); changed(); });
  $("#shThink").onchange = guard(async () => { C = await call("showCloudSet", { think: $("#shThink").value }); paint(); changed(); toast("改好了：开了一段新对话"); });
  window.addEventListener("lg-models-changed", refresh);
  window.addEventListener("lg-models", () => setTimeout(refresh, 50));
  window.addEventListener("lg-page", (e) => { if (e.detail === "plugins") refresh(); });
  refresh();
})();
