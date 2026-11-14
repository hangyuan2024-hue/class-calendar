"""捞捞算力 · 配方（训练 / 生成的 Python 代码）用的小工具。

配方里这样用：
    import lg
    t = lg.task()                 # 这次要做的事：{"input": {...}, "job": {...}, "resume": 本地存档路径或 None, ...}
    for step in range(...):
        lg.metric(step, loss=0.1)  # 曲线（客户端和控制中心实时画）
        lg.progress(0.3)           # 进度 0～1
        lg.checkpoint(path, step)  # 中途存档：这台电脑停了，下一台从这里接着算
    lg.output(path)                # 交一个结果文件
    lg.review(kind="ab", a=图片路径, b=图片路径, question="哪个更可爱？")  # 交给大家人工审核
    lg.done(loss=0.01, ckpt=path)  # 做完（结果里的文件路径会自动上传）
    lg.comfy("run", graph={...})   # 配方开头写「# needs: comfy」：让本机的 AI 引擎（ComfyUI）画图，返回结果文件
    lg.llm("start", lora=path)     # 配方开头写「# needs: llm」：换个方式开本地大模型（比如带上 LoRA 考试）
    lg.dataset()                   # 任务参数里写了 dataset：大家审核好的结果（训练用）

客户端会每隔一小会儿看一眼「现在执行到配方的第几行」，在界面上把那一行高亮出来。
"""
import json
import os
import shutil
import sys
import threading
import time

_out = sys.__stdout__
# Windows 的控制台默认是 GBK / cp1252，写中文会报错：和客户端之间一律用 UTF-8
for _s in (sys.__stdout__, sys.__stderr__, sys.stdin):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
_lock = threading.Lock()
_task = None
_recipe = os.path.normcase(os.path.abspath(os.environ.get("LG_RECIPE", sys.argv[0] if sys.argv else "")))


def _clean(v):
    # NaN / 无穷大（训练发散时常见）JSON 里放不下：换成 None
    if isinstance(v, float) and (v != v or v in (float("inf"), float("-inf"))):
        return None
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    return v


def _send(**m):
    with _lock:
        _out.write("@@lg " + json.dumps(_clean(m), ensure_ascii=False) + "\n")
        _out.flush()


def task():
    """这次的任务（客户端写在 LG_TASK 指向的文件里）。"""
    global _task
    if _task is None:
        p = os.environ.get("LG_TASK")
        if p and os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                _task = json.load(f)
        else:
            _task = {"input": {}, "job": {"params": {}}, "resume": None, "work": os.getcwd()}
    return _task


def work_dir():
    d = task().get("work") or os.getcwd()
    os.makedirs(d, exist_ok=True)
    return d


def log(*a):
    _send(t="log", msg=" ".join(str(x) for x in a))


def metric(step, **kv):
    _send(t="metric", step=int(step), **{k: float(v) for k, v in kv.items() if v is not None})


def progress(p, note=None):
    _send(t="progress", p=max(0.0, min(1.0, float(p))), note=note)


def checkpoint(path, step, **extra):
    """存档文件写好以后调用（每次用新文件名，客户端在后台上传）。"""
    _send(t="ckpt", path=os.path.abspath(path), step=int(step), **extra)


def output(path, name=None):
    _send(t="output", path=os.path.abspath(path), name=name or os.path.basename(path))


def image(path, caption=""):
    """在客户端的画廊里显示一张刚生成的图（不上传）。"""
    _send(t="image", path=os.path.abspath(path), caption=caption)


def review(kind="ab", **payload):
    """交给大家审核。kind="ab"：a、b 两张图比哪个好；kind="pass"：img 一张图合不合格。图片写本地路径，客户端会上传。"""
    for k in ("a", "b", "ref", "img", "audio"):
        if k in payload and payload[k]:
            payload[k] = os.path.abspath(payload[k])
    _send(t="review", kind=kind, **payload)


