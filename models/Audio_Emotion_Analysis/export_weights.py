"""Writes the weights of model3.h5 for the browser: one float32 file and a JSON file that says where each tensor is.

Run it again only if model3.h5 changes:  .venv/Scripts/python export_weights.py  (or .venv/bin/python on macOS and Linux)
Needs only h5py and numpy, not TensorFlow.
"""
import hashlib
import json
import os

import h5py
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "frontend", "src", "lib", "voice", "assets")

# Keras layer name in model3.h5 -> name used by frontend/src/lib/voice/model.ts, with the expected shapes.
TENSORS = [
    ("conv1d/conv1d/kernel:0", "conv1_kernel", (5, 91, 256)),
    ("conv1d/conv1d/bias:0", "conv1_bias", (256,)),
    ("conv1d_1/conv1d_1/kernel:0", "conv2_kernel", (5, 256, 128)),
    ("conv1d_1/conv1d_1/bias:0", "conv2_bias", (128,)),
    ("dense/dense/kernel:0", "dense1_kernel", (128, 64)),
    ("dense/dense/bias:0", "dense1_bias", (64,)),
    ("dense_1/dense_1/kernel:0", "dense2_kernel", (64, 6)),
    ("dense_1/dense_1/bias:0", "dense2_bias", (6,)),
]


def main():
    source = os.path.join(HERE, "model3.h5")
    parts, layout, offset = [], {}, 0
    with h5py.File(source, "r") as h5:
        weights = h5["model_weights"]
        for h5_name, name, shape in TENSORS:
            values = np.asarray(weights[h5_name], dtype="<f4")
            if values.shape != shape:
                raise SystemExit(f"{h5_name} has shape {values.shape}, expected {shape}")
            parts.append(values.tobytes(order="C"))
            layout[name] = {"shape": list(shape), "offset": offset}
            offset += values.size

    data = b"".join(parts)
    with open(source, "rb") as f:
        source_sha = hashlib.sha256(f.read()).hexdigest()
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "model3.bin"), "wb") as f:
        f.write(data)
    with open(os.path.join(OUT, "model3.json"), "w", encoding="utf-8") as f:
        json.dump({
            "source": "models/Audio_Emotion_Analysis/model3.h5",
            "source_sha256": source_sha,
            "dtype": "float32, little-endian, C order (Keras layout: kernels are [k, in, out] and [in, out])",
            "values": offset,
            "tensors": layout,
        }, f, indent=2)
        f.write("\n")
    print(f"Wrote {offset} values ({len(data)} bytes) to {os.path.normpath(OUT)}")


if __name__ == "__main__":
    main()
