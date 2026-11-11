// 捞捞PPT助手 · 先帮老师打个草稿：根据这一页的标题和文字，写一段讲解词、出两个问题（老师再改）
"use strict";

const isCode = (t) => /[;{}]|^\s*(#include|int |for\s*\(|while\s*\(|if\s*\(|printf|return\b)/.test(t) || (t.match(/[=<>+\-*/%&|]/g) || []).length >= 3;
const clean = (t) => String(t).replace(/\s+/g, " ").replace(/^[•·\-*\d.、)）\s]+/, "").trim();
const endPunct = (t) => (/[。！？!?.;；…]$/.test(t) ? t : t + "。");

function narration(slide, { first = false, hasQa = false } = {}) {
  const title = clean(slide.title || "");
  const lines = (slide.texts || []).map(clean).filter(Boolean);
  const words = lines.filter((t) => !isCode(t)), code = lines.length - words.length;
  const out = [];
  if (first) out.push("同学们好！");
  if (title) out.push(`这一页我们来看「${title}」。`);
  let n = 0;
  for (const t of words) { if (n >= 4 || out.join("").length > 140) break; out.push(endPunct(t)); n++; }
  if (code) out.push("大家看这段代码，跟着我一行一行地看。");
  if (!title && !words.length && !code) out.push("我们来看这一页。");
  if (hasQa) out.push("有不明白的地方，可以点旁边的问题，我来回答。");
  return out.join("");
}

function questions(slide) {
  const title = clean(slide.title || "");
  const words = (slide.texts || []).map(clean).filter((t) => t && !isCode(t));
  const hasCode = (slide.texts || []).some(isCode);
  const qs = [];
  if (title) qs.push({ q: `「${title}」是什么意思？`, a: words.length ? words.slice(0, 2).map(endPunct).join("") : `「${title}」就是这一页要讲的内容，我们一起来看。` });
  if (hasCode) qs.push({ q: "这段代码最容易写错的是哪里？", a: "最容易写错的是循环的边界条件和下标，写完以后用一组小数据，一步一步算一遍结果对不对。" });
  else if (words.length > 1) qs.push({ q: "这一页最需要记住什么？", a: endPunct(words[words.length - 1]) });
  return qs.slice(0, 2);
}

module.exports = { narration, questions, isCode };
