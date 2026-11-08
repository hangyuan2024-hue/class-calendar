# 捞捞编程 · 画出来：一行一行地跑 Python 程序，每走一步记下所有变量（列表、字典、对象、链表……）
# 由 core/trace.js 启动：python -X utf8 py_trace.py 你的文件.py 结果.jsonl 最多步数 最多秒数（输入从 stdin 来）
import sys, os, json, time, types, traceback, io

path = os.path.abspath(sys.argv[1])
RES = open(sys.argv[2], "w", encoding="utf-8", buffering=1)
MAXS = int(sys.argv[3]) if len(sys.argv) > 3 else 1500
DEADLINE = time.time() + (float(sys.argv[4]) if len(sys.argv) > 4 else 12)
ARR_MAX, DEPTH = 120, 12

def emit(o):
    RES.write(json.dumps(o, ensure_ascii=False, separators=(",", ":")) + "\n")

class Out(io.TextIOBase):
    def __init__(self):
        self.buf = []
    def write(self, s):
        self.buf.append(str(s))
        return len(s)
    def take(self):
        s = "".join(self.buf)
        self.buf = []
        return s
    def flush(self):
        pass
out = Out()

SKIP = (types.ModuleType, types.FunctionType, types.BuiltinFunctionType, type, types.MethodType)

def conv(x, d=0, seen=None):
    if seen is None:
        seen = set()
    if x is None:
        return {"k": "z"}
    if isinstance(x, bool):
        return {"k": "b", "v": x}
    if isinstance(x, int):
        return {"k": "n", "v": x} if abs(x) < 2 ** 53 else {"k": "x", "v": str(x)[:60]}
    if isinstance(x, float):
        return {"k": "n", "v": x, "f": 1} if x == x and abs(x) != float("inf") else {"k": "x", "v": str(x)}
    if isinstance(x, str):
        return {"k": "s", "v": x[:400], "py": 1}
    if id(x) in seen or d > DEPTH:
        return {"k": "p", "a": id(x), "ref": 1}
    seen = seen | {id(x)}
    if isinstance(x, (list, tuple)):
        return {"k": "a", "v": [conv(y, d + 1, seen) for y in x[:ARR_MAX]], "n": len(x), "t": type(x).__name__, "id": id(x)}
    if isinstance(x, (set, frozenset)):
        items = list(x)[:ARR_MAX]
        try:
            items.sort()
        except TypeError:
            pass
        return {"k": "a", "v": [conv(y, d + 1, seen) for y in items], "n": len(x), "t": "set", "id": id(x)}
    if isinstance(x, dict):
        return {"k": "m", "v": [[conv(k, d + 1, seen), conv(v, d + 1, seen)] for k, v in list(x.items())[:ARR_MAX]], "t": "dict", "id": id(x)}
    if isinstance(x, SKIP):
        return None
    if hasattr(x, "__dict__"):
        fs = {}
        for k, v in list(vars(x).items())[:40]:
            if k.startswith("__"):
                continue
            c = conv(v, d + 1, seen)
            if c is not None:
                fs[k] = c
        # Python 里对象是「引用」：画成指针指向一个结构体，和 C 的链表一个画法
        return {"k": "p", "a": id(x), "d": {"k": "o", "t": type(x).__name__, "v": fs, "addr": id(x)}}
    try:
        return {"k": "x", "v": repr(x)[:80]}
    except Exception:
        return {"k": "x", "v": "?"}

def var_list(ns, glob=False):
    res = []
    for k, v in list(ns.items()):
        if k.startswith("__") or (glob and k in ("In", "Out")):
            continue
        c = conv(v)
        if c is not None:
            res.append([k, c])
    return res

state = {"n": 0, "last": None, "trunc": False}
class Stop(Exception):
    pass

def snapshot(frame):
    stack, f = [], frame
    while f is not None:
        if f.f_code.co_filename == path:
            if f.f_code.co_name != "<module>":
                stack.append({"fn": f.f_code.co_name, "l": f.f_lineno, "v": var_list(f.f_locals) if len(stack) < 8 else []})
            else:
                stack.append({"fn": "主程序", "l": f.f_lineno, "v": []})
        f = f.f_back
    return stack

G = {"__name__": "__main__", "__file__": path, "__builtins__": __builtins__}

def tracer(frame, event, arg):
    if frame.f_code.co_filename != path:
        return None
    if event == "line" or event == "return":
        if state["n"] >= MAXS or time.time() > DEADLINE:
            state["trunc"] = True
            raise Stop()
        step = {"l": frame.f_lineno, "f": snapshot(frame), "g": var_list(G, True)}
        if event == "return":
            if frame.f_code.co_name == "<module>":
                return tracer
            step["ret"] = conv(arg) or {"k": "x", "v": "?"}
        o = out.take()
        if o:
            step["o"] = o
        key = json.dumps(step, sort_keys=True, ensure_ascii=False)
        if key != state["last"]:
            emit(step)
            state["n"] += 1
            state["last"] = key
    return tracer

emit({"start": 1})
err = None
try:
    with open(path, encoding="utf-8") as fh:
        code = compile(fh.read(), path, "exec")
except SyntaxError as e:
    emit({"end": 1, "syntax": {"line": e.lineno, "msg": e.msg}})
    RES.close()
    sys.exit(0)

real_out = sys.stdout
sys.stdout = out
sys.path.insert(0, os.path.dirname(path))
if len(sys.argv) > 5 and sys.argv[5]:
    sys.path.insert(0, sys.argv[5])   # 边打字边画时跑的是拷贝：同一个文件夹里的其它 .py 还能 import
try:
    sys.settrace(tracer)
    exec(code, G)
except Stop:
    pass
except SystemExit:
    pass
except BaseException as e:
    tb = traceback.extract_tb(e.__traceback__)
    line = next((t.lineno for t in reversed(tb) if t.filename == path), None)
    err = {"type": type(e).__name__, "msg": str(e)[:300], "line": line}
finally:
    sys.settrace(None)
    sys.stdout = real_out

emit({"end": 1, "exit": 1 if err else 0, "err": err, "trunc": state["trunc"], "o": out.take()})
RES.close()
