// 捞捞编程 · 「问捞捞」怎么问本地模型：把代码、报错、输出、练习题整理成提示词
// 模型只有 1.5B：提示词短、要求明确；回答用中文、简短；默认给思路和提示，不直接把整段答案写出来
"use strict";

const SYSTEM = `你是「捞捞」，一位耐心、说话亲切的编程老师，学生是第一次学编程的中国大学生。
规则：
1. 一律用简体中文回答，简短清楚，先说结论，最多 6 句话或 6 个要点；代码用 Markdown 代码块。
2. 默认只给思路、提示和要改的那一两行，不要把整个程序重写一遍；学生明确说「直接给答案 / 给完整代码」时才给完整代码。
3. 讲报错时：先用一句大白话说「哪里错了、为什么」，再说「怎么改」，最后可以提醒一个以后避免的小习惯。
4. 不确定的就说不确定，不要编造不存在的函数或语法。
5. 多鼓励，像学长学姐一样说话，但不要说空话。`;

const clip = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n) + `\n……（后面还有 ${s.length - n} 个字，省略）` : s; };
const numbered = (code) => String(code || "").split("\n").map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n");

// ctx：{ lang（显示名）, file, code, selection, output, diags: [{line, message, hint}], exercise: {title, desc} }
function userPrompt(mode, ctx, question) {
  const parts = [];
  if (ctx.exercise) parts.push(`【练习题】${ctx.exercise.title}\n${clip(ctx.exercise.desc, 800)}`);
  const code = ctx.selection ? ctx.selection : ctx.code;
  if (code) parts.push(`【${ctx.selection ? "选中的代码" : "我的代码"}】（${ctx.lang}${ctx.file ? "，" + ctx.file : ""}，左边是行号）\n\`\`\`\n${clip(numbered(code), 6000)}\n\`\`\``);
  if (ctx.diags && ctx.diags.length) parts.push("【报错】\n" + ctx.diags.slice(0, 6).map((d) => `第 ${d.line || "?"} 行：${d.message}`).join("\n"));
  if (ctx.output) parts.push("【运行输出】\n" + clip(ctx.output, 1500));
  const ask = {
    error: "我的程序报错了 / 结果不对，请告诉我哪里错了、怎么改（只改需要改的地方）。",
    explain: "请一行一行（或一段一段）给我讲讲这段代码在做什么。",
    hint: "我卡住了，请给我一个提示或下一步的思路，先不要直接给完整答案。",
    review: "我的程序能运行了，请帮我看看还有哪里可以写得更好（命名、格式、边界情况），挑最重要的 2~3 点。",
    free: "",
  }[mode] || "";
  parts.push("【我的问题】" + (question ? question : ask));
  return parts.join("\n\n");
}

// history：之前的对话 [{role, content}]（只留最近几轮，模型记不住太长的）
function messages(mode, ctx, question, history = []) {
  const keep = history.slice(-6).map((m) => ({ role: m.role, content: clip(m.content, 1500) }));
  return [{ role: "system", content: SYSTEM }, ...keep, { role: "user", content: userPrompt(mode, ctx, question) }];
}

module.exports = { SYSTEM, messages, userPrompt };
