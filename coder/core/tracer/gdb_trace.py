# 捞捞编程 · 画出来：在 gdb 里一行一行地走 C / C++ 程序，每走一步记下所有变量（数组、结构体、指针、链表……）
# 由 core/trace.js 启动：gdb -q -nx -batch -x gdb_trace.py（工作目录 = 这次追踪的临时文件夹）
# 结果一行一个 JSON 写到 LL_RES：被强行停掉时前面的步骤也还在。
import gdb, json, os, time, math, threading, signal

SRC = set(x.lower() for x in os.environ.get("LL_SRC", "").split("|") if x)
MAXS = int(os.environ.get("LL_MAX", "1500"))
DEADLINE = time.time() + float(os.environ.get("LL_SECS", "12"))
PROG = os.environ["LL_PROG"]
RES = open(os.environ["LL_RES"], "w", encoding="utf-8", buffering=1)
OUTF = "ll-out.txt"
ARR_MAX = 120   # 一个数组最多看前 120 个
SUB_MAX = 40    # 二维数组每一行最多 40 个
DEPTH = 12      # 链表最多往后找 12 个

def emit(o):
    RES.write(json.dumps(o, ensure_ascii=False, separators=(",", ":")) + "\n")

def run(cmd):
    return gdb.execute(cmd, to_string=True)

for c in ["set pagination off", "set confirm off", "set width 0", "set print pretty off", "set disable-randomization on",
          "set new-console off", "set print elements 400", "set print repeats unlimited", "set auto-load safe-path /",
          "skip -rfu ^std::", "skip -rfu ^__gnu_cxx::", "skip -rfu ^__cxxabiv1::"]:
    try:
        run(c)
    except gdb.error:
        pass

# C++ 标准库的美化打印（vector、string、map 画成数组、字符串、表）：Windows 上程序是静态编译的，gdb 不会自动加载，手动注册
_pp = os.environ.get("LL_PRINTERS")
if _pp and os.path.isdir(_pp):
    import sys
    sys.path.insert(0, _pp)
    try:
        from libstdcxx.v6.printers import register_libstdcxx_printers
        register_libstdcxx_printers(None)
    except Exception:
        pass

state = {"exit": None, "signal": None}
def on_exit(ev):
    state["exit"] = getattr(ev, "exit_code", 0)
def on_stop(ev):
    # SIGINT / SIGTRAP 是我们自己「戳」停的（见 step_cmd），不是程序出错
    if isinstance(ev, gdb.SignalEvent) and ev.stop_signal not in ("SIGINT", "SIGTRAP"):
        state["signal"] = ev.stop_signal
gdb.events.exited.connect(on_exit)
gdb.events.stop.connect(on_stop)

def base(fn):
    return os.path.basename(fn.replace("\\", "/")).lower() if fn else ""

def is_user(sal):
    return bool(sal and sal.symtab and base(sal.symtab.filename) in SRC)

CHARS = ("char", "signed char", "unsigned char")
def is_char(t):
    return t.code == gdb.TYPE_CODE_CHAR or (t.code == gdb.TYPE_CODE_INT and (t.name or "") in CHARS)

def text(bs):
    return bs.decode("utf-8", "replace")

def pyval(x, d, seen):
    if isinstance(x, gdb.Value):
        return conv(x, d, seen)
    if isinstance(x, bool):
        return {"k": "b", "v": x}
    if isinstance(x, (int, float)):
        return {"k": "n", "v": x}
    return {"k": "x", "v": str(x)[:80]}

def num(f):
    if math.isnan(f) or math.isinf(f):
        return {"k": "x", "v": str(f)}
    return {"k": "n", "v": f, "f": 1}

def conv(v, d=0, seen=None):
    try:
        return conv_(v, d, seen)
    except Exception:
        return {"k": "x", "v": "?"}

