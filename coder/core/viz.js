// 捞捞编程 · 把「你自己写的代码」画成动画（C / C++）
// 做法：编译时多带一个头文件（-include），里面有一个 SHOW(数组, 个数) 宏：每调用一次，就把数组现在的样子打一行特殊格式的输出；
// 跑完后把这些行挑出来，就是一帧一帧的画面，别的输出照常显示。
// 「自动」模式：不用改你的代码 —— 拷一份，在每一句给数组元素赋值的语句后面（同一行，行号不变）加上 SHOW，拷贝去编译运行，原文件不动。
"use strict";

const MARK = "\u001eLLVIZ|";
// 编译时自动带上的头文件
const HEADER = `/* 捞捞编程「画出来」自动加上的（只在画动画时用，不影响你的代码） */
#ifndef LAOLAO_VIZ_H
#define LAOLAO_VIZ_H
#include <stdio.h>
#ifdef __cplusplus
extern "C" {
#endif
#if defined(__GNUC__)
#define LAOLAO_VIZ_UNUSED __attribute__((unused))
#else
#define LAOLAO_VIZ_UNUSED
#endif
static int laolao_viz_frames_ LAOLAO_VIZ_UNUSED = 0;
static LAOLAO_VIZ_UNUSED void laolao_viz_show_(const char *name, const int *a, long n, long m1, long m2, int line) {
    if (!a || n <= 0 || laolao_viz_frames_ >= 3000) return;
    if (n > 64) n = 64;
    laolao_viz_frames_++;
    printf("\\x1eLLVIZ|%d|%s|%ld|%ld|", line, name, m1, m2);
    for (long k = 0; k < n; k++) printf(k ? ",%d" : "%d", a[k]);
    printf("\\n");
}
#ifdef __cplusplus
}
#endif
#define SHOW(a, n) laolao_viz_show_(#a, (const int *)(a), (long)(n), -1L, -1L, __LINE__)
#define SHOW2(a, n, i, j) laolao_viz_show_(#a, (const int *)(a), (long)(n), (long)(i), (long)(j), __LINE__)
#endif
`;

// 找 int 数组：int a[10]; int a[] = {…}; int a[N]; （只认 int，排序作业基本都是 int）
function findArrays(src) {
  const out = new Map();
  const re = /\bint\s+([A-Za-z_]\w*)\s*\[\s*([^\]]*)\]\s*(=\s*\{([^}]*)\})?/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1]; let size = m[2].trim();
    if (!size && m[4] != null) size = String(m[4].split(",").filter((x) => x.trim()).length);
    if (!size) continue;
    if (/^[A-Za-z_]\w*$/.test(size) || /^\d+$/.test(size) || /^[\w\s+*\-/()]+$/.test(size)) if (!out.has(name)) out.set(name, size);
  }
  return out;
}

// 代码里有没有自己写的 SHOW（有就不自动加）
const hasShow = (src) => /\bSHOW2?\s*\(/.test(src);

// 去掉注释和字符串里的内容（换成空格，位置不变），免得把字符串里的 a[i] = 当成赋值
function blank(src) {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, (s) => s.replace(/[^\n]/g, " "));
}

