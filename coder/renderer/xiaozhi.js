// 捞捞编程 · 捞小智：未来感的小智能体（平面版，给界面用；3D 版在 stage3d.js 里）
// 白色圆润外壳 + 深色玻璃面罩，眼睛是两道会眨的青色光；头顶天线一闪一闪，身下有悬浮推进的光
// 用法：XIAOZHI.svg({ size: 64, mood: "happy" | "think" | "wow" | "sad" | "" })
"use strict";
(function (root) {
  let uid = 0;
  const EYES = {
    "": (c) => `<rect x="${44 - 7}" y="46" width="9" height="13" rx="4.5" fill="${c}"/><rect x="${76 - 2}" y="46" width="9" height="13" rx="4.5" fill="${c}"/>`,
    happy: (c) => `<path d="M37 55 q5.5 -8 11 0" stroke="${c}" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M72 55 q5.5 -8 11 0" stroke="${c}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    think: (c) => `<rect x="37" y="49" width="10" height="7" rx="3.5" fill="${c}"/><rect x="73" y="45" width="10" height="13" rx="5" fill="${c}"/>`,
    wow: (c) => `<circle cx="42" cy="52" r="6.5" fill="${c}"/><circle cx="78" cy="52" r="6.5" fill="${c}"/>`,
    sad: (c) => `<path d="M37 50 l10 5" stroke="${c}" stroke-width="4" stroke-linecap="round"/><path d="M83 50 l-10 5" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`,
  };
  const MOUTH = {
    "": (c) => `<path d="M53 66 q7 5 14 0" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/>`,
    happy: (c) => `<path d="M51 64 q9 9 18 0" stroke="${c}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`,
    think: (c) => `<path d="M54 67 h12" stroke="${c}" stroke-width="3" stroke-linecap="round" opacity=".8"/>`,
    wow: (c) => `<ellipse cx="60" cy="67" rx="4" ry="5" fill="none" stroke="${c}" stroke-width="3"/>`,
    sad: (c) => `<path d="M53 69 q7 -5 14 0" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  };
  function svg({ size = 64, mood = "", cls = "", eye } = {}) {
    const id = "xz" + ++uid;
    const c = eye || (mood === "sad" ? "#fb7185" : "#5eead4");
    return `<svg class="xz ${cls} xz-${mood || "idle"}" viewBox="0 0 120 132" width="${size}" height="${Math.round(size * 1.1)}" aria-label="捞小智" role="img">
  <defs>
    <radialGradient id="${id}s" cx="38%" cy="28%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#e3ecfa"/><stop offset="1" stop-color="#9fb2d6"/></radialGradient>
    <linearGradient id="${id}v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2a4a"/><stop offset="1" stop-color="#050a18"/></linearGradient>
    <radialGradient id="${id}g" cx="50%" cy="0%" r="100%"><stop offset="0" stop-color="#22d3ee" stop-opacity=".9"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></radialGradient>
    <filter id="${id}f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <ellipse class="xz-jet" cx="60" cy="118" rx="20" ry="12" fill="url(#${id}g)"/>
  <g class="xz-body">
    <line x1="60" y1="18" x2="60" y2="6" stroke="#9fb2d6" stroke-width="3" stroke-linecap="round"/>
    <circle class="xz-ant" cx="60" cy="6" r="5" fill="#22d3ee" filter="url(#${id}f)"/>
    <ellipse cx="18" cy="58" rx="6" ry="12" fill="#c7d4ee"/><ellipse cx="102" cy="58" rx="6" ry="12" fill="#c7d4ee"/>
    <rect x="15" y="54" width="6" height="8" rx="3" fill="#22d3ee" opacity=".85"/><rect x="99" y="54" width="6" height="8" rx="3" fill="#22d3ee" opacity=".85"/>
    <path d="M60 16 C 92 16 104 36 104 60 C 104 88 86 104 60 104 C 34 104 16 88 16 60 C 16 36 28 16 60 16 Z" fill="url(#${id}s)"/>
    <path d="M60 30 C 82 30 92 40 92 56 C 92 72 80 78 60 78 C 40 78 28 72 28 56 C 28 40 38 30 60 30 Z" fill="url(#${id}v)"/>
    <path d="M38 36 C 46 32 54 31 62 31" stroke="#ffffff" stroke-opacity=".35" stroke-width="3" fill="none" stroke-linecap="round"/>
    <g class="xz-eyes" filter="url(#${id}f)">${(EYES[mood] || EYES[""])(c)}</g>
    ${(MOUTH[mood] || MOUTH[""])(c)}
    <path d="M44 92 h32" stroke="#9fb2d6" stroke-width="2" stroke-linecap="round" opacity=".6"/>
    <circle cx="60" cy="92" r="3" fill="#22d3ee" opacity=".9"/>
    <circle class="xz-hand" cx="10" cy="80" r="7" fill="url(#${id}s)"/><circle class="xz-hand r" cx="110" cy="80" r="7" fill="url(#${id}s)"/>
  </g>
</svg>`;
  }
  root.XIAOZHI = { svg };
})(typeof window !== "undefined" ? window : globalThis);
