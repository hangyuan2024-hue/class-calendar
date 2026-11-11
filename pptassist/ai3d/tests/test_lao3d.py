# 3D 形象工坊的测试（不用显卡）：读写 glb、摆正和转身、找关节、蒙皮、找眼睛和嘴、改贴图、命令行
import json
import os
import subprocess
import sys
import tempfile
import unittest

import numpy as np

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))
import fake_doll  # noqa: E402
from lao3d.glb import read_glb, read_extras, write_glb  # noqa: E402
from lao3d.build import build, face  # noqa: E402
from lao3d.raster import load_textures  # noqa: E402


class Lao3D(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="lao3d-")
        cls.raw = os.path.join(cls.tmp, "raw.glb")
        fake_doll.make(cls.raw)
        cls.out = os.path.join(cls.tmp, "out")
        build(cls.raw, cls.out)
        cls.ex = read_extras(os.path.join(cls.out, "avatar.glb"))[0]["lao"]
        cls.k = 1.25 / fake_doll.EXPECT["height"]

    def J(self, name):
        if name in self.ex["extra"]:
            return np.array(self.ex["extra"][name])
        return np.array(next(j["pos"] for j in self.ex["joints"] if j["name"] == name))

    def test_glb_roundtrip(self):
        m = fake_doll.make()
        data = write_glb(None, m)
        m2 = read_glb(data)
        self.assertEqual(len(m2.idx), len(m.idx))
        self.assertTrue(np.allclose(m2.pos, m.pos, atol=1e-5))
        self.assertTrue(np.allclose(m2.uv, m.uv, atol=1e-6))
        self.assertIsNotNone(m2.materials[0]["image"])

    def test_joints(self):
        e, k = fake_doll.EXPECT, self.k
        y0 = 0.045 - 0.06 * 0.7   # 鞋底（摆正后脚踩在 0）
        Y = lambda y: (y - y0) * k
        self.assertEqual(self.ex["warn"], [], "腿和胳膊都是分开的，不该有提醒")
        self.assertAlmostEqual(self.ex["landmarks"]["neck"], Y(e["neck_y"]), delta=0.06)
        for nm, s in (("L", 1), ("R", -1)):
            sh = self.J("shoulder_" + nm)
            self.assertAlmostEqual(sh[1], Y(e["shoulder"][1]), delta=0.07)
            self.assertGreater(sh[0] * s, 0.05)
            wr = self.J("wrist_" + nm)
            self.assertAlmostEqual(wr[1], Y(e["wrist_y"]), delta=0.08)
            self.assertGreater(wr[0] * s, sh[0] * s, "手腕在肩膀外面（A 字）")
            self.assertLess(self.J("knee_" + nm)[1], self.J("hip_" + nm)[1])
        self.assertGreater(self.J("head")[1], self.J("neck")[1])

    def test_weights(self):
        m = read_glb(os.path.join(self.out, "avatar.glb"))
        z = np.load(os.path.join(self.out, "base.npz"))
        w, j = z["w"], z["jidx"].astype(int)
        self.assertTrue(np.allclose(w.sum(1), 1, atol=1e-4))
        names = [x["name"] for x in self.ex["joints"]]
        dom = np.array(names)[j[np.arange(len(w)), np.argmax(w, 1)]]
        p = m.pos
        hand = np.linalg.norm(p - self.J("handTip_L") * [1, 1, 0] - [0, 0, self.J("wrist_L")[2]], axis=1) < 0.05
        self.assertTrue(np.isin(dom[hand], ["wrist_L", "elbow_L"]).mean() > 0.8, "手跟着左手腕动")
        top = p[:, 1] > self.J("head")[1] + 0.1
        self.assertTrue((dom[top] == "head").mean() > 0.95, "头顶跟着头动")
        foot = p[:, 1] < 0.05
        self.assertTrue(np.isin(dom[foot], ["ankle_L", "ankle_R", "knee_L", "knee_R"]).mean() > 0.9, "脚跟着脚踝动")

    def test_face(self):
        f = self.ex["face"]
        e, k = fake_doll.EXPECT, self.k
        y0 = 0.045 - 0.06 * 0.7
        ex, ey = e["eye"][0] * k, (e["eye"][1] - y0) * k
        cs = sorted([((b["box"][0] + b["box"][2]) / 2, (b["box"][1] + b["box"][3]) / 2) for b in f["eyes"]])
        self.assertAlmostEqual(cs[0][0], -ex, delta=0.03)
        self.assertAlmostEqual(cs[1][0], ex, delta=0.03)
        for c in cs:
            self.assertAlmostEqual(c[1], ey, delta=0.03)
        mb = f["mouth"]["box"]
        self.assertAlmostEqual((mb[1] + mb[3]) / 2, (e["mouth_y"] - y0) * k, delta=0.03)
        self.assertTrue(all(x["sprite"].startswith("data:image/png;base64,") for x in f["eyes"] + [f["mouth"]]))
        # 贴图上眼睛的地方补成了皮肤色
        tex = load_textures(read_glb(os.path.join(self.out, "avatar.glb")))[0]
        H = tex.shape[0] // 2
        u = int((fake_doll.EYE_PHI / (2 * np.pi) + 0.5) * H)
        v = int(fake_doll.EYE_TH / np.pi * H)
        px = tex[v, u, :3].astype(int)
        self.assertGreater(px.mean(), 150, f"眼睛被抹掉了（现在是 {px}）")

    def test_turned_and_hints(self):
        raw = os.path.join(self.tmp, "turned.glb")
        fake_doll.make(raw, turned=True)
        out = os.path.join(self.tmp, "out_t")
        build(raw, out)
        ex = read_extras(os.path.join(out, "avatar.glb"))[0]["lao"]
        self.assertTrue(ex["turned"], "背对着的模型要转过来")
        self.assertEqual(len(ex["face"]["eyes"]), 2)
        # 老师点的位置：在头部正面照上（像素）
        sh = ex["face"]["shot"]
        box, res = sh["box"], sh["res"]
        px = lambda x, y: [(x - box[0]) * res, (box[3] - y) * res]
        e = [((b["box"][0] + b["box"][2]) / 2, (b["box"][1] + b["box"][3]) / 2) for b in ex["face"]["eyes"]]
        m = ex["face"]["mouth"]["box"]
        face(out, {"e1": px(*e[0]), "e2": px(*e[1]), "mouth": px((m[0] + m[2]) / 2, (m[1] + m[3]) / 2)})
        ex2 = read_extras(os.path.join(out, "avatar.glb"))[0]["lao"]
        self.assertIn("用的是老师点的位置", ex2["face"]["notes"])

    def test_smooth(self):
        from lao3d.glb import Mesh
        from lao3d.smooth import smooth_mesh, weld
        rng = np.random.default_rng(1)
        pos, uv, idx = fake_doll.uv_sphere(np.zeros(3), 0.6, nu=120, nv=80, head=True)   # 一个头那么大的球，表面加小疙瘩
        first, inv = weld(pos, 1e-7)
        r = 0.6 + rng.normal(0, 0.004, len(first))[inv]
        m = Mesh(pos / 0.6 * r[:, None], idx, uv=uv)
        F = inv[idx]
        F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 2] != F[:, 0])]
        vol = lambda P: abs(np.einsum("ij,ij->i", P[F[:, 0]], np.cross(P[F[:, 1]], P[F[:, 2]])).sum() / 6)
        v0 = vol(m.pos[first])
        uv0 = m.uv.copy()
        r0, r1, it = smooth_mesh(m, 1.0)
        self.assertGreater(it, 0)
        self.assertLess(r1, r0 * 0.5, "磨完应该平很多")
        self.assertLess(abs(vol(m.pos[first]) - v0) / v0, 0.02, "体积基本不变")
        self.assertTrue(np.array_equal(m.uv, uv0), "贴图坐标不动")
        self.assertTrue(np.allclose(m.pos, m.pos[first][inv]), "接缝处重合的点还重合")
        rad = np.linalg.norm(m.pos, axis=1)
        self.assertLess(rad.std(), 0.004 * 0.5, "疙瘩磨掉一大半")

    def test_legs_together(self):
        raw = os.path.join(self.tmp, "together.glb")
        fake_doll.make(raw, legs_together=True)
        out = os.path.join(self.tmp, "out_lt")
        build(raw, out)
        ex = read_extras(os.path.join(out, "avatar.glb"))[0]["lao"]
        self.assertTrue(any("按两只手的高度估的" in w for w in ex["warn"]), ex["warn"])
        e, k = fake_doll.EXPECT, self.k
        Y = lambda y: (y - (0.045 - 0.06 * 0.7)) * k
        self.assertAlmostEqual(ex["landmarks"]["neck"], Y(e["neck_y"]), delta=0.06)
        self.assertAlmostEqual(ex["landmarks"]["crotch"], Y(0.46), delta=0.12)
        for nm in ("L", "R"):
            sh = np.array(next(j["pos"] for j in ex["joints"] if j["name"] == "shoulder_" + nm))
            wr = np.array(next(j["pos"] for j in ex["joints"] if j["name"] == "wrist_" + nm))
            self.assertAlmostEqual(wr[1], Y(e["wrist_y"]), delta=0.08)
            self.assertLess(wr[1], sh[1])

    def test_talk_parts(self):
        from lao3d import talk
        self.assertEqual(talk.pingpong(4, 0, 10), [0, 1, 2, 3, 2, 1, 0, 1, 2, 3])
        self.assertEqual(talk.pingpong(4, 5, 3), [1, 0, 1], "接着上一段的位置继续来回放")
        sr = talk.SR
        x = (np.random.default_rng(0).standard_normal(sr * 40) * 0.1).astype("float32")
        x[sr * 14: sr * 14 + sr // 5] = 0
        parts = talk.split_audio(x)
        self.assertEqual(parts[0][0], 0)
        self.assertEqual(parts[-1][1], len(x))
        self.assertTrue(all(b - a <= 16 * sr for a, b in parts))
        self.assertTrue(abs(parts[0][1] / sr - 14.1) < 0.2, "切在安静的地方")
        # YuNet 换掉 InsightFace：没有脸返回空；有脸时眉毛中心在眼睛上面、比两眼宽一点，鼻子在下面
        fd = talk.YuNetFace()
        self.assertEqual(fd(np.full((240, 320, 3), 200, np.uint8)), (None, None))
        fd.raw = lambda f: np.array([100, 80, 120, 150, 140, 140, 200, 140, 170, 175, 145, 205, 195, 205, 0.95], np.float32)
        box, l = fd(np.zeros((400, 400, 3), np.uint8))
        self.assertEqual(box, [100, 80, 220, 230])
        bl, br, nose = l[43], l[101], l[74]
        self.assertTrue(bl[0] < 140 and br[0] > 200 and bl[1] < 140 - 10 and abs(bl[1] - br[1]) < 1e-3 and nose[1] > 140 + 10)
        self.assertTrue(np.allclose(l[[48, 49, 50, 51]], bl) and np.allclose(l[102:106], br) and np.allclose(l[[77, 83, 86]], nose))

    def test_talk_cli(self):
        try:
            import cv2  # noqa: F401
            import soundfile as sf
        except Exception:
            self.skipTest("没有 cv2 / soundfile")
        from lao3d import talk
        tpl = os.path.join(self.tmp, "tpl.mp4")
        talk.write_frames(tpl, [np.full((64, 36, 3), i * 20, np.uint8) for i in range(10)])
        wav = os.path.join(self.tmp, "a.wav")
        sf.write(wav, np.zeros(talk.SR * 2, np.float32), talk.SR)
        out = os.path.join(self.tmp, "talk.mp4")
        env = dict(os.environ, PYTHONPATH=os.path.join(HERE, ".."), LAO3D_TEST_TALK="1")
        r = subprocess.run([sys.executable, "-m", "lao3d.run", "talk", "--template", tpl, "--audio", wav, "--out", out], capture_output=True, text=True, env=env, encoding="utf-8")
        self.assertEqual(r.returncode, 0, r.stderr[-1500:])
        self.assertEqual(len(talk.read_frames(out)), 51, "模板来回放到配音那么长（2 秒 × 25 帧 + 1）")

    def test_stylize_extra(self):
        from lao3d.stylize import prompt_for, panel
        from PIL import Image
        self.assertIn("图3是同一位老师的侧面和背面", prompt_for(True, "photo", True))
        self.assertIn("图2是同一位老师的侧面和背面", prompt_for(False, "photo", True))
        self.assertNotIn("侧面和背面", prompt_for(True))
        fs = []
        for i, size in enumerate([(300, 400), (200, 100)]):
            f = os.path.join(self.tmp, f"v{i}.png")
            Image.new("RGB", size, "red").save(f)
            fs.append(f)
        p = panel(fs, h=200)
        self.assertEqual(p.size, (150 + 16 + 400, 200))

    def test_cli(self):
        out = os.path.join(self.tmp, "cli")
        env = dict(os.environ, PYTHONPATH=os.path.join(HERE, ".."))
        r = subprocess.run([sys.executable, "-m", "lao3d.run", "build", "--src", self.raw, "--out", out], capture_output=True, text=True, env=env, encoding="utf-8")
        msgs = [json.loads(l[2:]) for l in r.stdout.splitlines() if l.startswith("@@")]
        self.assertEqual(r.returncode, 0, r.stderr[-2000:])
        self.assertTrue(msgs[-1].get("done"))
        self.assertTrue(all(0 <= m.get("p", 0) <= 1 for m in msgs))
        r = subprocess.run([sys.executable, "-m", "lao3d.run", "build", "--src", os.path.join(self.tmp, "nope.glb"), "--out", out], capture_output=True, text=True, env=env, encoding="utf-8")
        self.assertEqual(r.returncode, 1)
        self.assertIn("error", json.loads([l for l in r.stdout.splitlines() if l.startswith("@@")][-1][2:]))


if __name__ == "__main__":
    unittest.main()
