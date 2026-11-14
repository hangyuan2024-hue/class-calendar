// 捞捞算力 · 防休眠 / 合盖继续算
//   · 要算的时候（正在算、或者「开始」了在等任务）不让电脑睡：
//       Electron 的 powerSaveBlocker（SetThreadExecutionState，老式待机管用）
//     + Windows 的 PowerRequest「执行必需」（现代待机 / S0ix 的笔记本，屏幕关了也照样跑；只靠上面那个管不住）
//   · 合上盖子也继续算（自愿，只在插着电时）：改当前电源计划里「合盖」的插电动作为「不采取任何操作」，关掉这个选项时改回原来的
"use strict";
const { spawn, execFile } = require("child_process");

// PowerShell 里调 kernel32 的 PowerCreateRequest / PowerSetRequest；父进程没了自己退出（不会留着让电脑永远不睡）
const PS = (pid) => `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class LgPower {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct Ctx { public uint Version; public uint Flags; public string Reason; }
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr PowerCreateRequest(ref Ctx c);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool PowerSetRequest(IntPtr h, int t);
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);
}
"@
$c = New-Object LgPower+Ctx; $c.Version = 0; $c.Flags = 1; $c.Reason = 'LaolaoGrid is training'
$h = [LgPower]::PowerCreateRequest([ref]$c)
[void][LgPower]::PowerSetRequest($h, 1)   # SystemRequired
[void][LgPower]::PowerSetRequest($h, 3)   # ExecutionRequired（现代待机）
[void][LgPower]::SetThreadExecutionState(0x80000041)   # ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED
Write-Output 'LG_POWER_OK'
while ($true) { Start-Sleep -Seconds 20; if (-not (Get-Process -Id ${pid} -ErrorAction SilentlyContinue)) { break } }
`;

function create(o = {}) {
  const log = o.log || (() => {});
  const isWin = (o.platform || process.platform) === "win32";
  const doSpawn = o.spawn || spawn;
  const run = o.execFile || ((cmd, args) => new Promise((ok, bad) => execFile(cmd, args, { windowsHide: true, timeout: 20000 }, (e, out) => (e ? bad(e) : ok(String(out))))));
  let blockId = null, helper = null, awake = false, why = "";

  function keepAwake(on, reason = "") {
    on = !!on;
    if (on === awake) return awake;
    awake = on; why = reason;
    if (on) {
      try { if (o.powerSaveBlocker && blockId == null) blockId = o.powerSaveBlocker.start("prevent-app-suspension"); } catch (e) { log("防休眠（Electron）没成功：" + e.message); }
      if (isWin && !helper) {
        try {
          helper = doSpawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PS(process.pid)], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
          helper.stdout && helper.stdout.on("data", (d) => { if (/LG_POWER_OK/.test(String(d))) log("防休眠已开：" + (reason || "要算")); });
          helper.stderr && helper.stderr.on("data", (d) => log("防休眠：" + String(d).trim().slice(0, 200)));
          const me = helper;
          helper.on("exit", () => { if (helper === me) helper = null; });
          helper.on("error", (e) => { log("防休眠没开起来：" + e.message); if (helper === me) helper = null; });
        } catch (e) { log("防休眠没开起来：" + e.message); helper = null; }
      }
    } else {
      try { if (o.powerSaveBlocker && blockId != null) o.powerSaveBlocker.stop(blockId); } catch (e) {}
      blockId = null;
      if (helper) { try { helper.kill(); } catch (e) {} helper = null; }
      log("防休眠关了（不算的时候电脑照常睡）");
    }
    return awake;
  }

  // 合盖动作（插电）：0 不采取任何操作 / 1 睡眠 / 2 休眠 / 3 关机
  async function lidAc() {
    if (!isWin) return null;
    const out = await run("powercfg", ["/q", "SCHEME_CURRENT", "SUB_BUTTONS", "LIDACTION"]);
    const m = /(?:Current AC Power Setting Index|当前交流电源设置索引)[:：]\s*0x([0-9a-f]+)/i.exec(out);
    return m ? parseInt(m[1], 16) : null;
  }
  async function setLidAc(v) {
    if (!isWin) return false;
    await run("powercfg", ["/setacvalueindex", "SCHEME_CURRENT", "SUB_BUTTONS", "LIDACTION", String(v)]);
    await run("powercfg", ["/setactive", "SCHEME_CURRENT"]);
    return true;
  }
  // on：记下原来的设置再改成「不采取任何操作」；off：改回记下的
  async function lidKeepRunning(on, saved) {
    if (!isWin) return { ok: false, why: "只有 Windows 能设置" };
    try {
      if (on) {
        const before = await lidAc();
        if (before !== 0) await setLidAc(0);
        return { ok: true, saved: before == null ? saved : before === 0 ? saved : before };
      }
      if (saved != null && saved !== 0) await setLidAc(saved);
      return { ok: true, saved: null };
    } catch (e) { return { ok: false, why: "改电源设置没成功：" + e.message }; }
  }

  return { keepAwake, lidKeepRunning, lidAc, status: () => ({ awake, why, helper: !!helper }) };
}

module.exports = { create, PS };