def conv_(v, d=0, seen=None):
    if seen is None:
        seen = set()
    try:
        t = v.type.strip_typedefs()
    except gdb.error:
        return {"k": "x", "v": "?"}
    c = t.code
    try:
        if c == gdb.TYPE_CODE_BOOL:
            return {"k": "b", "v": bool(int(v))}
        if is_char(t):
            return {"k": "c", "v": int(v)}
        if c == gdb.TYPE_CODE_INT:
            return {"k": "n", "v": int(v)}
        if c == gdb.TYPE_CODE_FLT:
            return num(float(v))
        if c == gdb.TYPE_CODE_ENUM:
            return {"k": "n", "v": int(v), "e": str(v)}
        if c == gdb.TYPE_CODE_REF or c == getattr(gdb, "TYPE_CODE_RVALUE_REF", -99):
            return conv(v.referenced_value(), d, seen)
        if c == gdb.TYPE_CODE_ARRAY:
            lo, hi = t.range()
            n = hi - lo + 1
            et = t.target().strip_typedefs()
            addr = int(v.address) if v.address is not None else 0
            if is_char(et):
                m = min(max(n, 0), 400)
                bs = bytes(int(v[lo + i]) & 255 for i in range(m))
                z = bs.find(b"\0")
                return {"k": "s", "v": text(bs if z < 0 else bs[:z]), "n": n, "addr": addr}
            lim = ARR_MAX if d == 0 else SUB_MAX
            items = [conv(v[lo + i], d + 1, seen) for i in range(min(n, lim))]
            return {"k": "a", "v": items, "n": n, "addr": addr, "es": et.sizeof}
        if c in (gdb.TYPE_CODE_STRUCT, gdb.TYPE_CODE_UNION):
            vis = gdb.default_visualizer(v)
            if vis is not None:
                return visual(v, vis, t, d, seen)
            addr = int(v.address) if v.address is not None else 0
            fs = {}
            for f in t.fields():
                if not f.name or f.is_base_class or (hasattr(f, "bitpos") is False):
                    continue
                fs[f.name] = conv(v[f], d + 1, seen)
            return {"k": "o", "t": t.tag or t.name or "", "v": fs, "addr": addr}
        if c == gdb.TYPE_CODE_PTR:
            a = int(v)
            if a == 0:
                return {"k": "z"}
            tt = t.target().strip_typedefs()
            if is_char(tt):
                try:
                    bs = bytes(gdb.selected_inferior().read_memory(a, 200))
                    z = bs.find(b"\0")
                    return {"k": "s", "v": text(bs if z < 0 else bs[:z]), "p": a}
                except gdb.MemoryError:
                    return {"k": "p", "a": a, "bad": 1}
            if tt.code == gdb.TYPE_CODE_FUNC:
                return {"k": "x", "v": "函数"}
            if tt.code == gdb.TYPE_CODE_VOID:
                return {"k": "p", "a": a}
            if a in seen or d >= DEPTH:
                return {"k": "p", "a": a, "ref": 1}
            seen.add(a)
            try:
                inner = conv(v.dereference(), d + 1, seen)
            except (gdb.MemoryError, gdb.error):
                return {"k": "p", "a": a, "bad": 1}
            return {"k": "p", "a": a, "d": inner}
    except (gdb.MemoryError, gdb.error, ValueError, OverflowError):
        return {"k": "x", "v": "?"}
    try:
        return {"k": "x", "v": str(v)[:80]}
    except gdb.error:
        return {"k": "x", "v": "?"}