// 函数参数里的数组：void sort(int a[], int n) / int *a, int n → 在这个函数里用 SHOW(a, n)
function paramArrays(clean) {
  const res = [];
  const re = /\b[A-Za-z_]\w*\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*\{/g;
  let m;
  while ((m = re.exec(clean))) {
    if (/^(if|for|while|switch|return|sizeof)$/.test(m[1])) continue;
    const ps = m[2].split(",").map((s) => s.trim());
    const arr = ps.map((p) => (p.match(/^(?:const\s+)?int\s*(?:\*\s*([A-Za-z_]\w*)|([A-Za-z_]\w*)\s*\[\s*\])$/) || [])).find((x) => x[1] || x[2]);
    const len = ps.map((p) => (p.match(/^(?:const\s+)?(?:int|long|size_t|unsigned)\s+([A-Za-z_]\w*)$/) || [])[1]).filter(Boolean);
    if (!arr) continue;
    // 找函数体的结尾
    let depth = 0, i = re.lastIndex - 1, end = clean.length;
    for (; i < clean.length; i++) { if (clean[i] === "{") depth++; else if (clean[i] === "}") { depth--; if (depth === 0) { end = i; break; } } }
    // 长度参数：优选名字像 n / len / size 的；只有一个数组参数加一个整数参数时就用它；数组 + lo + hi 时用 hi + 1
    let size = len.find((x) => /^(n|len|length|size|cnt|count|num)$/i.test(x));
    if (!size && len.length === 1) size = len[0];
    if (!size && len.length >= 2 && /^(lo|low|l|left|start|begin)$/i.test(len[0]) && /^(hi|high|r|right|end)$/i.test(len[1])) size = `(${len[1]}) + 1`;
    if (!size) continue;
    res.push({ name: arr[1] || arr[2], size, from: re.lastIndex, to: end, whole: /^(hi|high|r|right|end)/i.test(len[1] || "") });
  }
  return res;
}

/**
 * 自动加 SHOW：在给数组元素赋值的语句（a[i] = …; a[j] += …; swap(&a[i], &a[j]);）那一行末尾加 SHOW(a, n);
 * 返回 { src, added, arrays }；行号不变（加在同一行），这样报错、高亮的行号都对得上。
 */
function instrument(src) {
  if (hasShow(src)) return { src, added: 0, arrays: [], manual: true };
  const clean = blank(src);
  const globals = findArrays(clean);
  const params = paramArrays(clean);
  const lines = src.split("\n"), cl = clean.split("\n");
  let pos = 0, added = 0; const used = new Set();
  // 每一行在全文里的起点
  const starts = cl.map((l) => { const s = pos; pos += l.length + 1; return s; });
  for (let li = 0; li < cl.length; li++) {
    const l = cl[li];
    if (/^\s*#/.test(l)) continue;
    const names = new Set();
    for (const m of l.matchAll(/\b([A-Za-z_]\w*)\s*\[[^\]]*\]\s*(?:[+\-*/%]?=)(?!=)/g)) names.add(m[1]);
    for (const m of l.matchAll(/\bswap\s*\(\s*&\s*([A-Za-z_]\w*)\s*\[/g)) names.add(m[1]);
    if (!names.size || !/;\s*(\}\s*)*$/.test(l.replace(/\s+$/, "")) && !/;/.test(l)) continue;
    // 声明那一行（int a[5] = …）不算
    if (/\bint\s+[A-Za-z_]\w*\s*\[/.test(l)) continue;
    const at = starts[li];
    const shows = [];
    for (const nm of names) {
      const p = params.find((x) => x.name === nm && at > x.from && at < x.to);
      const size = p ? p.size : globals.get(nm);
      if (!size) continue;
      shows.push(`SHOW(${nm}, ${size});`); used.add(nm);
    }
    if (!shows.length) continue;
    // 加在这一行最后一个分号后面；如果分号后面紧跟着 }，加在分号和 } 之间
    const raw = lines[li]; const k = cl[li].lastIndexOf(";");
    if (k < 0) continue;
    // for (…; …; …) 这种行里的分号不算语句结尾：只在括号外面的分号后面加
    let par = 0; for (let q = 0; q < k; q++) { if (cl[li][q] === "(") par++; else if (cl[li][q] === ")") par--; }
    if (par > 0) continue;
    const ind = raw.match(/^\s*/)[0], body = raw.slice(ind.length).replace(/\s+$/, "");
    const S = shows.join(" ");
    // 1) 这一行自己就是「if (…) 语句;」「for (…) 语句;」：把后面的单句用 { } 包起来，SHOW 放进去
    const hd = cl[li].slice(ind.length).match(/^(?:\}\s*)?(?:else\s+)?(if|for|while)\s*\(/);
    if (hd) {
      let q = ind.length + hd[0].length - 1, dp = 0;
      for (; q < cl[li].length; q++) { if (cl[li][q] === "(") dp++; else if (cl[li][q] === ")" && --dp === 0) break; }
      const rest = raw.slice(q + 1, k + 1).trim();
      // 同一行还有 else（if (x) a[0]=1; else a[0]=2;）→ 整句后面加；body 是 { … } → 加在最后一个分号后面
      if (!rest || rest.startsWith("{") || /\belse\b/.test(cl[li].slice(q + 1))) lines[li] = raw.slice(0, k + 1) + " " + S + raw.slice(k + 1);
      else lines[li] = raw.slice(0, q + 1) + " { " + rest + " " + S + " }" + raw.slice(k + 1);
    } else if (/^(?:\}\s*)?else\b(?!\s*if)/.test(cl[li].slice(ind.length)) && !/^(?:\}\s*)?else\s*\{/.test(cl[li].slice(ind.length))) {
      // 2) 「else 语句;」
      const m = raw.slice(ind.length, k + 1).match(/^((?:\}\s*)?else)\s*([\s\S]*)$/);
      lines[li] = ind + m[1] + " { " + m[2].trim() + " " + S + " }" + raw.slice(k + 1);
    } else {
      // 3) 上一行是不带 { 的 if (…) / for (…) / else：这一句是它的单句分支，直接在后面加 SHOW 会跑到分支外面（if 后面还有 else 就编译不过了）→ 用 { } 包起来
      let pv = li - 1; while (pv >= 0 && !cl[pv].trim()) pv--;
      const prev = pv >= 0 ? cl[pv].replace(/\s+$/, "") : "";
      if (/(\)|\belse)$/.test(prev) && /^\s*(?:\}\s*)?(?:else\b|if\b|for\b|while\b)/.test(prev)) {
        if (/^(if|else|for|while|do|switch)\b/.test(body)) continue;
        lines[li] = ind + "{ " + raw.slice(ind.length, k + 1) + " " + S + " }" + raw.slice(k + 1);
      } else lines[li] = raw.slice(0, k + 1) + " " + S + raw.slice(k + 1);
    }
    added += shows.length;
  }
  // main 里第一次出现数组之后、排序之前也画一帧：在每个用到的数组声明那一行后面加 SHOW
  let depth = 0;
  for (let li = 0; li < cl.length; li++) {
    const d0 = depth; for (const ch of cl[li]) { if (ch === "{") depth++; else if (ch === "}") depth--; }
    const m = cl[li].match(/\bint\s+([A-Za-z_]\w*)\s*\[[^\]]*\]\s*(=\s*\{[^}]*\})?\s*;/);
    if (!m || !used.has(m[1]) || !globals.get(m[1]) || !m[2] || d0 === 0) continue;   // 函数外面（全局）不能写语句
    lines[li] = lines[li].replace(/;(\s*)$/, `; SHOW(${m[1]}, ${globals.get(m[1])});$1`);
    added++;
  }
  return { src: lines.join("\n"), added, arrays: [...used] };
}

/** 程序输出 → { frames: [{ line, name, a, i, j }], output: 去掉画面行以后的输出 } */
function parseFrames(stdout) {
  const frames = []; const keep = [];
  for (const ln of String(stdout || "").split("\n")) {
    const k = ln.indexOf(MARK);
    if (k < 0) { keep.push(ln); continue; }
    if (k > 0) keep.push(ln.slice(0, k));   // 同一行前面还有程序自己打的字（printf 没换行）
    const p = ln.slice(k + MARK.length).split("|");
    if (p.length < 5) continue;
    const a = p[4].split(",").filter((x) => x !== "").map(Number);
    frames.push({ line: +p[0], name: p[1], i: +p[2], j: +p[3], a });
  }
  return { frames, output: keep.join("\n") };
}

// 连着两帧一模一样的去掉（比如循环里每次都 SHOW，但数组没变）
function dedupe(frames) {
  const out = [];
  for (const f of frames) { const last = out[out.length - 1]; if (last && last.name === f.name && last.a.join() === f.a.join() && last.i === f.i && last.j === f.j) continue; out.push(f); }
  return out;
}

module.exports = { HEADER, MARK, instrument, findArrays, paramArrays, parseFrames, dedupe, hasShow };
