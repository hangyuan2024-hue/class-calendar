// 捞捞PPT助手 · 界面：① 捏形象 ② 准备声音 ③ 选页写讲解和问答 ④ 生成（配音 → 画视频 → 写进 PPT）
"use strict";
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const call = (m, ...a) => window.cc.call(m, ...a);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let toastT = 0;
  const toast = (t, err) => { const el = $("#toast"); el.textContent = t; el.className = "toast" + (err ? " err" : ""); el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), err ? 6000 : 2600); };
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(String((e && e.message) || e).replace(/^Error invoking remote method 'call': (Error: )?/, ""), true); } };

  // ---------- 状态 ----------
  // 默认是「公仔风」：大头、黑色高马尾、眯眯笑眼、黑色格子高领毛衣、紫裤子、棕色短靴（机器人骨架默认不要，想要可以勾上）
  const DEFAULT = { look: 8, photoFace: true, faceStyle: "doll", rig: false, grid: true, body: "chibi", tech: true, stage: false, collar: "#f7f8fb", shell: "#eef1f6", hairStyle: "ponytail", bangs: "side", eyeStyle: "smile", bottom: "pants", skin: "#ffdccb", hair: "#1c1a1f", top: "#26262c", pants: "#6a4f8c", shoes: "#6b4430", eye: "#2b1d18", glassesColor: "#3b3b46", accent: "#22d3ee", glasses: false, blush: true, earrings: true, antenna: false, earpods: true };
  let S = null, spec = { ...DEFAULT }, doc = null, cur = 0, qaSeq = 0;
  const plan = new Map();   // 页号 → { on, narration, qa: [{ id, q, a }] }

  // ---------- 切换步骤 ----------
  function go(step) {
    for (const b of $$("#steps button")) b.classList.toggle("on", b.dataset.step === step);
    for (const p of $$(".page")) p.hidden = p.id !== "pg-" + step;
    if (step === "make") paintJobs();
    if (av) av.setManual(step !== "avatar");   // 不在这一页就别一直画
  }
  $("#steps").onclick = (e) => { const b = e.target.closest("button"); if (b) go(b.dataset.step); };
  function markDone() {
    const d = { avatar: !!S.profile.avatar, voice: !!(S.voice && S.voice.prompt), slides: [...plan.values()].some((p) => p.on) };
    for (const b of $$("#steps button")) b.classList.toggle("done", !!d[b.dataset.step]);
  }

  // ---------- ① 我的形象 ----------
  let av = null, saveT = 0;
  const HAIR = [["none", "不要头发"], ["flare", "外翻长发"], ["long", "长直发"], ["bob", "波波头"], ["short", "短发"], ["ponytail", "马尾"], ["bun", "丸子头"], ["curly", "卷发"]];
  const BANGS = [["middle", "中分"], ["full", "齐刘海"], ["side", "斜刘海"], ["none", "不要刘海"]];
  const EYES = [["smile", "眯眯眼"], ["open", "睁眼"]];
  const BOTTOM = [["pants", "裤子"], ["skirt", "裙子"]];
  const BODY = [["chibi", "Q版（大头）"], ["tall", "修长"]];
  const COLORS = [["shell", "头部外壳"], ["skin", "皮肤"], ["hair", "头发"], ["top", "上衣（毛衣 / 外套）"], ["collar", "衬衫领子、袖口"], ["pants", "裤子 / 裙子"], ["shoes", "鞋子"], ["eye", "眼睛（睁眼时）"], ["glassesColor", "镜框"], ["accent", "发光色（舞台光效）"]];
  const FACESTYLE = [["doll", "公仔风（推荐）"], ["ai3d", "AI 3D 形象"], ["real", "真人数字人"], ["screen", "机器人屏幕脸"], ["cyber", "赛博照片"], ["photo", "原样照片"], ["cartoon", "卡通"]];
  const TOGGLES = [["rig", "机器人骨架（关节球、线路、骨头手）"], ["grid", "衣服上的白格子"], ["photoFace", "用照片做脸"], ["tech", "照片脸的科技光效"], ["stage", "舞台光效（脚下光环、扫描线）"], ["glasses", "戴眼镜"], ["blush", "腮红"], ["earrings", "耳环"], ["earpods", "耳机灯环"], ["antenna", "小天线"]];
  // 每种脸用得上的颜色、开关（用不上的不显示，免得改了没反应）
  const USES = {
    doll: { c: ["skin", "hair", "top", "pants", "shoes", "eye", "glassesColor", "accent"], t: ["grid", "rig", "stage", "glasses", "blush", "earrings"] },
    screen: { c: ["shell", "hair", "top", "collar", "pants", "shoes", "glassesColor", "accent"], t: ["stage", "glasses", "earpods", "antenna"] },
    ai3d: { c: ["accent"], t: ["stage"] },   // AI 生成的：长相、衣服都在模型里了
    real: { c: [], t: [] },   // 真人数字人：就是老师自己的视频
  };
  const uses = (kind, k) => { const u = USES[spec.faceStyle]; return !u || u[kind].includes(k); };
  const lineFace = () => spec.faceStyle === "doll" || spec.faceStyle === "screen";   // 只从照片里量五官，照片不贴上去
  // 每一段说话时做什么动作
  const ACTIONS = [["auto", "自动"], ["wave", "挥手打招呼"], ["point", "指着幻灯片"], ["gesture", "边讲边比划"], ["nod", "点头"], ["think", "先想一想"]];
  const actSel = (key, v) => `<select class="act" data-act="${key}" title="说这一段时做什么动作">${ACTIONS.map(([k, t]) => `<option value="${k}"${(v || "auto") === k ? " selected" : ""}>动作：${t}</option>`).join("")}</select>`;
  function paintForm() {
    const chips = (k, list) => `<div class="chips" data-k="${k}">${list.map(([v, t]) => `<button data-v="${v}" class="${spec[k] === v ? "on" : ""}">${t}</button>`).join("")}</div>`;
    $("#avatarForm").innerHTML =
      `<div class="grp"><b>脸的样子</b>${chips("faceStyle", FACESTYLE)}</div>` +
      (spec.faceStyle === "real" ? `<p class="hint">真人数字人：PPT 里出现的是你自己视频里正对镜头的那几秒，嘴跟着配音动（要显卡）。在下面「用一段视频做」里上传视频、装好组件就能用。画面左上角一直有「AI生成」标识。</p>` :
      spec.faceStyle === "ai3d" ? `<p class="hint">AI 生成的形象：长相、发型、衣服都在模型里了，在下面「AI 生成 3D 形象」里重新生成就能换。</p>` :   // 发型、衣服这些对它没用
      `<div class="grp"><b>发型</b>${chips("hairStyle", HAIR)}</div>` +
      (spec.hairStyle === "none" ? "" : `<div class="grp"><b>刘海</b>${chips("bangs", BANGS)}</div>`) +
      `<div class="grp"><b>眼睛</b>${chips("eyeStyle", EYES)}</div>` +
      `<div class="grp"><b>下装</b>${chips("bottom", BOTTOM)}</div>` +
      (spec.faceStyle === "doll" ? `<div class="grp"><b>身材</b>${chips("body", BODY)}</div>` : "")) +
      `<div class="grp"><b>颜色</b><div class="colors">${COLORS.filter(([k]) => uses("c", k)).map(([k, t]) => `<label><input type="color" data-c="${k}" value="${spec[k]}">${t}</label>`).join("")}</div></div>` +
      `<div class="grp"><b>其他</b><div class="toggles">${TOGGLES.filter(([k]) => uses("t", k)).map(([k, t]) => `<label><input type="checkbox" data-t="${k}" ${spec[k] ? "checked" : ""}>${t}</label>`).join("")}</div></div>` +
      `<div class="row"><button class="btn sm" id="avReset">恢复默认</button></div>`;
    $$("#dropper button").forEach((b) => { const k = b.dataset.pick; b.innerHTML = `<i style="background:${spec[k]}"></i>${b.textContent.replace(/^\s+/, "")}`; });
  }
  function changed() {
    if (av) av.setSpec(spec);
    paintForm();
    clearTimeout(saveT); saveT = setTimeout(guard(async () => { await call("saveAvatar", spec); S.profile.avatar = spec; markDone(); }), 400);
  }
  $("#avatarForm").addEventListener("click", (e) => {
    const b = e.target.closest(".chips button"); if (b) { const k = b.parentElement.dataset.k; spec[k] = b.dataset.v; changed(); if (k === "hairStyle") paintForm(); if (k === "faceStyle") showReal(); if (k === "faceStyle" && spec.faceStyle === "real") return; if (k === "faceStyle" && spec.faceStyle === "ai3d") { guard(ensureAi)(); return; } if (k === "faceStyle") { if (photoImg && marks.e1 && marks.e2 && marks.mouth) guard(buildFace)(); else if (!lineFace()) toast("先上传照片、标好五官，再选照片脸"); } }
    if (e.target.id === "avReset") { spec = { ...DEFAULT }; changed(); }
  });
  $("#avatarForm").addEventListener("input", (e) => { const c = e.target.dataset.c; if (c) { spec[c] = e.target.value; if (av) av.setSpec(spec); clearTimeout(saveT); saveT = setTimeout(changed, 250); } });
  $("#avatarForm").addEventListener("change", (e) => { const t = e.target.dataset.t; if (t) { spec[t] = e.target.checked; changed(); } });
  let talkTimer = 0;
  $(".poses").onclick = (e) => {
    const p = e.target.closest("button"); if (!p || !av) return;
    clearInterval(talkTimer); av.talk(0);
    if (p.dataset.pose === "talk" || p.dataset.pose === "gesture") { if (p.dataset.pose === "gesture") av.mood("gesture", 3); let n = 0; talkTimer = setInterval(() => { av.talk(Math.random() < 0.25 ? 0.05 : 0.35 + Math.random() * 0.65); if (++n > 30) { clearInterval(talkTimer); av.talk(0); } }, 90); }
    else av.mood(p.dataset.pose, 2.6);
  };
  // 照片 + 吸颜色 + 标五官
  let pickKey = null, markKey = null, photoImg = null, photoK = 1, marks = {}, faceImg = null;
  function drawPhoto() {
    const cv = $("#photoCv"), g = cv.getContext("2d");
    g.drawImage(photoImg, 0, 0, cv.width, cv.height);
    for (const [k, p] of Object.entries(marks)) {
      const x = p[0] * photoK, y = p[1] * photoK;
      g.strokeStyle = "#22d3ee"; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(x - 11, y); g.lineTo(x + 11, y); g.moveTo(x, y - 11); g.lineTo(x, y + 11); g.stroke();
    }
    $$("#marks button").forEach((b) => b.classList.toggle("done", !!marks[b.dataset.mark]));
  }
  function showPhoto(url) {
    if (!url) { photoImg = null; $("#photoCv").hidden = true; $("#photoEmpty").hidden = false; return Promise.resolve(null); }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cv = $("#photoCv"), box = $("#photoBox"), k = Math.min(box.clientWidth / img.width, box.clientHeight / img.height, 1);
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        photoImg = img; photoK = k; cv.hidden = false; $("#photoEmpty").hidden = true;
        drawPhoto(); resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
  // 自动认：五官的三个点、发型、头发和上衣的颜色（MediaPipe，本机）。认不出来就退回让老师点三下
  const BANGS_T = Object.fromEntries(BANGS), HAIR_T = Object.fromEntries(HAIR);
  let lastHair = null;
  async function autoFace(img, back) {
    if (!img || !window.LaoVision) return false;
    $("#faceHint").textContent = "正在认脸和发型……（第一次要几秒钟）";
    let r;
    try { r = await window.LaoVision.analyzePhoto(img); } catch (e) { r = { ok: false, error: "认脸的组件没加载上：" + e.message }; }
    if (!r.ok) {
      markKey = "e1"; $$(".dropper button").forEach((b) => b.classList.toggle("on", b.dataset.mark === "e1")); $("#dropHint").textContent = "现在点照片上的「一只眼睛」";
      $("#faceHint").textContent = (r.error || "没认出脸") + "。可以在照片上依次点：一只眼睛、另一只眼睛、嘴巴中间。";
      return false;
    }
    marks = { e1: r.marks.e1, e2: r.marks.e2, mouth: r.marks.mouth }; drawPhoto();
    let h = r.hair;
    if (back && h && h.ok) h = window.LaoVision.mergeHair(h, back);
    lastHair = h;
    let said = "";
    if (h && h.ok && spec.faceStyle !== "ai3d" && spec.faceStyle !== "real") {
      spec.hairStyle = h.style; spec.bangs = h.bangs; if (h.color) spec.hair = h.color; if (h.top) spec.top = h.top;
      said = `认出来：${h.text}。公仔的发型选了「${HAIR_T[h.style] || h.style}」、刘海选了最接近的「${BANGS_T[h.bangs] || h.bangs}」，头发和上衣的颜色照着照片取了（不对就在右边改）。`;
    }
    await buildFace();
    const notes = [...(r.notes || []), ...((h && h.notes) || [])];
    $("#faceHint").textContent = (said || "五官找好了。") + (notes.length ? " 注意：" + notes.join("；") + "。" : "") + " 点的位置不准可以在照片上重新点。";
    return true;
  }
  // 三个点都标好了：做脸（转正、卡通化）、取皮肤色、存起来、换到形象上
  async function buildFace() {
    if (!photoImg || !marks.e1 || !marks.e2 || !marks.mouth || !window.LaoFace) return;
    const [eyeL, eyeR] = [marks.e1, marks.e2].sort((a, b) => a[0] - b[0]);
    $("#faceHint").textContent = "正在做脸…";
    await new Promise((r) => setTimeout(r, 30));
    if (lineFace()) {
      // 公仔风 / 屏幕脸：从照片里量出眉毛、眼睛、嘴的形状和特点（两眼距离、眉毛走向、嘴的宽度和笑的弧度），照着画到脸上（照片本身不贴上去）
      const r = window.LaoFace.analyze(photoImg, { eyeL, eyeR, mouth: marks.mouth });
      marks = { e1: r.marks.eyeL, e2: r.marks.eyeR, mouth: marks.mouth }; drawPhoto();
      spec.faceLines = r.lines; spec.photoFace = true;
      const pv = $("#facePrev"); pv.hidden = false; drawFacePrev(pv);
      const what = spec.faceStyle === "doll" ? "公仔脸" : "屏幕脸";
      const fd = r.found, miss = [!(fd.brows >= 2) && "眉毛", !(fd.eyes >= 2) && "眼睛", !fd.mouth && "嘴"].filter(Boolean);
      $("#faceHint").textContent = miss.length
        ? `${what}做好了。照片里的${miss.join("、")}没量清楚（可能被头发、眼镜挡住或者光线太暗），先用了默认的形状；换一张正脸、光线均匀的照片会更像。`
        : `${what}做好了：眉毛、眼睛、嘴的形状都是从你的照片里量出来的。标得不准可以再点一次重新标。`;
      try { const pb = await new Promise((res) => pv.toBlob(res, "image/png")); await call("saveFace", new Uint8Array(await pb.arrayBuffer()), marks); } catch {}
      if (av) av.setSpec(spec);
      changed();
      return;
    }
    const f = window.LaoFace.make(photoImg, { eyeL, eyeR, mouth: marks.mouth }, { style: spec.faceStyle || "cyber" });
    marks = { e1: f.marks.eyeL, e2: f.marks.eyeR, mouth: marks.mouth }; drawPhoto();   // 眼睛的点吸到了瞳孔中心
    const blob = await new Promise((r) => f.canvas.toBlob(r, "image/png"));
    await call("saveFace", new Uint8Array(await blob.arrayBuffer()), marks);
    faceImg = f.canvas; spec.skin = f.skin; spec.photoFace = true;
    const pv = $("#facePrev"); pv.hidden = false; const pg = pv.getContext("2d"); pg.imageSmoothingQuality = "high"; pg.drawImage(f.canvas, 0, 0, 96, 96);
    $("#faceHint").textContent = f.small
      ? `脸做好了。不过照片里的脸比较小（两只眼睛之间只有 ${Math.round(Math.hypot(eyeR[0] - eyeL[0], eyeR[1] - eyeL[1]))} 个像素），放大后会有点糊——换一张离得近、更清楚的正脸照效果会好很多。`
      : "脸做好了，右边的形象换上了你的脸。标得不准可以再点一次重新标。";
    if (av) av.setFace(faceImg, spec);
    changed();
  }
  // 小预览：公仔脸画在一个皮肤色的圆上，屏幕脸画面罩
  function drawFacePrev(pv) {
    const g = pv.getContext("2d"), n = pv.width, P = window.LaoAvatar.sanitize(spec);
    if (spec.faceStyle !== "doll") { window.LaoAvatar.drawScreen(g, n, P, { t: 1 }); return; }
    const c = document.createElement("canvas"); c.width = c.height = n * 2; window.LaoAvatar.drawDollFace(c.getContext("2d"), n * 2, P, {});
    g.clearRect(0, 0, n, n); g.fillStyle = spec.skin; g.beginPath(); g.arc(n / 2, n / 2, n / 2, 0, Math.PI * 2); g.fill();
    g.drawImage(c, n * 0.36, n * 0.46, n * 1.28, n * 1.28, 0, 0, n, n);   // 只取五官那一块，放大一点
  }
  $("#pickPhoto").onclick = guard(async () => {
    if (!(await ensureConsent())) return;
    const u = await call("pickPhoto"); if (!u) return;
    marks = {}; const img = await showPhoto(u);
    await autoFace(img);
  });
  $("#marks").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; if (!photoImg) return toast("先上传一张照片"); markKey = b.dataset.mark; pickKey = null; $$(".dropper button").forEach((x) => x.classList.toggle("on", x.dataset.mark === markKey)); $("#dropHint").textContent = `现在点照片上的「${b.textContent.trim()}」`; };
  $$(".dropper")[0].onclick = (e) => { const b = e.target.closest("button"); if (!b) return; markKey = null; pickKey = pickKey === b.dataset.pick ? null : b.dataset.pick; $$(".dropper button").forEach((x) => x.classList.toggle("on", !!pickKey && x.dataset.pick === pickKey)); $("#dropHint").textContent = pickKey ? `现在点照片上的「${b.textContent.trim()}」` : "先点上面一个部位，再点照片上对应的地方"; };
  $("#photoCv").onclick = guard(async (e) => {
    const cv = e.currentTarget, r = cv.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * cv.width), y = Math.round(((e.clientY - r.top) / r.height) * cv.height);
    if (markKey) {
      marks[markKey] = [x / photoK, y / photoK];
      const next = ["e1", "e2", "mouth"].find((k) => !marks[k]);
      markKey = next || null; $$(".dropper button").forEach((b) => b.classList.toggle("on", b.dataset.mark === markKey));
      $("#dropHint").textContent = next ? `现在点照片上的「${$(`#marks [data-mark="${next}"]`).textContent}」` : "先点上面一个部位，再点照片上对应的地方";
      drawPhoto();
      if (!next) await buildFace();
      return;
    }
    if (!pickKey) return toast("先在下面点一个部位（头发、皮肤……），或者标五官");
    const d = cv.getContext("2d").getImageData(Math.max(0, x - 3), Math.max(0, y - 3), 7, 7).data;
    let R = 0, G = 0, B = 0, n = 0; for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
    spec[pickKey] = "#" + [R, G, B].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("");
    changed();
  });
  // 导出成捞捞编程的皮肤（脸缩小成 256×256 的 jpg 一起放进去）
  $("#exportSkin").onclick = guard(async () => {
    let faceImage;
    if (spec.faceStyle === "ai3d") toast("捞捞编程的皮肤里放不下 AI 生成的 3D 模型，导出的是公仔风");
    if (faceImg && spec.photoFace !== false && !lineFace()) { const c = document.createElement("canvas"); c.width = c.height = 256; const cg = c.getContext("2d"); cg.imageSmoothingQuality = "high"; cg.drawImage(faceImg, 0, 0, 256, 256); faceImage = c.toDataURL("image/jpeg", 0.85); if (faceImage.length > 58000) faceImage = c.toDataURL("image/jpeg", 0.7); }
    const r = await call("exportSkin", { ...spec, faceImage });
    toast("存好了：" + r.file + "（在捞捞编程「画出来」→「皮肤」→「导入皮肤文件」里选它）");
    call("reveal", r.file);
  });

  // ---------- 授权（用人脸、声音之前）----------
  function paintConsent() {
    const c = S.consent, el = $("#consentSt");
    el.className = "consent-st" + (c ? " ok" : "");
    el.innerHTML = c ? `✓ 已授权：${c.who === "other" ? `用 <b>${esc(c.name)}</b> 的照片、视频、声音（已取得本人书面同意）` : "用<b>我自己</b>的照片、视频、声音"}（${esc(String(c.at).slice(0, 10))}）。全部只在这台电脑上处理。`
      : "用照片、视频、声音之前，要先同意「人脸和声音的授权」（只能用你自己的，或者取得本人书面同意的）。";
    $("#consentOpen").textContent = c ? "查看授权" : "阅读并同意授权";
  }
  // 没同意过就弹出来；同意了返回 true
  function ensureConsent() {
    if (S.consent) return Promise.resolve(true);
    const d = $("#consentDlg");
    $("#consentAgree").checked = false; $("#consentWritten").checked = false;
    return new Promise((resolve) => {
      d.onclose = guard(async () => {
        if (d.returnValue !== "ok") return resolve(false);
        const who = ($$("#consentDlg input[name=who]").find((x) => x.checked) || {}).value || "self";
        try { S.consent = await call("saveConsent", { who, name: $("#consentName").value, written: $("#consentWritten").checked, agree: $("#consentAgree").checked }); paintConsent(); resolve(true); }
        catch (e) { resolve(false); throw e; }
      });
      d.returnValue = ""; d.showModal();
    });
  }
  $("#consentDlg").addEventListener("change", (e) => { if (e.target.name === "who") $("#consentOther").hidden = e.target.value !== "other"; });
  $("#consentOk").onclick = (e) => { if (!$("#consentAgree").checked) { e.preventDefault(); toast("要先勾上「我已阅读并同意以上内容」", true); } };
  $("#consentOpen").onclick = () => { if (S.consent) $("#lawDlg").showModal(); else ensureConsent(); };
  let clearArm = 0;
  $("#bioClear").onclick = guard(async () => {
    const b = $("#bioClear");
    if (Date.now() - clearArm > 5000) { clearArm = Date.now(); b.textContent = "再点一次：确认全部删掉"; b.classList.add("danger"); setTimeout(() => { b.textContent = "清除我的照片、视频和声音"; b.classList.remove("danger"); }, 5000); return; }
    clearArm = 0; await call("clearBiometrics");
    S = await call("state"); spec = { ...DEFAULT, ...(S.profile.avatar || {}) }; faceImg = null; marks = {}; aiBytes = null; vid = null;
    $("#facePrev").hidden = true; await showPhoto(null); paintConsent(); paintVoice(); paintVid(); showReal(); changed(); guard(paintAi)();
    b.textContent = "清除我的照片、视频和声音"; b.classList.remove("danger");
    toast("都删掉了，授权也撤回了");
  });

  // ---------- 上传一段视频：自动挑正脸 / 侧脸 / 后脑勺，截配音，做真人模板 ----------
  // vid：{ info, frames: [{ i, t, face, person, headHair, url }], pick: { front, left, right, back }（帧号）, cands: { 同上: [帧号…] }, voice: [t0, t1], template, back }
  let vid = null;
  const vidBusy = (on, msg, p) => { $("#vidProg").hidden = !on; if (msg) $("#vidMsg").textContent = msg; if (p != null) $("#vidBar").style.width = Math.round(p * 100) + "%"; $("#pickVideo").disabled = on; $("#vidUse").disabled = on; };
  const VIEWS = [["front", "正脸"], ["left", "侧脸（一边）"], ["right", "侧脸（另一边）"], ["back", "后脑勺"]];
  function wavOf(bytes) {   // 只认我们自己转的 16 位单声道 wav
    const b = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let off = 12, rate = 32000, data = null;
    while (off + 8 <= b.byteLength) { const id = String.fromCharCode(b.getUint8(off), b.getUint8(off + 1), b.getUint8(off + 2), b.getUint8(off + 3)), size = b.getUint32(off + 4, true); if (id === "fmt ") rate = b.getUint32(off + 12, true); if (id === "data") { data = [off + 8, Math.min(size, b.byteLength - off - 8)]; break; } off += 8 + size + (size & 1); }
    if (!data) return null;
    const n = data[1] >> 1, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = b.getInt16(data[0] + i * 2, true) / 32768;
    return { rate, x };
  }
  function wavBlob(x, rate) {
    const n = x.length, b = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); b.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, rate, true); b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, "data"); b.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), true);
    return new Blob([b.buffer], { type: "audio/wav" });
  }
  async function analyzeVideo(info) {
    const V = window.LaoVision; if (!V) throw new Error("认脸的组件没加载上");
    const frames = [], step = info.n > 160 ? 2 : 1;
    vidBusy(true, "准备认脸的组件……", 0); await V.ready();
    // 第一遍：每一帧找脸、算朝向和清晰度
    for (let i0 = 0; i0 < info.n; i0 += 16) {
      const batch = await call("videoFrames", i0, 16);
      for (const f of batch) {
        if ((f.i % step) !== 0) continue;
        const blob = new Blob([f.jpg], { type: "image/jpeg" });
        const r = await V.analyzeFrame(blob);
        frames.push({ i: f.i, t: f.t, face: r.face, person: r.person, blob, url: URL.createObjectURL(blob) });
        vidBusy(true, `认脸：第 ${f.i + 1}/${info.n} 帧`, 0.05 + 0.6 * (f.i / info.n));
      }
    }
    const byScore = (arr, sc) => arr.map((f) => ({ f, s: sc(f) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.f.i);
    const cands = {
      front: byScore(frames, (f) => V.frameScore(f)),
      left: byScore(frames, (f) => (f.face && f.face.yaw > 30 ? f.face.yaw * Math.log(1 + f.face.sharp) : 0)),
      right: byScore(frames, (f) => (f.face && f.face.yaw < -30 ? -f.face.yaw * Math.log(1 + f.face.sharp) : 0)),
    };
    if (!cands.front.length) throw new Error("视频里没找到清楚的正脸（正对镜头、光线亮一点再拍一段）");
    const F = (i) => frames.find((f) => f.i === i);
    // 正脸那一帧认发型（拿到头发颜色），再用头发颜色找后脑勺：看不到脸、头顶那一块大部分是头发的帧
    vidBusy(true, "认发型……", 0.7);
    const front = await V.analyzePhoto(F(cands.front[0]).blob);
    const hc = front.ok && front.hair && front.hair.color;
    const noFace = frames.filter((f) => !f.face && f.person > 0.04);
    for (const [k, f] of noFace.entries()) { if (hc) f.headHair = (await V.analyzeFrame(f.blob, hc)).headHair; vidBusy(true, `找后脑勺：${k + 1}/${noFace.length}`, 0.72 + 0.15 * (k / Math.max(1, noFace.length))); }
    cands.back = byScore(noFace, (f) => (f.headHair > 0.5 ? f.headHair * f.person : 0));
    let back = null;
    if (cands.back.length && hc) { back = await V.hairBackOf(F(cands.back[0]).blob, hc); }
    // 配音参考：整段声音里挑 3～10 秒连着说话的一段（开头说的那句）
    let voice = null, audio = null;
    if (info.audio) { const ab = await call("videoAudio"); audio = ab && wavOf(ab); if (audio) voice = V.speechSpan(audio.x, audio.rate); }
    // 真人模板：最长一段一直正对镜头（左右、上下都不超过 15°）的帧，2.5～10 秒
    let run = [], best = [];
    for (const f of frames) { const ok = f.face && Math.abs(f.face.yaw) < 15 && Math.abs(f.face.pitch) < 18; if (ok) run.push(f); else { if (run.length > best.length) best = run; run = []; } }
    if (run.length > best.length) best = run;
    let template = null;
    const fps = info.fps || 4;
    if (best.length / fps * step >= 2.5) {
      const span = best.slice(0, Math.round(10 * fps / step)), im = await createImageBitmap(span[0].blob), W = im.width, Hh = im.height; im.close();
      const bx = span.map((f) => f.face.box), mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;   // face.box 是抽出来的帧上的像素
      const fcx = mean(bx.map((b) => (b[0] + b[2]) / 2)), fcy = mean(bx.map((b) => (b[1] + b[3]) / 2)), fw = mean(bx.map((b) => b[2] - b[0]));
      const w = Math.min(1, Math.max(0.2, (fw * 3.2) / W)), cropH = Math.min(Hh, w * W * 16 / 9);
      template = { t0: Math.max(0, span[0].t - 0.12), t1: span[span.length - 1].t + 0.12, cx: fcx / W, cy: Math.min(1, (fcy + 0.12 * cropH) / Hh), w };
    }
    return { info, frames, cands, pick: { front: cands.front[0], left: cands.left[0], right: cands.right[0], back: cands.back[0] }, voice, audio, template, back, front };
  }
  function paintVid() {
    const has = !!vid;
    $("#vidViews").hidden = !has; $("#vidUseRow").hidden = !has; $("#vidVoice").hidden = !(has && vid.voice);
    if (!has) { $("#vidHint").textContent = S && S.video ? `上次上传的视频（${S.video.seconds} 秒）已经用上了。` + (S.video.template ? "真人数字人的模板也做好了。" : "") : ""; return; }
    const F = (i) => vid.frames.find((f) => f.i === i);
    $("#vidViews").innerHTML = VIEWS.map(([k, t]) => {
      const i = vid.pick[k], f = i != null ? F(i) : null, n = vid.cands[k].length, at = n ? vid.cands[k].indexOf(i) + 1 : 0;
      return `<div class="vid-view" data-k="${k}"><div class="ph${f ? "" : " none"}" style="${f ? `background-image:url(${f.url})` : ""}">${f ? "" : "没找到"}</div><b>${t}</b>` +
        (n > 1 ? `<div class="nav"><button data-d="-1">‹</button><span>${at}/${n}</span><button data-d="1">›</button></div>` : `<div class="nav">${f ? f.t.toFixed(1) + " 秒" : ""}</div>`) + `</div>`;
    }).join("");
    if (vid.voice && vid.audio) {
      const [a, b] = vid.voice, r = vid.audio.rate;
      if (vid.voiceUrl) URL.revokeObjectURL(vid.voiceUrl);
      vid.voiceUrl = URL.createObjectURL(wavBlob(vid.audio.x.subarray(Math.floor(a * r), Math.floor(b * r)), r));
      $("#vidAudio").src = vid.voiceUrl; $("#vidVoiceMeta").textContent = `${a.toFixed(1)}～${b.toFixed(1)} 秒，共 ${(b - a).toFixed(1)} 秒`;
      if (!$("#vidText").value) $("#vidText").value = $("#vidLine").textContent;
    }
    const h = vid.front && vid.front.hair, notes = [];
    if (h && h.ok) notes.push("发型：" + (vid.back && vid.back.ok ? window.LaoVision.mergeHair(h, vid.back).text : h.text));
    if (!vid.cands.back.length) notes.push("没找到背对镜头的那一段（看不到后面的发型）");
    if (!vid.voice) notes.push(vid.info.audio ? "没找到连着说 3 秒以上的声音（配音参考还用原来的）" : "视频没有声音");
    notes.push(vid.template ? `真人数字人的模板：${vid.template.t0.toFixed(1)}～${vid.template.t1.toFixed(1)} 秒（一直正对镜头的那段）` : "没找到连着 2.5 秒以上正对镜头的一段，做不了真人数字人的模板");
    $("#vidHint").textContent = notes.join("；") + "。每一张都可以点 ‹ › 换。";
  }
  $("#vidViews").onclick = (e) => {
    const b = e.target.closest("button[data-d]"); if (!b || !vid) return;
    const k = b.closest(".vid-view").dataset.k, c = vid.cands[k]; if (!c.length) return;
    vid.pick[k] = c[(c.indexOf(vid.pick[k]) + +b.dataset.d + c.length) % c.length];
    paintVid();
  };
  $("#pickVideo").onclick = guard(async () => {
    if (!(await ensureConsent())) return;
    vidBusy(true, "读视频……", 0);
    try {
      const info = await call("pickVideo"); if (!info) return;
      if (vid) vid.frames.forEach((f) => URL.revokeObjectURL(f.url));
      vid = await analyzeVideo(info);
      paintVid();
      toast("挑好了：看一眼下面的几张，点「用这些」");
      $("#vidCard").scrollIntoView({ behavior: "smooth", block: "start" });
    } finally { vidBusy(false); }
  });
  $("#vidUse").onclick = guard(async () => {
    if (!vid) return;
    const F = (i) => (i != null ? vid.frames.find((f) => f.i === i) : null), t = (k) => (F(vid.pick[k]) ? F(vid.pick[k]).t : undefined);
    vidBusy(true, "存照片、截声音、做模板……", 0.3);
    try {
      const r = await call("videoUse", { front: t("front"), views: { left: t("left"), right: t("right"), back: t("back") }, voice: vid.voice, text: $("#vidText").value.trim(), template: vid.template });
      S = await call("state");
      const back = vid.back && vid.back.ok ? vid.back : null;
      marks = {}; const img = await showPhoto(r.photo); await autoFace(img, back);
      paintVoice(); showReal(); markDone();
      toast("用上了：正脸当照片、" + (r.voice ? "声音当配音参考、" : "") + (r.template ? "真人模板也做好了" : "侧脸和后脑勺给 AI 3D 形象参考"));
    } finally { vidBusy(false); }
  });
  // 真人数字人：组件、预览
  let realUrl = null;
  async function showReal() {
    const on = spec.faceStyle === "real";
    let v = $("#realStage");
    if (!on) { if (v) v.remove(); $("#avStage").hidden = false; }
    const has = S && S.talk && S.talk.template;
    if (has && !realUrl) { const b = await call("videoTemplate"); if (b) realUrl = URL.createObjectURL(new Blob([b], { type: "video/mp4" })); }
    if (!has && realUrl) { URL.revokeObjectURL(realUrl); realUrl = null; }
    const pv = $("#realPrev"); pv.hidden = !realUrl; if (realUrl && pv.src !== realUrl) { pv.src = realUrl; pv.play().catch(() => {}); }
    if (on) {
      $("#avStage").hidden = true;
      if (!v) { v = document.createElement("video"); v.id = "realStage"; v.className = "real-stage"; v.muted = true; v.loop = true; v.playsInline = true; $(".stage-card").prepend(v); }
      if (realUrl) { v.src = realUrl; v.play().catch(() => {}); } else v.removeAttribute("src");
      if (!realUrl) toast("还没有真人模板：在下面「用一段视频做」里上传一段视频");
    }
    const c = S && S.talk && S.talk.check;
    $("#talkSt").textContent = c ? (c.ok ? "组件齐了。" : "还缺组件，点「安装真人数字人组件」。") : (S && S.talk && S.talk.template ? "模板做好了；组件装好就能用。" : "先上传一段视频。");
  }
  let talkProg = null;   // 正在生成的那一段的进度回调
  window.cc.on("talk", (m) => { if (talkProg) talkProg(m); });
  window.cc.on("ai3d", (m) => { if (m.stage === "talk-setup" && !$("#vidProg").hidden) vidBusy(true, m.msg, m.p); });
  $("#talkSetup").onclick = guard(async () => {
    vidBusy(true, "安装真人数字人组件（要下载约 5G，几分钟到几十分钟）……", 0.05);
    try { await call("talkSetup"); S = await call("state"); showReal(); toast("真人数字人的组件装好了"); } finally { vidBusy(false); }
  });

  // ---------- AI 生成 3D 形象 ----------
  let aiBytes = null, aiS = null, aiPts = [], aiShotImg = null;
  // 把 AI 模型读进预览（第一次用、或者刚重新生成过）
  async function ensureAi(force) {
    if (force || !aiBytes) aiBytes = await call("ai3dModel");
    if (!aiBytes) { toast("还没有 AI 3D 形象：在下面「AI 生成 3D 形象」里先生成一个"); return false; }
    if (av && (force || !av.hasAi)) { $("#aiMsg").textContent = "读模型……"; await av.setAi(aiBytes, spec); av.mood("wave", 2); }
    return true;
  }
  const aiBusy = (on, msg) => { $("#aiProg").hidden = !on; if (msg) $("#aiMsg").textContent = msg; for (const b of $$("#aiCard button:not(#aiCancel)")) b.disabled = on; };
  window.cc.on("ai3d", (m) => {
    if (m.p != null) $("#aiBar").style.width = Math.round(m.p * 100) + "%";
    if (m.msg) $("#aiMsg").textContent = (m.stage ? { check: "检查环境", setup: "安装组件", stylize: "画立绘", to3d: "生成 3D", rig: "绑骨骼", face: "做脸" }[m.stage] + "：" : "") + m.msg;
    if (m.cand) guard(paintAi)();
  });
  async function paintAi() {
    aiS = await call("ai3dState");
    const c = aiS.check, rt = aiS.rt;
    $("#aiSetup").disabled = !aiS.dir;
    let env = "还没选整合包。";
    if (aiS.dir) {
      env = "整合包：" + aiS.dir + (rt && rt.ok ? "" : "（" + ((rt && rt.error) || "不能用") + "）");
      if (c) {
        const g = c.gpu || {};
        env += "\n" + (g.cuda ? `显卡：${g.name}，显存 ${g.vram}G` : "没找到 NVIDIA 显卡（生成那两步用不了，绑骨骼可以）") + `；内存 ${c.ram}G；Python ${c.python}`;
        env += c.need && c.need.length ? "\n还缺：" + c.need.join("、") + "（点「安装缺的组件」）" : "\n组件齐了。";
      }
    }
    $("#aiEnv").textContent = env;
    const st = $("#aiStyleImg"); st.hidden = !aiS.style; if (aiS.style) st.src = aiS.style;
    const fg = $("#aiFigImg"); fg.hidden = !aiS.figure; if (aiS.figure) fg.src = aiS.figure;
    $("#aiCands").innerHTML = aiS.cands.map((u, i) => `<img src="${u}" data-i="${i}" title="用这一张">`).join("");
    const w = (aiS.model && aiS.model.warn) || [];
    $("#aiWarn").textContent = aiS.model ? `模型做好了（${(aiS.model.size / 1048576).toFixed(1)}MB）。` + (w.length ? "注意：" + w.join("；") : "") + " 上面「脸的样子」选「AI 3D 形象」就用上了。" : "";
    if (aiS.job && aiS.job.busy) aiBusy(true, "正在做：" + aiS.job.cmd);
    const shot = aiS.model ? await call("ai3dShot") : null;
    const cv = $("#aiShot");
    if (shot) {
      aiShotImg = await new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = shot.marked; });
      if (aiShotImg) { cv.hidden = false; cv.width = aiShotImg.width; cv.height = aiShotImg.height; drawShot(); }
    } else cv.hidden = true;
  }
  function drawShot() {
    const cv = $("#aiShot"), g = cv.getContext("2d");
    if (!aiShotImg) return;
    g.drawImage(aiShotImg, 0, 0);
    aiPts.forEach((p, i) => { g.strokeStyle = i < 2 ? "#22d3ee" : "#f43f5e"; g.lineWidth = Math.max(2, cv.width / 150); g.beginPath(); g.arc(p[0], p[1], cv.width / 40, 0, Math.PI * 2); g.stroke(); });
    $("#aiFaceFix").disabled = aiPts.length < 3;
    $("#aiShotHint").textContent = aiPts.length < 3 ? `框不对就在图上依次点：${["一只眼睛", "另一只眼睛", "嘴"][aiPts.length]}` : "点好了，点「按点的位置重做脸」";
  }
  $("#aiShot").onclick = (e) => {
    const cv = e.currentTarget, r = cv.getBoundingClientRect();
    if (aiPts.length >= 3) aiPts = [];
    aiPts.push([Math.round(((e.clientX - r.left) / r.width) * cv.width), Math.round(((e.clientY - r.top) / r.height) * cv.height)]);
    drawShot();
  };
  // 一件事：按钮变灰、进度条，做完刷新；用了新模型就重新读进预览
  const aiDo = (fn, msg) => guard(async () => {
    aiBusy(true, msg); $("#aiBar").style.width = "0%";
    try { return await fn(); } finally { aiBusy(false); await paintAi(); }
  });
  $("#aiDir").onclick = aiDo(async () => { await call("ai3dPickDir"); }, "检查环境……");
  $("#aiSetup").onclick = aiDo(async () => { await call("ai3dSetup"); toast("组件装好了"); }, "安装组件（要下载，几分钟到几十分钟）……");
  $("#aiStyle").onclick = guard(async () => { await call("ai3dPickStyle"); await paintAi(); });
  $("#aiFigure").onclick = guard(async () => { if (await call("ai3dPickFigure")) { await paintAi(); toast("好了，下一步点「生成 3D 形象」"); } });
  $("#aiStylize").onclick = aiDo(async () => { await call("ai3dStylize", { n: $("#aiN").value, quality: $("#aiQ").value, clothes: $("#aiClothes").value }); toast("画好了，点一张最像的"); }, "画立绘……");
  $("#aiCands").onclick = guard(async (e) => { const im = e.target.closest("img"); if (!im) return; await call("ai3dChoose", im.dataset.i); $$("#aiCands img").forEach((x) => x.classList.toggle("on", x === im)); await paintAi(); toast("选好了，下一步点「生成 3D 形象」"); });
  const useNew = async () => { aiBytes = null; aiPts = []; spec.faceStyle = "ai3d"; if (await ensureAi(true)) changed(); };
  $("#aiBuild").onclick = aiDo(async () => { await call("ai3dBuild", { quality: $("#aiQ3").value }); await useNew(); toast("3D 形象做好了"); }, "生成 3D 形象……");
  $("#aiRig").onclick = aiDo(async () => { await call("ai3dRig"); await useNew(); toast("重新绑好了"); }, "绑骨骼……");
  $("#aiFaceFix").onclick = aiDo(async () => { const [e1, e2, mouth] = aiPts; await call("ai3dFace", { e1, e2, mouth }); await useNew(); toast("脸重新做好了"); }, "按点的位置重做脸……");
  $("#aiCancel").onclick = guard(async () => { await call("ai3dCancel"); });
  $("#aiCard").addEventListener("click", (e) => { const a = e.target.closest("[data-aipage]"); if (a) { e.preventDefault(); call("ai3dOpenPage", a.dataset.aipage); } });

  // ---------- ② 我的声音 ----------
  function paintVoice() {
    const v = S.voice;
    $("#voiceMeta").textContent = v ? `已上传，${v.seconds} 秒${v.seconds < 3 ? "（太短了，要 3 秒以上）" : ""}` : "还没有";
    $("#voiceAudio").hidden = !v; if (v) $("#voiceAudio").src = v.url;
    $("#voicePrompt").value = v ? v.prompt : "";
    $("#gsvDir").textContent = S.profile.gsvDir || "还没选";
    paintEngine(S.engine);
  }
  function paintEngine(e) {
    const st = (e && e.state) || "off", el = $("#engState");
    el.textContent = { off: "没启动", starting: "启动中…", ready: "已就绪", error: "出错了" }[st] || st;
    el.className = "pill " + ({ ready: "ok", error: "err", starting: "busy" }[st] || "");
    if (e && e.error) { $("#engLog").hidden = false; $("#engLog").textContent = e.error; }
  }
  window.cc.on("voice", (e) => { S.engine = e; paintEngine(e); });
  $("#pickVoice").onclick = guard(async () => { const v = await call("pickVoice"); if (!v) return; S.voice = v; paintVoice(); toast(v.short ? "录音太短了，最好 3～10 秒" : "录音好了，别忘了在下面写上这段话说的是什么"); $("#voicePrompt").focus(); });
  $("#voicePrompt").onchange = guard(async () => { await call("setVoicePrompt", $("#voicePrompt").value); S.voice.prompt = $("#voicePrompt").value; markDone(); });
  $("#gsvPage").onclick = (e) => { e.preventDefault(); call("openGsvPage"); };
  $("#pickGsv").onclick = guard(async () => { const d = await call("pickGsvDir"); if (d) { S.profile.gsvDir = d; paintVoice(); } });
  $("#engStart").onclick = guard(async () => {
    $("#engLog").hidden = false; $("#engLog").textContent = "正在启动 GPT-SoVITS…";
    const poll = setInterval(async () => { const s = await call("voiceState"); if (s.log && s.log.length) $("#engLog").textContent = s.log.join("\n"); }, 1500);
    try { S.engine = await call("voiceStart"); paintEngine(S.engine); toast("老师的声音准备好了"); } finally { clearInterval(poll); }
  });
  $("#engStop").onclick = guard(async () => { S.engine = await call("voiceStop"); paintEngine(S.engine); });
  $("#trySay").onclick = guard(async () => {
    const b = $("#trySay"); b.disabled = true; $("#tryMeta").textContent = "生成中…";
    try { const r = await call("synth", "try", $("#tryText").value); $("#tryAudio").hidden = false; $("#tryAudio").src = await call("previewAudio", "try"); $("#tryAudio").play().catch(() => {}); $("#tryMeta").textContent = `${(r.ms / 1000).toFixed(1)} 秒`; }
    finally { b.disabled = false; if ($("#tryMeta").textContent === "生成中…") $("#tryMeta").textContent = ""; }
  });

  // ---------- ③ 选页和内容 ----------
  const P = (no) => { if (!plan.has(no)) plan.set(no, { on: false, narration: "", qa: [], drafted: false }); return plan.get(no); };
  $("#openPpt").onclick = guard(async () => {
    const r = await call("openPpt"); if (!r) return;
    doc = r; plan.clear(); cur = (r.info.slides.find((s) => !s.hidden) || r.info.slides[0] || {}).no || 0;
    $("#pptName").textContent = r.file; $("#slidesGrid").hidden = false;
    if (r.info.slides.some((s) => s.laolao)) toast("这个 PPT 里已经加过捞捞形象了：最好用没加过的原文件", true);
    paintSlides(); paintEdit(); markDone();
  });
  function paintSlides() {
    $("#slideList").innerHTML = doc.info.slides.map((s) => {
      const p = P(s.no);
      return `<div class="sl${s.no === cur ? " cur" : ""}" data-no="${s.no}"><input type="checkbox" ${p.on ? "checked" : ""} ${s.hidden ? "disabled" : ""}><span class="no">${s.no}</span><div><b>${esc(s.title || "（没有标题）")}</b><small>${esc(s.texts.join(" ") || " ")}</small>${s.hidden ? '<span class="tag">隐藏页</span>' : ""}${s.laolao ? '<span class="tag">已经加过形象</span>' : ""}</div></div>`;
    }).join("");
  }
  async function draftInto(no) {
    const p = P(no), firstOn = [...plan.entries()].filter(([, x]) => x.on).map(([n]) => n).sort((a, b) => a - b)[0];
    const d = await call("draft", no, { first: firstOn === no });
    p.narration = d.narration; p.qa = d.qa.map((x) => ({ id: ++qaSeq, ...x })); p.drafted = true;
  }
  $("#slideList").onclick = guard(async (e) => {
    const row = e.target.closest(".sl"); if (!row) return;
    const no = +row.dataset.no;
    if (e.target.matches("input[type=checkbox]")) { const p = P(no); p.on = e.target.checked; if (p.on && !p.drafted) await draftInto(no); markDone(); }
    cur = no; paintSlides(); paintEdit();
  });
  async function recBadge(key) { return (await call("hasRecording", key)) ? `<span class="rec">✓ 用我自己的录音</span> <button class="btn sm" data-drop="${key}">不用录音了</button>` : `<button class="btn sm" data-rec="${key}">上传我录的这段</button>`; }
  async function paintEdit() {
    const s = doc && doc.info.slides.find((x) => x.no === cur); if (!s) return;
    const p = P(cur);
    if (!p.on) { $("#slideEdit").innerHTML = `<h2>第 ${s.no} 页：${esc(s.title || "（没有标题）")}</h2><div class="texts">${esc(s.texts.join("\n") || "（这一页没有文字）")}</div><p class="muted">${s.hidden ? "隐藏页不能加。" : "勾上左边的方框，这一页就加上老师形象。"}</p>`; return; }
    const nk = "n" + cur;
    $("#slideEdit").innerHTML =
      `<h2>第 ${s.no} 页：${esc(s.title || "（没有标题）")}</h2><div class="texts">${esc(s.texts.join("\n") || "（这一页没有文字）")}</div>` +
      `<div class="seg"><div class="seg-h"><b>讲解（进到这一页，形象自动开讲）</b><span class="grow"></span>${actSel("n", p.action)}${await recBadge(nk)}<button class="btn sm" id="reDraft">重新打草稿</button></div>` +
      `<textarea id="narr" rows="4" placeholder="不想讲就空着">${esc(p.narration)}</textarea></div>` +
      `<div class="seg"><div class="seg-h"><b>问答（页面上的问题按钮，点了形象回答）</b><span class="grow"></span><button class="btn sm" id="addQa">加一个问题</button></div>` +
      (await Promise.all(p.qa.map(async (q) => `<div class="qa" data-id="${q.id}"><div class="row"><input data-f="q" value="${esc(q.q)}" placeholder="问题（显示在按钮上，短一点）"><button class="btn sm danger" data-del="${q.id}">删掉</button></div><textarea data-f="a" rows="2" placeholder="回答（形象念出来，也显示在回答页上）">${esc(q.a)}</textarea><div class="row">${actSel("q" + q.id, q.action)}${await recBadge("q" + cur + "-" + q.id)}</div></div>`))).join("") +
      (p.qa.length ? "" : `<p class="muted">还没有问题。</p>`) + `</div>`;
  }
  $("#slideEdit").addEventListener("input", (e) => {
    const p = P(cur);
    if (e.target.id === "narr") p.narration = e.target.value;
    const box = e.target.closest(".qa"); if (box && e.target.dataset.f) { const q = p.qa.find((x) => x.id === +box.dataset.id); if (q) q[e.target.dataset.f] = e.target.value; }
  });
  $("#slideEdit").addEventListener("change", (e) => {
    const a = e.target.dataset.act; if (!a) return;
    const p = P(cur);
    if (a === "n") p.action = e.target.value; else { const q = p.qa.find((x) => "q" + x.id === a); if (q) q.action = e.target.value; }
  });
  $("#slideEdit").addEventListener("click", guard(async (e) => {
    const p = P(cur), b = e.target.closest("button"); if (!b) return;
    if (b.id === "reDraft") { const d = await call("draft", cur, {}); p.narration = d.narration; return paintEdit(); }
    if (b.id === "addQa") { p.qa.push({ id: ++qaSeq, q: "", a: "" }); await paintEdit(); const inp = $$("#slideEdit .qa input"); if (inp.length) inp[inp.length - 1].focus(); return; }
    if (b.dataset.del) { p.qa = p.qa.filter((x) => x.id !== +b.dataset.del); return paintEdit(); }
    if (b.dataset.rec) { if (await call("pickRecording", b.dataset.rec)) { toast("这一段就用你的录音了"); paintEdit(); } return; }
    if (b.dataset.drop) { await call("dropRecording", b.dataset.drop); return paintEdit(); }
  }));

  // ---------- ④ 生成 ----------
  function jobsOf() {
    const out = [];
    for (const [no, p] of [...plan.entries()].sort((a, b) => a[0] - b[0])) {
      if (!p.on) continue;
      const s = doc.info.slides.find((x) => x.no === no);
      if (p.narration.trim()) out.push({ key: "n" + no, no, kind: "讲解", text: p.narration.trim(), bg: s.bg, action: p.action || "auto" });
      for (const q of p.qa) if (q.q.trim() && q.a.trim()) out.push({ key: `q${no}-${q.id}`, no, kind: "回答", q: q.q.trim(), text: q.a.trim(), bg: "#ffffff", action: q.action || "auto" });
    }
    return out;
  }
  function paintJobs() {
    $("#optSide").value = S.profile.side || "right"; $("#optScale").value = S.profile.scale || 0.6; $("#optScaleV").textContent = Math.round(($("#optScale").value) * 100) + "% 页面高度";
    if (!doc) { $("#makeList").innerHTML = `<p class="muted">先在「选页和内容」里打开一个 PPT。</p>`; return; }
    const js = jobsOf();
    $("#makeList").innerHTML = js.length ? js.map((j) => `<div class="job" data-key="${j.key}"><span>第 ${j.no} 页<br><small class="muted">${j.kind}</small></span><span class="what">${esc(j.q ? "问：" + j.q + " — " : "")}${esc(j.text)}</span><span><span class="st">等着</span><div class="bar"><i></i></div></span><img alt=""></div>`).join("") : `<p class="muted">在「选页和内容」里勾上要加的页，写上讲解或问答。</p>`;
  }
  const saveLayout = guard(() => call("saveLayout", { side: $("#optSide").value, scale: +$("#optScale").value }).then(() => { S.profile.side = $("#optSide").value; S.profile.scale = +$("#optScale").value; }));
  $("#optSide").onchange = saveLayout;
  $("#optScale").oninput = () => { $("#optScaleV").textContent = Math.round($("#optScale").value * 100) + "% 页面高度"; };
  $("#optScale").onchange = saveLayout;

  const row = (key) => $(`.job[data-key="${key}"]`);
  const status = (key, t, cls = "", pct = null) => { const r = row(key); if (!r) return; const st = $(".st", r); st.textContent = t; st.className = "st " + cls; if (pct != null) $(".bar i", r).style.width = Math.round(pct * 100) + "%"; };

  // 这一段每一刻做什么动作（t 秒，一共 dur 秒）
  function moodAt(job, first, t, dur) {
    const a = job.action || "auto";
    if (a === "wave") return t < 2 ? "wave" : "gesture";
    if (a === "point") return t > dur * 0.12 && t < dur * 0.75 ? "point" : "gesture";
    if (a === "gesture") return "gesture";
    if (a === "nod") return t < 1.3 || t > dur - 1.4 ? "nod" : "gesture";
    if (a === "think") return t < 1.6 ? "think" : "gesture";
    // 自动：讲解——第一页先挥手、讲到一段指着幻灯片，其余比划；回答——先想一想，最后点头
    if (job.kind === "讲解") { if (first && t < 1.6) return "wave"; if (t > dur * 0.3 && t < dur * 0.6) return "point"; return "gesture"; }
    if (t < 1.1) return "think"; if (t > dur - 1.3) return "nod"; return "gesture";
  }
  const VW = 720, VH = 1280;   // 视频清晰度（竖着的 9:16，PPT 里放大也不糊）
  // 画一段视频：形象跟着声音说话（嘴跟着张合），按选的动作动
  async function renderVideo(job, seg, first, onP) {
    if (spec.faceStyle === "real") {   // 真人数字人：老师的视频模板 + 这一段配音 → 对口型（工坊里用显卡算）
      talkProg = (m) => { if (m.key === job.key && m.p != null) onP(m.p); };
      try { return await call("talkMake", job.key, { quality: "best" }); } finally { talkProg = null; }
    }
    const id = await call("videoBegin", job.key, { jpeg: true });
    const host = $("#offscreen"); host.innerHTML = "";
    const ai = spec.faceStyle === "ai3d" && aiBytes ? await window.LaoAvatar.loadAi(aiBytes) : null;   // 每段视频单独读一份 AI 模型
    const st = window.LaoAvatar.create(host, spec, { manual: true, capture: true, pixelRatio: 2, bg: parseInt(job.bg.slice(1), 16), width: VW, height: VH, face: faceImg, ai });
    // 先按两倍大画，再缩小成视频的大小（超采样）：边缘、头发、五官都更细腻
    const out = document.createElement("canvas"); out.width = VW; out.height = VH;
    const og = out.getContext("2d"); og.imageSmoothingQuality = "high";
    if (!st) throw new Error("这台电脑画不了 3D（显卡驱动太旧？）");
    const fps = 25, n = Math.ceil(seg.ms / (1000 / fps)) + 15, dur = n / fps;
    try {
      for (let f = 0; f < n; f++) {
        const t = f / fps;
        og.drawImage(st.frame(1 / fps, seg.levels[f] || 0, t > dur - 0.6 ? "idle" : moodAt(job, first, t, dur)), 0, 0, VW, VH);
        const cv = out;
        if (f === 0) { const pb = await new Promise((r) => cv.toBlob(r, "image/png")); await call("videoFrame", id, new Uint8Array(await pb.arrayBuffer()), true); }   // 封面
        const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.93));
        await call("videoFrame", id, new Uint8Array(await blob.arrayBuffer()));
        if (f % 5 === 0) onP(f / n);
      }
      return await call("videoEnd", id);
    } catch (e) { call("videoCancel", id); throw e; }
    finally { st.dispose(); host.innerHTML = ""; }
  }
  $("#makeGo").onclick = guard(async () => {
    if (!doc) throw new Error("先在「选页和内容」里打开一个 PPT");
    const js = jobsOf(); if (!js.length) throw new Error("没有要生成的内容：勾上页，写上讲解或问答");
    const btn = $("#makeGo"); btn.disabled = true; $("#makeDone").hidden = true;
    paintJobs();
    const firstKey = js.find((j) => j.kind === "讲解");
    let failed = 0;
    try {
      for (const j of js) {
        try {
          status(j.key, "配音中…", "", 0.05);
          const seg = await call("synth", j.key, j.text);
          status(j.key, "画视频…", "", 0.15);
          await renderVideo(j, seg, firstKey && firstKey.key === j.key, (p) => status(j.key, `画视频… ${Math.round(p * 100)}%`, "", 0.15 + p * 0.85));
          status(j.key, `好了（${(seg.ms / 1000).toFixed(1)} 秒）`, "ok", 1);
          const img = $("img", row(j.key)); if (img) img.src = await call("posterUrl", j.key);
        } catch (e) { failed++; status(j.key, String(e.message || e).replace(/^Error invoking remote method 'call': (Error: )?/, ""), "err"); }
      }
      if (failed) throw new Error(`有 ${failed} 段没做好（看上面的红字），改好再点一次「开始生成」；做好的不会重做`);
      const items = [];
      for (const [no, p] of [...plan.entries()].sort((a, b) => a[0] - b[0])) {
        if (!p.on) continue;
        items.push({ no, narration: p.narration.trim() ? "n" + no : null, qa: p.qa.filter((q) => q.q.trim() && q.a.trim()).map((q) => ({ q: q.q.trim(), a: q.a.trim(), key: `q${no}-${q.id}` })) });
      }
      const r = await call("build", items);
      const d = $("#makeDone"); d.hidden = false;
      d.innerHTML = `<b>做好了！</b><code class="path">${esc(r.file)}</code><span class="grow"></span><button class="btn pri" id="openOut">用 PowerPoint 打开</button><button class="btn" id="revealOut">打开所在文件夹</button>`;
      $("#openOut").onclick = () => call("openFile", r.file); $("#revealOut").onclick = () => call("reveal", r.file);
      const noAuto = r.report.filter((x) => x.narration && !x.auto).map((x) => x.no);
      toast(noAuto.length ? `第 ${noAuto.join("、")} 页的动画太复杂，讲解视频要点一下才播放` : "做好了：放映时进到那一页，形象就开讲");
    } finally { btn.disabled = false; }
  });

  // ---------- 启动 ----------
  (async () => {
    S = await call("state");
    if (S.profile.avatar) spec = { ...DEFAULT, ...S.profile.avatar };
    // 以前存的是旧样子（机器人屏幕脸 / 旧的照片脸）：换成新的公仔风，从照片量出来的五官留着；想要旧的可以在「脸的样子」里选回去
    if (S.profile.avatar && !(S.profile.avatar.look >= 7)) { spec = { ...DEFAULT, faceLines: S.profile.avatar.faceLines }; setTimeout(() => { toast("老师形象换成了新的公仔风（原来的样子在「脸的样子」里还能选回去）"); changed(); }, 800); }
    else if (S.profile.avatar && S.profile.avatar.look === 7) { spec.look = 8; spec.rig = false; setTimeout(changed, 800); }   // 公仔风第一版默认带骨架，现在默认不要
    paintForm();
    if (S.face) { faceImg = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = S.face.url; }); marks = S.face.marks || {}; if (faceImg) { const pv = $("#facePrev"); pv.hidden = false; pv.getContext("2d").drawImage(faceImg, 0, 0, 96, 96); } }
    if (lineFace() && spec.faceLines) { const pv = $("#facePrev"); pv.hidden = false; drawFacePrev(pv); }
    if (window.LaoAvatar && window.THREE) av = window.LaoAvatar.create($("#avStage"), spec, { transparent: true, face: faceImg });
    if (av) setTimeout(() => av.mood("wave", 2), 400);
    if (spec.faceStyle === "ai3d") guard(ensureAi)();
    guard(paintAi)();
    showPhoto(S.photo); paintVoice(); paintConsent(); paintVid(); showReal(); markDone();
    $("#sideFoot").innerHTML = `捞捞PPT助手 ${esc(S.version || "")}<br><a id="lawOpen">授权与合规说明</a>`;
    $("#lawOpen").onclick = () => $("#lawDlg").showModal();
    $("#openXz").onclick = guard(() => call("openSite", "xiaozhi"));
    $("#openNext").onclick = guard(() => call("openSite", "next"));
    window.__ready = true;
  })().catch((e) => toast("启动出错：" + e.message, true));
})();