def visual(v, vis, t, d, seen):
    # C++ 标准库（vector、string、map……）：用 gdb 自带的美化打印
    hint = vis.display_hint() if hasattr(vis, "display_hint") else None
    name = (t.tag or t.name or "")
    short = name.split("<")[0]
    if hint == "string" or short.endswith("basic_string"):
        s = vis.to_string()
        try:
            if hasattr(s, "length") and hasattr(s, "value") and not isinstance(s, gdb.Value):
                n = s.length
                s = s.value().string(length=min(n, 400) if n >= 0 else -1)
            elif isinstance(s, gdb.Value):
                s = s.string(length=400)
        except (gdb.error, gdb.MemoryError, ValueError):
            try:
                s = str(v)
                if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
                    s = s[1:-1]
            except gdb.error:
                s = "?"
        return {"k": "s", "v": str(s)}
    kids = []
    if hasattr(vis, "children"):
        for i, kv in enumerate(vis.children()):
            if i >= ARR_MAX * 2:
                break
            kids.append(kv)
    if hint == "map":
        pairs = [[pyval(kids[i][1], d + 1, seen), pyval(kids[i + 1][1], d + 1, seen)] for i in range(0, len(kids) - 1, 2)]
        return {"k": "m", "v": pairs, "t": short}
    if hint == "array" or any(x in short for x in ("vector", "deque", "list", "array", "set", "stack", "queue")):
        return {"k": "a", "v": [pyval(x, d + 1, seen) for _, x in kids[:ARR_MAX]], "t": short}
    if kids:
        return {"k": "o", "t": short, "v": {str(k): pyval(x, d + 1, seen) for k, x in kids[:40]}}
    try:
        return {"k": "x", "v": str(vis.to_string())[:80]}
    except Exception:
        return {"k": "x", "v": "?"}

LEN_SUFFIX = ("Size", "_size", "Len", "_len", "Length", "_length", "Count", "_count", "Num", "_num", "N", "_n")
LEN_GENERIC = ("n", "len", "size", "length", "cnt", "count", "num", "sz")

def as_array(v, raw):
    # 指针 + 长度变量 → 当数组画：int *nums, int numsSize（力扣的 C 函数都这样）、int *a = malloc(n * sizeof(int))
    try:
        t = v.type.strip_typedefs()
        if t.code != gdb.TYPE_CODE_PTR or int(v) == 0:
            return None
        tt = t.target().strip_typedefs()
        if tt.code not in (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_FLT, gdb.TYPE_CODE_BOOL) or is_char(tt):
            return None
    except (gdb.error, ValueError):
        return None
    return tt

def frame_vars(f, line):
    try:
        b = f.block()
    except RuntimeError:
        return []
    got, names, raw = [], set(), {}
    while b is not None:
        for sym in b:
            if not (sym.is_variable or sym.is_argument) or sym.name in names:
                continue
            # 这一行还没走到的声明不显示
            if not sym.is_argument and b.function is None and sym.line and sym.line >= line:
                continue
            if not sym.is_argument and b.function is not None and sym.line and sym.line > line:
                continue
            names.add(sym.name)
            try:
                v = sym.value(f)
                raw[sym.name] = v
                got.append([0 if sym.is_argument else 1, sym.line or 0, sym.name, v])
            except (gdb.error, RuntimeError):
                pass
        if b.function is not None:
            break
        b = b.superblock
    ints = {}
    for n, v in raw.items():
        try:
            if v.type.strip_typedefs().code == gdb.TYPE_CODE_INT and not is_char(v.type.strip_typedefs()):
                ints[n] = int(v)
        except (gdb.error, ValueError):
            pass
    ptrs = [n for n, v in raw.items() if as_array(v, raw) is not None]
    out = []
    for g in sorted(got, key=lambda x: (x[0], x[1])):
        n, v = g[2], g[3]
        val = None
        tt = as_array(v, raw)
        if tt is not None:
            ln = next((ints[n + s] for s in LEN_SUFFIX if n + s in ints), None)
            if ln is None and (len(ptrs) == 1 or n in ("a", "b", "arr", "array", "nums", "num", "data", "list", "q", "st", "stack", "queue", "heap", "dp")):
                ln = next((ints[k] for k in LEN_GENERIC if k in ints), None)
            if ln is not None and 0 < ln <= 100000:
                try:
                    arr = v.cast(tt.array(min(ln, ARR_MAX) - 1).pointer()).dereference()
                    val = conv(arr)
                    if val.get("k") == "a":
                        val["n"] = ln
                        val["ptr"] = 1
                except (gdb.error, gdb.MemoryError, ValueError):
                    val = None
        out.append([n, val if val is not None else conv(v)])
    return out

