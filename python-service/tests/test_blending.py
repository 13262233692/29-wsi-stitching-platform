#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
高斯混合拼接算法单元测试
"""

import unittest
import numpy as np
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from blending.gaussian_blending import (  # noqa: E402
    generate_gaussian_weight,
    GaussianBlender,
    decode_base64_image,
    encode_numpy_image,
)


class TestGaussianWeight(unittest.TestCase):
    def test_shape(self):
        w = generate_gaussian_weight((128, 128), overlap=16)
        self.assertEqual(w.shape, (128, 128))

    def test_range(self):
        w = generate_gaussian_weight((64, 64), overlap=8)
        self.assertGreaterEqual(w.min(), 0.0)
        self.assertLessEqual(w.max(), 1.0)

    def test_center_is_max(self):
        w = generate_gaussian_weight((32, 32), overlap=4)
        self.assertAlmostEqual(w[16, 16], 1.0, places=2)


class TestBlender(unittest.TestCase):
    def test_single_tile(self):
        blender = GaussianBlender(
            canvas_size=(512, 512),
            tile_size=(512, 512),
            overlap=32,
            scale_factor=1,
        )
        tile = np.random.rand(512, 512, 3).astype(np.float32)
        blender.add_tile(tile, row=0, col=0)
        canvas = blender.get_blended_canvas()
        self.assertEqual(canvas.shape, (512, 512, 3))
        self.assertGreaterEqual(canvas.min(), 0.0)
        self.assertLessEqual(canvas.max(), 1.0)

    def test_multiple_tiles_overlap(self):
        canvas_h = canvas_w = 992
        blender = GaussianBlender(
            canvas_size=(canvas_h, canvas_w),
            tile_size=(512, 512),
            overlap=32,
            scale_factor=1,
        )
        tile = np.ones((512, 512, 3), dtype=np.float32) * 0.5
        for r in range(2):
            for c in range(2):
                blender.add_tile(tile, row=r, col=c)
        canvas = blender.get_blended_canvas()
        self.assertEqual(canvas.shape, (canvas_h, canvas_w, 3))


class TestImageEncoding(unittest.TestCase):
    def test_roundtrip(self):
        arr = (np.random.rand(32, 32, 3) * 255).astype(np.uint8)
        import base64
        from io import BytesIO
        from PIL import Image

        img = Image.fromarray(arr, mode="RGB")
        buf = BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        decoded = decode_base64_image(b64)
        self.assertEqual(decoded.shape, (32, 32, 3))
        self.assertGreaterEqual(decoded.min(), 0.0)
        self.assertLessEqual(decoded.max(), 1.0)

        re_encoded = encode_numpy_image(decoded)
        self.assertIsInstance(re_encoded, str)


if __name__ == "__main__":
    unittest.main()
