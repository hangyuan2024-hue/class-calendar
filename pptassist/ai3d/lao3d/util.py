# 捞捞 · 3D 形象工坊：进度回报、下载镜像、看显卡和内存
#   和捞捞PPT助手之间约定：标准输出里以 @@ 开头的一行是一条 JSON 消息（进度 / 结果 / 出错），其余的行是日志
import json
import os
import sys
import time
import urllib.request

_t0 = time.time()

# 消息和日志里有中文：不管系统是什么编码（英文 Windows 默认 cp1252），一律按 UTF-8 输出
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


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


def api_ok(base, timeout=8):
    """真的能查到模型信息才算连得上（以前只看网站有没有回音：被拦截时返回个错误页也当成连上了，结果下模型时才失败）"""
    try:
        req = urllib.request.Request(base.rstrip("/") + "/api/models/tencent/Hunyuan3D-2", headers={"User-Agent": "laolao-3d"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status == 200 and b'"id"' in r.read(4096)
    except Exception:
        return False


def use_mirror():
    """国内连不上 huggingface.co 时，模型从 hf-mirror.com 下（老师也可以自己先设好 HF_ENDPOINT）"""
    # 别的软件设了「离线」（HF_HUB_OFFLINE）：这里要下模型，去掉（不然只会在本机找、找不到就报 local_files_only）
    for k in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "DIFFUSERS_OFFLINE"):
        if os.environ.get(k) not in (None, "", "0"):
            log("去掉了环境变量 %s（要下模型）" % k)
            os.environ.pop(k, None)
    os.environ.setdefault("HF_HUB_ETAG_TIMEOUT", "30")       # 镜像有时慢，默认 10 秒太短
    os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "60")
    if os.environ.get("HF_ENDPOINT"):
        return os.environ["HF_ENDPOINT"]
    if not api_ok("https://huggingface.co"):
        os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
        log("连不上 huggingface.co，改用镜像 https://hf-mirror.com" + ("" if api_ok("https://hf-mirror.com") else "（镜像也没连上，下模型可能会失败）"))
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