GLOBALS = None
def globals_now():
    global GLOBALS
    if GLOBALS is None:
        GLOBALS = []
        try:
            blk = gdb.selected_frame().block()
            for b in (blk.static_block, blk.global_block):
                for sym in b:
                    if sym.is_variable and sym.symtab and base(sym.symtab.filename) in SRC and not sym.name.startswith("laolao"):
                        GLOBALS.append(sym)
        except (gdb.error, RuntimeError):
            pass
        GLOBALS.sort(key=lambda s: s.line or 0)
    out = []
    for sym in GLOBALS:
        try:
            out.append([sym.name, conv(sym.value())])
        except (gdb.error, RuntimeError):
            pass
    return out

out_pos = 0
def new_output():
    global out_pos
    try:
        with open(OUTF, "rb") as fh:
            fh.seek(out_pos)
            bs = fh.read(65536)
        out_pos += len(bs)
        return text(bs)
    except OSError:
        return ""

# 一行里的循环（while (1) x++;、for (...) s += i;）：gdb 的 step 要等到「换了一行」才停，会一直跑下去。
# 每一步最多等 0.12 秒，没停就戳一下程序让它停（Linux 发 SIGINT，Windows 用 DebugBreakProcess），记下这时候的样子接着走
PID = [0]
def poke():
    state["poked"] = True
    try:
        if os.name == "nt":
            import ctypes
            k = ctypes.windll.kernel32
            h = k.OpenProcess(0x1F0FFF, False, PID[0])
            if h:
                k.DebugBreakProcess(h)
                k.CloseHandle(h)
        elif PID[0]:
            os.kill(PID[0], signal.SIGINT)
    except Exception:
        pass

def step_cmd(cmd):
    state["poked"] = False
    t = threading.Timer(0.12, poke)
    t.daemon = True
    t.start()
    try:
        return run(cmd)
    finally:
        t.cancel()
        if state.get("poked") and os.name == "nt":
            try:
                run("thread 1")   # Windows 上戳停的是新开的一个线程，切回主线程
            except gdb.error:
                pass

def alive():
    try:
        return gdb.selected_inferior().pid != 0 and state["exit"] is None
    except gdb.error:
        return False

emit({"start": 1})
try:
    run('file "%s"' % PROG)
    run("break main")
    run("run < ll-in.txt > ll-out.txt")
except gdb.error as e:
    emit({"fatal": str(e)[:300]})
    RES.close()
    gdb.execute("quit")

steps, misses, last = 0, 0, None
try:
    PID[0] = gdb.selected_inferior().pid
except gdb.error:
    pass
trunc = False
while alive():
    if steps >= MAXS or time.time() > DEADLINE:
        trunc = True
        break
    try:
        fr = gdb.selected_frame()
        sal = fr.find_sal()
    except gdb.error:
        break
    if state["signal"] and not is_user(sal):
        # 程序在库函数里崩了（比如 strlen 读到坏指针）：往上找到你的代码那一层
        f = fr
        while f is not None and not is_user(f.find_sal()):
            f = f.older()
        if f is None:
            break
        fr, sal = f, f.find_sal()
    if not is_user(sal):
        misses += 1
        if misses > 400:
            break
        try:
            step_cmd("finish")
        except gdb.error:
            try:
                step_cmd("step")
            except gdb.error:
                break
        continue
    misses = 0
    stack, f, k = [], fr, 0
    while f is not None and k < 16:
        s2 = f.find_sal()
        if is_user(s2):
            stack.append({"fn": f.name() or "?", "l": s2.line, "v": frame_vars(f, s2.line) if len(stack) < 8 else []})
        f = f.older()
        k += 1
    step = {"l": sal.line, "f": stack, "g": globals_now()}
    o = new_output()
    if o:
        step["o"] = o
    if state["signal"]:
        step["err"] = state["signal"]
    key = json.dumps(step, sort_keys=True)
    if key != last:   # finish 回到同一行、什么都没变的不重复记
        emit(step)
        steps += 1
        last = key
    if state["signal"]:
        break
    try:
        step_cmd("step")
    except gdb.error as e:
        if alive():
            emit({"warn": str(e)[:200]})
        break

o = new_output()
emit({"end": 1, "exit": state["exit"], "signal": state["signal"], "trunc": trunc, "o": o})
RES.close()
try:
    if alive():
        run("kill")
except gdb.error:
    pass
