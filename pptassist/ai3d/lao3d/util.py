# 捞捞 · 3D 形象工坊：进度回报、下载镜像、看显卡和内存
#   和捞捞PPT助手之间约定：标准输出里以 @@ 开头的一行是一条 JSON 消息（进度 / 结果 / 出错），其余的行是日志
import json
import os
import sys
import time
import urllib.request

_t0 = time.time()


def say(**kw):
    """给 PPT 助手发一条消息：stage（哪一步）、p（0~1 的进度）、msg（给老师看的话）"""
    kw.setdefault("t", round(time.time() - _t0, 1))
    sys.stdout.write("@@" + json.dumps(kw, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def reachable(url, timeout=4):
    try:
        req = urllib.request.Request(url, method="HEAD")
        urllib.request.urlopen(req, timeout=timeout)
        return True
    except Exception as e:   # 403 / 405 也算连得上
        return hasattr(e, "code")


def use_mirror():
    """国内连不上 huggingface.co 时，模型从 hf-mirror.com 下（老师也可以自己先设好 HF_ENDPOINT）"""
    if os.environ.get("HF_ENDPOINT"):
        return os.environ["HF_ENDPOINT"]
    if not reachable("https://huggingface.co"):
        os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
        log("连不上 huggingface.co，改用镜像 https://hf-mirror.com")
    return os.environ.get("HF_ENDPOINT", "https://huggingface.co")


def gpu_info():
    try:
        import torch
        if not torch.cuda.is_available():
            return {"cuda": False, "torch": torch.__version__}
        p = torch.cuda.get_device_properties(0)
        return {"cuda": True, "torch": torch.__version__, "name": p.name, "vram": round(p.total_memory / 2 ** 30, 1), "cap": f"{p.major}.{p.minor}"}
    except Exception as e:
        return {"cuda": False, "error": str(e)}


def ram_gb():
    try:
        if sys.platform == "win32":
            import ctypes

            class MS(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong), ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong), ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong), ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong), ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
            m = MS()
            m.dwLength = ctypes.sizeof(MS)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            return round(m.ullTotalPhys / 2 ** 30, 1)
        return round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 2 ** 30, 1)
    except Exception:
        return 0.0


def free_gpu():
    import gc
    gc.collect()
    try:
        import torch
        torch.cuda.empty_cache()
    except Exception:
        pass
