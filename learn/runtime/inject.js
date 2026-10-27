// 打包时注入到每个模块：Node 里的全局 Buffer、process、setImmediate
export const Buffer = require("./buffer.js").Buffer;
// 7.5 思维导图后台任务用到 process.pid / kill(pid, 0)（检查「持有任务锁的服务」还在不在）、process.versions。
// 网页版只有一个 Service Worker：除了自己，别的编号都当作已经不在了（上一次的 Service Worker 被浏览器停掉后留下的锁可以接管）。
export const process = {
  env: {}, platform: "browser", pid: 1, ppid: 0, versions: { node: "0.0.0-browser" },
  nextTick: (f, ...a) => Promise.resolve().then(() => f(...a)),
  kill(pid) { if (pid === 1) return true; const e = new Error("ESRCH: no such process"); e.code = "ESRCH"; throw e; },
};
export const setImmediate = (f, ...a) => setTimeout(f, 0, ...a);
// Node 的定时器有 unref()；浏览器的定时器是数字，补一个什么也不做的
if (!Number.prototype.unref) Object.defineProperties(Number.prototype, { unref: { value() { return this; }, configurable: true }, ref: { value() { return this; }, configurable: true } });
