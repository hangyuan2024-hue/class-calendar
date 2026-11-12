// 录表情：摄像头 → MediaPipe face_mesh（478 个点）→ 捞捞表情参数（shared/expr.js）；麦克风 → 录音。
// 一句一句录：屏幕上显示讲稿，读完点「下一句」；每句检查质量（有没有拍到脸、声音大小、读得快慢），不合格提示重录。
// 视频不保存：只把每一帧的表情参数和录音交给主窗口（主窗口存本机、最后一起上传）。
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const E = window.LaoExpr;
  let item = null, lines = [], idx = 0, stream = null, fm = null, neutralRaw = null, calib = null;
  let rec = null, chunks = [], frames = [], faceFrames = 0, allFrames = 0, t0 = 0, rmsSum = 0, rmsN = 0, peak = 0, recording = false, lastRaw = null;
  let secsTotal = 0, saved = [];
  let ask = 0; const waits = {};
  const parentCall = (msg) => new Promise((ok, bad) => { const id = ++ask; waits[id] = (r) => (r.ok ? ok(r.r) : bad(new Error(r.e))); parent.postMessage({ ...msg, id }, "*"); });
  window.addEventListener("message", (e) => {
    const m = e.data || {};
    if (m.type === "reply" && waits[m.id]) { waits[m.id](m); delete waits[m.id]; }
    if (m.type === "start") start(m.item);
  });

  // 参数条
  $("#params").innerHTML = E.PARAMS.map(([k, n, a]) => `<div><span>${n}</span><span class="pb ${a < 0 ? "sym" : ""}" id="pb-${k}"><i></i></span><b id="pv-${k}">0</b></div>`).join("");
  function paintParams(v) {
    E.PARAMS.forEach(([k, , a], i) => {
      const x = v ? v[i] : 0, el = document.getElementById("pb-" + k).firstChild;
      if (a < 0) { el.style.left = (x < 0 ? 50 + x * 50 : 50) + "%"; el.style.width = Math.abs(x) * 50 + "%"; } else { el.style.left = "0"; el.style.width = x * 100 + "%"; }
      document.getElementById("pv-" + k).textContent = x.toFixed(2);
    });
  }

  async function start(it) {
    item = it; lines = (it.task.input.lines || []).filter(Boolean); idx = 0; saved = []; secsTotal = 0;
    $("#jobName").textContent = `${it.job.name} · 第 ${it.task.seq + 1} 段`;
    $("#dots").innerHTML = lines.map(() => "<i></i>").join("");
    paintDots();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 960, height: 720, facingMode: "user" }, audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (e) { $("#camTag").textContent = "打不开摄像头或麦克风：" + e.message; $("#camTag").className = "cam-tag bad"; return; }
    $("#vid").srcObject = stream;
    // 声音大小
    const ac = new AudioContext(); const an = ac.createAnalyser(); an.fftSize = 1024; ac.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    (function lv() { an.getFloatTimeDomainData(buf); let s = 0, p = 0; for (const x of buf) { s += x * x; p = Math.max(p, Math.abs(x)); } const r = Math.sqrt(s / buf.length); $("#lvl").style.width = Math.min(100, r * 400) + "%"; if (recording) { rmsSum += r; rmsN++; peak = Math.max(peak, p); } requestAnimationFrame(lv); })();
    // 认脸
    try {
      fm = new window.FaceMesh({ locateFile: (f) => "vendor/mediapipe/face_mesh/" + f });
      fm.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      fm.onResults(onFace);
      await fm.initialize();
    } catch (e) { $("#camTag").textContent = "认脸的组件没装好：" + e.message; $("#camTag").className = "cam-tag bad"; return; }
    const v = $("#vid");
    (async function loop() { if (v.readyState >= 2) { try { await fm.send({ image: v }); } catch (e) {} } setTimeout(loop, 33); })();
  }

  function onFace(r) {
    const cv = $("#mesh"), v = $("#vid");
    cv.width = cv.clientWidth; cv.height = cv.clientHeight;
    const g = cv.getContext("2d");
    const P = r.multiFaceLandmarks && r.multiFaceLandmarks[0];
    if (recording) allFrames++;
    if (!P) { $("#camTag").textContent = "没看到脸：坐正，脸在画面中间"; $("#camTag").className = "cam-tag bad"; paintParams(null); return; }
    $("#camTag").textContent = calib ? "✓ 看到脸了" : "✓ 看到脸了，点「校准」"; $("#camTag").className = "cam-tag ok";
    // 网格（按视频的裁切方式对齐到画布）
    const vw = v.videoWidth || 960, vh = v.videoHeight || 720, s = Math.max(cv.width / vw, cv.height / vh), ox = (cv.width - vw * s) / 2, oy = (cv.height - vh * s) / 2;
    g.fillStyle = "rgba(54,226,255,.55)";
    for (let i = 0; i < P.length; i += 2) { const p = P[i]; g.fillRect(ox + p.x * vw * s - 1, oy + p.y * vh * s - 1, 2, 2); }
    g.fillStyle = "rgba(62,240,161,.9)";
    for (const i of [13, 14, 61, 291, 159, 145, 386, 374, 105, 334]) { const p = P[i]; g.beginPath(); g.arc(ox + p.x * vw * s, oy + p.y * vh * s, 3, 0, 7); g.fill(); }
    const raw = E.raw(P.map((p) => ({ x: p.x * vw, y: p.y * vh })));
    lastRaw = raw;
    if (neutralRaw) neutralRaw.push(raw);
    const par = E.params(raw, calib);
    paintParams(par);
    if (recording) { faceFrames++; frames.push([Math.round(performance.now() - t0), ...par]); }
  }

  function paintDots() { [...$("#dots").children].forEach((d, i) => { d.className = i < saved.length ? "done" : i === idx ? "cur" : ""; }); $("#sIdx").textContent = lines.length ? `第 ${Math.min(idx + 1, lines.length)} / ${lines.length} 句` : "—"; }
  function show() {
    if (idx >= lines.length) { $("#line").textContent = "这一段录完了！"; $("#hint").textContent = "点「交上去」：录音和表情参数会上传（不包括视频）。"; $("#main").textContent = "交上去"; $("#redo").hidden = true; return; }
    $("#line").textContent = lines[idx];
    $("#hint").textContent = "点「开始」后像讲课一样读出来，读完点「读完了」。";
    $("#main").textContent = "开始读这一句";
  }

  $("#main").onclick = async () => {
    if (!stream) return;
    $("#warns").textContent = "";
    // 校准：2 秒自然表情
    if (!calib) {
      if (!lastRaw) { $("#warns").textContent = "还没看到脸"; return; }
      neutralRaw = []; $("#main").disabled = true; $("#main").textContent = "保持自然表情… 2";
      await new Promise((r) => setTimeout(r, 1000)); $("#main").textContent = "保持自然表情… 1";
      await new Promise((r) => setTimeout(r, 1000));
      calib = E.neutral(neutralRaw); neutralRaw = null; $("#main").disabled = false;
      if (!calib) { $("#warns").textContent = "没看清脸，再来一次"; return; }
      show(); return;
    }
    if (idx >= lines.length) {
      $("#main").disabled = true; $("#main").textContent = "上传中…";
      try { await parentCall({ type: "submit", task: item.task.id, job: item.job.id, secs: secsTotal }); $("#line").textContent = "交上去了，谢谢！"; $("#hint").textContent = ""; $("#main").textContent = "回到任务向导"; $("#main").disabled = false; $("#main").onclick = () => parent.postMessage({ type: "close" }, "*"); }
      catch (e) { $("#warns").textContent = "上传失败：" + e.message; $("#main").disabled = false; $("#main").textContent = "再试一次"; }
      return;
    }
    if (!recording) {
      chunks = []; frames = []; faceFrames = 0; allFrames = 0; rmsSum = 0; rmsN = 0; peak = 0;
      rec = new MediaRecorder(new MediaStream(stream.getAudioTracks()), { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 96000 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.start(250); t0 = performance.now(); recording = true;
      $("#recDot").hidden = false; $("#main").textContent = "读完了"; $("#redo").hidden = true;
      return;
    }
    recording = false; $("#recDot").hidden = true;
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    const secs = (performance.now() - t0) / 1000;
    const issues = E.check({ frames: allFrames, faceFrames, rms: rmsN ? rmsSum / rmsN : 0, peak, secs, chars: lines[idx].replace(/\s/g, "").length });
    if (issues.length) { $("#warns").innerHTML = issues.map((x) => "⚠ " + x).join("<br>"); $("#main").textContent = "重录这一句"; return; }
    const audio = await new Blob(chunks, { type: "audio/webm" }).arrayBuffer();
    const params = { version: E.VERSION, names: E.NAMES, text: lines[idx], secs, fps: frames.length / secs, neutral: calib, frames };
    try { await parentCall({ type: "save", task: item.task.id, idx, audio, params }); } catch (e) { $("#warns").textContent = "保存失败：" + e.message; return; }
    saved.push(idx); secsTotal += secs; idx++;
    $("#redo").hidden = false;
    paintDots(); show();
  };
  $("#redo").onclick = () => { if (idx > 0 && !recording) { idx--; saved.pop(); paintDots(); show(); } };
  $("#back").onclick = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); parent.postMessage({ type: "close" }, "*"); };
  window.__recReady = true;
})();
