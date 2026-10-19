// node test/runner.test.js —— 用电脑上装好的编译器测一遍：编译、运行、输入、报错定位、中文提示、停止
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { Session, runOnce } = require("../core/runner");
const { locate, LANGS } = require("../core/langs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-")), opt = { toolDirs: {}, allowSystem: true, buildDir: path.join(dir, "build") };
const ok = (s) => console.log("✓ " + s);
const W = (name, code) => { const f = path.join(dir, name); fs.writeFileSync(f, code); return f; };
const ECHO = {
  c: ["a.c", '#include <stdio.h>\nint main(){int a,b;printf("输入两个数：");scanf("%d %d",&a,&b);printf("和是%d\\n",a+b);return 0;}\n'],
  cpp: ["a.cpp", '#include <iostream>\nusing namespace std;\nint main(){int a,b;cout<<"输入两个数：";cin>>a>>b;cout<<"和是"<<a+b<<endl;}\n'],
  python: ["a.py", 'a, b = map(int, input("输入两个数：").split())\nprint(f"和是{a+b}")\n'],
  java: ["Main.java", 'import java.util.*;\npublic class Main{public static void main(String[] x){Scanner s=new Scanner(System.in);System.out.print("输入两个数：");int a=s.nextInt(),b=s.nextInt();System.out.println("和是"+(a+b));}}\n'],
  javascript: ["a.js", 'process.stdout.write("输入两个数：");let d="";process.stdin.on("data",c=>{d+=c;if(d.includes("\\n")){const [a,b]=d.trim().split(/\\s+/).map(Number);console.log("和是"+(a+b));process.exit(0);}});\n'],
  go: ["a.go", 'package main\nimport "fmt"\nfunc main(){var a,b int\nfmt.Print("输入两个数：")\nfmt.Scan(&a,&b)\nfmt.Println("和是", a+b)}\n'],
};
const BAD = {
  c: ["b.c", '#include <stdio.h>\nint main(){\n  int n\n  printf("%d", n);\n}\n', 3, /分号/],
  cpp: ["b.cpp", '#include <iostream>\nint main(){\n  cout << x;\n}\n', 3, /没有定义/],
  python: ["b.py", 'x = 1\nprint(y)\n', 2, /「y」没定义/],
  java: ["Main.java", 'public class Main{\n public static void main(String[] a){\n  int x = "hi";\n }\n}\n', 3, /不能当成/],
  javascript: ["b.js", 'let a = 1;\nconsole.log(bb);\n', 2, /「bb」没定义/],
  go: ["b.go", 'package main\nimport "fmt"\nfunc main(){\n\tx := 1\n\tfmt.Println("hi")\n}\n', 4, /声明了没用/],
};
(async () => {
  for (const L of LANGS) {
    if (!locate(L, {}, true)) { console.log("- 跳过 " + L.name + "（这台电脑没装）"); continue; }
    // 交互：先看到提示，再送输入
    const [n, code] = ECHO[L.id]; const sub = path.join(dir, L.id); fs.mkdirSync(sub, { recursive: true });
    const f = path.join(sub, n); fs.writeFileSync(f, code);
    const s = new Session(); let out = "", sawPrompt = false;
    await new Promise((res) => s.start(L.id, f, opt, {
      phase() {}, diags() {},
      out(st, t) { if (st !== "compile") out += t; if (!sawPrompt && out.includes("输入两个数：")) { sawPrompt = true; s.input("3 4\n"); } },
      exit(i) { res(i); },
    }));
    assert.ok(sawPrompt, L.name + " 提示没有马上显示：" + JSON.stringify(out));
    assert.match(out, /和是\s?7/, L.name + " 输出不对：" + JSON.stringify(out));
    // 练习检查：一次跑完
    const r = await runOnce(L.id, f, opt, "10 20\n");
    assert.match(r.stdout, /和是\s?30/);
    // 报错：定位到行、有中文提示
    const [bn, bcode, line, hint] = BAD[L.id]; const bsub = path.join(dir, L.id + "-bad"); fs.mkdirSync(bsub, { recursive: true });
    const bf = path.join(bsub, bn); fs.writeFileSync(bf, bcode);
    const br = await runOnce(L.id, bf, opt, "");
    const d = br.diags.find((x) => x.line === line);
    assert.ok(d, L.name + " 报错没定位到第 " + line + " 行：" + JSON.stringify(br.diags) + "\n" + (br.stderr || ""));
    assert.match(br.diags.map((x) => x.hint).join(" "), hint, L.name + " 中文提示不对：" + JSON.stringify(br.diags));
    ok(`${L.name}：运行、输入、输出马上显示、报错第 ${line} 行 + 中文提示（${d.hint}）`);
  }
  // 中文文件夹 + 中文文件名：能编译、报错还是指到这个文件的第几行
  const zh = path.join(dir, "练习", "成绩"); fs.mkdirSync(zh, { recursive: true });
  const zf = path.join(zh, "成绩.c"); fs.writeFileSync(zf, '#include <stdio.h>\nint main(){\n  printf("中文输出\\n")\n}\n');
  const zr = await runOnce("c", zf, opt, "");
  assert.ok(zr.compileFailed && zr.diags.some((d) => d.line === 3 || d.line === 4), "中文文件名的报错没对上行：" + JSON.stringify(zr));
  assert.ok(/成绩\.c/.test(zr.stderr) && !/src-/.test(zr.stderr), "报错里的文件名要换回中文名");
  fs.writeFileSync(zf, '#include <stdio.h>\nint main(){\n  printf("中文输出\\n");\n}\n');
  assert.strictEqual((await runOnce("c", zf, opt, "")).stdout, "中文输出\n"); ok("中文文件夹、中文文件名能编译运行，报错照样指到行");
  // 死循环：停得下来；超时
  const loop = W("loop.py", "while True:\n    pass\n");
  const t = await runOnce("python", loop, opt, "", { timeoutMs: 800 });
  assert.ok(t.timedOut); ok("死循环超时会停");
  const s = new Session(); const t0 = Date.now();
  const p = new Promise((res) => s.start("python", loop, opt, { phase() {}, diags() {}, out() {}, exit: res }));
  setTimeout(() => s.stop(), 300); const e = await p; assert.ok(e.stopped && Date.now() - t0 < 3000); ok("点「停止」能停下来");
  const spam = W("spam.py", "while True:\n    print('x' * 100)\n");
  const sp = await runOnce("python", spam, opt, "", { timeoutMs: 20000 }); assert.ok(sp.tooMuch); ok("一直打印停得下来（输出太多）");
  console.log("运行：全部通过");
})().catch((e) => { console.error("✗", e); process.exit(1); });
