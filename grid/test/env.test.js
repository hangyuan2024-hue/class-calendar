// 装训练环境：国内存储里有的从国内存储下（核对 sha256），pip 只从本地装；坏了的文件删掉报错
"use strict";
const assert = require("assert");
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const { execFileSync } = require("child_process");
const Env = require("../app/env");
const ok = (m) => console.log("✓", m);
const PY = process.env.PYTHON || "python3";

// 手工做一个最小的 wheel（zip 里放一个模块和 dist-info）
function wheel(dir, name, ver) {
  const py = `import zipfile,sys\nn,v,out=sys.argv[1:4]\nm=n.replace('-','_')\nf=f"{out}/{m}-{v}-py3-none-any.whl"\nz=zipfile.ZipFile(f,'w')\nz.writestr(f"{m}.py","X=1\\n")\nd=f"{m}-{v}.dist-info"\nz.writestr(d+"/METADATA",f"Metadata-Version: 2.1\\nName: {n}\\nVersion: {v}\\n")\nz.writestr(d+"/WHEEL","Wheel-Version: 1.0\\nGenerator: t\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n")\nz.writestr(d+"/RECORD","")\nz.close()\nprint(f)`;
  return execFileSync(PY, ["-c", py, name, ver, dir]).toString().trim();
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-env-"));
  execFileSync(PY, ["-m", "venv", path.join(tmp, "venv")]);
  const vpy = path.join(tmp, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const src = path.join(tmp, "src"); fs.mkdirSync(src);
  const files = [wheel(src, "lgdemo-a", "1.0"), wheel(src, "lgdemo-b", "2.0")];
  const entry = (f, extra = {}) => { const b = fs.readFileSync(f); return { group: "grid", pkg: "gridwheel", ver: "2.9.0+cu128", name: path.basename(f), size: b.length, sha256: crypto.createHash("sha256").update(b).digest("hex"), ...extra }; };
  let man = null, hits = 0;
  const srv = http.createServer((q, r) => {
    if (q.url.startsWith("/m.json")) { r.setHeader("content-type", "application/json"); return r.end(JSON.stringify(man)); }
    const f = path.join(src, decodeURIComponent(q.url.slice(1)));
    if (fs.existsSync(f)) { hits++; r.setHeader("content-length", fs.statSync(f).size); return fs.createReadStream(f).pipe(r); }
    r.statusCode = 404; r.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  man = { files: Object.fromEntries(files.map((f) => ["ai/grid/" + path.basename(f), { ...entry(f), url: base + "/" + path.basename(f) }])) };
  // 别的组的文件不要
  man.files["ai/models/x"] = { group: "portrait", name: "x", url: base + "/x", size: 1 };

  const ev = [];
  const env = Env.create({ dir: path.join(tmp, "env"), python: vpy, mirror: ["http://127.0.0.1:1/none.json", base + "/m.json"], onEvent: (e) => ev.push(e), basePkgs: ["lgdemo-a", "lgdemo-b"] });
  await env.install({ skipTorch: true });
  execFileSync(vpy, ["-c", "import lgdemo_a, lgdemo_b"]);
  assert.equal(hits, 2);
  assert.ok(ev.some((e) => /国内存储/.test(e.msg || "")) && ev.some((e) => e.stage === "wheels" && e.done));
  assert.ok(ev.some((e) => e.cmd && /--no-index/.test(e.msg)), "pip 只从本地装");
  ok("训练环境：从你的国内存储下载（第一个清单地址不通换下一个），pip 只从本地装，不走公共镜像");

  // 再装一次：下过的不再下
  hits = 0;
  await env.install({ skipTorch: true });
  assert.equal(hits, 0);
  ok("再点一次：下过、大小对的文件不再下");

  // 文件坏了（sha256 对不上）：删掉，改走公共镜像（这里没有网，报错说清楚）
  fs.rmSync(path.join(tmp, "env", "wheels"), { recursive: true, force: true });
  man.files["ai/grid/" + path.basename(files[0])].sha256 = "0".repeat(64);
  const ev2 = [];
  const env2 = Env.create({ dir: path.join(tmp, "env"), python: vpy, mirror: [base + "/m.json"], onEvent: (e) => ev2.push(e), basePkgs: ["lgdemo-a", "lgdemo-b"] });
  await env2.install({ skipTorch: true }).catch(() => {});
  assert.ok(ev2.some((e) => /下载坏了/.test(e.msg || "")));
  assert.ok(!fs.existsSync(path.join(tmp, "env", "wheels", path.basename(files[0]))));
  ok("下载的文件和 sha256 对不上：删掉，不装坏的");

  srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log("训练环境：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
