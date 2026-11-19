// 国内存储清理旧版安装包（.github/workflows/cn-clean.sh）：只删同名、不同版本的安装包，文件夹里别的东西（捞捞算力的训练文件）一个都不碰。
//   2026-11-19 查实的根因：以前按「同一个文件夹只留最新 3 个」清理，grid/ 下面还有训练文件（grid/jobs/…），每次打包捞捞算力都把它们删光。
//   用一个假的 aws 命令（记下删了哪些）跑真的脚本。要 bash：Windows 上跳过（脚本只在 GitHub 的 Linux 机器上跑）。
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const ok = (m) => console.log("✓", m);
if (process.platform === "win32" || spawnSync("bash", ["-c", "true"]).status !== 0) { console.log("（没有 bash，跳过清理脚本的测试）"); process.exit(0); }
const SCRIPT = path.join(__dirname, "..", "..", ".github", "workflows", "cn-clean.sh");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-cnclean-"));
const bin = path.join(tmp, "bin"); fs.mkdirSync(bin);
// 假的 aws：list-objects-v2 按 --prefix 从 bucket.txt 里挑（文件里的顺序 = 从旧到新），s3 rm 记到 deleted.txt
fs.writeFileSync(path.join(bin, "aws"), `#!/usr/bin/env bash
if [ "$1 $2" = "s3api list-objects-v2" ]; then
  P=""; while [ $# -gt 0 ]; do [ "$1" = "--prefix" ] && P="$2"; shift; done
  ks=$(grep -F -- "$P" "${tmp}/bucket.txt" | awk -v p="$P" 'index($0,p)==1' | paste -sd '\\t' -); [ -z "$ks" ] && echo None || echo "$ks"; exit 0
fi
if [ "$1 $2" = "s3 rm" ]; then echo "\${3#s3://*/}" >> "${tmp}/deleted.txt"; exit 0; fi
exit 1
`, { mode: 0o755 });
const TRAIN = ["grid/jobs/20/2222/out-qa-math-12-176.jsonl", "grid/jobs/37/2122/ckpt-746-ckpt-746.pt", "grid/jobs/37/2122/ckpt-250-ckpt-250-1a2b3c4d.pt", "grid/logs/3/1731900000-log.txt", "grid/jobs/_canary/keep-me.txt"];
function run(key, keep, objs) {
  fs.writeFileSync(path.join(tmp, "bucket.txt"), objs.join("\n") + "\n"); fs.rmSync(path.join(tmp, "deleted.txt"), { force: true });
  const r = spawnSync("bash", [SCRIPT, key, String(keep)], { env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, CN_S3_BUCKET: "laolao-1", CN_S3_ENDPOINT: "https://cos.example" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, "", "清理不往标准输出写东西（cn-upload.sh 的标准输出是下载地址）");
  try { return fs.readFileSync(path.join(tmp, "deleted.txt"), "utf8").trim().split("\n").filter(Boolean); } catch (e) { return []; }
}
// 1. 捞捞算力：训练文件夹在 grid/ 下面，和安装包混在一起（按时间穿插）
const g = ["grid/LaolaoGrid-Setup-0.1.70.exe", TRAIN[0], "grid/LaolaoGrid-Setup-0.1.71.exe", TRAIN[2], TRAIN[1], "grid/LaolaoGrid-Setup-0.1.72.exe", "grid/LaolaoGrid-Setup.exe", TRAIN[3], "grid/LaolaoGrid-Setup-0.1.73.exe", TRAIN[4], "grid/LaolaoGrid-Setup-0.1.76.exe"];
let del = run("grid/LaolaoGrid-Setup-0.1.76.exe", 3, g);
assert.deepEqual(del, ["grid/LaolaoGrid-Setup-0.1.70.exe", "grid/LaolaoGrid-Setup-0.1.71.exe"], "只删最旧的两个版本：" + del);
for (const t of TRAIN) assert.ok(!del.includes(t), "训练文件不能删：" + t);
assert.ok(!del.includes("grid/LaolaoGrid-Setup.exe"), "不带版本号的不算");
ok("捞捞算力打包后清理：grid/ 下只删同名的旧版安装包（留最新 3 个），训练的存档、数据、日志、看门狗一个都不碰");
// 2. 别的安装包：安卓、捞捞编程（留 2 个）
del = run("android/class-calendar-5.3.39.apk", 3, ["android/class-calendar-5.3.36.apk", "android/class-calendar-5.3.37.apk", "android/notes.txt", "android/class-calendar-5.3.38.apk", "android/class-calendar-5.3.39.apk"]);
assert.deepEqual(del, ["android/class-calendar-5.3.36.apk"]);
del = run("code/LaolaoCode-Setup-2.1.0.exe", 2, ["code/LaolaoCode-Setup-1.9.0.exe", "code/LaolaoCode-Setup-2.0.0.exe", "code/LaolaoCode-Setup-2.1.0.exe"]);
assert.deepEqual(del, ["code/LaolaoCode-Setup-1.9.0.exe"]);
// 3. 认不出版本号：不清理
assert.deepEqual(run("grid/LaolaoGrid-Setup.exe", 3, g), []);
ok("别的安装包（安卓、捞捞编程留 2 个）照样只删同名旧版；认不出版本号就不清理");
// 4. cn-upload.sh 用的是这个脚本，不再按文件夹删
const up = fs.readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "cn-upload.sh"), "utf8");
assert.match(up, /cn-clean\.sh" "\$KEY" "\$KEEP"/); assert.ok(!/--prefix "\$DIR"/.test(up), "cn-upload.sh 里不能再有按整个文件夹列出来删的写法");
ok("cn-upload.sh 打包上传后调用 cn-clean.sh，不再按整个文件夹清理");
console.log("国内存储清理：全部通过");
