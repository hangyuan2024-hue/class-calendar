# 捞捞 · 3D 形象工坊：自己读写 .glb（glTF 2.0 的二进制格式），只用 numpy，不依赖别的 3D 库
#   读：生成出来的带贴图模型（Hunyuan3D 用 trimesh 存的那种），可能有好几个网格 / 材质，按节点的变换摆好、合成一份
#   写：绑好骨骼的模型（关节、蒙皮权重、贴图），再在 extras 里放形象的说明（关节位置、脸上眼睛和嘴在哪……）
import io
import json
import struct

import numpy as np

GLB_MAGIC, CHUNK_JSON, CHUNK_BIN = 0x46546C67, 0x4E4F534A, 0x004E4942
_DT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


class Mesh:
    """一份三角网格：pos (N,3)、nor (N,3) 或 None、uv (N,2) 或 None、idx (M,3)、fmat (M,) 每个面用第几个材质；
    materials：[{"color": [r,g,b,a]（线性）, "image": bytes 或 None, "mime": "image/png"}]"""

    def __init__(self, pos, idx, nor=None, uv=None, fmat=None, materials=None):
        self.pos = np.asarray(pos, np.float64)
        self.idx = np.asarray(idx, np.int64).reshape(-1, 3)
        self.nor = None if nor is None else np.asarray(nor, np.float64)
        self.uv = None if uv is None else np.asarray(uv, np.float64)
        self.fmat = np.zeros(len(self.idx), np.int64) if fmat is None else np.asarray(fmat, np.int64)
        self.materials = materials or [{"color": [0.8, 0.8, 0.8, 1.0], "image": None, "mime": None}]

    def copy(self):
        return Mesh(self.pos.copy(), self.idx.copy(), None if self.nor is None else self.nor.copy(), None if self.uv is None else self.uv.copy(), self.fmat.copy(), [dict(m) for m in self.materials])

    def face_normals(self):
        a, b, c = (self.pos[self.idx[:, k]] for k in range(3))
        n = np.cross(b - a, c - a)
        l = np.linalg.norm(n, axis=1, keepdims=True)
        return n / np.maximum(l, 1e-12)

    def vertex_normals(self):
        a, b, c = (self.pos[self.idx[:, k]] for k in range(3))
        fn = np.cross(b - a, c - a)   # 按面积加权
        n = np.zeros_like(self.pos)
        for k in range(3):
            np.add.at(n, self.idx[:, k], fn)
        l = np.linalg.norm(n, axis=1, keepdims=True)
        return n / np.maximum(l, 1e-12)


# ---------------------------------------------------------------- 读
def _read(path):
    with open(path, "rb") as f:
        return f.read()


def _split_glb(data):
    if len(data) < 20:
        raise ValueError("不是 glb 文件（太短）")
    magic, ver, length = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC:
        raise ValueError("不是 glb 文件（文件头不对）")
    if ver != 2:
        raise ValueError(f"只认 glTF 2.0（这个是 {ver}）")
    off, js, bin_ = 12, None, b""
    while off + 8 <= min(length, len(data)):
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == CHUNK_JSON:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == CHUNK_BIN:
            bin_ = chunk
        off += 8 + clen
    if js is None:
        raise ValueError("glb 里没有 JSON 部分")
    return js, bin_


def _accessor(js, bin_, i):
    a = js["accessors"][i]
    dt, nc, n = _DT[a["componentType"]], _NC[a["type"]], a["count"]
    if "bufferView" not in a:   # 全是 0 的（稀疏的也按 0 处理）
        return np.zeros((n, nc), np.float64)
    bv = js["bufferViews"][a["bufferView"]]
    if bv.get("buffer", 0) != 0:
        raise ValueError("只认一个 buffer 的 glb")
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    item = np.dtype(dt).itemsize * nc
    stride = bv.get("byteStride", 0) or item
    if stride == item:
        arr = np.frombuffer(bin_, dtype=dt, count=n * nc, offset=start).reshape(n, nc)
    else:
        raw = np.frombuffer(bin_, dtype=np.uint8, count=stride * (n - 1) + item, offset=start)
        rows = np.lib.stride_tricks.as_strided(raw, shape=(n, item), strides=(stride, 1))
        arr = np.ascontiguousarray(rows).view(dt).reshape(n, nc)
    arr = arr.astype(np.float64)
    if a.get("normalized"):
        arr /= {np.int8: 127.0, np.uint8: 255.0, np.int16: 32767.0, np.uint16: 65535.0}.get(dt, 1.0)
    return arr


def _node_matrix(nd):
    if "matrix" in nd:
        return np.array(nd["matrix"], np.float64).reshape(4, 4).T   # glTF 是列优先
    t = np.array(nd.get("translation", [0, 0, 0]), np.float64)
    x, y, z, w = nd.get("rotation", [0, 0, 0, 1])
    s = np.array(nd.get("scale", [1, 1, 1]), np.float64)
    r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    m = np.eye(4)
    m[:3, :3] = r * s
    m[:3, 3] = t
    return m


