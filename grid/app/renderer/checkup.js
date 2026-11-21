// 捞捞算力 · 成品展示里的「检测报告」卡片：最近一次的雷达图（和上周 / 某一次叠在一起比）、哪几项进步 / 退步、历次记录；
//   做一次检测（选照片 + 自测问卷；按设置走合作方接口或者捞捞自己的分析）、导入合作方导出的文件、设置数据来源、演示数据、全部删除。
//   对话里捞小智调了检测的工具，也在对话里画一张雷达图（window.LaoCheckup.onTool）。
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const call = (m, ...a) => window.lg.call(m, ...a);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const msgOf = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '\w+': (Error: )?/, "");
  const toast = (t, err) => { const el = $("#toast"); if (!el) return; el.textContent = t; el.className = "toast" + (err ? " err" : ""); el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), err ? 6000 : 2800); };
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(msgOf(e), true); } };
  const COLOR = { 4: "var(--gr)", 3: "var(--am)", 2: "#ff9a5c", 1: "var(--rd)" };

  // ---------- 雷达图：越靠外越好；信息不足的不连线（画一个虚线小圈）；对比的那一次画成虚线 ----------
  function radarSvg(R, opt = {}) {
    if (!R || !R.latest) return "";
    const dims = R.latest.dims, n = dims.length, W = opt.size || 300, cx = W / 2, cy = W / 2, r = W * 0.3, max = R.max || 4;
    const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const pt = (i, v) => [cx + Math.cos(ang(i)) * r * (v / max), cy + Math.sin(ang(i)) * r * (v / max)];
    const f = (x) => x.toFixed(1);
    const padX = W * 0.17;   // 左右两边的项目名（四个字）要留地方，不然被裁掉
    let s = `<svg class="ck-radar" viewBox="${-padX} 0 ${W + 2 * padX} ${W}" width="100%" role="img" aria-label="${esc(R.profile)}雷达图">`;
    for (let k = 1; k <= max; k++) s += `<polygon points="${dims.map((_, i) => pt(i, k).map(f).join(",")).join(" ")}" fill="${k === max ? "rgba(54,226,255,.05)" : "none"}" stroke="rgba(120,170,255,${k === max ? 0.35 : 0.16})"/>`;
    dims.forEach((_, i) => { const [x, y] = pt(i, max); s += `<line x1="${cx}" y1="${cy}" x2="${f(x)}" y2="${f(y)}" stroke="rgba(120,170,255,.16)"/>`; });
    // 一条折线：只连相邻都测出来的两项
    const line = (set, cls) => { let p = ""; const by = new Map(set.dims.map((d) => [d.key, d.level])); for (let i = 0; i < n; i++) { const a = by.get(dims[i].key), b = by.get(dims[(i + 1) % n].key); if (a == null || b == null || (n < 3 && i === n - 1)) continue; const [x1, y1] = pt(i, a), [x2, y2] = pt((i + 1) % n, b); p += `<line class="${cls}" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`; } return p; };
    if (R.base) s += line(R.base, "ck-base");
    s += line(R.latest, "ck-now");
    dims.forEach((d, i) => {
      if (d.level == null) { const [x, y] = pt(i, max * 0.75); s += `<circle cx="${f(x)}" cy="${f(y)}" r="5" class="ck-unk"/>`; }
      else { const [x, y] = pt(i, d.level); s += `<circle cx="${f(x)}" cy="${f(y)}" r="4.5" fill="#0a1124" stroke="${COLOR[d.level]}" stroke-width="2.4"/>`; }
      const [lx, ly] = pt(i, max * 1.32), anchor = Math.abs(lx - cx) < 8 ? "middle" : lx > cx ? "start" : "end";
      const b = R.base && R.base.dims.find((x) => x.key === d.key), arrow = b && b.level != null && d.level != null && b.level !== d.level ? (d.level > b.level ? " ↑" : " ↓") : "";
      s += `<text x="${f(lx)}" y="${f(ly - 3)}" text-anchor="${anchor}" class="ck-lbl">${esc(d.name)}</text><text x="${f(lx)}" y="${f(ly + 12)}" text-anchor="${anchor}" class="ck-lv" fill="${d.level == null ? "var(--mut)" : COLOR[d.level]}">${esc(d.label)}${arrow}</text>`;
    });
    return s + "</svg>";
  }
  const legend = (R) => `<div class="ck-legend"><span><i class="now"></i>${esc(R.latest.date)}</span>${R.base ? `<span><i class="base"></i>${esc(R.base.date)}</span>` : ""}<span class="muted">越靠外越好 · 虚线圈 = 信息不足</span></div>`;

  // ---------- 卡片 ----------
  let V = null, base = "", photos = [], scanOpen = false, setOpen = false, wipeArm = 0, quizOpen = null, zoned = false;
  // photos：[{ url, zone, light }]；普通照片 zone / light 是空的。分区实拍（检测仪）：按拍摄时间排好，自动标「部位·光源」，每张可以改
  function paint() {
    if (!V || !$("#ckBody")) return;
    const c = V.config;
    $("#ckTitle").textContent = c.profile + "报告";
    $("#ckFoot").textContent = c.disclaimer + " 照片和报告只存在这台电脑上。";
    if (!V.latest) {
      $("#ckBody").innerHTML = `<div class="muted small">还没有检测记录。可以「做一次检测」（传头皮照片 / 答几道自测题），「导入」合作方导出的结果，或者先</div><div class="btns"><button class="btn small" id="ckDemo">放演示数据看看</button></div>`;
    } else {
      const R = V.radar, cmp = V.compare, L = V.latest;
      const opts = V.list.slice(1).map((x) => `<option value="${esc(x.id)}" ${x.id === base ? "selected" : ""}>${esc(x.date)} · ${esc(x.source)}</option>`).join("");
      const rows = cmp && cmp.base ? `${cmp.better.length ? `<div class="ck-chg up">进步：${esc(cmp.better.join("、"))}</div>` : ""}${cmp.worse.length ? `<div class="ck-chg down">退步：${esc(cmp.worse.join("、"))}</div>` : ""}${!cmp.better.length && !cmp.worse.length ? `<div class="ck-chg">和 ${esc(cmp.base.date)} 比，测出来的几项都没变</div>` : ""}${cmp.mixed ? `<div class="muted small">${esc(cmp.mixed)}</div>` : ""}` : `<div class="muted small">只有这一次，过几天再测就能看变化</div>`;
      $("#ckBody").innerHTML = `<div class="ck-meta"><b>${esc(L.date)}</b><span class="tag ${L.demo ? "ck-demo" : ""}">${esc(L.source)}</span></div>
        ${L.fallback ? `<div class="ck-fb">${esc(L.fallback)}</div>` : ""}
        ${radarSvg(R)}${legend(R)}
        ${V.list.length > 1 ? `<label class="ck-cmp muted small">和哪次比 <select id="ckBase"><option value="">上周（自动）</option>${opts}</select></label>` : ""}
        ${rows}
        <details class="ck-hist"><summary class="muted small">历次检测（${V.count} 次）</summary>${V.list.map((x) => `<div class="ck-row"><i>${esc(x.date)}</i><span>${esc(x.source)}${x.demo ? "（演示）" : ""}</span><small>${esc(x.summary)}</small><button class="ck-x" data-rm="${esc(x.id)}" title="删掉这一次">×</button></div>`).join("")}</details>`;
    }
    paintScan(); paintSet();
  }
  // 做一次检测
  function paintScan() {
    const el = $("#ckScan"); el.hidden = !scanOpen; if (!scanOpen) { quizOpen = null; return; }
    const c = V.config, q = c.local.quiz;
    // 重画（加了照片）不丢已经选的答案、不收起问卷
    const picked = {}; for (const r of el.querySelectorAll('input[type="radio"]:checked')) picked[r.name] = r.value;
    const dt = el.querySelector("details.ck-quiz"); if (dt) quizOpen = dt.open;
    const src = c.source === "local" || !c.partner.ready ? "捞捞自己的分析（本机看照片 + 问卷）" : c.consent.partner ? `${esc(c.partner.name)}的接口（连不上自动换成捞捞自己的）` : `捞捞自己的分析（还没同意把照片发给${esc(c.partner.name)}）`;
    el.innerHTML = `<div class="ck-panel">
      ${c.consent.local ? "" : `<label class="ck-ok"><input type="checkbox" id="ckConsent"> 我同意：检测照片和报告保存在这台电脑上（随时可以在「设置」里全部删除）</label>`}
      <div class="muted small">这次用：${src}</div>
      <label class="ck-ok"><input type="checkbox" id="ckZoned" ${zoned ? "checked" : ""}> 用头皮检测仪分区实拍（前额、头顶、左侧、右侧、后枕，每个部位白光、偏振光、紫外光各一张，共 15 张）</label>
      <div class="ck-ph"><label class="btn small">${zoned ? "选检测仪拍的照片（一次全选，最多 15 张）" : "选头皮照片（最多 6 张）"}<input type="file" id="ckFiles" accept="image/*" multiple hidden></label><span class="muted small">${zoned ? "按拍摄时间自动标好部位和光源，标错了在下面改" : "拨开头发、离近一点、光线亮一点"}</span></div>
      ${zoned ? zoneHint() : ""}
      <div class="ck-thumbs ${zoned ? "zoned" : ""}">${photos.map((p, i) => `<span><img src="${p.url}" alt="照片${i + 1}"><button class="ck-x" data-ph="${i}">×</button>${zoned ? `<select data-pz="${i}">${c.zones.map((z) => `<option value="${z.key}" ${z.key === p.zone ? "selected" : ""}>${esc(z.name)}</option>`).join("")}</select><select data-pl="${i}">${c.lights.map((l) => `<option value="${l.key}" ${l.key === p.light ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>` : ""}</span>`).join("")}</div>
      <details class="ck-quiz" ${(quizOpen == null ? !photos.length : quizOpen) ? "open" : ""}><summary class="muted small">自测问卷（看照片看不出来的项目靠它补，可以不答）</summary>
        ${q.map((x) => `<div class="ck-q"><div>${esc(x.q)}</div><div class="ops">${x.options.map((t) => `<label><input type="radio" name="ckq-${x.key}" value="${esc(t)}" ${picked["ckq-" + x.key] === t ? "checked" : ""}> ${esc(t)}</label>`).join("")}</div></div>`).join("")}
      </details>
      <div class="btns"><button class="btn small primary" id="ckGo">开始检测</button><button class="btn small" id="ckCancel">取消</button></div></div>`;
  }
  // 分区实拍：还差哪几张、哪一格拍了两张
  function zoneHint() {
    const c = V.config, have = new Map();
    for (const p of photos) { const k = p.zone + "/" + p.light; have.set(k, (have.get(k) || 0) + 1); }
    const miss = [], twice = [];
    for (const z of c.zones) for (const l of c.lights) { const n = have.get(z.key + "/" + l.key) || 0; if (!n) miss.push(z.name + "·" + l.name); if (n > 1) twice.push(z.name + "·" + l.name); }
    return `<div class="muted small">${photos.length}/15 张${miss.length && photos.length ? `，还差：${esc(miss.slice(0, 6).join("、"))}${miss.length > 6 ? ` 等 ${miss.length} 张` : ""}（缺几张也能测，合作方可能要求拍全）` : ""}${twice.length ? `；<b style="color:var(--rd)">这几格拍了两张：${esc(twice.join("、"))}</b>` : ""}</div>
      <div class="muted small">${c.lights.map((l) => `${esc(l.name)}看${esc(l.see)}`).join("；")}</div>`;
  }
  // 设置：数据来源、合作方接口、同意、演示数据、全部删除
  function paintSet() {
    const el = $("#ckSet"); el.hidden = !setOpen; if (!setOpen) return;
    const c = V.config, p = c.partner;
    el.innerHTML = `<div class="ck-panel">
      <label>数据来源 <select id="ckSrc">${c.sources.map((s) => `<option value="${s.key}" ${s.key === c.source ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
      <div class="ck-sub">合作方接口（他们给了接口说明再填；不填就只用捞捞自己的）</div>
      <label>名称 <input id="ckPName" value="${esc(p.name)}"></label>
      <label>接口地址 <input id="ckPUrl" placeholder="https://…" value="${esc(p.url)}"></label>
      <label>口令 <input id="ckPTok" type="password" autocomplete="off" placeholder="${p.hasToken ? "已保存（不显示）；要换就重新填" : "没有就空着"}"></label>
      <label>口令放在 <input id="ckPAuth" value="${esc(p.auth)}"></label>
      <label>发照片的方式 <select id="ckPBody"><option value="json" ${p.body === "json" ? "selected" : ""}>JSON（照片转成 base64）</option><option value="multipart" ${p.body === "multipart" ? "selected" : ""}>表单上传文件（multipart）</option></select></label>
      <label>照片字段名 <input id="ckPField" value="${esc(p.imageField)}"></label>
      <label>字段对应（JSON，可以不填）<textarea id="ckPMap" rows="3" placeholder='{"items":"data.result","key":"code","level":"grade"}'>${esc(Object.keys(p.map || {}).length ? JSON.stringify(p.map) : "")}</textarea></label>
      <div class="ck-sub">分区实拍（合作方要的 5 个部位 × 3 种光）</div>
      <label>部位、光源的叫法（JSON，按合作方的改；不填就用 front/top/left/right/back、white/polarized/uv）<textarea id="ckPCodes" rows="2" placeholder='{"zones":{"front":"qianE"},"lights":{"uv":"UV"}}'>${esc(Object.keys(p.codes || {}).length ? JSON.stringify(p.codes) : "")}</textarea></label>
      <label>表单上传时每张的字段名 <input id="ckPPat" value="${esc(p.fieldPattern || "{zone}_{light}")}"></label>
      <label>至少要几张才发（0 = 不限；合作方要求拍全就填 15）<input id="ckPMin" type="number" min="0" max="15" value="${+p.minPhotos || 0}"></label>
      <label>额外参数（JSON，可以不填）<textarea id="ckPExtra" rows="2" placeholder='{"device":"comb-01"}'>${esc(Object.keys(p.extra || {}).length ? JSON.stringify(p.extra) : "")}</textarea></label>
      <label class="ck-ok"><input type="checkbox" id="ckPConsent" ${c.consent.partner ? "checked" : ""}> 同意把检测照片发给${esc(p.name)}（照片会离开这台电脑）</label>
      <label class="ck-ok"><input type="checkbox" id="ckKeep" ${c.keepPhotos ? "checked" : ""}> 在这台电脑上留着检测照片</label>
      <div class="btns"><button class="btn small primary" id="ckSave">保存</button><button class="btn small" id="ckDemo2">放演示数据</button><button class="btn small" id="ckWipe">${wipeArm > Date.now() ? "再点一次：全部删掉" : "删除全部检测数据"}</button></div></div>`;
  }
  const load = guard(async () => { V = await call("showCheckup", base || null); paint(); });

  // 照片：缩到长边 1280、存成 JPEG（省内存，也不会把几十 M 的原图发出去）
  function shrink(file) {
    return new Promise((ok, bad) => {
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, 1280 / Math.max(img.width, img.height)); const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(u); ok(cv.toDataURL("image/jpeg", 0.88)); };
      img.onerror = () => { URL.revokeObjectURL(u); bad(new Error(`「${file.name}」打不开（HEIC 先转成 JPG，或者截个图）`)); };
      img.src = u;
    });
  }

  // 按顺序自动标（前额 白 偏 紫、头顶 白 偏 紫……）；已经手动改过的不动
  function relabel() {
    const zs = V.config.zones, ls = V.config.lights;
    photos.forEach((p, i) => { if (!p.zone) p.zone = (zs[Math.floor(i / ls.length)] || zs[zs.length - 1]).key; if (!p.light) p.light = ls[i % ls.length].key; });
  }
  function bind() {
    const card = $("#ckCard"); if (!card || card._b) return; card._b = true;
    $("#ckScanBtn").onclick = () => { scanOpen = !scanOpen; setOpen = false; paint(); };
    $("#ckSetBtn").onclick = () => { setOpen = !setOpen; scanOpen = false; paint(); };
    $("#ckImport").onclick = guard(async () => { const r = await call("showCheckupImport"); if (!r) return; V = r.view; base = ""; paint(); toast(`导入了 ${r.added} 次检测`); });
    card.addEventListener("change", guard(async (e) => {
      if (e.target.id === "ckBase") { base = e.target.value; await load(); }
      if (e.target.id === "ckZoned") { zoned = e.target.checked; if (zoned) relabel(); else photos = photos.slice(0, 6).map((p) => ({ url: p.url })); paintScan(); }
      if (e.target.id === "ckFiles") {
        // 检测仪的照片按拍摄时间排（文件名一般也是时间），一个部位三种光拍完再换下一个部位
        const files = [...e.target.files].sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name, undefined, { numeric: true }));
        for (const f of files.slice(0, (zoned ? 15 : 6) - photos.length)) photos.push({ url: await shrink(f) });
        if (zoned) relabel(); paintScan();
      }
      if (e.target.dataset.pz != null) { photos[+e.target.dataset.pz].zone = e.target.value; paintScan(); }
      if (e.target.dataset.pl != null) { photos[+e.target.dataset.pl].light = e.target.value; paintScan(); }
    }));
    card.addEventListener("click", guard(async (e) => {
      const t = e.target, id = t.id;
      if (t.dataset.rm) { V = await call("showCheckupRemove", t.dataset.rm); base = ""; paint(); return; }
      if (t.dataset.ph != null) { photos.splice(+t.dataset.ph, 1); paintScan(); return; }
      if (id === "ckDemo" || id === "ckDemo2") { V = await call("showCheckupDemo"); base = ""; setOpen = false; paint(); toast("放好了 6 次演示数据（虚构的）"); return; }
      if (id === "ckCancel") { scanOpen = false; photos = []; zoned = false; paint(); return; }
      if (id === "ckWipe") { if (wipeArm < Date.now()) { wipeArm = Date.now() + 4000; paintSet(); setTimeout(paintSet, 4100); return; } wipeArm = 0; V = await call("showCheckupWipe"); base = ""; paint(); toast("检测数据和照片都删掉了"); return; }
      if (id === "ckSave") {
        const g = (k) => $(k).value;
        await call("showCheckupConfig", { source: g("#ckSrc"), keepPhotos: $("#ckKeep").checked, consent: { partner: $("#ckPConsent").checked },
          partner: { name: g("#ckPName"), url: g("#ckPUrl"), token: g("#ckPTok"), auth: g("#ckPAuth"), body: g("#ckPBody"), imageField: g("#ckPField"), map: g("#ckPMap"), extra: g("#ckPExtra"), codes: g("#ckPCodes"), fieldPattern: g("#ckPPat"), minPhotos: +g("#ckPMin") || 0 } });
        setOpen = false; await load(); toast("保存好了"); return;
      }
      if (id === "ckGo") {
        if ($("#ckConsent") && !$("#ckConsent").checked) throw new Error("先勾上同意保存，才能检测");
        if ($("#ckConsent")) await call("showCheckupConfig", { consent: { local: true } });
        const answers = {}; for (const x of V.config.local.quiz) { const r = document.querySelector(`input[name="ckq-${x.key}"]:checked`); if (r) answers[x.key] = r.value; }
        if (!photos.length && !Object.keys(answers).length) throw new Error("选几张照片，或者答几道自测题");
        const b = $("#ckGo"); b.disabled = true; b.textContent = photos.length ? "正在看照片（第一次要下载看图组件）…" : "正在分析…";
        try { const r = await call("showCheckupScan", { images: photos.map((p) => (zoned ? { url: p.url, zone: p.zone, light: p.light } : p.url)), answers }); V = r.view; base = ""; scanOpen = false; photos = []; zoned = false; paint(); toast(r.report.fallback ? r.report.fallback : `测好了：${r.report.summary}`, !!r.report.fallback); }
        finally { if (b.isConnected) { b.disabled = false; b.textContent = "开始检测"; } }
      }
    }));
  }

  // 对话里调了检测的工具：卡片刷新；最近一次 / 对比 / 刚测完，在对话里也画一张
  async function onTool(e, add) {
    if (!e.ok || !/^checkup_/.test(e.name)) return;
    const r = e.result || {}, b = e.name === "checkup_compare" && r.base ? r.base.id : "";
    try {
      const v = await call("showCheckup", b || null);
      if (!b) { V = v; paint(); }
      if (/^checkup_(latest|compare|scan)$/.test(e.name) && v.radar && add) add("sh-ck", radarSvg(v.radar, { size: 280 }) + legend(v.radar));
    } catch (x) { /* 画不出来不影响对话 */ }
  }

  window.addEventListener("lg-page", (e) => { if (e.detail === "show") { bind(); load(); } });
  window.LaoCheckup = { radarSvg, onTool, load, state: () => V };
})();
