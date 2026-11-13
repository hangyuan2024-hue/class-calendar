// 捞捞算力 · 调度中心的核心：成员、电脑、邀请、任务、租约、存档、审核、积分。全部存在一个 SQLite 文件里，重启就恢复。
// 三种分法：
//   map     拆成很多小任务，谁空谁领（生成数据、跑评测）
//   relay   接力训练：一次只跑一段，每隔几分钟存一次档；这台停了，下一台从最近的存档接着算
//   diloco  多台一起训：每一轮各自从同一个存档算一段，交上来的合并成下一轮的存档；掉线的不等，回来再加入
//   record  人工任务（录表情）：成员在软件里自己领
// 租约：领到任务的电脑要定时报平安（续约）；过期没报，任务回到队列，转给别的电脑。
"use strict";
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const LEASE_MS = 120000;
const MAX_ATTEMPTS = 5;   // 出错几次放一边
const MAX_LOST = 30;      // 掉线几次放一边
const now = () => Date.now();
const J = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch (e) { return d; } };
const S = (o) => JSON.stringify(o == null ? null : o);
const hash = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const rid = (n = 12) => crypto.randomBytes(n).toString("base64url");

const SCHEMA = `
create table if not exists kv(k text primary key, v text);
create table if not exists members(id integer primary key, name text not null, role text not null default 'member', created integer, points real not null default 0, reviews integer not null default 0, secs real not null default 0, disabled integer not null default 0);
create table if not exists devices(id integer primary key, member_id integer not null, name text, token_hash text unique, info text, state text, policy text, last_seen integer, task_id integer, secs real not null default 0, tasks integer not null default 0, disabled integer not null default 0, created integer, live text);
create table if not exists invites(code text primary key, role text, note text, created integer, expires integer, uses integer not null default 0, max_uses integer not null default 1);
create table if not exists recipes(id text primary key, name text, key text, sig text, meta text, created integer);
create table if not exists stages(id integer primary key, name text, sort integer, note text);
create table if not exists jobs(id integer primary key, name text, stage_id integer, kind text, recipe_id text, params text, req text, state text, priority integer not null default 0, created integer, finished integer, done integer not null default 0, total integer not null default 0, meta text, note text);
create table if not exists tasks(id integer primary key, job_id integer not null, kind text not null default 'run', seq integer, round integer, input text, state text not null default 'queued', attempts integer not null default 0, errors integer not null default 0, lost integer not null default 0, device_id integer, member_id integer, lease_until integer, started integer, finished integer, progress real, result text, error text);
create index if not exists tasks_q on tasks(job_id, state);
create index if not exists tasks_dev on tasks(device_id, started);
create table if not exists ckpts(id integer primary key, job_id integer, task_id integer, step integer, round integer, key text, kind text, created integer, device_id integer);
create table if not exists reviews(id integer primary key, job_id integer, task_id integer, kind text, payload text, need integer, state text not null default 'open', result text, created integer, votes integer not null default 0);
create table if not exists votes(review_id integer, member_id integer, choice text, created integer, primary key(review_id, member_id));
create table if not exists events(id integer primary key, ts integer, type text, msg text, device_id integer, job_id integer, member_id integer);
create table if not exists metrics(job_id integer, step integer, k text, v real, ts integer, device_id integer);
create index if not exists metrics_j on metrics(job_id, k, step);
create table if not exists outputs(id integer primary key, job_id integer, task_id integer, name text, key text, size integer, created integer);
`;

