// 本机文件夹（core/folder.js）：文件留在原地，按名字和内容找、看子文件夹、分段读；出不了选的那个文件夹；读过的有缓存
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const F = require("../core/folder");
const FILES = require("../core/files");
const ok = (m) => console.log("✓", m);
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-folder-"));
  const root = path.join(tmp, "课程资料");
  fs.mkdirSync(path.join(root, "第三章"), { recursive: true }); fs.mkdirSync(path.join(root, ".git")); fs.mkdirSync(path.join(root, "node_modules", "x"), { recursive: true });
  fs.writeFileSync(path.join(root, "第三章", "冒泡排序讲义.md"), "# 冒泡排序\n相邻两个数比较，大的往后换。时间复杂度 O(n^2)。");
  fs.writeFileSync(path.join(root, "作业要求.txt"), "第三次作业：用快速排序给成绩排名，周五交。");
  fs.writeFileSync(path.join(root, "长文.txt"), "开头" + "字".repeat(9000) + "结尾");
  fs.writeFileSync(path.join(root, ".git", "config"), "冒泡排序 不该被搜到");
  fs.writeFileSync(path.join(root, "node_modules", "x", "a.js"), "// 冒泡排序 不该被搜到");
  fs.writeFileSync(path.join(root, "照片.png"), Buffer.from("89504e47", "hex"));
  fs.writeFileSync(path.join(root, "期末复习.docx"), await FILES.docx("# 期末复习\n\n- 冒泡排序要会手写\n- 递归要会画调用树"));
  fs.writeFileSync(path.join(tmp, "外面的秘密.txt"), "不能读");
  const cache = path.join(tmp, "cache");
  const fo = F.create({ file: path.join(tmp, "folder.json"), cacheDir: cache });
  await assert.rejects(() => fo.find({ query: "排序" }), /还没选文件夹/);
  assert.throws(() => fo.set(os.homedir()), /范围太大/);
  let I = fo.set(root); assert.equal(I.name, "课程资料");
  assert.equal(F.create({ file: path.join(tmp, "folder.json") }).info().root, fs.realpathSync(root), "记住了，重开还在");
  ok("选文件夹：记住；不让选整个盘、整个用户目录");

  let r = await fo.find({ query: "冒泡排序" });
  const ps = r.results.map((x) => x.path);
  assert.equal(ps[0], "第三章/冒泡排序讲义.md", "文件名里有的排前面：" + ps.join(","));
  assert.ok(ps.includes("期末复习.docx"), "Word 里的字也能搜到");
  assert.ok(!ps.some((p) => /\.git|node_modules/.test(p)), "隐藏文件夹、node_modules 不进");
  assert.ok(r.results.find((x) => x.path === "期末复习.docx").snippet.includes("冒泡排序要会手写"));
  r = await fo.find({ query: "快速排序", ext: "txt" }); assert.deepEqual(r.results.map((x) => x.path), ["作业要求.txt"]);
  ok("找：按文件名和内容（Word 里的字也算）；能只找某种文件；带一小段上下文");
  assert.ok(fs.readdirSync(cache).length > 0, "读过的文字缓存下来");

  const L = fo.list({}); assert.deepEqual(L.items.map((x) => x.name).slice(0, 1), ["第三章/"]); assert.ok(L.items.some((x) => x.name === "作业要求.txt") && !L.items.some((x) => x.name === ".git/"));
  let t = await fo.read({ path: "长文.txt" }); assert.equal(t.text.length, 6000); assert.match(t.more, /from=6000/);
  t = await fo.read({ path: "长文.txt", from: 6000 }); assert.ok(t.text.endsWith("结尾") && !t.more);
  assert.match((await fo.read({ path: "照片.png" })).note, /拖进对话框/);
  for (const bad of ["../外面的秘密.txt", "/etc/passwd", "第三章/../../外面的秘密.txt"]) await assert.rejects(() => fo.read({ path: bad }), /只能看选的那个文件夹里面|没有这个文件/);
  try { fs.symlinkSync(path.join(tmp, "外面的秘密.txt"), path.join(root, "快捷方式.txt")); await assert.rejects(() => fo.read({ path: "快捷方式.txt" }), /只能看选的那个文件夹里面/); } catch (e) { if (e.code !== "EPERM") throw e; }
  ok("看子文件夹、分段读长文件（6000 字一段）；图片让对方拖进来；出不了选的那个文件夹（.. 和快捷方式都挡住）");

  // 交文件可以存进这个文件夹
  const T = FILES.tool({ dir: tmp, folder: fo });
  const m = await T.run({ name: "复习提纲", format: "md", content: "# 提纲", to_folder: true });
  assert.ok(fs.existsSync(path.join(root, "捞小智做的", "复习提纲.md"))); assert.equal(m.ref, "folder:捞小智做的/复习提纲.md");
  const m2 = await T.run({ name: "复习提纲", format: "md", content: "# 提纲" }); assert.ok(!m2.ref && fs.existsSync(path.join(tmp, "files", "复习提纲.md")));
  ok("交文件：说「存到我的文件夹」就存进去（「捞小智做的」里）；不说就照旧");
  fo.set(null); assert.equal(fo.info().root, "");
  console.log("本机文件夹：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