def _image_bytes(js, bin_, img_i):
    im = js["images"][img_i]
    if "bufferView" in im:
        bv = js["bufferViews"][im["bufferView"]]
        o = bv.get("byteOffset", 0)
        return bytes(bin_[o: o + bv["byteLength"]]), im.get("mimeType", "image/png")
    uri = im.get("uri", "")
    if uri.startswith("data:"):
        import base64
        head, b64 = uri.split(",", 1)
        return base64.b64decode(b64), head[5:].split(";")[0]
    raise ValueError("贴图在 glb 外面的文件里，不认")


def read_glb(src):
    """读 .glb（路径或 bytes）→ Mesh（所有三角形合在一起，已经按节点变换摆好）"""
    data = src if isinstance(src, (bytes, bytearray)) else _read(src)
    js, bin_ = _split_glb(bytes(data))
    mats = []
    for m in js.get("materials", []) or [{}]:
        pbr = m.get("pbrMetallicRoughness", {})
        col = pbr.get("baseColorFactor", [1, 1, 1, 1])
        img = mime = None
        bt = pbr.get("baseColorTexture")
        if bt is not None:
            tex = js["textures"][bt["index"]]
            if "source" in tex:
                img, mime = _image_bytes(js, bin_, tex["source"])
        mats.append({"color": list(col), "image": img, "mime": mime})
    P, N, U, I, F = [], [], [], [], []
    base = 0
    scene = js.get("scenes", [{"nodes": list(range(len(js.get("nodes", []))))}])[js.get("scene", 0)]

    def walk(ni, parent):
        nonlocal base
        nd = js["nodes"][ni]
        M = parent @ _node_matrix(nd)
        if "mesh" in nd:
            for pr in js["meshes"][nd["mesh"]]["primitives"]:
                if pr.get("mode", 4) != 4:
                    continue
                at = pr["attributes"]
                p = _accessor(js, bin_, at["POSITION"])[:, :3]
                p = p @ M[:3, :3].T + M[:3, 3]
                P.append(p)
                if "NORMAL" in at:
                    n = _accessor(js, bin_, at["NORMAL"])[:, :3] @ np.linalg.inv(M[:3, :3])
                    N.append(n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12))
                else:
                    N.append(None)
                U.append(_accessor(js, bin_, at["TEXCOORD_0"])[:, :2] if "TEXCOORD_0" in at else None)
                ix = _accessor(js, bin_, pr["indices"])[:, 0].astype(np.int64) if "indices" in pr else np.arange(len(p))
                ix = ix.reshape(-1, 3)
                if np.linalg.det(M[:3, :3]) < 0:
                    ix = ix[:, ::-1]
                I.append(ix + base)
                F.append(np.full(len(ix), pr.get("material", 0) if js.get("materials") else 0))
                base += len(p)
        for c in nd.get("children", []):
            walk(c, M)

    for ni in scene.get("nodes", []):
        walk(ni, np.eye(4))
    if not P:
        raise ValueError("glb 里没有三角形网格")
    pos = np.concatenate(P)
    nor = np.concatenate(N) if all(n is not None for n in N) else None
    if all(u is not None for u in U):
        uv = np.concatenate(U)
    elif any(u is not None for u in U):
        uv = np.concatenate([u if u is not None else np.zeros((len(p), 2)) for u, p in zip(U, P)])
    else:
        uv = None
    return Mesh(pos, np.concatenate(I), nor, uv, np.concatenate(F), mats)


def read_extras(src):
    data = src if isinstance(src, (bytes, bytearray)) else _read(src)
    js, _ = _split_glb(bytes(data))
    return (js.get("extras") or {}), js


# ---------------------------------------------------------------- 写
class _Builder:
    def __init__(self):
        self.bin = bytearray()
        self.views, self.accessors = [], []

    def view(self, raw, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        v = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(raw)}
        if target:
            v["target"] = target
        self.bin += raw
        self.views.append(v)
        return len(self.views) - 1

    def accessor(self, arr, ctype, typ, target=None, minmax=False, normalized=False):
        arr = np.ascontiguousarray(arr)
        vi = self.view(arr.tobytes(), target)
        a = {"bufferView": vi, "componentType": ctype, "count": int(arr.shape[0]), "type": typ}
        if normalized:
            a["normalized"] = True
        if minmax:
            a["min"] = [float(x) for x in arr.min(axis=0)]
            a["max"] = [float(x) for x in arr.max(axis=0)]
        self.accessors.append(a)
        return len(self.accessors) - 1


