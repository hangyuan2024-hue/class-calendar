// 捞捞编程 · 算法动画：内置的几种排序、查找。每种算法给出一段完整的 C 代码，
// 和一个 trace(数据) —— 按 C 代码一步一步「执行」，记下每一步：停在第几行、数组现在什么样、哪几格在比较 / 交换、变量的值、一句中文说明。
// 界面（viz.js）拿这些步骤画柱子、标代码行；测试（test/viz.test.js）拿同一段 C 代码真的编译运行，结果要和 trace 的最后一步一样。
// 浏览器里是 window.VizAlgos，Node 里 require 进来。
(function (root) {
  "use strict";

  // 一段 C 代码 → 行数组；line("某段文字") 找它在第几行（从 1 开始），写步骤时用，不用手数行号
  function program(lines) {
    const code = lines.join("\n");
    const line = (s) => { const i = lines.findIndex((l) => l.includes(s)); if (i < 0) throw new Error("代码里没有：" + s); return i + 1; };
    return { code, line };
  }
  const arrLit = (a) => "{" + a.join(", ") + "}";
  const mainSort = (call, a) => [
    "int main(void) {",
    "    int a[] = " + arrLit(a) + ";",
    "    int n = sizeof(a) / sizeof(a[0]);",
    "    " + call,
    "    for (int k = 0; k < n; k++) printf(\"%d \", a[k]);",
    "    printf(\"\\n\");",
    "    return 0;",
    "}",
  ];

  // 记步骤的小工具
  function recorder(a0) {
    const steps = []; let cmp = 0, swp = 0; const sorted = new Set();
    return {
      a: a0.slice(),
      sorted,
      cmp() { cmp++; }, swp() { swp++; },
      push(line, extra) {
        steps.push({ line, a: this.a.slice(), sorted: [...sorted], cmp, swp, hi: {}, vars: {}, ptr: {}, ...extra });
      },
      steps,
    };
  }

  // ---------------- 冒泡排序 ----------------
  const bubble = {
    id: "bubble", name: "冒泡排序", kind: "sort", big: "O(n²)",
    desc: "相邻两个比一比，前面的大就交换。每一轮把最大的「冒」到最后面。",
    build(a) {
      return program([
        "#include <stdio.h>",
        "",
        "void bubble_sort(int a[], int n) {",
        "    for (int i = 0; i < n - 1; i++) {",
        "        for (int j = 0; j < n - 1 - i; j++) {",
        "            if (a[j] > a[j + 1]) {",
        "                int t = a[j];",
        "                a[j] = a[j + 1];",
        "                a[j + 1] = t;",
        "            }",
        "        }",
        "    }",
        "}",
        "",
        ...mainSort("bubble_sort(a, n);", a),
      ]);
    },
    trace(data) {
      const P = this.build(data), R = recorder(data), a = R.a, n = a.length;
      const L = { cmp: P.line("if (a[j] > a[j + 1])"), swap: P.line("a[j + 1] = t;"), outer: P.line("for (int i = 0;"), call: P.line("bubble_sort(a, n);") };
      R.push(L.call, { note: `开始排序：一共 ${n} 个数` });
      for (let i = 0; i < n - 1; i++) {
        R.push(L.outer, { vars: { i }, note: `第 ${i + 1} 轮：把没排好的里面最大的那个，一路换到第 ${n - i} 个位置` });
        for (let j = 0; j < n - 1 - i; j++) {
          R.cmp();
          const big = a[j] > a[j + 1];
          R.push(L.cmp, { hi: { cmp: [j, j + 1] }, vars: { i, j }, ptr: { j }, note: `比较 a[${j}]=${a[j]} 和 a[${j + 1}]=${a[j + 1]}：` + (big ? "前面的大，要交换" : "不用换") });
          if (big) { const t = a[j]; a[j] = a[j + 1]; a[j + 1] = t; R.swp(); R.push(L.swap, { hi: { swap: [j, j + 1] }, vars: { i, j, t }, ptr: { j }, note: `交换完：a[${j}]=${a[j]}，a[${j + 1}]=${a[j + 1]}` }); }
        }
        R.sorted.add(n - 1 - i);
        R.push(L.outer, { vars: { i }, note: `第 ${i + 1} 轮结束：a[${n - 1 - i}]=${a[n - 1 - i]} 排好了` });
      }
      for (let k = 0; k < n; k++) R.sorted.add(k);
      R.push(P.line("for (int k = 0;"), { note: "排好了！" });
      return { code: P.code, steps: R.steps };
    },
  };

  // ---------------- 选择排序 ----------------
  const selection = {
    id: "selection", name: "选择排序", kind: "sort", big: "O(n²)",
    desc: "每一轮在没排好的里面找最小的，放到最前面。",
    build(a) {
      return program([
        "#include <stdio.h>",
        "",
        "void selection_sort(int a[], int n) {",
        "    for (int i = 0; i < n - 1; i++) {",
        "        int min = i;",
        "        for (int j = i + 1; j < n; j++) {",
        "            if (a[j] < a[min]) {",
        "                min = j;",
        "            }",
        "        }",
        "        if (min != i) {",
        "            int t = a[i];",
        "            a[i] = a[min];",
        "            a[min] = t;",
        "        }",
        "    }",
        "}",
        "",
        ...mainSort("selection_sort(a, n);", a),
      ]);
    },
    trace(data) {
      const P = this.build(data), R = recorder(data), a = R.a, n = a.length;
      const L = { min0: P.line("int min = i;"), cmp: P.line("if (a[j] < a[min])"), set: P.line("min = j;"), swap: P.line("a[min] = t;") };
      R.push(P.line("selection_sort(a, n);"), { note: `开始排序：一共 ${n} 个数` });
      for (let i = 0; i < n - 1; i++) {
        let min = i;
        R.push(L.min0, { hi: { mark: [i] }, vars: { i, min }, ptr: { i, min }, note: `第 ${i + 1} 轮：先当 a[${i}]=${a[i]} 是最小的` });
        for (let j = i + 1; j < n; j++) {
          R.cmp();
          const less = a[j] < a[min];
          R.push(L.cmp, { hi: { cmp: [j, min] }, vars: { i, j, min }, ptr: { i, j, min }, note: `a[${j}]=${a[j]} 比目前最小的 a[${min}]=${a[min]} ` + (less ? "还小：记下它" : "大，不管") });
          if (less) { min = j; R.push(L.set, { hi: { mark: [min] }, vars: { i, j, min }, ptr: { i, j, min }, note: `现在最小的是 a[${min}]=${a[min]}` }); }
        }
        if (min !== i) { const t = a[i]; a[i] = a[min]; a[min] = t; R.swp(); R.push(L.swap, { hi: { swap: [i, min] }, vars: { i, min }, ptr: { i, min }, note: `把最小的 ${a[i]} 换到第 ${i + 1} 个位置` }); }
        R.sorted.add(i);
      }
      for (let k = 0; k < n; k++) R.sorted.add(k);
      R.push(P.line("for (int k = 0;"), { note: "排好了！" });
      return { code: P.code, steps: R.steps };
    },
  };

  // ---------------- 插入排序 ----------------
  const insertion = {
    id: "insertion", name: "插入排序", kind: "sort", big: "O(n²)",
    desc: "像整理扑克牌：拿起一张，往前找到它该在的位置插进去。",
    build(a) {
      return program([
        "#include <stdio.h>",
        "",
        "void insertion_sort(int a[], int n) {",
        "    for (int i = 1; i < n; i++) {",
        "        int key = a[i];",
        "        int j = i - 1;",
        "        while (j >= 0 && a[j] > key) {",
        "            a[j + 1] = a[j];",
        "            j--;",
        "        }",
        "        a[j + 1] = key;",
        "    }",
        "}",
        "",
        ...mainSort("insertion_sort(a, n);", a),
      ]);
    },
    trace(data) {
      const P = this.build(data), R = recorder(data), a = R.a, n = a.length;
      const L = { key: P.line("int key = a[i];"), cond: P.line("while (j >= 0"), move: P.line("a[j + 1] = a[j];"), put: P.line("a[j + 1] = key;") };
      R.push(P.line("insertion_sort(a, n);"), { note: `开始排序：第 1 个数自己就算排好了` });
      R.sorted.add(0);
      for (let i = 1; i < n; i++) {
        const key = a[i]; let j = i - 1;
        R.push(L.key, { hi: { mark: [i] }, vars: { i, key, j }, ptr: { i }, note: `拿起 a[${i}]=${key}，往前给它找位置` });
        while (true) {
          const go = j >= 0 && a[j] > key;
          if (j >= 0) R.cmp();
          R.push(L.cond, { hi: j >= 0 ? { cmp: [j] } : {}, vars: { i, key, j }, ptr: { j: Math.max(j, 0) }, note: j < 0 ? "已经到最前面了" : `a[${j}]=${a[j]} ` + (go ? `比 ${key} 大，往后挪一格` : `不比 ${key} 大，就插在它后面`) });
          if (!go) break;
          a[j + 1] = a[j]; R.swp();
          R.push(L.move, { hi: { swap: [j, j + 1] }, vars: { i, key, j }, ptr: { j }, note: `a[${j}] 往后挪到 a[${j + 1}]` });
          j--;
        }
        a[j + 1] = key;
        for (let k = 0; k <= i; k++) R.sorted.add(k);
        R.push(L.put, { hi: { mark: [j + 1] }, vars: { i, key, j }, ptr: { j: j + 1 }, note: `${key} 放进 a[${j + 1}]，前 ${i + 1} 个排好了` });
      }
      R.push(P.line("for (int k = 0;"), { note: "排好了！" });
      return { code: P.code, steps: R.steps };
    },
  };

  // ---------------- 快速排序 ----------------
  const quick = {
    id: "quick", name: "快速排序", kind: "sort", big: "平均 O(n log n)",
    desc: "选最后一个当「基准」，比它小的都放左边，然后左右两边各自再这样排。",
    build(a) {
      return program([
        "#include <stdio.h>",
        "",
        "void swap(int *x, int *y) { int t = *x; *x = *y; *y = t; }",
        "",
        "int partition(int a[], int lo, int hi) {",
        "    int pivot = a[hi];",
        "    int i = lo - 1;",
        "    for (int j = lo; j < hi; j++) {",
        "        if (a[j] < pivot) {",
        "            i++;",
        "            swap(&a[i], &a[j]);",
        "        }",
        "    }",
        "    swap(&a[i + 1], &a[hi]);",
        "    return i + 1;",
        "}",
        "",
        "void quick_sort(int a[], int lo, int hi) {",
        "    if (lo < hi) {",
        "        int p = partition(a, lo, hi);",
        "        quick_sort(a, lo, p - 1);",
        "        quick_sort(a, p + 1, hi);",
        "    }",
        "}",
        "",
        ...mainSort("quick_sort(a, 0, n - 1);", a),
      ]);
    },
    trace(data) {
      const P = this.build(data), R = recorder(data), a = R.a, n = a.length;
      const L = { qs: P.line("if (lo < hi)"), piv: P.line("int pivot = a[hi];"), cmp: P.line("if (a[j] < pivot)"), sw: P.line("swap(&a[i], &a[j]);"), last: P.line("swap(&a[i + 1], &a[hi]);") };
      R.push(P.line("quick_sort(a, 0, n - 1);"), { note: `开始排序：一共 ${n} 个数` });
      const qs = (lo, hi, depth) => {
        R.push(L.qs, { hi: { range: [lo, hi] }, vars: { lo, hi }, ptr: { lo: Math.max(lo, 0), hi: Math.max(hi, 0) }, depth, note: lo < hi ? `排 a[${lo}]~a[${hi}] 这一段` : (lo === hi ? `a[${lo}] 只有一个数，不用排` : "这一段是空的") });
        if (lo === hi) R.sorted.add(lo);
        if (lo >= hi) return;
        const pivot = a[hi]; let i = lo - 1;
        R.push(L.piv, { hi: { range: [lo, hi], pivot: hi }, vars: { lo, hi, pivot, i }, ptr: { hi }, depth, note: `基准选最后一个：${pivot}` });
        for (let j = lo; j < hi; j++) {
          R.cmp();
          const less = a[j] < pivot;
          R.push(L.cmp, { hi: { range: [lo, hi], pivot: hi, cmp: [j] }, vars: { lo, hi, pivot, i, j }, ptr: { j, ...(i >= lo ? { i } : {}) }, depth, note: `a[${j}]=${a[j]} ` + (less ? `比基准 ${pivot} 小，放到左边去` : `不比基准小，留在右边`) });
          if (less) { i++; if (i !== j) { const t = a[i]; a[i] = a[j]; a[j] = t; } R.swp(); R.push(L.sw, { hi: { range: [lo, hi], pivot: hi, swap: [i, j] }, vars: { lo, hi, pivot, i, j }, ptr: { i, j }, depth, note: i === j ? `i 走到 ${i}，它自己就在左边，不用动` : `交换 a[${i}] 和 a[${j}]` }); }
        }
        { const t = a[i + 1]; a[i + 1] = a[hi]; a[hi] = t; } R.swp();
        R.sorted.add(i + 1);
        R.push(L.last, { hi: { range: [lo, hi], swap: [i + 1, hi], pivot: i + 1 }, vars: { lo, hi, pivot, i }, ptr: { i: i + 1 }, depth, note: `基准 ${pivot} 放到 a[${i + 1}]：左边都比它小，右边都不比它小，它的位置定了` });
        qs(lo, i, depth + 1);
        qs(i + 2, hi, depth + 1);
      };
      qs(0, n - 1, 0);
      for (let k = 0; k < n; k++) R.sorted.add(k);
      R.push(P.line("for (int k = 0;"), { note: "排好了！" });
      return { code: P.code, steps: R.steps };
    },
  };

  // ---------------- 归并排序 ----------------
  const merge = {
    id: "merge", name: "归并排序", kind: "sort", big: "O(n log n)",
    desc: "先一分为二各自排好，再像拉拉链一样合并成一段。",
    build(a) {
      return program([
        "#include <stdio.h>",
        "",
        "void merge(int a[], int lo, int mid, int hi) {",
        "    int tmp[100];",
        "    int i = lo, j = mid + 1, k = 0;",
        "    while (i <= mid && j <= hi) {",
        "        if (a[i] <= a[j]) tmp[k++] = a[i++];",
        "        else tmp[k++] = a[j++];",
        "    }",
        "    while (i <= mid) tmp[k++] = a[i++];",
        "    while (j <= hi) tmp[k++] = a[j++];",
        "    for (k = 0; k < hi - lo + 1; k++) a[lo + k] = tmp[k];",
        "}",
        "",
        "void merge_sort(int a[], int lo, int hi) {",
        "    if (lo >= hi) return;",
        "    int mid = (lo + hi) / 2;",
        "    merge_sort(a, lo, mid);",
        "    merge_sort(a, mid + 1, hi);",
        "    merge(a, lo, mid, hi);",
        "}",
        "",
        ...mainSort("merge_sort(a, 0, n - 1);", a),
      ]);
    },
    trace(data) {
      const P = this.build(data), R = recorder(data), a = R.a, n = a.length;
      const L = { split: P.line("int mid = (lo + hi) / 2;"), cmp: P.line("if (a[i] <= a[j])"), back: P.line("a[lo + k] = tmp[k];"), call: P.line("merge(a, lo, mid, hi);") };
      R.push(P.line("merge_sort(a, 0, n - 1);"), { note: `开始排序：一共 ${n} 个数` });
      const ms = (lo, hi, depth) => {
        if (lo >= hi) return;
        const mid = (lo + hi) >> 1;
        R.push(L.split, { hi: { range: [lo, hi], split: mid }, vars: { lo, mid, hi }, ptr: { lo, mid, hi }, depth, note: `把 a[${lo}]~a[${hi}] 分成两半：${lo}~${mid} 和 ${mid + 1}~${hi}` });
        ms(lo, mid, depth + 1); ms(mid + 1, hi, depth + 1);
        R.push(L.call, { hi: { range: [lo, hi], split: mid }, vars: { lo, mid, hi }, ptr: { lo, mid, hi }, depth, note: `两半都排好了，合并 a[${lo}]~a[${hi}]` });
        const tmp = []; let i = lo, j = mid + 1;
        while (i <= mid && j <= hi) {
          R.cmp();
          R.push(L.cmp, { hi: { range: [lo, hi], cmp: [i, j] }, vars: { lo, mid, hi, i, j }, ptr: { i, j }, tmp: tmp.slice(), depth, note: `a[${i}]=${a[i]} 和 a[${j}]=${a[j]} 比，小的 ${Math.min(a[i], a[j])} 先放进临时数组` });
          if (a[i] <= a[j]) tmp.push(a[i++]); else tmp.push(a[j++]);
        }
        while (i <= mid) tmp.push(a[i++]);
        while (j <= hi) tmp.push(a[j++]);
        for (let k = 0; k < tmp.length; k++) { a[lo + k] = tmp[k]; R.swp(); }
        if (lo === 0 && hi === n - 1) for (let k = 0; k < n; k++) R.sorted.add(k);
        R.push(L.back, { hi: { range: [lo, hi], swap: tmp.map((_, k) => lo + k) }, vars: { lo, mid, hi }, ptr: { lo, hi }, tmp: tmp.slice(), depth, note: `临时数组 [${tmp.join(", ")}] 抄回 a[${lo}]~a[${hi}]，这一段排好了` });
      };
      ms(0, n - 1, 0);
      for (let k = 0; k < n; k++) R.sorted.add(k);
      R.push(P.line("for (int k = 0;"), { note: "排好了！" });
      return { code: P.code, steps: R.steps };
    },
  };

  // ---------------- 二分查找 ----------------
  const binary = {
    id: "binary", name: "二分查找", kind: "search", big: "O(log n)",
    desc: "在排好序的数组里找一个数：每次看中间那个，一下排除一半。",
    build(a, x) {
      return program([
        "#include <stdio.h>",
        "",
        "int binary_search(int a[], int n, int x) {",
        "    int lo = 0, hi = n - 1;",
        "    while (lo <= hi) {",
        "        int mid = (lo + hi) / 2;",
        "        if (a[mid] == x) return mid;",
        "        else if (a[mid] < x) lo = mid + 1;",
        "        else hi = mid - 1;",
        "    }",
        "    return -1;",
        "}",
        "",
        "int main(void) {",
        "    int a[] = " + arrLit(a) + ";",
        "    int n = sizeof(a) / sizeof(a[0]);",
        "    int x = " + x + ";",
        "    printf(\"%d\\n\", binary_search(a, n, x));",
        "    return 0;",
        "}",
      ]);
    },
    trace(data, x) {
      data = data.slice().sort((p, q) => p - q);
      if (x == null || isNaN(x)) x = data[Math.floor(data.length * 0.7)];
      const P = this.build(data, x), R = recorder(data), a = R.a, n = a.length;
      const L = { init: P.line("int lo = 0, hi = n - 1;"), mid: P.line("int mid = (lo + hi) / 2;"), eq: P.line("if (a[mid] == x)"), right: P.line("lo = mid + 1;"), left: P.line("hi = mid - 1;"), miss: P.line("return -1;") };
      let lo = 0, hi = n - 1;
      R.push(L.init, { hi: { range: [lo, hi] }, vars: { x, lo, hi }, ptr: { lo, hi }, note: `数组已经排好序，要找 ${x}：先看整段 a[0]~a[${n - 1}]` });
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1; R.cmp();
        R.push(L.mid, { hi: { range: [lo, hi], cmp: [mid] }, vars: { x, lo, hi, mid }, ptr: { lo, mid, hi }, note: `中间是 a[${mid}]=${a[mid]}` });
        if (a[mid] === x) { found = mid; R.push(L.eq, { hi: { range: [lo, hi], found: mid }, vars: { x, lo, hi, mid }, ptr: { mid }, note: `找到了！${x} 在 a[${mid}]（只看了 ${R.steps.filter((s) => s.line === L.mid).length} 次）` }); break; }
        if (a[mid] < x) { lo = mid + 1; R.push(L.right, { hi: { range: [lo, hi] }, vars: { x, lo, hi, mid }, ptr: { lo: Math.min(lo, n - 1), hi: Math.max(hi, 0) }, note: `${a[mid]} < ${x}：要找的在右边，左半边不用看了` }); }
        else { hi = mid - 1; R.push(L.left, { hi: { range: [lo, hi] }, vars: { x, lo, hi, mid }, ptr: { lo: Math.min(lo, n - 1), hi: Math.max(hi, 0) }, note: `${a[mid]} > ${x}：要找的在左边，右半边不用看了` }); }
      }
      if (found < 0) R.push(L.miss, { vars: { x, lo, hi }, note: `lo 已经跑到 hi 右边了：数组里没有 ${x}，返回 -1` });
      return { code: P.code, steps: R.steps, result: found, x };
    },
  };

  const ALGOS = [bubble, selection, insertion, quick, merge, binary];

  // 「5 3 8 1」「5,3,8,1」都认；最多 16 个，-999~999
  function parseData(s) {
    const a = String(s || "").split(/[^\d-]+/).filter((x) => /^-?\d+$/.test(x)).map(Number).filter((v) => Math.abs(v) <= 999);
    return a.slice(0, 16);
  }
  function randomData(n = 8) { const a = []; for (let i = 0; i < n; i++) a.push(1 + Math.floor(Math.random() * 60)); return a; }

  const VizAlgos = { ALGOS, byId: (id) => ALGOS.find((x) => x.id === id), parseData, randomData };
  if (typeof module !== "undefined" && module.exports) module.exports = VizAlgos; else root.VizAlgos = VizAlgos;
})(typeof window !== "undefined" ? window : this);
