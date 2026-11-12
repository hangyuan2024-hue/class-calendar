"""测试用的假 transformers：CLIP 特征换成图片像素的平均值（确定、很快）。"""
import os

import numpy as np

import torch


class _Out:
    def __init__(self, e):
        self.image_embeds = torch.T(e)


class CLIPVisionModelWithProjection:
    @classmethod
    def from_pretrained(cls, d, torch_dtype=None):
        assert os.path.exists(os.path.join(d, "model.safetensors")), "CLIP 没下载"
        return cls()

    def eval(self):
        return self

    def __call__(self, pixel_values):
        x = pixel_values.a
        r = np.random.default_rng(0).normal(size=(x.shape[1] * 16, 768)).astype(np.float32)
        f = x.reshape(x.shape[0], x.shape[1], 16, -1).mean(-1).reshape(x.shape[0], -1)
        return _Out(f @ r)
