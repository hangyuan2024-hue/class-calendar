// 捞捞算力 · 远程协助：在这台电脑上执行对方的鼠标键盘（只在 Windows 上；同意了「查看和操控」才会开）
//   开一个 PowerShell 小程序，用 Windows 自己的 SendInput 动鼠标、按键、打字（中文也行：按 Unicode 字符送）。
//   坐标是 0～1 的比例，对应主屏幕（截屏也只截主屏幕，两边对得上）。
//   结束时把 Ctrl / Shift / Alt / Win 都松开，免得对方断线时某个键一直按着。父进程没了它自己退出。
"use strict";
const { spawn } = require("child_process");

const PS = (pid) => `
$ErrorActionPreference = 'Continue'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class LgIn {
  [StructLayout(LayoutKind.Sequential)] public struct KI { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int dx; public int dy; public int mouseData; public uint dwFlags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct U { [FieldOffset(0)] public MI mi; [FieldOffset(0)] public KI ki; }
  [StructLayout(LayoutKind.Sequential)] public struct IN { public uint type; public U u; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, IN[] i, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  public static void Init() { SetProcessDPIAware(); }
  static void Send(IN x) { SendInput(1, new IN[] { x }, Marshal.SizeOf(typeof(IN))); }
  public static void Move(double x, double y) { int w = GetSystemMetrics(0), h = GetSystemMetrics(1); SetCursorPos((int)Math.Round(Math.Max(0, Math.Min(1, x)) * (w - 1)), (int)Math.Round(Math.Max(0, Math.Min(1, y)) * (h - 1))); }
  public static void Btn(int b, bool down) { uint f = b == 2 ? (down ? 0x8u : 0x10u) : b == 1 ? (down ? 0x20u : 0x40u) : (down ? 0x2u : 0x4u); IN x = new IN(); x.type = 0; x.u.mi.dwFlags = f; Send(x); }
  public static void Wheel(int d) { IN x = new IN(); x.type = 0; x.u.mi.dwFlags = 0x800; x.u.mi.mouseData = d; Send(x); }
  public static void Key(int vk, bool down) {
    bool ext = (vk >= 33 && vk <= 40) || vk == 45 || vk == 46 || vk == 91 || vk == 92 || vk == 111 || vk == 144;
    IN x = new IN(); x.type = 1; x.u.ki.wVk = (ushort)vk; x.u.ki.dwFlags = (down ? 0u : 2u) | (ext ? 1u : 0u); Send(x);
  }
  public static void Text(string s) {
    foreach (char ch in s) {
      IN a = new IN(); a.type = 1; a.u.ki.wScan = ch; a.u.ki.dwFlags = 4; Send(a);
      IN b = new IN(); b.type = 1; b.u.ki.wScan = ch; b.u.ki.dwFlags = 4 | 2; Send(b);
    }
  }
  public static void Release() { foreach (int k in new int[] { 16, 17, 18, 91, 160, 161, 162, 163, 164, 165 }) Key(k, false); }
}
"@
[LgIn]::Init()
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
Write-Output 'LG_INJECT_OK'
$parent = ${pid}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if (-not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { break }
  try {
    $arr = ConvertFrom-Json -InputObject $line   # 一行是一组操作（数组）；不走管道，PowerShell 5.1 才会一个一个展开
    foreach ($e in $arr) {
      switch ($e.t) {
        'move'  { [LgIn]::Move([double]$e.x, [double]$e.y) }
        'down'  { [LgIn]::Move([double]$e.x, [double]$e.y); [LgIn]::Btn([int]$e.b, $true) }
        'up'    { [LgIn]::Move([double]$e.x, [double]$e.y); [LgIn]::Btn([int]$e.b, $false) }
        'wheel' { [LgIn]::Wheel([int]$e.d) }
        'key'   { [LgIn]::Key([int]$e.vk, [bool]$e.down) }
        'text'  { [LgIn]::Text([string]$e.s) }
      }
    }
  } catch { }
}
[LgIn]::Release()
`;

// 只认这几种，数值都夹在范围里（对方送什么都不能变成别的东西）
function clean(evs) {
  const out = [];
  const num = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));
  for (const e of Array.isArray(evs) ? evs : []) {
    if (!e || typeof e !== "object") continue;
    if (e.t === "move") out.push({ t: "move", x: num(e.x, 0, 1), y: num(e.y, 0, 1) });
    else if (e.t === "down" || e.t === "up") out.push({ t: e.t, b: [0, 1, 2].includes(+e.b) ? +e.b : 0, x: num(e.x, 0, 1), y: num(e.y, 0, 1) });
    else if (e.t === "wheel") out.push({ t: "wheel", d: Math.round(num(e.d, -1200, 1200)) });
    else if (e.t === "key") { const vk = Math.round(num(e.vk, 1, 254)); if (vk) out.push({ t: "key", vk, down: !!e.down }); }
    else if (e.t === "text" && typeof e.s === "string" && e.s) out.push({ t: "text", s: e.s.slice(0, 500) });
  }
  return out;
}

function create(o = {}) {
  const log = o.log || (() => {});
  const isWin = (o.platform || process.platform) === "win32";
  if (!isWin) return { send: (evs) => clean(evs), close() {}, ok: false };
  const p = (o.spawn || spawn)("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PS(process.pid)], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let alive = true;
  p.on("exit", () => { alive = false; });
  p.on("error", (e) => { alive = false; log("远程操控没开起来：" + e.message); });
  p.stdin.on("error", () => {});
  p.stderr && p.stderr.on("data", (d) => log("远程操控：" + String(d).trim().slice(0, 200)));
  return {
    ok: true,
    send(evs) { const c = clean(evs); if (alive && c.length) p.stdin.write(JSON.stringify(c) + "\n"); return c; },
    close() { if (!alive) return; try { p.stdin.end(); } catch (e) {} setTimeout(() => { try { p.kill(); } catch (e) {} }, 1500); },
  };
}

module.exports = { create, clean, PS };
