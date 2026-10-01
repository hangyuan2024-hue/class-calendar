const $ = (id) => document.getElementById(id);
const form = $("form");
let mode = "login";
const next = new URLSearchParams(location.search).get("next");
const safeNext = next && /^[a-z0-9_-]+\.html([?#].*)?$/i.test(next) ? next : null;

function setMode(m) {
  mode = m;
  form.classList.toggle("signup", m === "signup");
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  $("go").textContent = m === "signup" ? "注册并登录" : "登录";
  $("password").autocomplete = m === "signup" ? "new-password" : "current-password";
  $("note").textContent = m === "signup" ? "开发者、测试员身份由管理员在后台分配。" : "";
  $("msg").textContent = "";
}
document.querySelector(".tabs").onclick = (e) => { const b = e.target.closest("button[data-mode]"); if (b) setMode(b.dataset.mode); };

async function afterLogin() {
  const me = await CCAuth.me();
  let dest = "index.html";
  if (me && me.role === "teacher") dest = "class.html";
  else if (me && ["admin", "developer", "tester"].includes(me.role)) dest = "dev.html";
  location.href = safeNext || dest;
}

form.onsubmit = async (e) => {
  e.preventDefault();
  $("msg").textContent = "";
  const account = $("account").value, password = $("password").value;
  if (mode === "signup" && password !== $("password2").value) { $("msg").textContent = "两次输入的密码不一样"; return; }
  $("go").disabled = true;
  try {
    if (mode === "signup") await CCAuth.signUp(account, password, $("name").value,
      (document.querySelector('input[name=role]:checked') || {}).value);
    else await CCAuth.signIn(account, password);
    await afterLogin();
  } catch (err) {
    $("msg").textContent = err.message;
  } finally {
    $("go").disabled = false;
  }
};

(async () => {
  const s = await CCAuth.session();
  if (!s) return;
  const me = await CCAuth.me();
  if (!me) return;
  $("alreadyName").textContent = `${me.display_name}（${CCAuth.ROLE_NAMES[me.role] || me.role}）`;
  $("already").classList.remove("hidden"); $("loginBox").classList.add("hidden");
})();
$("continueBtn").onclick = afterLogin;
$("switchBtn").onclick = async () => {
  await CCAuth.signOut();
  $("already").classList.add("hidden"); $("loginBox").classList.remove("hidden");
};
