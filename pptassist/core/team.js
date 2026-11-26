// 捞小智 · 多个助手一起干活：大任务拆成几件互不依赖的小事，同时交给几个「助手」做，做完交回来，捞小智再汇总
//   · 助手用「干活模型」（cloud.workerModel()：默认是现在这家最便宜的那个），不开思考
//   · 省 token：助手只拿到「总任务一句话 + 自己那一件」，不带整段对话；每份结果限长；捞小智只看结果，不看助手的过程
//   · 助手只能查（联网搜索、读网页、查资料、查课表 / 成绩 / 考试 / 空教室 / 通知、读导图），不能办（请假、调课、审批这些要捞小智自己问清楚再办）
//   · 本机模型一次只能做一件：干活模型是本机时一件一件做
"use strict";

const READ_ONLY = new Set(["campus_whoami", "get_timetable", "get_grades", "get_exams", "find_free_rooms", "my_requests", "pending_approvals", "search_notices",
  "web_search", "read_page", "answer_from_sources", "mindmap_list", "mindmap_read"]);
const HELPER_SYS = "你是「捞小智」团队里的一个助手。只做分给你的这一件事，做完直接交结果：先写结论，再写要点和依据（查到的写出处），不寒暄、不反问、不重复题目。" +
  "需要事实就用工具查，查不到就写「没查到」，不要编。用简体中文。";
const MAX_RESULT = 1600;

const schemaOf = (list) => list.map((t) => ({ type: "function", function: { name: t.name, description: t.desc, parameters: { type: "object", properties: t.params || {}, required: t.req || [] } } }));

function create(o) {
  const emit = (e) => { try { o.onEvent && o.onEvent(e); } catch (x) {} };
  const maxTasks = o.maxTasks || 6;
  let stopped = false, running = [];

  async function helper(i, task, goal, model, tools) {
    const msgs = [{ role: "system", content: HELPER_SYS },
      { role: "user", content: `总任务：${goal || task.title}\n你负责第 ${i + 1} 件：${task.title}\n要做的：${task.todo}\n直接交结果，${o.limit || 600} 字以内。` }];
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (let round = 0; round < (o.rounds || 4); round++) {
      if (stopped) throw new Error("停下了");
      const last = round === (o.rounds || 4) - 1;
      const p = o.llm.chat(msgs, { model, think: false, temperature: 0.3, maxTokens: 1500, mode: "team", ...(tools.length && !last ? { tools: schemaOf(tools) } : {}) });
      running.push(p);
      let r; try { r = await p; } finally { running = running.filter((x) => x !== p); }
      if (!r.tool_calls || !r.tool_calls.length) return (r.content || "").trim();
      msgs.push({ role: "assistant", content: r.content || "", tool_calls: r.tool_calls });
      for (const c of r.tool_calls) {
        let a = {}; try { a = JSON.parse(c.function.arguments || "{}"); } catch (e) {}
        const t = byName.get(c.function.name);
        let res; try { if (!t) throw new Error("助手不能用这个工具：" + c.function.name); emit({ type: "team", i, stage: "tool", title: task.title, say: t.say ? t.say(a) : t.name }); res = await t.run(a); } catch (e) { res = { error: e.message }; }
        msgs.push({ role: "tool", tool_call_id: c.id, name: c.function.name, content: JSON.stringify(res).slice(0, 3000) });
      }
    }
    return "";
  }

  async function run(a) {
    const goal = String(a.goal || "").slice(0, 300);
    const tasks = (Array.isArray(a.tasks) ? a.tasks : []).map((t) => ({ title: String((t && t.title) || "").trim().slice(0, 60), todo: String((t && (t.todo || t.detail)) || "").trim().slice(0, 600) }))
      .filter((t) => t.title && t.todo).slice(0, maxTasks);
    if (tasks.length < 2) throw new Error("大任务要拆成至少两件互不依赖的小事（每件写 title 和 todo）；只有一件就自己做");
    const model = o.worker ? o.worker() : null, tools = (o.tools ? o.tools() : []).filter((t) => READ_ONLY.has(t.name));
    const conc = model === "local" ? 1 : Math.max(1, o.concurrency || 3);
    stopped = false;
    emit({ type: "team", stage: "plan", tasks: tasks.map((t) => t.title), model: o.workerName ? o.workerName() : model });
    const out = new Array(tasks.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(conc, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++, t = tasks[i], t0 = Date.now();
        emit({ type: "team", i, stage: "start", title: t.title });
        try {
          let r = await helper(i, t, goal, model, tools);
          if (!r) throw new Error("没交出结果");
          if (r.length > MAX_RESULT) r = r.slice(0, MAX_RESULT) + "…（后面省了）";
          out[i] = { title: t.title, ok: true, result: r };
          emit({ type: "team", i, stage: "done", title: t.title, ok: true, secs: Math.round((Date.now() - t0) / 1000) });
        } catch (e) {
          out[i] = { title: t.title, ok: false, error: e.message };
          emit({ type: "team", i, stage: "done", title: t.title, ok: false, error: e.message });
        }
      }
    }));
    return { helpers: tasks.length, ok: out.filter((x) => x.ok).length, results: out, note: "这是几个助手交回来的结果：汇总成一个完整、不重复的回答给对方（不用说是助手做的）；有没做成的照实说，必要时自己补上" };
  }

  const tool = {
    name: "team_work",
    desc: "大任务拆给几个助手同时做（更快、更省）：把任务拆成 2～" + maxTasks + " 件互不依赖、能分开做的小事（比如分别查几样东西再对比、分几部分写、一章一章整理、出一套题的几个部分），" +
      "每件写 title（几个字）和 todo（要做什么、要交什么）；goal 写总任务一句话。助手们只能查，不能办事（请假、调课、审批你自己来）。做完你把结果汇总。简单的问题、一步就能答的别用。",
    params: { goal: { type: "string" }, tasks: { type: "array", items: { type: "object", properties: { title: { type: "string" }, todo: { type: "string" } }, required: ["title", "todo"] } } },
    req: ["tasks"],
    say: (a) => `分给 ${Array.isArray(a.tasks) ? Math.min(a.tasks.length, maxTasks) : "几"} 个助手同时做`,
    run,
  };
  function stop() { stopped = true; for (const p of running) { try { p.abort && p.abort(); } catch (e) {} } }
  return { tool, run, stop, READ_ONLY };
}

module.exports = { create, READ_ONLY, HELPER_SYS };
