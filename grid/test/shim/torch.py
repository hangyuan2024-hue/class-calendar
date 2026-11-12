"""测试用的假 torch（只够 qv_gen.py 算特征那几行用；真的电脑上用真的 PyTorch）。"""
import contextlib

import numpy as np

float32 = "float32"


class T:
    def __init__(self, a):
        self.a = np.asarray(a, dtype=np.float32)

    def norm(self, dim=-1, keepdim=False):
        return T(np.linalg.norm(self.a, axis=dim, keepdims=keepdim))

    def __truediv__(self, o):
        return T(self.a / (o.a if isinstance(o, T) else o))

    def __iter__(self):
        return (T(x) for x in self.a)

    def numpy(self):
        return self.a


def tensor(a, dtype=None):
    return T(a)


@contextlib.contextmanager
def no_grad():
    yield