def encode_image(img, mime="image/jpeg", quality=92):
    """PIL 图 → bytes"""
    buf = io.BytesIO()
    if mime == "image/png":
        img.save(buf, "PNG", optimize=True)
    else:
        img.convert("RGB").save(buf, "JPEG", quality=quality, subsampling=0)
    return buf.getvalue()


def write_glb(path, mesh, skin=None, extras=None, name="LaoAvatar", roughness=0.7):
    """mesh: Mesh；skin: {"joints": [{"name", "parent"（下标，-1 是根）, "pos"（模型空间的位置）}], "jidx": (N,4), "w": (N,4)}
    关节在模型空间里都是不转的（只平移），所以 inverseBindMatrices 就是「平移回去」"""
    B = _Builder()
    pos = mesh.pos.astype(np.float32)
    nor = (mesh.nor if mesh.nor is not None else mesh.vertex_normals()).astype(np.float32)
    attrs = {"POSITION": B.accessor(pos, 5126, "VEC3", 34962, minmax=True), "NORMAL": B.accessor(nor, 5126, "VEC3", 34962)}
    if mesh.uv is not None:
        attrs["TEXCOORD_0"] = B.accessor(mesh.uv.astype(np.float32), 5126, "VEC2", 34962)
    if skin is not None:
        attrs["JOINTS_0"] = B.accessor(np.asarray(skin["jidx"], np.uint16), 5123, "VEC4", 34962)
        w = np.asarray(skin["w"], np.float32)
        w = w / np.maximum(w.sum(axis=1, keepdims=True), 1e-8)
        attrs["WEIGHTS_0"] = B.accessor(w.astype(np.float32), 5126, "VEC4", 34962)
    js = {"asset": {"version": "2.0", "generator": "laolao lao3d"}, "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [], "meshes": [], "materials": [], "textures": [], "images": [], "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}]}
    prims = []
    for mi, m in enumerate(mesh.materials):
        sel = mesh.idx[mesh.fmat == mi]
        if len(sel) == 0:
            continue
        ix = sel.astype(np.uint32).reshape(-1)
        mat = {"name": f"mat{mi}", "pbrMetallicRoughness": {"baseColorFactor": [float(c) for c in m.get("color", [1, 1, 1, 1])], "metallicFactor": 0.0, "roughnessFactor": roughness}}
        if m.get("image"):
            iv = B.view(m["image"])
            js["images"].append({"bufferView": iv, "mimeType": m.get("mime") or "image/png"})
            js["textures"].append({"sampler": 0, "source": len(js["images"]) - 1})
            mat["pbrMetallicRoughness"]["baseColorTexture"] = {"index": len(js["textures"]) - 1}
        js["materials"].append(mat)
        prims.append({"attributes": attrs, "indices": B.accessor(ix, 5125, "SCALAR", 34963), "material": len(js["materials"]) - 1})
    js["meshes"].append({"name": name + "Mesh", "primitives": prims})
    root = {"name": name, "children": []}
    js["nodes"].append(root)
    js["nodes"].append({"name": name + "Body", "mesh": 0})
    root["children"].append(1)
    if skin is not None:
        J = skin["joints"]
        first = len(js["nodes"])
        for j in J:
            p = np.asarray(j["pos"], np.float64)
            pp = np.asarray(J[j["parent"]]["pos"], np.float64) if j["parent"] >= 0 else np.zeros(3)
            js["nodes"].append({"name": j["name"], "translation": [float(x) for x in (p - pp)]})
        for k, j in enumerate(J):
            if j["parent"] >= 0:
                js["nodes"][first + j["parent"]].setdefault("children", []).append(first + k)
            else:
                root["children"].append(first + k)
        ibm = np.zeros((len(J), 16), np.float32)
        for k, j in enumerate(J):
            m = np.eye(4)
            m[:3, 3] = -np.asarray(j["pos"], np.float64)
            ibm[k] = m.T.reshape(-1)   # 列优先
        js["skins"] = [{"name": name + "Skin", "joints": list(range(first, first + len(J))), "inverseBindMatrices": B.accessor(ibm, 5126, "MAT4")}]
        js["nodes"][1]["skin"] = 0
    if not js["images"]:
        for k in ("images", "textures", "samplers"):
            js.pop(k)
    if extras:
        js["extras"] = extras
    js["bufferViews"], js["accessors"] = B.views, B.accessors
    while len(B.bin) % 4:
        B.bin.append(0)
    js["buffers"] = [{"byteLength": len(B.bin)}]
    jb = json.dumps(js, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    while len(jb) % 4:
        jb += b" "
    total = 12 + 8 + len(jb) + 8 + len(B.bin)
    out = struct.pack("<III", GLB_MAGIC, 2, total) + struct.pack("<II", len(jb), CHUNK_JSON) + jb + struct.pack("<II", len(B.bin), CHUNK_BIN) + bytes(B.bin)
    if path:
        with open(path, "wb") as f:
            f.write(out)
    return out