def download(url, dest, note=None):
    """下载一个文件（前面步骤交的结果：t["deps"][步骤]["outputs"][i]["url"]）。下过的不再下。
    url 可以是一串地址（国内存储、hf-mirror、官方），前面的不通就换下一个。"""
    import urllib.request
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
    urls = [url] if isinstance(url, (str, dict)) else list(url)
    err = None
    for u in urls:
        # GitHub 上超过 2G 的切成了几块：{"parts": [地址1, 地址2…]}，每块下好再按顺序接起来
        if isinstance(u, dict):
            try:
                ps = []
                for i, pu in enumerate(u.get("parts") or []):
                    ps.append(download(pu, dest + ".p%03d" % (i + 1), note and "%s（第 %d/%d 块）" % (note, i + 1, len(u["parts"]))))
                if not ps:
                    continue
                with open(dest + ".part", "wb") as out:
                    for pf in ps:
                        with open(pf, "rb") as fh:
                            shutil.copyfileobj(fh, out, 8 << 20)
                os.replace(dest + ".part", dest)
                for pf in ps:
                    os.remove(pf)
                return dest
            except Exception as e:
                err = e
                continue
        tmp = dest + ".part"
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "laolao-grid"})
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                total = int(r.headers.get("Content-Length") or 0)
                got, last = 0, 0.0
                while True:
                    b = r.read(1 << 20)
                    if not b:
                        break
                    f.write(b)
                    got += len(b)
                    if note and total and time.time() - last > 2:
                        last = time.time()
                        log("%s：%d%%（%.0fM / %.0fM）" % (note, got * 100 // total, got / 1e6, total / 1e6))
            if total and os.path.getsize(tmp) != total:
                raise IOError("没下完整")
            os.replace(tmp, dest)
            return dest
        except Exception as e:  # 换下一个地址
            err = e
            try:
                os.remove(tmp)
            except OSError:
                pass
    raise IOError("下载失败：%s（%s）" % (os.path.basename(dest), err))


def region():
    """这台电脑在国内（cn）还是国外（global）：客户端测过的（同时连国内存储和 GitHub，看谁快）"""
    return (task() or {}).get("region") or "cn"


_mirror_cache = None


def mirror(model=None, group=None):
    """组件镜像清单（download/ai-mirror.json）里的文件：[{name, size, sha256, sources}]，
    sources 已经按地区排好：国内先腾讯云存储，国外先自己 GitHub 的 Release（超过 2G 的是 {"parts": [...]}）。读不到就是空的。"""
    global _mirror_cache
    import json as _json
    import urllib.request
    if _mirror_cache is None and os.environ.get("LG_MIRROR") == "off":
        _mirror_cache = {}
    if _mirror_cache is None:
        cn = ["https://www.laolaokechengbiao.cn/download/ai-mirror.json", "https://cdn.jsdelivr.net/gh/hangyuan2024-hue/class-calendar@main/download/ai-mirror.json"]
        gl = ["https://raw.githubusercontent.com/hangyuan2024-hue/class-calendar/main/download/ai-mirror.json"]
        _mirror_cache = {}
        own = os.environ.get("LG_MIRROR")  # 测试用：换一个清单地址
        for u in ([own] if own else gl + cn if region() == "global" else cn + gl):
            try:
                with urllib.request.urlopen(urllib.request.Request(u + "?t=%d" % time.time(), headers={"User-Agent": "laolao-grid"}), timeout=20) as r:
                    _mirror_cache = _json.loads(r.read().decode("utf-8")).get("files") or {}
                    break
            except Exception:
                pass
    out = []
    for key, v in _mirror_cache.items():
        if model and v.get("model") != model:
            continue
        if group and v.get("group") != group:
            continue
        if not str(v.get("url", "")).startswith(("https://", "http://127.0.0.1")):
            continue
        gh = v.get("gh") or []
        ghs = (gh[0] if len(gh) == 1 else {"parts": gh}) if gh else None
        src = [x for x in ([ghs, v["url"]] if region() == "global" else [v["url"], ghs]) if x]
        out.append(dict(v, key=key, sources=src))
    return out


_cid = 0
_stdin_lock = threading.Lock()


def _call(_kind, _op, /, **args):
    """让客户端做一件事，等它做完（一行 JSON 写到标准输入）。"""
    global _cid
    with _stdin_lock:
        _cid += 1
        my = _cid
        if "path" in args and args["path"]:
            args["path"] = os.path.abspath(args["path"])
        _send(t=_kind, id=my, op=_op, **args)
        while True:
            line = sys.stdin.readline()
            if not line:
                raise RuntimeError("客户端断开了")
            try:
                m = json.loads(line)
            except ValueError:
                continue
            if m.get("id") != my:
                continue
            if not m.get("ok"):
                raise RuntimeError(("AI 引擎：" if _kind == "comfy" else "本地大模型：") + str(m.get("error")))
            m.pop("ok", None)
            m.pop("id", None)
            return m


def comfy(op, /, **args):
    """让本机的 AI 引擎（ComfyUI）做事，等它做完：
        comfy("info")                             → {"models": {"qwenEdit": 文件名, ...}, "vram": 8}
        comfy("upload", path=图片)                → {"name": ComfyUI 里的名字}（给 LoadImage 用）
        comfy("lora", path=插件, name="x.safetensors") → {"name": "laolao/x.safetensors"}（给 LoraLoader 用）
        comfy("run", graph=节点图)                → {"files": [结果图片的本地路径]}
    """
    return _call("comfy", op, **args)


def llm(op, /, **args):
    """本地大模型（配方开头写「# needs: llm」）：
        llm("start", llm={...可选，覆盖任务参数里的模型...}, lora=任务文件夹里的 LoRA)  → {"url": "http://127.0.0.1:端口"}
        llm("stop")                                → 关掉（让出显存给训练）
        llm("info")                                → {"version": "b6xxx"}（llama.cpp 的版本）
    """
    if "lora" in args and args["lora"]:
        args["lora"] = os.path.abspath(args["lora"])
    return _call("llm", op, **args)


def dataset():
    """大家审核好的结果（任务参数里写 "dataset": "标签"，只给领着这个任务的电脑）。"""
    p = task().get("dataset")
    if not p or not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def done(**result):
    """结果里值是文件路径的（ckpt、delta、global 等），客户端会上传后换成存储里的地址。"""
    for k, v in list(result.items()):
        if isinstance(v, str) and os.path.isabs(v) and os.path.exists(v):
            result[k] = {"$file": v}
    _send(t="result", **result)


# ---- 实时代码：看主线程现在在配方的哪一行 ----
def _sampler(main_id):
    last = None
    last_t = 0
    while True:
        time.sleep(0.25)
        try:
            f = sys._current_frames().get(main_id)
            hit = None
            while f is not None:
                if os.path.normcase(os.path.abspath(f.f_code.co_filename)) == _recipe:
                    hit = f
                    break
                f = f.f_back
            if hit is not None:
                cur = (hit.f_lineno, hit.f_code.co_name)
                if cur != last or time.time() - last_t > 2:
                    _send(t="line", line=cur[0], fn=cur[1])
                    last, last_t = cur, time.time()
        except Exception:
            pass


if os.environ.get("LG_TASK"):
    threading.Thread(target=_sampler, args=(threading.main_thread().ident,), daemon=True).start()
