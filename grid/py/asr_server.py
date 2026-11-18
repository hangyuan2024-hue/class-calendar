# 捞捞算力 · 成品展示「打电话」的耳朵：把听到的一段话（16k 单声道 wav）变成文字
#   用 GPT-SoVITS 整合包自带的 FunASR（达摩院 Paraformer 中文识别 + 断句 + 加标点），整合包的 Python 跑，不用另外装。
#   第一次用的时候从魔搭（ModelScope）下识别模型（几百 M，魔搭连不上就从 HuggingFace 下），以后直接用。
#   默认用 CPU（一句话不到一秒），显卡留给大模型和声音；设 LG_ASR_DEVICE=cuda 改用显卡。
#   POST /asr（body 是 wav）→ {"text": "..."}；GET /ping → ok。模型加载好了才开始监听，端口能连上就是准备好了。
import argparse, json, os, sys, tempfile, traceback
from http.server import HTTPServer, BaseHTTPRequestHandler

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=9881)
ap.add_argument("--fake", action="store_true")   # 测试用：不加载模型，回 wav 的长度
a = ap.parse_args()
sys.path.insert(0, os.getcwd())                   # cwd 是整合包的文件夹：tools.asr 在里面


# Python 3.12 起没有 distutils，FunASR 有几处还在用：借 setuptools 里的那份（整合包自己的听写也是这么做的）
try:
    import distutils  # noqa
except Exception:
    try:
        import setuptools._distutils as _d, setuptools._distutils.util as _du, setuptools._distutils.version as _dv
        sys.modules.setdefault("distutils", _d); sys.modules.setdefault("distutils.util", _du); sys.modules.setdefault("distutils.version", _dv)
    except Exception:
        pass

PARA = "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"
VAD = "speech_fsmn_vad_zh-cn-16k-common-pytorch"
PUNC = "punc_ct-transformer_zh-cn-common-vocab272727-pytorch"


def why(e):
    t = (str(e) or type(e).__name__).strip().splitlines()[0][:200]
    # 下载失败时 FunASR 报的是「not registered」，看不出是网的问题
    return "下载识别模型失败（连不上）" if "not registered" in t else t


def load():
    if a.fake:
        return None
    dev = os.environ.get("LG_ASR_DEVICE", "cpu")
    try:
        if dev.startswith("cuda"):
            import torch
            if not torch.cuda.is_available():
                dev = "cpu"
    except Exception:
        dev = "cpu"
    errs = []

    def auto(**kw):
        from funasr import AutoModel
        try:
            return AutoModel(device=dev, disable_update=True, **kw)
        except TypeError:   # 很老的 funasr 不认 disable_update
            return AutoModel(device=dev, **kw)

    # 1. 新版整合包：tools/asr/funasr_asr.py 有 create_damo_model(device)（默认的 Fun-ASR-Nano 太大，打电话用达摩 Paraformer 就够了）
    try:
        import tools.asr.funasr_asr as F
        if hasattr(F, "create_damo_model"):
            m = F.create_damo_model(dev)
            print("耳朵准备好了（整合包的达摩 Paraformer，" + dev + "）", flush=True)
            return m
    except Exception as e:
        errs.append("整合包的听写：" + why(e))
    # 2. 魔搭：模型已经在 tools/asr/models 里就直接用，没有就下
    R = "tools/asr/models/"
    loc = lambda d: R + d if os.path.isdir(R + d) else "iic/" + d
    try:
        m = auto(model=loc(PARA), model_revision="v2.0.4", vad_model=loc(VAD), vad_model_revision="v2.0.4", punc_model=loc(PUNC), punc_model_revision="v2.0.4")
        print("耳朵准备好了（达摩 Paraformer，魔搭，" + dev + "）", flush=True)
        return m
    except Exception as e:
        errs.append("魔搭：" + why(e))
    # 3. 魔搭连不上（比如在国外）：从 HuggingFace 下同一套模型
    try:
        m = auto(model="paraformer-zh", vad_model="fsmn-vad", punc_model="ct-punc", hub="hf")
        print("耳朵准备好了（达摩 Paraformer，HuggingFace，" + dev + "）", flush=True)
        return m
    except Exception as e:
        errs.append("HuggingFace：" + why(e))
    print("ERROR: 听写模型加载不了：" + "；".join(errs), flush=True)
    sys.exit(1)


M = load()


def recognize(path):
    if M is None:
        return "（假的识别：%d 字节）" % os.path.getsize(path)
    r = M.generate(input=path)
    t = "".join(x.get("text", "") for x in (r or []))
    return t.strip()


class H(BaseHTTPRequestHandler):
    def log_message(self, *x):
        pass

    def reply(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        self.reply(200, {"ok": True})

    def do_POST(self):
        if self.path != "/asr":
            return self.reply(404, {"error": "没有这个地址"})
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        if body[:4] != b"RIFF":
            return self.reply(400, {"error": "要 wav"})
        f = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        try:
            f.write(body); f.close()
            self.reply(200, {"text": recognize(f.name)})
        except Exception as e:
            traceback.print_exc()
            self.reply(500, {"error": str(e)})
        finally:
            try:
                os.unlink(f.name)
            except Exception:
                pass


HTTPServer(("127.0.0.1", a.port), H).serve_forever()
