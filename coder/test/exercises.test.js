// node test/exercises.test.js —— 每道练习题：标准答案能过，错的答案过不了；提示文字不影响判对
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { EX, check, same, starter } = require("../core/exercises");
const { runOnce } = require("../core/runner");
// LC_BUNDLED=1（GitHub Actions 里）：用安装包自带的编译器，不用打包机器上装的
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lx-")), opt = process.env.LC_BUNDLED
  ? { toolDirs: { bundled: path.join(__dirname, "..", "resources", "toolchains") }, allowSystem: false, buildDir: path.join(dir, "build") }
  : { toolDirs: {}, allowSystem: true, buildDir: path.join(dir, "build") };
const PY = {
  hello: 'print("Hello, World!")',
  aplusb: 'a,b=map(int,input().split())\nprint(a+b)',
  oddeven: 'n=int(input())\nprint("奇数" if n%2 else "偶数")',
  grade: 's=int(input("请输入成绩："))\nprint("A" if s>=90 else "B" if s>=80 else "C" if s>=70 else "D" if s>=60 else "E")',
  max3: 'print(max(map(int,input().split())))',
  leap: 'y=int(input())\nprint("是" if (y%4==0 and y%100!=0) or y%400==0 else "否")',
  sum1n: 'n=int(input())\nprint(n*(n+1)//2)',
  table: 'n=int(input())\nfor i in range(1,n+1):\n    print(" ".join(f"{j}*{i}={i*j}" for j in range(1,i+1)))',
  revnum: 'print(int(input().strip()[::-1]))',
  gcd: 'import math\na,b=map(int,input().split())\nprint(math.gcd(a,b))',
  prime: 'n=int(input())\nprint("是" if n>1 and all(n%d for d in range(2,int(n**.5)+1)) else "否")',
  fib: 'n=int(input())\na,b=1,1\nfor _ in range(n-1): a,b=b,a+b\nprint(a)',
  avg: 'input()\nv=list(map(int,input().split()))\nprint(f"{sum(v)/len(v):.2f}")',
  sort: 'input()\nprint(" ".join(map(str,sorted(map(int,input().split())))))',
  revstr: 'print(input()[::-1])',
};
const C = {
  aplusb: '#include <stdio.h>\nint main(){long long a,b;printf("请输入两个数：");scanf("%lld %lld",&a,&b);printf("%lld\\n",a+b);}',
  fib: '#include <stdio.h>\nint main(){int n;scanf("%d",&n);long long a=1,b=1;for(int i=1;i<n;i++){long long t=a+b;a=b;b=t;}printf("%lld\\n",a);}',
  sort: '#include <stdio.h>\nint main(){int n,a[100];scanf("%d",&n);for(int i=0;i<n;i++)scanf("%d",&a[i]);for(int i=0;i<n;i++)for(int j=0;j+1<n-i;j++)if(a[j]>a[j+1]){int t=a[j];a[j]=a[j+1];a[j+1]=t;}for(int i=0;i<n;i++)printf(i?" %d":"%d",a[i]);printf("\\n");}',
};
(async () => {
  assert.ok(same("请输入两个数：7\n", "7") && same("Hello, World!  \n\n", "Hello, World!") && !same("8", "7") && !same("17", "7"));
  for (const ex of EX) {
    const f = path.join(dir, ex.id + ".py"); fs.writeFileSync(f, PY[ex.id]);
    const r = await check(ex, (inp) => runOnce("python", f, opt, inp));
    assert.ok(r.pass, ex.title + " 标准答案没过：" + JSON.stringify(r.results.slice(-1)));
  }
  console.log("✓ 15 道题的 Python 标准答案都能过（带「请输入」提示也算对）");
  for (const [id, code] of Object.entries(C)) {
    const d = path.join(dir, "c-" + id); fs.mkdirSync(d); const f = path.join(d, "main.c"); fs.writeFileSync(f, code);
    const r = await check(EX.find((e) => e.id === id), (inp) => runOnce("c", f, opt, inp));
    assert.ok(r.pass, id + " C 答案没过：" + JSON.stringify(r));
  }
  console.log("✓ C 答案也能过（两数之和带提示、斐波那契要 long long、冒泡排序）");
  const bad = path.join(dir, "bad.py"); fs.writeFileSync(bad, 'n=int(input())\nprint(n*(n-1)//2)');
  const r = await check(EX.find((e) => e.id === "sum1n"), (inp) => runOnce("python", bad, opt, inp));
  assert.ok(!r.pass && r.results.length === 1 && r.results[0].expected === "5050"); console.log("✓ 错的答案过不了，停在第一个不对的测试");
  const intFib = path.join(dir, "intfib"); fs.mkdirSync(intFib); const fi = path.join(intFib, "m.c");
  fs.writeFileSync(fi, '#include <stdio.h>\nint main(){int n;scanf("%d",&n);int a=1,b=1;for(int i=1;i<n;i++){int t=a+b;a=b;b=t;}printf("%d\\n",a);}');
  const r2 = await check(EX.find((e) => e.id === "fib"), (inp) => runOnce("c", fi, opt, inp));
  assert.ok(!r2.pass && r2.results[2] && !r2.results[2].ok); console.log("✓ 斐波那契用 int 会在第 50 项错（提醒要 long long）");
  const c = starter(EX[1], "c"); assert.ok(/练习：两数之和/.test(c) && /int main/.test(c)); console.log("✓ 新题的代码架子");
  console.log("练习题：全部通过");
})().catch((e) => { console.error("✗", e); process.exit(1); });
