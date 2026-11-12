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

客户端会每隔一小会儿看一眼「现在执行到配方的第几行」，在界面上把那一行高亮出来。
"""
import json
import os
import sys
import threading
import time

_out = sys.__stdout__
_lock = threading.Lock()
_task = None
_recipe = os.path.abspath(os.environ.get("LG_RECIPE", sys.argv[0] if sys.argv else ""))


def _send(**m):
    with _lock:
        _out.write("@@lg " + json.dumps(m, ensure_ascii=False) + "\n")
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
    _send(t="metric", step=int(step), **{k: float(v) for k, v in kv.items()})


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
    for k in ("a", "b", "img", "audio"):
        if k in payload and payload[k]:
            payload[k] = os.path.abspath(payload[k])
    _send(t="review", kind=kind, **payload)


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
                if os.path.abspath(f.f_code.co_filename) == _recipe:
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