function open(file, opt = {}) {
  const db = new DatabaseSync(file);
  db.exec("pragma journal_mode=wal; pragma busy_timeout=5000;");
  db.exec(SCHEMA);
  const q = (sql) => db.prepare(sql);
  const one = (sql, ...a) => q(sql).get(...a);
  const all = (sql, ...a) => q(sql).all(...a);
  const run = (sql, ...a) => q(sql).run(...a);
  const tx = (fn) => { db.exec("begin immediate"); try { const r = fn(); db.exec("commit"); return r; } catch (e) { db.exec("rollback"); throw e; } };
  const clock = opt.clock || now;
  const leaseMs = opt.leaseMs || LEASE_MS;
  const listeners = new Set();

  function event(type, msg, o = {}) {
    run("insert into events(ts,type,msg,device_id,job_id,member_id) values(?,?,?,?,?,?)", clock(), type, msg, o.device || null, o.job || null, o.member || null);
    for (const f of listeners) { try { f({ type, msg, ...o }); } catch (e) {} }
  }
  const kv = { get: (k) => J((one("select v from kv where k=?", k) || {}).v), set: (k, v) => run("insert into kv(k,v) values(?,?) on conflict(k) do update set v=excluded.v", k, S(v)) };

  // ---------- 管理员、成员、电脑 ----------
  function adminToken() {
    let t = kv.get("adminToken");
    if (!t) { t = "adm_" + rid(24); kv.set("adminToken", t); }
    return t;
  }
  const isAdmin = (t) => !!t && t === kv.get("adminToken");
  function invite({ role = "member", note = "", hours = 72, maxUses = 1 } = {}) {
    const code = rid(6).replace(/[-_]/g, "x").slice(0, 8).toUpperCase();
    run("insert into invites(code,role,note,created,expires,max_uses) values(?,?,?,?,?,?)", code, role, note, clock(), clock() + hours * 3600e3, maxUses);
    event("invite", `发了邀请码（${role === "admin" ? "管理员" : "成员"}${note ? "，" + note : ""}）`);
    return { code, role, expires: clock() + hours * 3600e3 };
  }
  // 用邀请码加入：同一个人（名字一样）多台电脑算一个成员
  function join({ code, name, device = {} }) {
    name = String(name || "").trim().slice(0, 20);
    if (!name) throw new Error("写一下你的名字");
    return tx(() => {
      const inv = one("select * from invites where code=?", String(code || "").trim().toUpperCase());
      if (!inv) throw new Error("邀请码不对");
      if (inv.expires < clock()) throw new Error("邀请码过期了，找管理员要一个新的");
      if (inv.uses >= inv.max_uses) throw new Error("邀请码已经用过了，找管理员要一个新的");
      run("update invites set uses=uses+1 where code=?", inv.code);
      let m = one("select * from members where name=?", name);
      if (!m) { run("insert into members(name,role,created) values(?,?,?)", name, inv.role, clock()); m = one("select * from members where name=?", name); }
      else if (inv.role === "admin" && m.role !== "admin") run("update members set role='admin' where id=?", m.id);
      const token = "dev_" + rid(24);
      run("insert into devices(member_id,name,token_hash,info,state,policy,last_seen,created) values(?,?,?,?,?,?,?,?)", m.id, String(device.name || "电脑").slice(0, 40), hash(token), S(device.info || {}), "online", S(device.policy || {}), clock(), clock());
      const d = one("select * from devices where token_hash=?", hash(token));
      event("join", `${name} 的「${d.name}」加入了`, { device: d.id, member: m.id });
      return { token, device: d.id, member: { id: m.id, name: m.name, role: inv.role === "admin" ? "admin" : m.role } };
    });
  }
  function auth(token) {
    if (!token) return null;
    const d = one("select d.*, m.name as member_name, m.role as role, m.disabled as m_disabled from devices d join members m on m.id=d.member_id where d.token_hash=?", hash(token));
    if (!d || d.disabled || d.m_disabled) return null;
    return d;
  }

  // 报平安：电脑的状态（显卡、温度、在不在挂机）
  function heartbeat(dev, { info, state, policy, live } = {}) {
    run("update devices set last_seen=?, info=coalesce(?,info), state=coalesce(?,state), policy=coalesce(?,policy), live=coalesce(?,live) where id=?", clock(), info ? S(info) : null, state || null, policy ? S(policy) : null, live ? S(live) : null, dev.id);
    sweep();
    return { time: clock() };
  }

  // ---------- 配方（训练 / 生成的 Python 代码，管理员签名） ----------
  function addRecipe({ name, key, sig, meta, id }) {
    run("insert into recipes(id,name,key,sig,meta,created) values(?,?,?,?,?,?) on conflict(id) do update set name=excluded.name, key=excluded.key, sig=excluded.sig, meta=excluded.meta", id, name, key, sig, S(meta || {}), clock());
    event("recipe", `新配方「${name}」`);
    return one("select * from recipes where id=?", id);
  }

  // ---------- 阶段、任务 ----------
  function stage(name, note = "") {
    const s = one("select * from stages where name=?", name);
    if (s) return s.id;
    const sort = (one("select coalesce(max(sort),0)+1 as n from stages") || {}).n;
    return Number(run("insert into stages(name,sort,note) values(?,?,?)", name, sort, note).lastInsertRowid);
  }
  // kind=map：params.items（每个任务的输入）或 params.count；relay：params.totalSteps、segSteps；diloco：rounds、width、innerSteps、minDone、roundSecs；record：params.items（每段要读的句子）
  function createJob({ name, stage: st, kind, recipe, params = {}, req = {}, priority = 0, note = "" }) {
    if (!["map", "relay", "diloco", "record"].includes(kind)) throw new Error("没有这种任务：" + kind);
    if (kind !== "record" && !one("select id from recipes where id=?", recipe)) throw new Error("没有这个配方");
    return tx(() => {
      const sid = st ? stage(st) : null;
      let total = 0;
      if (kind === "map" || kind === "record") total = (params.items || []).length || params.count || 0;
      if (kind === "record" && params.perMember) total = 0;   // 每个人都录全部：谁来录就给谁建任务
      if (kind === "relay") total = params.totalSteps;
      if (kind === "diloco") total = params.rounds;
      const id = Number(run("insert into jobs(name,stage_id,kind,recipe_id,params,req,state,priority,created,total,note) values(?,?,?,?,?,?,?,?,?,?,?)", name, sid, kind, recipe || null, S(params), S(req), "active", priority, clock(), total, note).lastInsertRowid);
      if (kind === "map" || (kind === "record" && !params.perMember)) {
        const items = params.items || Array.from({ length: params.count || 0 }, (_, i) => ({ i }));
        items.forEach((it, i) => run("insert into tasks(job_id,kind,seq,input,state) values(?,?,?,?,?)", id, kind === "record" ? "human" : "run", i, S(it), "queued"));
      }
      if (kind === "relay") newSegment(id, params, 0);
      if (kind === "diloco") newRound(id, params, 0);
      event("job", `新任务「${name}」`, { job: id });
      return id;
    });
  }
  function newSegment(jobId, p, from) {
    const to = Math.min(p.totalSteps, from + (p.segSteps || p.totalSteps));
    run("insert into tasks(job_id,kind,seq,input,state) values(?,?,?,?,?)", jobId, "run", from, S({ from, to, totalSteps: p.totalSteps }), "queued");
  }
  function newRound(jobId, p, r) {
    for (let i = 0; i < (p.width || 3); i++) run("insert into tasks(job_id,kind,seq,round,input,state) values(?,?,?,?,?,?)", jobId, "run", i, r, S({ round: r, shard: i, innerSteps: p.innerSteps, width: p.width || 3 }), "queued");
    const meta = J((one("select meta from jobs where id=?", jobId) || {}).meta, {}) || {};
    meta.roundStart = clock(); meta.round = r;
    run("update jobs set meta=? where id=?", S(meta), jobId);
  }

  // 租约过期的任务回到队列（或者放弃）；DiLoCo 一轮到时间了就合并
  function sweep() {
    const t = clock();
    for (const k of all("select t.*, j.kind as jkind, j.name as jname from tasks t join jobs j on j.id=t.job_id where t.state='leased' and t.lease_until<?", t)) {
      const d = one("select d.name, m.name as mn from devices d join members m on m.id=d.member_id where d.id=?", k.device_id) || {};
      // 掉线不怪任务：只记一笔；连着掉线太多次（可能是任务本身把电脑搞崩了）才放一边
      if (k.lost + 1 >= MAX_LOST) { run("update tasks set state='failed', device_id=null, error=? where id=?", `换了 ${k.lost + 1} 台电脑都没算完`, k.id); event("fail", `「${k.jname}」有个任务换了 ${k.lost + 1} 次电脑都没算完，先放一边`, { job: k.job_id }); continue; }
      run("update tasks set state='queued', device_id=null, lease_until=null, lost=lost+1 where id=?", k.id);
      if (k.device_id) run("update devices set task_id=null where id=? and task_id=?", k.device_id, k.id);
      event("lost", `${d.mn || ""}的「${d.name || "电脑"}」掉线了，「${k.jname}」的任务交给下一台接着算`, { job: k.job_id, device: k.device_id });
    }
    for (const j of all("select * from jobs where kind='diloco' and state='active'")) maybeMerge(j);
  }
  function maybeMerge(j) {
    const p = J(j.params, {}), meta = J(j.meta, {}) || {};
    const r = meta.round || 0;
    if (one("select id from tasks where job_id=? and kind='merge' and round=?", j.id, r)) return;
    const done = all("select * from tasks where job_id=? and kind='run' and round=? and state='done'", j.id, r);
    const width = p.width || 3;
    const late = clock() - (meta.roundStart || 0) > (p.roundSecs || 3600) * 1000;
    if (done.length >= width || (late && done.length >= (p.minDone || 1))) {
      run("update tasks set state='dropped' where job_id=? and kind='run' and round=? and state in ('queued','leased')", j.id, r);
      run("insert into tasks(job_id,kind,seq,round,input,state) values(?,?,?,?,?,?)", j.id, "merge", 0, r, S({ round: r, parts: done.map((x) => J(x.result, {}).delta).filter(Boolean) }), "queued");
      event("merge", `「${j.name}」第 ${r + 1} 轮收齐了 ${done.length} 份，开始合并`, { job: j.id });
    }
  }

  // 机器能不能做这个任务（显存、内存、要不要显卡）
  function fits(req, caps) {
    if (!req) return true;
    if (req.gpu && !(caps.gpu && caps.vram)) return false;
    if (req.vram && (caps.vram || 0) < req.vram) return false;
    if (req.ram && (caps.ram || 0) < req.ram) return false;
    if (req.os && caps.os && req.os !== caps.os) return false;
    if (req.comfy && !caps.comfy) return false;   // 要装好 AI 引擎（ComfyUI + 画 Q版的模型）
    if (req.llm && !caps.llm) return false;       // 要能跑本地大模型（新版客户端自带 llama.cpp）
    if (req.gsv && !caps.gsv) return false;       // 要能装 GPT-SoVITS 整合包（Windows；训练声音）
    return true;
  }
  // 领一个活
  function lease(dev, caps = {}) {
    sweep();
    return tx(() => {
      const cur = dev.task_id && one("select * from tasks where id=? and state='leased' and device_id=?", dev.task_id, dev.id);
      if (cur) return pack(cur, dev);
      // 同样优先级的几个活：哪个现在在算的电脑少就先给哪个（几种活一起推进，比如画 Q版 和 做数学题）；
      // 一样少就接着做这台电脑上一个做的（模型还在显存里，不用重新加载）
      const last = (one("select job_id from tasks where device_id=? order by started desc limit 1", dev.id) || {}).job_id || 0;
      const jobs = all(`select j.*, (select count(*) from tasks t where t.job_id=j.id and t.state='leased') as busy from jobs j where j.state='active' and j.kind!='record'
        order by j.priority desc, busy asc, (j.id=?) desc, j.id asc`, last);
      for (const j of jobs) {
        if (!fits(J(j.req), caps)) continue;
        // 每日一轮里的任务：前面的步骤做完了才能开始
        const deps = J(j.deps, []) || [];
        if (deps.length && one(`select count(*) as n from jobs where id in (${deps.map(Number).join(",")}) and state!='done'`).n) continue;
        // 失败过的任务，排在后面再试；一台电脑不重复领自己刚失败的
        const t = one("select * from tasks where job_id=? and state='queued' and kind in ('run','merge') order by errors asc, case kind when 'merge' then 0 else 1 end, round asc, seq asc limit 1", j.id);
        if (!t) continue;
        run("update tasks set state='leased', device_id=?, member_id=?, lease_until=?, started=?, attempts=attempts+1, progress=0 where id=?", dev.id, dev.member_id, clock() + leaseMs, clock(), t.id);
        run("update devices set task_id=? where id=?", t.id, dev.id);
        const tt = one("select * from tasks where id=?", t.id);
        event("lease", `${dev.member_name}的「${dev.name}」开始算「${j.name}」${label(j, tt)}`, { job: j.id, device: dev.id });
        return pack(tt, dev);
      }
      return null;
    });
  }
  function label(j, t) {
    const i = J(t.input, {});
    if (t.kind === "merge") return `（第 ${t.round + 1} 轮合并）`;
    if (j.kind === "relay") return `（第 ${i.from}～${i.to} 步）`;
    if (j.kind === "diloco") return `（第 ${t.round + 1} 轮，第 ${t.seq + 1} 份）`;
    return `（第 ${t.seq + 1} 个）`;
  }
  // 交给电脑的东西：任务、配方、要接着算的存档
  function pack(t, dev) {
    const j = one("select * from jobs where id=?", t.job_id);
    const r = j.recipe_id && one("select * from recipes where id=?", j.recipe_id);
    const out = { task: { id: t.id, kind: t.kind, seq: t.seq, round: t.round, input: J(t.input, {}), attempts: t.attempts, leaseUntil: t.lease_until }, job: { id: j.id, name: j.name, kind: j.kind, params: J(j.params, {}) }, recipe: r ? { id: r.id, name: r.name, key: r.key, sig: r.sig, meta: J(r.meta, {}) } : null, resume: null };
    // 前面步骤的结果（文件由电脑下载到本机）、接着上一版训练的起点（warmStart）
    const deps = J(j.deps, []) || [];
    if (deps.length) {
      out.deps = {}; out.files = {};
      for (const d of deps) {
        const dj = one("select * from jobs where id=?", d);
        if (!dj) continue;
        const k = (J(dj.params, {}) || {}).stageKey || String(d), res = (J(dj.meta, {}) || {}).result || {};
        out.deps[k] = { result: res, outputs: all("select name, key, size from outputs where job_id=? order by id", d) };
        for (const [n, v] of Object.entries(res)) if (typeof v === "string" && /^jobs\//.test(v)) out.files[`${k}.${n}`] = v;
      }
    }
    // 参数里指向已发布模型文件的（warmStart、loraTest……）：电脑先下载到本机
    for (const [k, v] of Object.entries(J(j.params, {}) || {})) if (typeof v === "string" && /^jobs\//.test(v)) (out.files = out.files || {})[k] = v;
    // 训练某位老师的声音：params.voiceOf = 名字 → 这位老师录的每一句（带讲稿）和导入的录音
    const vo = (J(j.params, {}) || {}).voiceOf;
    if (vo) { const v = voiceData(vo); out.files = { ...(out.files || {}), ...v.files }; out.extra = { ...(out.extra || {}), texts: v.texts }; }
    // 训练要用到现在为止某一类任务交的所有结果文件（比如 tag = "qa-math" 的讲解）：params.outputsOf
    const of = (J(j.params, {}) || {}).outputsOf;
    if (of) {
      out.files = out.files || {};
      all("select o.key from outputs o join jobs jj on jj.id=o.job_id where json_extract(jj.params,'$.tag')=? order by o.id limit 20000", String(of)).forEach((o, n) => { out.files["data" + n] = o.key; });
    }
    if (j.kind === "relay") {
      const c = one("select * from ckpts where job_id=? and kind='relay' order by step desc, id desc limit 1", j.id);
      if (c) out.resume = { key: c.key, step: c.step };
    }
    if (j.kind === "diloco") {
      const c = one("select * from ckpts where job_id=? and kind='global' and round=? order by id desc limit 1", j.id, t.round);
      if (c) out.resume = { key: c.key, round: c.round };
    }
    return out;
  }
  function mine(dev, taskId) {
    const t = one("select * from tasks where id=?", taskId);
    if (!t || t.state !== "leased" || t.device_id !== dev.id) return null;
    return t;
  }
  // 续约，顺便报进度和曲线
  function renew(dev, { task, progress, metrics, live } = {}) {
    const t = mine(dev, task);
    if (!t) return { cancel: true, why: "这个任务已经交给别的电脑了" };
    const j = one("select * from jobs where id=?", t.job_id);
    if (j.state !== "active") return { cancel: true, why: j.state === "paused" ? "管理员暂停了这个任务" : "任务已经结束" };
    run("update tasks set lease_until=?, progress=? where id=?", clock() + leaseMs, progress == null ? t.progress : progress, t.id);
    saveMetrics(j.id, dev.id, metrics);
    if (live) run("update devices set live=? where id=?", S(live), dev.id);
    return { ok: true, leaseUntil: clock() + leaseMs };
  }
  // 中途存档（接力训练用）
  function checkpoint(dev, { task, step, key }) {
    const t = mine(dev, task);
    if (!t) throw new Error("这个任务已经不归你了");
    const j = one("select * from jobs where id=?", t.job_id);
    run("insert into ckpts(job_id,task_id,step,round,key,kind,created,device_id) values(?,?,?,?,?,?,?,?)", j.id, t.id, step, t.round, key, j.kind === "relay" ? "relay" : "part", clock(), dev.id);
    if (j.kind === "relay") run("update jobs set done=max(done,?) where id=?", step, j.id);
    return { ok: true };
  }
  // 做完了
  const saveMetrics = (jobId, devId, metrics) => { for (const m of metrics || []) for (const [k, v] of Object.entries(m)) if (k !== "step" && typeof v === "number" && isFinite(v)) run("insert into metrics(job_id,step,k,v,ts,device_id) values(?,?,?,?,?,?)", jobId, m.step || 0, k, v, clock(), devId); };
  function finish(dev, { task, result = {}, outputs = [], reviews = [], secs, metrics }) {
    return tx(() => {
      const t = mine(dev, task);
      if (!t) return { ok: false, why: "这个任务已经交给别的电脑了，结果不用了" };
      const j = one("select * from jobs where id=?", t.job_id);
      const p = J(j.params, {});
      const spent = secs != null ? secs : (clock() - t.started) / 1000;
      run("update tasks set state='done', finished=?, result=?, progress=1, lease_until=null where id=?", clock(), S(result), t.id);
      saveMetrics(j.id, dev.id, metrics);
      run("update devices set task_id=null, secs=secs+?, tasks=tasks+1 where id=?", spent, dev.id);
      run("update members set secs=secs+?, points=points+? where id=?", spent, spent / 60, dev.member_id);
      for (const o of outputs) run("insert into outputs(job_id,task_id,name,key,size,created) values(?,?,?,?,?,?)", j.id, t.id, o.name, o.key, o.size || 0, clock());
      for (const r of reviews) run("insert into reviews(job_id,task_id,kind,payload,need,created) values(?,?,?,?,?,?)", j.id, t.id, r.kind || "ab", S(r), r.need || p.reviewNeed || 2, clock());
      if (j.kind === "map") {
        const left = one("select count(*) as n from tasks where job_id=? and state in ('queued','leased')", j.id).n;
        run("update jobs set done=(select count(*) from tasks where job_id=? and state='done') where id=?", j.id, j.id);
        if (!left) endJob(j, j.total === 1 ? result : undefined);   // 只有一个小任务的（比如评测）：它的结果就是整个任务的结果
      }
      if (j.kind === "relay") {
        const i = J(t.input, {});
        if (result.ckpt) run("insert into ckpts(job_id,task_id,step,key,kind,created,device_id) values(?,?,?,?,?,?,?)", j.id, t.id, i.to, result.ckpt, "relay", clock(), dev.id);
        run("update jobs set done=? where id=?", i.to, j.id);
        // 到点了（每日一轮的 until）：这一段算完就收尾，用现在的结果
        if (i.to >= p.totalSteps || (p.deadline && clock() >= p.deadline)) endJob(j, result); else newSegment(j.id, p, i.to);
      }
      if (j.kind === "diloco") {
        if (t.kind === "merge") {
          run("insert into ckpts(job_id,task_id,step,round,key,kind,created,device_id) values(?,?,?,?,?,?,?,?)", j.id, t.id, 0, t.round + 1, result.global, "global", clock(), dev.id);
          run("update jobs set done=? where id=?", t.round + 1, j.id);
          event("round", `「${j.name}」第 ${t.round + 1} 轮合并好了${result.loss != null ? "，误差 " + (+result.loss).toFixed(4) : ""}`, { job: j.id });
          if (t.round + 1 >= p.rounds) endJob(j, result); else newRound(j.id, p, t.round + 1);
        } else maybeMerge(j);
      }
      event("done", `${dev.member_name}的「${dev.name}」算完了「${j.name}」${label(j, t)}`, { job: j.id, device: dev.id });
      return { ok: true };
    });
  }
  function endJob(j, result) {
    run("update jobs set state='done', finished=?, meta=json_set(coalesce(meta,'{}'),'$.result',json(?)) where id=?", clock(), S(result || {}), j.id);
    event("jobdone", `「${j.name}」全部完成`, { job: j.id });
  }
  // 到点收尾（每日一轮的 until）：没人领的小任务不做了；正在算的让它算完。
  //   返回 "wait"（还有在算的）、"empty"（一个都没做成）、"done"（收好了，后面的步骤可以开始）
  function cut(jobId) {
    return tx(() => {
      const j = one("select * from jobs where id=?", jobId);
      if (!j || j.state === "done") return "done";
      const dropped = Number(run("update tasks set state='dropped' where job_id=? and state='queued'", j.id).changes);
      const leased = one("select count(*) as n from tasks where job_id=? and state='leased'", j.id).n;
      const done = all("select * from tasks where job_id=? and kind='run' and state='done' order by id", j.id);
      if (j.kind === "map") run("update jobs set total=?, done=? where id=?", done.length + leased, done.length, j.id);
      if (dropped) event("cut", `「${j.name}」到点了：已经做了 ${done.length} 个${leased ? `，还有 ${leased} 个正在算的算完就收尾` : "，收尾"}`, { job: j.id });
      if (leased) return "wait";
      if (!done.length) return "empty";
      const last = J(done[done.length - 1].result, {});
      endJob(j, j.kind === "relay" ? last : done.length === 1 ? last : undefined);
      return "done";
    });
  }
  // 一直开着的任务（随时有人开着就画）：快领完了再补一批
  function addTasks(jobId, n) {
    return tx(() => {
      const j = one("select * from jobs where id=?", jobId);
      if (!j || j.kind !== "map") return 0;
      const from = (one("select coalesce(max(seq),-1)+1 as n from tasks where job_id=?", jobId) || {}).n || 0;
      for (let i = 0; i < n; i++) run("insert into tasks(job_id,kind,seq,input,state) values(?,?,?,?,?)", jobId, "run", from + i, S({ i: from + i }), "queued");
      run("update jobs set total=(select count(*) from tasks where job_id=? and state!='dropped') where id=?", jobId, jobId);
      return n;
    });
  }
  // 换下来（配方或模型更新了）：没人领的不做了，正在算的算完；一个都没做的直接结束
  function retire(jobId) {
    const c = cut(jobId);
    if (c === "empty") run("update jobs set state='done', finished=? where id=? and state!='done'", clock(), jobId);
    return c;
  }
  // 导入的录音：记在「导入的录音」这个任务下，算这位老师的（训练声音时一起用）
  function importVoice({ member, key, name, size }) {
    if (!/^imports\/[\w.\-]+$/.test(String(key || ""))) throw new Error("文件不对");
    const m = one("select * from members where name=?", String(member || ""));
    if (!m) throw new Error("没有叫「" + member + "」的成员（要先用邀请链接加入）");
    const find = () => one("select * from jobs where kind='record' and json_extract(params,'$.purpose')='voice-import' order by id limit 1");
    if (!find()) createJob({ name: "导入的录音", stage: "阶段 1 · 数据", kind: "record", params: { purpose: "voice-import", perMember: true, items: [] } });
    return tx(() => {
      const j = find();
      const tid = Number(run("insert into tasks(job_id,kind,seq,input,state,member_id,finished,result) values(?,?,?,?,?,?,?,?)", j.id, "human", 0, S({ import: name }), "done", m.id, clock(), S({ imported: true })).lastInsertRowid);
      run("insert into outputs(job_id,task_id,name,key,size,created) values(?,?,?,?,?,?)", j.id, tid, String(name || key).slice(0, 120), key, +size || 0, clock());
      event("record", `导入了${m.name}的录音「${name}」`, { job: j.id, member: m.id });
      return { ok: true };
    });
  }
  // 某位老师的声音数据：录的每一句（有讲稿）+ 导入的整段录音（没有讲稿，要先切开、识别）
  function voiceData(memberName) {
    const m = one("select * from members where name=?", String(memberName || ""));
    if (!m) return { files: {}, texts: {} };
    const files = {}, texts = {};
    all(`select o.key, o.name, t.input, json_extract(j.params,'$.purpose') as purpose from outputs o join tasks t on t.id=o.task_id join jobs j on j.id=o.job_id
         where j.kind='record' and t.member_id=? and t.state='done' and json_extract(j.params,'$.purpose') like 'voice%' order by o.id limit 5000`, m.id).forEach((o, n) => {
      if (o.purpose === "voice-import") { files["imp" + n] = o.key; return; }
      const k = /^s(\d{3})\.webm$/.exec(o.name);
      if (!k) return;
      const line = ((J(o.input, {}) || {}).lines || [])[+k[1]];
      if (!line) return;
      files["rec" + n] = o.key; texts["rec" + n] = line;
    });
    return { files, texts };
  }
  // 训练要用的人工审核结果：只给手上正领着这个任务的电脑（params.dataset 写的是哪一类审核）
  function dataset(dev, { task }) {
    const t = mine(dev, task);
    if (!t) throw new Error("这个任务已经不归你了");
    const tag = (J(one("select params from jobs where id=?", t.job_id).params, {}) || {}).dataset;
    if (!tag) throw new Error("这个任务不用审核数据");
    return all("select r.id, r.job_id, r.kind, r.payload, r.result, r.created from reviews r where r.state='done' and json_extract(r.payload,'$.tag')=? order by r.id", String(tag))
      .map((r) => ({ id: r.id, job: r.job_id, kind: r.kind, payload: J(r.payload, {}), result: J(r.result, {}), created: r.created }));
  }
  // 出错了；release=true 是老师要用电脑了（不算失败次数）
  function fail(dev, { task, error, release }) {
    const t = mine(dev, task);
    if (!t) return { ok: true };
    run("update tasks set state='queued', device_id=null, lease_until=null, error=?, errors=errors+? where id=?", String(error || "").slice(0, 2000), release ? 0 : 1, t.id);
    run("update devices set task_id=null where id=?", dev.id);
    const j = one("select * from jobs where id=?", t.job_id);
    if (!release && t.errors + 1 >= MAX_ATTEMPTS) run("update tasks set state='failed' where id=?", t.id);
    event(release ? "release" : "error", release ? `${dev.member_name}的「${dev.name}」要用电脑了，「${j.name}」交给别人接着算` : `${dev.member_name}的「${dev.name}」算「${j.name}」出错了：${String(error || "").split("\n").filter(Boolean).pop() || "没说原因"}`, { job: j.id, device: dev.id });
    return { ok: true };
  }

  // ---------- 人工任务：录表情 ----------
  function humanNext(dev, jobId) {
    sweep();
    return tx(() => {
      const cur = one("select t.* from tasks t join jobs j on j.id=t.job_id where t.kind='human' and t.state='leased' and t.member_id=? and j.state='active' and (? is null or t.job_id=?) limit 1", dev.member_id, jobId || null, jobId || null);
      let t = cur || one("select t.* from tasks t join jobs j on j.id=t.job_id where t.kind='human' and t.state='queued' and j.state='active' and not coalesce(json_extract(j.params,'$.perMember'),0) and (? is null or t.job_id=?) order by j.priority desc, t.seq asc limit 1", jobId || null, jobId || null);
      // 每个人都要录全部的（录声音：每位老师的声音单独训练）：这个人还没录的下一段，现建一个任务给他
      if (!t) {
        for (const pj of all("select * from jobs where kind='record' and state='active' and json_extract(params,'$.perMember') and (? is null or id=?) order by priority desc, id asc", jobId || null, jobId || null)) {
          const items = (J(pj.params, {}) || {}).items || [];
          const mine = new Set(all("select seq from tasks where job_id=? and member_id=? and state in ('leased','done')", pj.id, dev.member_id).map((x) => x.seq));
          const seq = items.findIndex((_, i) => !mine.has(i));
          if (seq < 0) continue;
          const old = one("select * from tasks where job_id=? and member_id=? and seq=? and state='queued'", pj.id, dev.member_id, seq);
          const id = old ? old.id : Number(run("insert into tasks(job_id,kind,seq,input,state,member_id) values(?,?,?,?,?,?)", pj.id, "human", seq, S(items[seq]), "queued", dev.member_id).lastInsertRowid);
          run("update jobs set total=(select count(*) from tasks where job_id=?) + 0 where id=?", pj.id, pj.id);
          t = one("select * from tasks where id=?", id);
          break;
        }
      }
      if (!t) return null;
      if (!cur) run("update tasks set state='leased', device_id=?, member_id=?, lease_until=?, started=?, attempts=attempts+1 where id=?", dev.id, dev.member_id, clock() + 6 * 3600e3, clock(), t.id);
      const j = one("select * from jobs where id=?", t.job_id);
      return { task: { id: t.id, seq: t.seq, input: J(t.input, {}) }, job: { id: j.id, name: j.name, params: J(j.params, {}), done: j.done, total: j.total } };
    });
  }
  function humanDone(dev, { task, outputs = [], result = {} }) {
    return tx(() => {
      const t = one("select * from tasks where id=? and kind='human' and member_id=? and state='leased'", task, dev.member_id);
      if (!t) throw new Error("这一段已经交过了");
      run("update tasks set state='done', finished=?, result=?, device_id=? where id=?", clock(), S(result), dev.id, t.id);
      for (const o of outputs) run("insert into outputs(job_id,task_id,name,key,size,created) values(?,?,?,?,?,?)", t.job_id, t.id, o.name, o.key, o.size || 0, clock());
      run("update jobs set done=(select count(*) from tasks where job_id=? and state='done') where id=?", t.job_id, t.job_id);
      const pts = (result.secs || 60) / 60 * 3;
      run("update members set points=points+? where id=?", pts, dev.member_id);
      const j = one("select * from jobs where id=?", t.job_id);
      if (j.done >= j.total && !(J(j.params, {}) || {}).perMember) endJob(j);   // 每个人都录的：一直开着，新同事来了也能录
      event("record", `${dev.member_name}录好了「${j.name}」第 ${t.seq + 1} 段`, { job: j.id, device: dev.id, member: dev.member_id });
      return { ok: true };
    });
  }

  // ---------- 人工审核：大家都能做 ----------
  function reviewNext(dev) {
    return one("select r.*, j.name as job_name from reviews r join jobs j on j.id=r.job_id where r.state='open' and not exists(select 1 from votes v where v.review_id=r.id and v.member_id=?) order by r.votes desc, r.id asc limit 1", dev.member_id) || null;
  }
  function vote(dev, { review, choice }) {
    return tx(() => {
      const r = one("select * from reviews where id=?", review);
      if (!r) throw new Error("没有这一条");
      if (r.state !== "open") return { ok: true, closed: true };
      const p = J(r.payload, {});
      const allowed = p.choices ? p.choices.map((c) => c.id || c) : r.kind === "ab" ? ["a", "b", "same", "bad"] : ["pass", "fail", "skip"];
      if (!allowed.includes(choice)) throw new Error("选项不对");
      try { run("insert into votes(review_id,member_id,choice,created) values(?,?,?,?)", r.id, dev.member_id, choice, clock()); } catch (e) { return { ok: true, dup: true }; }
      run("update reviews set votes=votes+1 where id=?", r.id);
      run("update members set reviews=reviews+1, points=points+1 where id=?", dev.member_id);
      const vs = all("select choice, count(*) as n from votes where review_id=? and choice!='skip' group by choice order by n desc", r.id);
      const total = vs.reduce((a, b) => a + b.n, 0);
      // 够票数、而且第一名过半就定下来；票数到两倍还分不出来，也定下来（记成平局）
      if ((total >= r.need && vs[0] && vs[0].n * 2 > total) || total >= r.need * 2) {
        const res = { choice: vs[0] && vs[0].n * 2 > total ? vs[0].choice : "tie", votes: Object.fromEntries(vs.map((v) => [v.choice, v.n])) };
        run("update reviews set state='done', result=? where id=?", S(res), r.id);
      }
      return { ok: true };
    });
  }

  // ---------- 看板 ----------
  function devicesView(admin) {
    return all("select d.*, m.name as member_name, t.job_id, t.progress, j.name as job_name from devices d join members m on m.id=d.member_id left join tasks t on t.id=d.task_id left join jobs j on j.id=t.job_id where d.disabled=0 order by d.id").map((d) => {
      const online = clock() - (d.last_seen || 0) < 90000;
      const info = J(d.info, {}) || {};
      return { id: d.id, name: d.name, member: d.member_name, online, state: online ? (d.task_id ? "busy" : d.state || "idle") : "offline", gpu: info.gpu || "", vram: info.vram || 0, ram: info.ram || 0, version: info.version || "", task: d.task_id ? { job: d.job_id, name: d.job_name, progress: d.progress } : null, secs: d.secs, tasks: d.tasks, live: J(d.live, null), lastSeen: d.last_seen, ...(admin ? { info } : {}) };
    });
  }
  function jobsView() {
    return all("select j.*, s.name as stage_name, s.sort as stage_sort from jobs j left join stages s on s.id=j.stage_id order by coalesce(s.sort, 999), j.id").map((j) => {
      const c = Object.fromEntries(all("select state, count(*) as n from tasks where job_id=? group by state", j.id).map((x) => [x.state, x.n]));
      const rv = one("select count(*) as n, sum(state='done') as d from reviews where job_id=?", j.id);
      const pct = j.state === "done" ? 1 : j.total ? Math.min(1, j.done / j.total) : 0;
      // 速度：最近完成的任务的平均间隔 → 预计还要多久
      let eta = null;
      if (j.state === "active" && j.total && j.done) { const el = (clock() - j.created) / 1000; eta = Math.round(el / j.done * (j.total - j.done)); }
      const meta = J(j.meta, {}) || {};
      return { id: j.id, name: j.name, stage: j.stage_name, kind: j.kind, state: j.state, priority: j.priority, done: j.done, total: j.total, pct, eta, tasks: c, reviews: { total: rv.n || 0, done: rv.d || 0 }, created: j.created, finished: j.finished, round: meta.round, result: meta.result || null, note: j.note, recipe: j.recipe_id };
    });
  }
  function overview(admin) {
    const jobs = jobsView();
    const stages = all("select * from stages order by sort").map((s) => {
      const js = jobs.filter((j) => j.stage === s.name);
      return { name: s.name, note: s.note, jobs: js.length, pct: js.length ? js.reduce((a, b) => a + b.pct, 0) / js.length : 0 };
    });
    const devices = devicesView(admin);
    const total = jobs.length ? jobs.reduce((a, b) => a + b.pct, 0) / jobs.length : 0;
    return {
      time: clock(), total, stages, jobs, devices,
      online: devices.filter((d) => d.online).length,
      busy: devices.filter((d) => d.state === "busy").length,
      reviewsOpen: (one("select count(*) as n from reviews where state='open'") || {}).n,
      events: all("select * from events order by id desc limit 40"),
      board: board(),
    };
  }
  function board() {
    return all("select m.id, m.name, m.points, m.secs, m.reviews, (select count(*) from devices d where d.member_id=m.id and d.disabled=0) as devices, (select count(*) from tasks t where t.member_id=m.id and t.state='done' and t.kind='human') as records from members m where m.disabled=0 order by m.points desc");
  }
  function jobDetail(id) {
    const j = jobsView().find((x) => x.id === +id);
    if (!j) return null;
    const ks = all("select distinct k from metrics where job_id=?", id).map((x) => x.k);
    const curves = Object.fromEntries(ks.map((k) => [k, all("select step, v from metrics where job_id=? and k=? order by step, ts", id, k).filter((r, i, a) => i % Math.ceil(a.length / 400 || 1) === 0).map((r) => [r.step, r.v])]));
    const tasks = all("select t.id,t.kind,t.seq,t.round,t.state,t.attempts,t.errors,t.lost,t.progress,t.error,t.started,t.finished,d.name as device,m.name as member from tasks t left join devices d on d.id=t.device_id left join members m on m.id=t.member_id where t.job_id=? order by t.id desc limit 60", id);
    const ckpts = all("select step, round, kind, created from ckpts where job_id=? order by id desc limit 10", id);
    const outputs = all("select name, key, size from outputs where job_id=? order by id desc limit 200", id);
    const reviews = all("select id, kind, state, votes, result, payload from reviews where job_id=? order by id desc limit 200", id).map((r) => ({ ...r, result: J(r.result), payload: J(r.payload) }));
    return { ...j, curves, tasks, ckpts, outputs, reviews };
  }
  function setJob(id, { state, priority }) {
    const j = one("select * from jobs where id=?", id);
    if (!j) throw new Error("没有这个任务");
    if (state && ["active", "paused"].includes(state) && j.state !== "done") { run("update jobs set state=? where id=?", state, id); event("job", `「${j.name}」${state === "paused" ? "暂停了" : "继续"}`, { job: id }); }
    if (priority != null) run("update jobs set priority=? where id=?", +priority, id);
    return { ok: true };
  }
  function setDevice(id, { disabled }) { run("update devices set disabled=? where id=?", disabled ? 1 : 0, id); if (disabled) { const d = one("select * from devices where id=?", id); if (d && d.task_id) run("update tasks set state='queued', device_id=null, lease_until=null where id=? and state='leased'", d.task_id); } return { ok: true }; }
  function retry(jobId) { run("update tasks set state='queued', errors=0, lost=0, error=null where job_id=? and state='failed'", jobId); run("update jobs set state='active' where id=? and state!='done'", jobId); return { ok: true }; }

  return {
    db, kv, event, on: (f) => (listeners.add(f), () => listeners.delete(f)),
    adminToken, isAdmin, invite, join, auth, heartbeat, addRecipe, stage, createJob, lease, renew, checkpoint, finish, fail, sweep,
    humanNext, humanDone, reviewNext, vote, cut, retire, addTasks, dataset, importVoice, voiceData, overview, jobDetail, devicesView, board, setJob, setDevice, retry,
    recipe: (id) => one("select * from recipes where id=?", id), recipes: () => all("select id,name,meta,created from recipes order by created desc"),
    review: (id) => one("select * from reviews where id=?", id),
    invites: () => all("select * from invites order by created desc limit 50"),
    exportReviews: (jobId) => all("select r.id, r.kind, r.payload, r.result, r.state from reviews r where r.job_id=?", jobId).map((r) => ({ ...r, payload: J(r.payload), result: J(r.result) })),
    outputs: (jobId) => all("select * from outputs where job_id=? order by id", jobId),
    close: () => db.close(),
  };
}

module.exports = { open, hash };
