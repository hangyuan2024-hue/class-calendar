// 每日一轮：每天到点自动发一轮任务（生成数据 → 接着昨天训练 → 评测），评测分数比现在用的模型好（至少不差）才发布新版；
// 老师端（捞捞PPT助手）读发布清单 /pub/models/manifest.json，后台下载、下次用的时候换上，老师感觉不到。
//   流水线（pipeline）：{ name, at: "18:30", stages: [{ key, name, kind, recipe（配方名字，用最新上传的那个）, params, req, priority, after: [前面的 key] }],
//                        publish: { model: "qversion-lora", from: "eval", files: ["lora"], metrics: [{ k: "score", better: "higher", tol: 0 }] } }
//   训练接着上一版：params 里写 "warmStart": "$model:qversion-lora/lora" → 换成现在发布的那一版的文件
//   上一步的结果：后面的任务能拿到 deps[key].result（文件会下载到本机）
//   到点收尾：步骤里写 until: "04:30"（北京时间）→ 到点不管做了多少都收尾，后面的步骤接着开始（不用先测每台电脑多快）
//     map：没人领的小任务不做了，正在算的算完；relay：正在算的这一段算完就用它的结果
//   评测交 skip（比如「票数还不够」）：这一轮不出新版，不算失败
//   随时模式（mode: "continuous"，不定时间）：大家想算的时候开着就算
//     standing: true 的步骤一直开着（比如画 Q版）：快领完了自动补一批（keep 个）；用到的配方、发布的模型更新了就换成新的
//     when: { tag, reviews, minHours } 的步骤（比如训练）：这类审核新攒够 reviews 条、离上次至少 minHours 小时 → 开一轮
//     控制中心点「现在跑一轮」= 马上训练一次
//   比较时用同一份数据：metrics 里写 vs: "base_acc" → 和评测结果里现在这一版的分数比（每天的测试题会变多，昨天的分数不能直接比）
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
  // 下一个北京时间 hh:mm（比现在晚的那个）
  function nextAt(hm, t = clock()) {
    const [h, m] = String(hm).split(":").map(Number);
    if (!(h >= 0 && h < 24 && m >= 0 && m < 60)) throw new Error("时间不对：" + hm);
    const d = new Date(t + 8 * 3600e3);
    let ts = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m) - 8 * 3600e3;
    if (ts <= t) ts += 86400e3;
    return ts;
  }

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
    // 及格线（min）：连第一版也要过（比如打分模型至少要比瞎猜好）
    for (const m of spec.metrics || []) {
      if (m.min == null) continue;
      const b = +cand[m.k];
      if (!isFinite(b) || (m.better === "lower" ? b > m.min : b < m.min)) return { ok: false, why: `${m.k} 是 ${isFinite(b) ? +b.toFixed(4) : "—"}，没到及格线 ${m.min}` };
    }
    if (!cur) return { ok: true, why: "第一版" };
    let up = false;
    for (const m of spec.metrics || []) {
      const a = m.vs ? +cand[m.vs] : +J(cur.metrics, {})[m.k], b = +cand[m.k];
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
    for (const s of spec.stages) if (s.until) { nextAt(s.until); if (!["map", "relay"].includes(s.kind)) throw new Error(`「${s.key}」：只有 map 和 relay 能到点收尾`); }
    const cont = spec.mode === "continuous";
    if (cont) {
      if (!spec.stages.some((x) => x.standing || x.when)) throw new Error("随时模式要有一直开着的步骤（standing）或者攒够了才开的步骤（when）");
      for (const x of spec.stages) if (x.standing && x.kind !== "map") throw new Error(`「${x.key}」：一直开着的只能是 map`);
    }
    run("insert into pipelines(name,spec,at,created) values(?,?,?,?) on conflict(name) do update set spec=excluded.spec, at=excluded.at", spec.name, S(spec), cont ? "" : spec.at || "18:30", clock());
    core.event("pipeline", cont ? `「${spec.name}」设好了：不定时间，大家开着就算；审核攒够了自动训练` : `每日一轮「${spec.name}」设好了：每天 ${spec.at || "18:30"} 开始`);
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
  // 随时模式：某一类审核一共定下来多少条（训练开一轮时记下来，下次看新攒了多少）
  const reviewsDone = (tag) => one("select count(*) as n from reviews where state='done' and json_extract(payload,'$.tag')=?", String(tag)).n;
  function startRun(pid, why = "到点了") {
    const p = one("select * from pipelines where id=?", pid);
    const spec = J(p.spec);
    const cont = spec.mode === "continuous";
    const stages = cont ? spec.stages.filter((x) => !x.standing) : spec.stages;
    if (!stages.length) throw new Error("没有要开一轮的步骤");
    const marks = {};
    for (const x of stages) if (x.when && x.when.tag) marks[x.when.tag] = reviewsDone(x.when.tag);
    const rid = Number(run("insert into runs(pipeline_id,day,state,jobs,created,result) values(?,?,?,?,?,?)", pid, day(), "running", "{}", clock(), S({ marks, why })).lastInsertRowid);
    const ids = {};
    const stage = cont ? `自动训练 · ${p.name}` : `每日一轮 · ${day()}`;
    for (const s of stages) {
      const recipe = s.kind === "record" ? null : recipeByName(s.recipe);
      if (s.kind !== "record" && !recipe) throw new Error(`还没上传配方「${s.recipe}」`);
      const params = { ...fill(s.params || {}), stageKey: s.key, runId: rid };
      if (s.until) params.deadline = nextAt(s.until);
      const id = core.createJob({ name: `${s.name || s.key}（第 ${rid} 轮）`, stage, kind: s.kind, recipe, params, req: s.req || {}, priority: s.priority || 0 });
      ids[s.key] = id;
      run("update jobs set deps=?, run_id=? where id=?", S((s.after || []).filter((k) => ids[k]).map((k) => ids[k])), rid, id);
    }
    run("update runs set jobs=? where id=?", S(ids), rid);
    run("update pipelines set enabled=enabled where id=?", pid);
    core.event("run", `「${p.name}」第 ${rid} 轮开始（${why}）`);
    return rid;
  }
  // 每分钟看一眼：到点了、今天还没跑过 → 开一轮；上一轮还没跑完就不开（不叠在一起）
  function tick() {
    for (const r of all("select * from runs where state='running'")) {
      const ids = Object.values(J(r.jobs, {})).map(Number);
      if (!ids.length) continue;
      const fail = (why) => { run("update runs set state='failed', finished=? where id=?", clock(), r.id); run(`update jobs set state='paused' where id in (${ids.join(",")}) and state='active'`); core.event("fail", `第 ${r.id} 轮${why}，这一轮先停下；老师端继续用现在的模型`); };
      let failed = false;
      for (const j of all(`select * from jobs where id in (${ids.join(",")}) and state='active'`)) {
        const p = J(j.params, {}) || {};
        const n = one("select sum(state in ('queued','leased')) as open, sum(state='failed') as bad, sum(state='done') as ok from tasks where job_id=?", j.id);
        // 到点了：收尾
        if (p.deadline && clock() >= p.deadline && ["map", "relay"].includes(j.kind)) {
          const c = core.cut(j.id);
          if (c === "empty") { fail(`「${j.name}」到点了一个也没做成`); failed = true; break; }
          continue;
        }
        // 拆成很多份的：一个都没做成就已经有 5 个彻底失败了（比如 AI 引擎在这些电脑上跑不起来）→ 别整晚空转
        if (j.kind === "map" && !n.ok && n.bad >= 5) { fail(`「${j.name}」连着 ${n.bad} 个都失败了（一个都没做成）`); failed = true; break; }
        // 有小任务试了好几次都不行：生成这种拆成很多份的，做成了一些就用做成的；其他的算这一轮失败
        if (n.bad && !n.open) {
          if (j.kind === "map" && n.ok) { core.cut(j.id); continue; }
          fail(`「${j.name}」失败了`); failed = true; break;
        }
      }
      if (failed) continue;
    }
    for (const p of all("select * from pipelines where enabled=1")) {
      const spec = J(p.spec, {});
      if (spec.mode === "continuous") { try { continuous(p, spec); } catch (e) { core.event("error", `「${p.name}」出错：${e.message}`); } continue; }
      if (hhmm() < (p.at || "18:30")) continue;
      if (one("select id from runs where pipeline_id=? and day=?", p.id, day())) continue;
      if (one("select id from runs where pipeline_id=? and state='running'", p.id)) continue;
      try { startRun(p.id); } catch (e) { core.event("error", `「${p.name}」没能开始：${e.message}`); }
    }
  }
  // 随时模式：一直开着的步骤补活、换新；攒够审核开一轮训练
  function continuous(p, spec) {
    for (const s of spec.stages.filter((x) => x.standing)) {
      const recipe = recipeByName(s.recipe);
      if (!recipe) continue;
      const params = { ...fill(s.params || {}), stageKey: s.key };
      const sig = require("crypto").createHash("sha1").update(S(params) + recipe).digest("hex").slice(0, 12);
      let j = one("select j.* from jobs j join runs r on r.id=j.run_id where r.pipeline_id=? and r.state='standing' and json_extract(j.params,'$.stageKey')=? and j.state!='done' order by j.id desc limit 1", p.id, s.key);
      if (j && (J(j.params, {}) || {}).sig !== sig) {
        core.retire(j.id);
        core.event("job", `「${s.name || s.key}」的配方或模型更新了：换成新的（正在算的算完）`);
        j = null;
      }
      const keep = Math.max(1, s.keep || 40);
      if (!j) {
        const rid = Number(run("insert into runs(pipeline_id,day,state,jobs,created) values(?,?,?,?,?)", p.id, day(), "standing", "{}", clock()).lastInsertRowid);
        const id = core.createJob({ name: s.name || s.key, stage: `自动训练 · ${p.name}`, kind: "map", recipe, params: { ...params, sig, runId: rid, count: keep }, req: s.req || {}, priority: s.priority || 0 });
        run("update jobs set run_id=? where id=?", rid, id);
        run("update runs set jobs=? where id=?", S({ [s.key]: id }), rid);
        continue;
      }
      if (j.state !== "active") continue;   // 管理员暂停了，或者连着失败停下了
      const n = one("select sum(state='queued') as q, sum(state='failed') as bad, sum(state='done') as ok from tasks where job_id=?", j.id);
      // 一个都没做成就已经有 5 个彻底失败了（比如 AI 引擎在这些电脑上跑不起来）→ 停下，别一直空转
      if (!n.ok && n.bad >= 5) { core.setJob(j.id, { state: "paused" }); core.event("fail", `「${j.name}」连着 ${n.bad} 个都失败了（一个都没做成），先停下：看看出错信息，修好了在控制中心点「重试」`); continue; }
      if ((n.q || 0) < keep / 2) core.addTasks(j.id, keep - (n.q || 0));
    }
    // 训练：上一轮还没完就不开；新审核攒够了、离上次够久了 → 开一轮
    if (one("select id from runs where pipeline_id=? and state='running'", p.id)) return;
    const last = one("select * from runs where pipeline_id=? and state!='standing' order by id desc limit 1", p.id);
    const marks = (J(last && last.result, {}) || {}).marks || {};
    for (const s of spec.stages.filter((x) => x.when)) {
      const w = s.when, now = reviewsDone(w.tag), fresh = now - (marks[w.tag] || 0);
      if (fresh < (w.reviews || 1)) continue;
      if (last && clock() - last.created < (w.minHours || 0) * 3600e3) continue;
      startRun(p.id, `新的审核攒够了 ${fresh} 条`);
      return;
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
      if (res.skip) { core.event("model", `「${pub.model}」这一轮没出新版：${res.skip}（老师端继续用现在的）`); }
      else {
      const files = (pub.files || []).map((n) => ({ name: n, key: res[n] })).filter((f) => f.key);
      const metrics = Object.fromEntries((pub.metrics || []).flatMap((m) => [[m.k, res[m.k]], ...(m.vs ? [[m.vs, res[m.vs]]] : [])]));
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
      pipelines: all("select * from pipelines order by id").map((p) => {
        const spec = J(p.spec, {});
        const cont = spec.mode === "continuous";
        const w = cont && (spec.stages.find((x) => x.when) || {}).when;
        const last = cont && one("select * from runs where pipeline_id=? and state!='standing' order by id desc limit 1", p.id);
        return { id: p.id, name: p.name, at: p.at, mode: cont ? "continuous" : "daily", enabled: !!p.enabled, stages: spec.stages.map((s) => s.name || s.key),
          when: w ? { ...w, fresh: reviewsDone(w.tag) - (((J(last && last.result, {}) || {}).marks || {})[w.tag] || 0) } : null,
          standing: cont ? all("select j.id, j.name, j.state, j.done from jobs j join runs r on r.id=j.run_id where r.pipeline_id=? and r.state='standing' and j.state!='done' order by j.id desc limit 3", p.id) : [],
          runs: all("select id, day, state, created, finished from runs where pipeline_id=? and state!='standing' order by id desc limit 7", p.id) };
      }),
      models: all("select * from models order by name, version desc limit 60").map((m) => ({ id: m.id, name: m.name, version: m.version, state: m.state, metrics: J(m.metrics, {}), created: m.created, note: m.note, run: m.run_id })),
    };
  }
  return { nextAt, setPipeline, startRun, tick, onJobDone, manifest, publicKeys, setModel, view, better, released, setEnabled: (id, v) => run("update pipelines set enabled=? where id=?", v ? 1 : 0, id) };
}

module.exports = { attach };
