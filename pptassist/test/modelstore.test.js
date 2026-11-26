// 捞捞模型仓库（core/modelstore.js）：几个捞捞软件共用一份模型；旧的收进来（重复的删掉腾硬盘）；整合包记住装在哪；记谁用过、清掉很久没用的
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const MS = require("../core/modelstore");
const ok = (m) => console.log("✓", m);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-store-"));
const pointer = path.join(tmp, "home", ".laolao", "store.json");
const put = (f, n) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(n, 7)); };

// 捞小智（捞捞算力）先建仓库：在它的数据文件夹里
const grid = MS.create({ pointer, app: "捞小智", defaultDir: path.join(tmp, "D", "Laolao", "models") });
assert.equal(grid.dir(), path.join(tmp, "D", "Laolao", "models"));
// PPT 助手后来打开：看同一个 store.json，用同一个仓库
const ppt = MS.create({ pointer, app: "捞捞PPT助手", defaultDir: path.join(tmp, "C", "x") });
assert.equal(ppt.dir(), grid.dir());
ok("几个软件看同一个 store.json：用同一个仓库（第一个建的那个，比如捞捞算力的 D 盘数据文件夹）");

// 各自以前下过：捞小智 llm 里有 4B + 视觉组件，PPT 助手 llm 里也有一份 4B，电脑版有一份不一样大的（下坏了的）
put(path.join(tmp, "grid", "llm", "Qwen3VL-4B.gguf"), 1000);
put(path.join(tmp, "grid", "llm", "mmproj.gguf"), 300);
put(path.join(tmp, "ppt", "llm", "Qwen3VL-4B.gguf"), 1000);
put(path.join(tmp, "xz", "llm", "Qwen3VL-4B.gguf"), 999);
let r = grid.sweep([path.join(tmp, "grid", "llm")]);
assert.deepEqual(r, { moved: 2, deduped: 0, freed: 0 });
r = ppt.sweep([path.join(tmp, "ppt", "llm"), path.join(tmp, "nope")]);
assert.deepEqual(r, { moved: 0, deduped: 1, freed: 1000 }, "PPT 助手那份是重复的：删掉，腾出 1000");
assert.ok(!fs.existsSync(path.join(tmp, "ppt", "llm", "Qwen3VL-4B.gguf")));
assert.equal(ppt.find("Qwen3VL-4B.gguf", 1000), path.join(grid.dir(), "Qwen3VL-4B.gguf"));
assert.equal(ppt.find("Qwen3VL-4B.gguf", 1234), null, "大小对不上不算");
assert.equal(ppt.find("没有的.gguf"), null);
ok("以前各自下的收进仓库：同一个盘直接挪过去；仓库里已经有一样的就删掉多的那份；名字 + 大小对得上才算有");

// 整合包：捞小智装过声音组件，电脑版直接用
const gsvDir = path.join(tmp, "D", "Laolao", "ai", "LaolaoAI-GPT-SoVITS"); fs.mkdirSync(gsvDir, { recursive: true });
grid.setPack("gsv", gsvDir);
const xz = MS.create({ pointer, app: "捞小智电脑版" });
assert.equal(xz.pack("gsv"), gsvDir); assert.equal(xz.pack("comfy"), null);
fs.rmSync(gsvDir, { recursive: true }); assert.equal(xz.pack("gsv"), null, "被删掉了就不算");
ok("整合包（声音组件、AI 引擎、3D 引擎）只记装在哪：一个软件装过，别的软件直接用");

// 谁用过：列出来；60 天谁都没用过的清掉，正在用的留着
const L = xz.list(); assert.equal(L.files.length, 2); assert.ok(L.files[0].used["捞捞PPT助手"] > 0, "find 到了就记一笔");
const p = JSON.parse(fs.readFileSync(pointer, "utf8")); p.used["mmproj.gguf"] = { 捞小智: Date.now() - 90 * 864e5 }; fs.writeFileSync(pointer, JSON.stringify(p));
r = xz.prune(60, ["Qwen3VL-4B.gguf"]);
assert.deepEqual(r.removed, ["mmproj.gguf"]); assert.equal(r.freed, 300);
assert.equal(xz.list().files.length, 1);
ok("插件页「本地模型」：每个文件谁什么时候用过；60 天谁都没用过的一键清掉（正在用的不删）");

// 仓库所在的盘拔掉了（store.json 里记的地方写不进去）：回到默认的地方，不报错
const p2 = JSON.parse(fs.readFileSync(pointer, "utf8")); fs.writeFileSync(path.join(tmp, "afile"), "x"); p2.dir = path.join(tmp, "afile", "models"); fs.writeFileSync(pointer, JSON.stringify(p2));
const again = MS.create({ pointer, app: "x", defaultDir: path.join(tmp, "fallback") });
assert.equal(again.dir(), path.join(tmp, "fallback"));
ok("记的仓库用不了（比如移动硬盘拔了）：换回默认的地方");
console.log("模型仓库：全部通过");
