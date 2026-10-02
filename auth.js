// 班级群日历 · 登录与数据接口（index.html / login.html / dev.html 共用）
// 账号在后台对应一个内部邮箱：<账号>@<AUTH_EMAIL_DOMAIN>，用户不需要真实邮箱。
(function () {
  const CFG = window.APP_CONFIG || {};
  const BASE = CFG.SUPABASE_URL || "";
  const KEY = CFG.SUPABASE_ANON_KEY || "";
  const DOMAIN = CFG.AUTH_EMAIL_DOMAIN || "calendar.test";
  const LS = "cc_session_v1";

  const ROLE_NAMES = { admin: "管理员", developer: "开发者", tester: "测试员", teacher: "老师", monitor: "班委", student: "学生" };
  const STAFF = ["admin", "developer", "tester"];
  // 后台功能权限（管理员在插件后台给开发者/测试员勾选）
  const STAFF_PERMS = {
    try_testing: "试用测试中的插件", upload: "上传、管理自己的插件", view_code: "查看待审核插件的代码",
    publish: "同意插件上架", reject: "驳回插件", unpublish: "下架已发布的插件",
    set_default: "设置插件默认开启", transfer: "转交插件作者", manage_users: "给用户分配身份",
  };
  const LEGACY_PERMS = { admin: Object.keys(STAFF_PERMS), developer: ["try_testing", "upload"], tester: ["try_testing"] };
  const PERM_NAMES = { can_ingest: "AI 整理", can_edit: "增改事项", can_delete: "删除事项", can_view_members: "看成员名单" };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const load = () => { try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; } };
  const store = (s) => { try { s ? localStorage.setItem(LS, JSON.stringify(s)) : localStorage.removeItem(LS); } catch {} };

  const ACCOUNT_RE = /^[a-z0-9_]{3,20}$/;
  function normAccount(a) { return String(a || "").trim().toLowerCase(); }

  function humanError(j, status) {
    const m = String(j.msg || j.error_description || j.message || j.error || j.hint || "");
    if (/invalid login credentials/i.test(m)) return "账号或密码错误";
    if (/already (registered|exists)/i.test(m)) return "这个账号已经被注册了，换一个或直接登录";
    if (/password should be/i.test(m)) return "密码太短，至少 8 位";
    if (/signups? not allowed|signup is disabled/i.test(m)) return "暂时关闭了注册，请联系管理员";
    if (/email not confirmed/i.test(m)) return "账号还没激活，请联系管理员";
    if (/[\u4e00-\u9fa5]/.test(m)) return m;   // 数据库里写好的中文提示直接显示
    if (/row-level security|permission denied|42501/i.test(m) || status === 403) return "没有权限执行这个操作";
    if (/JWT expired/i.test(m)) return "登录已过期，请重新登录";
    return m || `请求失败（${status}）`;
  }

  // 人多的时候：读数据的请求遇到「服务器忙 / 网络抖动」会自动重试（等一小会儿、每人错开时间），
  // 写数据的请求不重试（避免重复提交）。每个请求最多等 20 秒。
  const SAFE_RPC = /\/rpc\/(app_bootstrap|my_classes|my_perms|feature_state|mail_my|growth_board|wall_my_reports|wall_report_list|credit_list|class_roster|parse_feedback_list|ingest_job_status|class_features_get|admin_features|ics_my_feed|udata_pull|udata_push)$/;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function call(url, opts, token) {
    const method = (opts.method || "GET").toUpperCase();
    const retryable = method === "GET" || SAFE_RPC.test(url.split("?")[0]);
    for (let attempt = 0; ; attempt++) {
      let res, netErr = null;
      const ctl = typeof AbortController === "function" ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 20000) : 0;
      try {
        res = await fetch(url, {
          ...opts, signal: ctl ? ctl.signal : undefined,
          headers: { apikey: KEY, Authorization: "Bearer " + (token || KEY), "Content-Type": "application/json", ...(opts.headers || {}) },
        });
      } catch (e) { netErr = e; } finally { clearTimeout(timer); }
      const busy = netErr || (res && [429, 502, 503, 504].includes(res.status));
      // 服务器忙：最多重试 3 次；连不上网：只重试 1 次（断网时别让人干等）
      const maxTry = netErr ? (navigator.onLine === false ? 0 : 1) : 3;
      if (busy && retryable && attempt < maxTry) {
        const ra = res && Number(res.headers.get("Retry-After"));
        await sleep(ra ? Math.min(ra, 10) * 1000 : 500 * 2 ** attempt + Math.random() * 600);
        continue;
      }
      if (netErr) throw new Error(netErr.name === "AbortError" ? "服务器响应太慢，请稍后重试" : "网络连接失败，请检查网络后重试");
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
      if (!res.ok) {
        if ([429, 502, 503, 504].includes(res.status)) throw new Error("现在用的人太多了，请过一会儿再试");
        const err = new Error(humanError(body || {}, res.status)); err.status = res.status; throw err;
      }
      return body;
    }
  }

  function keep(j) {
    const s = {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
      user_id: j.user && j.user.id,
    };
    store(s);
    return s;
  }

  let refreshing = null;
  async function session() {
    const s = load();
    if (!s || !s.access_token) return null;
    if (s.expires_at - 60 > Date.now() / 1000) return s;
    if (!refreshing) {
      refreshing = call(BASE + "/auth/v1/token?grant_type=refresh_token",
        { method: "POST", body: JSON.stringify({ refresh_token: s.refresh_token }) })
        .then(keep)
        // 只有服务器明确说「登录已失效」才退出；网络不好、服务器忙时保留登录，下次再续
        .catch((e) => { if (e && (e.status === 400 || e.status === 401)) { store(null); return null; } return s; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function signIn(account, password) {
    account = normAccount(account);
    if (!ACCOUNT_RE.test(account)) throw new Error("账号只能用 3~20 位小写字母、数字或下划线");
    const j = await call(BASE + "/auth/v1/token?grant_type=password",
      { method: "POST", body: JSON.stringify({ email: account + "@" + DOMAIN, password }) });
    meCache = null;
    return keep(j);
  }

  async function signUp(account, password, name, role, gender) {
    account = normAccount(account);
    name = String(name || "").trim();
    if (!ACCOUNT_RE.test(account)) throw new Error("账号只能用 3~20 位小写字母、数字或下划线");
    if (!name) throw new Error("请填写姓名（会显示为插件作者）");
    if (String(password).length < 8) throw new Error("密码至少 8 位");
    const j = await call(BASE + "/auth/v1/signup",
      { method: "POST", body: JSON.stringify({ email: account + "@" + DOMAIN, password, data: { name, role: role === "teacher" ? "teacher" : "student", gender: gender === "m" || gender === "f" ? gender : "" } }) });
    meCache = null;
    if (j && j.access_token) return keep(j);
    // 部分配置下注册不直接返回登录状态，再登录一次
    return signIn(account, password);
  }

  // 退出：先让服务器作废这次登录（包括刷新令牌），再清掉本机的登录信息
  async function signOut() {
    let s = null;
    try { s = await session(); } catch {}
    s = s || load();
    if (s) { try { await call(BASE + "/auth/v1/logout?scope=local", { method: "POST" }, s.access_token); } catch {} }
    store(null); meCache = null;
  }

  // PostgREST 查询：path 如 "plugins?select=id,name"
  async function rest(path, opts = {}) {
    const s = await session();
    return call(BASE + "/rest/v1/" + path, opts, s && s.access_token);
  }
  async function rpc(fn, args) {
    return rest("rpc/" + fn, { method: "POST", body: JSON.stringify(args || {}) });
  }

  let meCache = null, meLoading = null;
  // 打开网页时一次拿齐数据（app_bootstrap），顺便把用户信息存好，后面不用再单独请求
  function primeMe(me, perms) { if (me) { meCache = { ...me, perms: perms || LEGACY_PERMS[me.role] || [] }; } }
  // 同一时间多处要用户信息时只请求一次
  function me() {
    if (meCache) return Promise.resolve(meCache);
    if (!meLoading) meLoading = loadMe().finally(() => { meLoading = null; });
    return meLoading;
  }
  async function loadMe() {
    const s = await session();
    if (!s || !s.user_id) return null;
    try {
      const rows = await rest("profiles?select=id,account,display_name,role&id=eq." + encodeURIComponent(s.user_id));
      meCache = rows && rows[0] ? rows[0] : null;
    } catch { meCache = null; }
    if (meCache) {
      try { meCache.perms = (await rpc("my_perms")) || []; }
      catch { meCache.perms = LEGACY_PERMS[meCache.role] || []; }   // 数据库还没升级时按老规则
    }
    return meCache;
  }

  const can = (user, perm) => !!(user && user.perms && user.perms.includes(perm));
  window.CCAuth = { primeMe, signIn, signUp, signOut, session, rest, rpc, me, esc, can, ROLE_NAMES, STAFF, STAFF_PERMS, PERM_NAMES, ACCOUNT_RE };
})();
