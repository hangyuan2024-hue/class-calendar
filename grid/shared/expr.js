// 捞捞「表情参数」标准（v1）：画图和声音都按这一套走，所以嘴型、表情一定对得上。
//   画图那边：每个参数画出「最大」时的样子（嘴张到最大、眼睛闭上……），播放时按数值混合；
//   声音那边：「声音→表情」模型每一帧给出这些数值。
// 录表情时，从 MediaPipe face_mesh 的 478 个点（含虹膜）算出来；先录 2 秒「自然表情」当基准，减掉每个人自己的脸型差异。
(function (root) {
  "use strict";
  const PARAMS = [
    // 名字, 中文, 范围
    ["jawOpen", "张嘴", 0, 1],
    ["mouthWide", "嘴角拉开（咿）", -1, 1],
    ["mouthRound", "嘴撅圆（呜、哦）", 0, 1],
    ["smile", "笑", -1, 1],
    ["blinkL", "左眼闭", 0, 1],
    ["blinkR", "右眼闭", 0, 1],
    ["browUpL", "左眉挑", -1, 1],
    ["browUpR", "右眉挑", -1, 1],
    ["frown", "皱眉", 0, 1],
    ["gazeX", "眼神左右", -1, 1],
    ["gazeY", "眼神上下", -1, 1],
    ["headYaw", "摇头（左右转）", -1, 1],
    ["headPitch", "点头（上下）", -1, 1],
    ["headRoll", "歪头", -1, 1],
  ];
  const NAMES = PARAMS.map((p) => p[0]);
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // 原始量（还没减基准）：都除以脸的大小，离镜头远近不影响
  function raw(P) {
    const faceH = d(P[10], P[152]), faceW = d(P[234], P[454]);
    const ear = (t, b, l, r) => d(P[t], P[b]) / Math.max(1e-6, d(P[l], P[r]));
    const mouthW = d(P[61], P[291]) / faceW;
    const lipMidY = (P[13].y + P[14].y) / 2, cornerY = (P[61].y + P[291].y) / 2;
    const iris = P.length > 470;
    const gx = iris ? ((P[468].x - P[33].x) / Math.max(1e-6, P[133].x - P[33].x) + (P[473].x - P[362].x) / Math.max(1e-6, P[263].x - P[362].x)) / 2 - 0.5 : 0;
    const gy = iris ? ((P[468].y - (P[159].y + P[145].y) / 2) + (P[473].y - (P[386].y + P[374].y) / 2)) / 2 / faceH : 0;
    const eyeMid = { x: (P[33].x + P[263].x) / 2, y: (P[33].y + P[263].y) / 2 };
    const cheekMid = (P[234].x + P[454].x) / 2;
    return {
      jaw: d(P[13], P[14]) / faceH,
      mouthW,
      mouthH: d(P[0], P[17]) / faceH,
      smile: (lipMidY - cornerY) / faceH,
      earL: ear(159, 145, 33, 133), earR: ear(386, 374, 362, 263),
      browL: (P[159].y - P[105].y) / faceH, browR: (P[386].y - P[334].y) / faceH,
      browGap: d(P[55], P[285]) / faceW,
      gx, gy,
      yaw: (P[1].x - cheekMid) / faceW,
      pitch: (P[1].y - eyeMid.y) / faceH,
      roll: Math.atan2(P[263].y - P[33].y, P[263].x - P[33].x),
    };
  }
  // 基准：自然表情时若干帧的平均
  function neutral(frames) {
    const n = frames.length, out = {};
    if (!n) return null;
    for (const k of Object.keys(frames[0])) out[k] = frames.reduce((a, f) => a + f[k], 0) / n;
    return out;
  }
  // 一帧的表情参数（按 PARAMS 的顺序）
  function params(r, n) {
    n = n || { jaw: 0.01, mouthW: r.mouthW, mouthH: r.mouthH, smile: 0, earL: 0.3, earR: 0.3, browL: r.browL, browR: r.browR, browGap: r.browGap, gx: 0, gy: 0, yaw: 0, pitch: r.pitch, roll: 0 };
    const v = {
      jawOpen: clamp((r.jaw - n.jaw) / 0.18, 0, 1),
      mouthWide: clamp((r.mouthW / n.mouthW - 1) / 0.2, -1, 1),
      mouthRound: clamp((1 - r.mouthW / n.mouthW) / 0.22 * 0.7 + Math.max(0, r.mouthH / n.mouthH - 1) * 0.6, 0, 1),
      smile: clamp((r.smile - n.smile) / 0.03, -1, 1),
      blinkL: clamp(1 - r.earL / Math.max(0.05, n.earL), 0, 1),
      blinkR: clamp(1 - r.earR / Math.max(0.05, n.earR), 0, 1),
      browUpL: clamp((r.browL - n.browL) / 0.03, -1, 1),
      browUpR: clamp((r.browR - n.browR) / 0.03, -1, 1),
      frown: clamp((1 - r.browGap / n.browGap) / 0.12, 0, 1),
      gazeX: clamp((r.gx - n.gx) / 0.25, -1, 1),
      gazeY: clamp((r.gy - n.gy) / 0.04, -1, 1),
      headYaw: clamp((r.yaw - n.yaw) / 0.25, -1, 1),
      headPitch: clamp((r.pitch - n.pitch) / 0.15, -1, 1),
      headRoll: clamp((r.roll - n.roll) / 0.5, -1, 1),
    };
    return NAMES.map((k) => Math.round(v[k] * 1000) / 1000);
  }
  // 一句话录完的质量检查：有脸的帧够不够、声音够不够大、有没有爆音、长短对不对
  function check({ frames, faceFrames, rms, peak, secs, chars }) {
    const out = [];
    if (frames && faceFrames / frames < 0.9) out.push("有一段没拍到脸：坐正，脸在画面中间、别挡住");
    if (rms != null && rms < 0.01) out.push("声音太小：离麦克风近一点，或者大声一点");
    if (peak != null && peak > 0.98) out.push("声音爆了：离麦克风远一点");
    if (secs && chars && (chars / secs > 9)) out.push("读得太快了：像讲课一样慢一点");
    if (secs && chars && (chars / secs < 1.2)) out.push("停顿太长了：读完这一句就点「下一句」");
    return out;
  }
  const api = { VERSION: 1, PARAMS, NAMES, raw, neutral, params, check };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.LaoExpr = api;
})(typeof window !== "undefined" ? window : globalThis);
