function no() { throw new Error("网页版不能运行本机程序"); }
module.exports = { spawn: no, exec: no, execFile: no, execSync: no, spawnSync: no };
