# 把一个大文件传到国内存储（腾讯云 COS），一块一块传、哪块失败只重传那一块、能接着上次传
#   为什么不用 aws s3 cp：从美国传广州很慢，同时开 16 个连接每个都更慢，腾讯云会掐掉太慢的连接（UserNetworkTooSlow），
#   而 aws s3 cp 失败了整个文件从头再来（4.8G 传了十几分钟又重来）。
#   这里：同时 4 块；每块失败重试 8 次；上次没传完的（同一个文件、同样大小）接着传，已经传好的块跳过。
#   python3 cn-put.py <本地文件> <存储里的路径> <地址>（地址：普通地址或全球加速地址）
#   成功退出 0；全球加速没开退出 3；别的失败退出 1
import concurrent.futures
import os
import sys
import time

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

F, KEY, EP = sys.argv[1], sys.argv[2], sys.argv[3]
B = os.environ["CN_S3_BUCKET"]
SIZE = os.path.getsize(F)
CH = max(16 << 20, -(-SIZE // 9000))          # 至少 16MB 一块，最多 9000 块
N = -(-SIZE // CH) or 1
WORKERS = int(os.environ.get("CN_PUT_WORKERS", "4"))
log = lambda *a: print(*a, file=sys.stderr, flush=True)

cfg = dict(signature_version="s3v4", s3={"addressing_style": os.environ.get("CN_PUT_STYLE", "virtual")}, retries={"max_attempts": 2, "mode": "standard"},
           connect_timeout=30, read_timeout=300, max_pool_connections=WORKERS + 2)
try:
    c = boto3.client("s3", endpoint_url=EP, region_name=os.environ.get("CN_S3_REGION") or "us-east-1",
                     config=Config(**cfg, request_checksum_calculation="when_required", response_checksum_validation="when_required"))
except TypeError:
    c = boto3.client("s3", endpoint_url=EP, region_name=os.environ.get("CN_S3_REGION") or "us-east-1", config=Config(**cfg))

t0 = time.time()
try:
    if N == 1:
        with open(F, "rb") as fh:
            c.put_object(Bucket=B, Key=KEY, Body=fh, ContentType="application/octet-stream")
        log("上传好了（一块）：%d 秒" % (time.time() - t0))
        sys.exit(0)
    # 上次没传完的接着传（同一个路径、块大小一样）
    up, done = None, {}
    try:
        for u in c.list_multipart_uploads(Bucket=B, Prefix=KEY).get("Uploads", []):
            if u["Key"] != KEY:
                continue
            ps = {}
            kw = {}
            while True:
                r = c.list_parts(Bucket=B, Key=KEY, UploadId=u["UploadId"], **kw)
                for p in r.get("Parts", []):
                    ps[p["PartNumber"]] = p
                if not r.get("IsTruncated"):
                    break
                kw = {"PartNumberMarker": r["NextPartNumberMarker"]}
            good = {n: p["ETag"] for n, p in ps.items() if p["Size"] == (CH if n < N else SIZE - CH * (N - 1))}
            if up is None and (good or not ps):
                up, done = u["UploadId"], good
            else:
                try:
                    c.abort_multipart_upload(Bucket=B, Key=KEY, UploadId=u["UploadId"])
                except Exception:
                    pass
    except ClientError as e:
        if "AccelerateNotEnabled" in str(e) or "BucketAccelerateNotEnabled" in str(e):
            raise
        log("查上次没传完的出错（%s），从头传" % e)
    if up:
        log("接着上次传：%d/%d 块已经传好" % (len(done), N))
    else:
        up = c.create_multipart_upload(Bucket=B, Key=KEY, ContentType="application/octet-stream")["UploadId"]
    log("%s：%d MB，%d 块，每块 %d MB，同时 %d 块 → %s" % (KEY, SIZE >> 20, N, CH >> 20, WORKERS, EP))

    sent = [0]

    def part(n):
        if n in done:
            return n, done[n]
        off = (n - 1) * CH
        ln = min(CH, SIZE - off)
        err = None
        for k in range(8):
            try:
                with open(F, "rb") as fh:
                    fh.seek(off)
                    body = fh.read(ln)
                et = c.upload_part(Bucket=B, Key=KEY, UploadId=up, PartNumber=n, Body=body)["ETag"]
                sent[0] += ln
                return n, et
            except Exception as e:
                err = e
                if "AccelerateNotEnabled" in str(e):
                    raise
                time.sleep(3 + k * 5)
        raise RuntimeError("第 %d 块传了 8 次都没传上：%s" % (n, err))

    tags = {}
    last = time.time()
    with concurrent.futures.ThreadPoolExecutor(WORKERS) as ex:
        for n, et in ex.map(part, range(1, N + 1)):
            tags[n] = et
            if time.time() - last > 30:
                last = time.time()
                el = max(1, time.time() - t0)
                log("传了 %d/%d 块，%.1f MB/秒" % (len(tags), N, sent[0] / el / 1048576))
    c.complete_multipart_upload(Bucket=B, Key=KEY, UploadId=up, MultipartUpload={"Parts": [{"PartNumber": n, "ETag": tags[n]} for n in sorted(tags)]})
    el = max(1, time.time() - t0)
    log("上传好了：%d 秒，平均 %.1f MB/秒" % (el, sent[0] / el / 1048576))
except ClientError as e:
    if "AccelerateNotEnabled" in str(e):
        log("这个桶没开「全球加速」")
        sys.exit(3)
    log("失败：%s" % e)
    sys.exit(1)
except Exception as e:
    if "AccelerateNotEnabled" in str(e):
        sys.exit(3)
    log("失败：%s" % e)
    sys.exit(1)
