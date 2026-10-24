// 课内学习跟着捞捞网站的外观走：清爽 / 简约 / 书页 / 捞捞元宇宙 × 浅色 / 深色
// 课内的 style.css 里颜色都是写死的（三百多种）。打包时把每个颜色换成 var(--kc-xxxxxx, 原色)，
// 再按外观自动算出每种颜色在这个外观下该是什么颜色，生成 theme.css。不改课内原来的样式写法，以后课内更新了重新打包就行。
"use strict";

function hex6(h) { h = h.toLowerCase(); return h.length === 3 ? h.split("").map((c) => c + c).join("") : h; }
function toHsl(hex) {
  const n = parseInt(hex, 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
  }
  return [h, s, l];
}
function toHex([h, s, l]) {
  s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
}
const isBlue = ([h, s]) => s > 0.35 && h >= 200 && h <= 255;          // 课内原来的主色（#4a6cf7）一家
const isNeutral = ([, s]) => s < 0.3;

// 每个外观在浅色下怎么换：主色换成外观的强调色，中性色带一点外观的底色
const LOOKS = {
  fresh: { accentHue: 168, accentSat: 0.7, neutralHue: 150, neutralSat: 0.08, darkHue: 190, darkSat: 0.18 },
  clean: { accentHue: 240, accentSat: 0.06, accentDark: true, neutralHue: 240, neutralSat: 0.04, darkHue: 240, darkSat: 0.04, darkAccentHue: 234, darkAccentSat: 0.6 },
  paper: { accentHue: 11, accentSat: 0.62, neutralHue: 40, neutralSat: 0.32, darkHue: 35, darkSat: 0.14 },
  cyber: { accentHue: 186, accentSat: 0.85, neutralHue: 220, neutralSat: 0.3, darkHue: 222, darkSat: 0.5 },
};

function light(hex, L) {
  let [h, s, l] = toHsl(hex);
  if (isBlue([h, s])) {
    if (L.accentDark && l < 0.8) return toHex([L.accentHue, L.accentSat, Math.min(l, 0.2) * 0.8 + 0.06]);   // 简约：主色是墨黑
    return toHex([L.accentHue, l > 0.85 ? Math.min(s, 0.6) * L.accentSat / 0.7 : L.accentSat, L.look === "paper" && l < 0.8 ? Math.min(l, 0.45) : l]);
  }
  if (isNeutral([h, s])) {
    if (l > 0.85) return toHex([L.neutralHue, L.neutralSat * (l > 0.97 ? 0.6 : 1), l - (L.look === "paper" ? 0.02 : 0)]);
    return toHex([L.neutralHue, Math.min(s, L.neutralSat * 0.8), l]);
  }
  return "#" + hex;
}
function dark(hex, L) {
  const base = toHsl(light(hex, L).slice(1));
  let [h, s, l] = base;
  const orig = toHsl(hex);
  // 有颜色的（主色、红、绿、黄）：保持色相，调到在深色背景上看得清的亮度
  if (orig[1] > 0.35 && orig[2] > 0.18 && orig[2] < 0.9) {
    if (isBlue(orig) && L.darkAccentHue != null) return toHex([L.darkAccentHue, L.darkAccentSat, 0.66]);
    if (orig[2] >= 0.85) return toHex([h, Math.min(s, 0.45), 0.2]);                 // 浅色的底（淡蓝、淡红）→ 深色的底
    return toHex([h, Math.min(s, 0.75), Math.max(0.55, Math.min(l + 0.1, 0.7))]);
  }
  // 中性色：亮的变暗、暗的变亮
  const nl = 0.085 + (1 - l) * 0.84;
  return toHex([L.darkHue, L.darkSat * (nl < 0.4 ? 1 : 0.35), nl]);
}

function themeCss(colors) {
  const out = [];
  const block = (sel, fn) => { out.push(sel + " {\n" + colors.map((c) => `  --kc-${c}: ${fn(c)};`).join("\n") + "\n}"); };
  for (const [look, cfg] of Object.entries(LOOKS)) {
    const L = Object.assign({ look }, cfg);
    if (look !== "cyber") block(`html[data-look=${look}][data-tone=light]`, (c) => light(c, L));
    else block(`html[data-look=cyber][data-tone=light]`, (c) => light(c, Object.assign({}, L, { accentSat: 0.75 })));
    block(`html[data-look=${look}][data-tone=dark]`, (c) => dark(c, L));
  }
  return "/* 自动生成（learn/runtime/theme-gen.js）：课内学习跟着网站外观换色 */\n" + out.join("\n");
}

// 把样式里的颜色换成变量。color: #fff（彩色按钮上的白字）不换
function tokenize(css) {
  const colors = new Set();
  const swap = (prop, value) => value.replace(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b(?![0-9a-fA-F])/g, (m, h) => {
    const c = hex6(h);
    if (prop === "color" && (c === "ffffff")) return m;
    colors.add(c);
    return `var(--kc-${c}, ${m})`;
  }).replace(/rgba\(\s*74\s*,\s*108\s*,\s*247\s*,\s*([0-9.]+)\s*\)/g, (m, a) => { colors.add("4a6cf7"); return `color-mix(in srgb, var(--kc-4a6cf7, #4a6cf7) ${Math.round(parseFloat(a) * 100)}%, transparent)`; });
  const COLOR_PROP = /^(background|border|color$|outline|box-shadow|fill$|stroke$|text-decoration|caret-color|accent-color|column-rule|text-shadow|--)/i;
  const out = css.replace(/([a-zA-Z-]+)\s*:\s*([^;{}]+)/g, (m, prop, value) => (COLOR_PROP.test(prop) && /#|rgba\(\s*74/.test(value) ? `${prop}:${swap(prop.toLowerCase(), value)}` : m));
  return { css: out, colors: [...colors].sort() };
}

module.exports = { tokenize, themeCss, LOOKS };
