// 每日一轮：每天到点自动发一轮任务（生成数据 → 接着昨天训练 → 评测），评测分数比现在用的模型好（至少不差）才发布新版；
// 老师端（捞捞PPT助手）读发布清单 /pub/models/manifest.json，后台下载、下次用的时候换上，老师感觉不到。
//   流水线（pipeline）：{ name, at: "18:30", stages: [{ key, name, kind, recipe（配方名字，用最新上传的那个）, params, req, priority, after: [前面的 key] }],
//                        publish: { model: "qversion-lora", from: "eval", files: ["lora"], metrics: [{ k: "score", better: "higher", tol: 0 }] } }
//   训练接着上一版：params 里写 "warmStart": "$model:qversion-lora/lora" → 换成现在发布的那一版的文件
//   上一步的结果：后面的任务能拿到 deps[key].result（文件会下载到本机）
"use strict";

function attach(core, opt = {}) {
  const { db } = core;
  const clock = opt.clock || Date.now;
  db.exec(`
    create table if not exists pipelines(id integer primary key, name text unique, spec text, at text, enabled integer not null default 1, created integer);
    create table if not exists runs(id integer primary key, pipeline_id integer, day text, state text, jobs text, created integer, finished integer, result text);
    create table if not exists models(id integer primary key, name text, version integer, files text, metrics text, state text, run_id integer, created integer, note text);
  `);
  for (const c of ["deps text", "run_id integer"]) { try { db.exec("alter table jobs add column " + c); } catch (e) {} }
  const one = (s, ...a) => db.prepare(s).get(...a), all = (s, ...a) => db.prepare(s).all(...a), run = (s, ...a) => db.prepare(s).run(...a);
  const J = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch (e) { return d; } };
  const S = (o) => JSON.stringify(o == null ? null : o);
  const day = (t = clock()) => { const d = new Date(t + 8 * 3600e3); return d.toISOString().slice(0, 10); };   // 北京时间的日期
  const hhmm = (t = clock()) => new Date(t + 8 * 3600e3).toISOString().slice(11, 16);

  // ---- 模型版本 ----
  const released = (name) => one("select * from models where name=? and state='released' order by version desc limit 1", name);
  function manifest() {
    const out = { updated: clock(), models: {} };
    for (const r of all("select name from models where state='released' group by name")) {
      const m = released(r.name);
      out.models[r.name] = { version: m.version, files: J(m.files, []), metrics: J(m.metrics, {}), at: m.created, note: m.note || "" };
    }
    return out;
  }
  // 发布出去的文件才能公开下载
  const publicKeys = () => new Set(all("select files from models where state='released'").flatMap((m) => J(m.files, []).map((f) => f.key)));
  function better(spec, cur, cand) {
    if (!cur) return { ok: true, why: "第一版" };
    let up = false;
    for (const m of spec.metrics || []) {
      const a = +J(cur.metrics, {})[m.k], b = +cand[m.k];
      if (!isFinite(b)) return { ok: false, why: `评测结果里没有 ${m.k}` };
      if (!isFinite(a)) { up = true; continue; }
      const d = m.better === "lower" ? a - b : b - a;   // 正数 = 变好
      if (d < -(m.tol || 0)) return { ok: false, why: `${m.k} 变差了：${a} → ${b}` };
      if (d > (m.tol || 0)) up = true;
    }
    return up ? { ok: true, why: "变好了" } : { ok: spec.releaseEqual === true, why: "和现在的一样" };
  }

  // ---- 流水线 ----
  function setPipeline(spec) {
    if (!spec.name || !Array.isArray(spec.stages) || !spec.stages.length) throw new Error("流水线要有名字和步骤");
    const keys = new Set(spec.stages.map((s) => s.key));
    for (const s of spec.stages) for (const a of s.after || []) if (!keys.has(a)) throw new Error(`「${s.key}」要等的「${a}」不存在`);
    run("insert into pipelines(name,spec,at,created) values(?,?,?,?) on conflict(name) do update set spec=excluded.spec, at=excluded.at", spec.name, S(spec), spec.at || "18:30", clock());
    core.event("pipeline", `每日一轮「${spec.name}」设好了：每天 ${spec.at || "18:30"} 开始`);
    return one("select * from pipelines where name=?", spec.name).id;
  }
  // 配方按名字找最新上传的那个
  const recipeByName = (n) => (one("select id from recipes where name=? order by created desc limit 1", n) || {}).id;
  function fill(v) {
    if (typeof v === "string") {
      const m = /^\$model:([\w.\-]+)\/([\w.\-]+)$/.exec(v);
      if (m) { const r = released(m[1]); const f = r && J(r.files, []).find((x) => x.name === m[2]); return f ? f.key : null; }
      return v;
    }
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    return v;
  }
  function startRun(pid, why = "到点了") {
    const p = one("select * from pipelines where id=?", pid);
    const spec = J(p.spec);
    const rid = Number(run("insert into runs(pipeline_id,day,state,jobs,created) values(?,?,?,?,?)", pid, day(), "running", "{}", clock()).lastInsertRowid);
    const ids = {};
    const stage = `每日一轮 · ${day()}`;
    for (const s of spec.stages) {
      const recipe = s.kind === "record" ? null : recipeByName(s.recipe);
      if (s.kind !== "record" && !recipe) throw new Error(`还没上传配方「${s.recipe}」`);
      const id = core.createJob({ name: `${s.name || s.key}（第 ${rid} 轮）`, stage, kind: s.kind, recipe, params: { ...fill(s.params || {}), stageKey: s.key, runId: rid }, req: s.req || {}, priority: s.priority || 0 });
      ids[s.key] = id;
      run("update jobs set deps=?, run_id=? where id=?", S((s.after || []).map((k) => ids[k])), rid, id);
    }
    run("update runs set jobs=? where id=?", S(ids), rid);
    run("update pipelines set enabled=enabled where id=?", pid);
    core.event("run", `「${p.name}」第 ${rid} 轮开始（${why}）`);
    return rid;
  }
  // 每分钟看一眼：到点了、今天还没跑过 → 开一轮；上一轮还没跑完就不开（不叠在一起）
  function tick() {
    // 有一步失败了（试了好几次都不行）：这一轮算失败，明天照常开新的一轮
    for (const r of all("select * from runs where state='running'")) {
      const ids = Object.values(J(r.jobs, {})).map(Number);
      if (!ids.length) continue;
      const bad = one(`select j.name from jobs j where j.id in (${ids.join(",")}) and exists(select 1 from tasks t where t.job_id=j.id and t.state='failed') and not exists(select 1 from tasks t where t.job_id=j.id and t.state in ('queued','leased'))`);
      if (bad) { run("update runs set state='failed', finished=? where id=?", clock(), r.id); run(`update jobs set state='paused' where id in (${ids.join(",")}) and state='active'`); core.event("fail", `第 ${r.id} 轮「${bad.name}」失败了，这一轮先停下；老师端继续用现在的模型`); }
    }
    for (const p of all("select * from pipelines where enabled=1")) {
      if (hhmm() < (p.at || "18:30")) continue;
      if (one("select id from runs where pipeline_id=? and day=?", p.id, day())) continue;
      if (one("select id from runs where pipeline_id=? and state='running'", p.id)) continue;
      try { startRun(p.id); } catch (e) { core.event("error", `「${p.name}」没能开始：${e.message}`); }
    }
  }
  // 一个任务做完：是不是一轮的最后一步；评测完了比一比，好了就发布
  function onJobDone(jobId) {
    const j = one("select * from jobs where id=?", jobId);
    if (!j || !j.run_id) return;
    const r = one("select * from runs where id=?", j.run_id);
    if (!r || r.state !== "running") return;
    const p = one("select * from pipelines where id=?", r.pipeline_id);
    const spec = J(p.spec), ids = J(r.jobs, {});
    const pub = spec.publish;
    const key = J(j.params, {}).stageKey;
    if (pub && key === pub.from) {
      const res = (J(j.meta, {}) || {}).result || {};
      const files = (pub.files || []).map((n) => ({ name: n, key: res[n] })).filter((f) => f.key);
      const metrics = Object.fromEntries((pub.metrics || []).map((m) => [m.k, res[m.k]]));
      const cur = released(pub.model);
      const v = (one("select max(version) as v from models where name=?", pub.model) || {}).v || 0;
      const g = files.length === (pub.files || []).length ? better(pub, cur, metrics) : { ok: false, why: "评测没交出模型文件" };
      const state = g.ok && !pub.manual ? "released" : g.ok ? "candidate" : "rejected";
      run("insert into models(name,version,files,metrics,state,run_id,created,note) values(?,?,?,?,?,?,?,?)", pub.model, v + 1, S(files.map((f) => ({ ...f, size: res[f.name + "_size"] || 0, sha256: res[f.name + "_sha256"] || "" }))), S(metrics), state, r.id, clock(), g.why);
      core.event(state === "released" ? "release" : "model", state === "released" ? `「${pub.model}」第 ${v + 1} 版发布了（${g.why}：${fmt(metrics)}），老师端会自动换上`
        : state === "candidate" ? `「${pub.model}」第 ${v + 1} 版评测通过（${fmt(metrics)}），等你在控制中心点「发布」`
        : `「${pub.model}」第 ${v + 1} 版没发布：${g.why}（老师端继续用第 ${cur ? cur.version : "—"} 版）`);
      opt.onPublish && opt.onPublish();
    }
    const left = one(`select count(*) as n from jobs where id in (${Object.values(ids).map(Number).join(",") || 0}) and state!='done'`).n;
    if (!left) { run("update runs set state='done', finished=? where id=?", clock(), r.id); core.event("run", `「${p.name}」第 ${r.id} 轮做完了`); }
  }
  const fmt = (m) => Object.entries(m).map(([k, v]) => `${k} ${typeof v === "number" ? +v.toFixed(4) : v}`).join("，");
  core.on((e) => { if (e.type === "jobdone" && e.job) setImmediate(() => { try { onJobDone(e.job); } catch (x) { core.event("error", "每日一轮出错：" + x.message); } }); });

  // 管理员：手动发布 / 撤回（撤回 = 老师端退回上一版）
  function setModel(id, state) {
    const m = one("select * from models where id=?", id);
    if (!m) throw new Error("没有这个版本");
    if (!["released", "rejected"].includes(state)) throw new Error("只能发布或撤回");
    run("update models set state=?, note=? where id=?", state, state === "released" ? "管理员发布" : "管理员撤回", id);
    core.event(state === "released" ? "release" : "model", `「${m.name}」第 ${m.version} 版${state === "released" ? "发布了" : "撤回了，老师端退回上一版"}`);
    opt.onPublish && opt.onPublish();
    return { ok: true };
  }
  function view() {
    return {
      pipelines: all("select * from pipelines order by id").map((p) => ({ id: p.id, name: p.name, at: p.at, enabled: !!p.enabled, stages: J(p.spec).stages.map((s) => s.name || s.key), runs: all("select id, day, state, created, finished from runs where pipeline_id=? order by id desc limit 7", p.id) })),
      models: all("select * from models order by name, version desc limit 60").map((m) => ({ id: m.id, name: m.name, version: m.version, state: m.state, metrics: J(m.metrics, {}), created: m.created, note: m.note, run: m.run_id })),
    };
  }
  return { setPipeline, startRun, tick, onJobDone, manifest, publicKeys, setModel, view, better, released, setEnabled: (id, v) => run("update pipelines set enabled=? where id=?", v ? 1 : 0, id) };
}

module.exports = { attach };
