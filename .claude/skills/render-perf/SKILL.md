---
name: render-perf
description: Three.js performance and precision conventions for Rinkai scenes. Use when writing or changing rendering code.
paths: frontend/src/scene/**
user-invocable: false
---
- Floating origin: re-center the world on the camera focus to avoid float precision jitter; enable the logarithmic depth buffer.
- Satellites: one InstancedMesh or Points object; update positions in a typed array; propagate SGP4 in a Web Worker in batches; no per-frame allocations.
- Star field: one Points object from a pre-baked binary buffer (position + colour + size).
- Dispose geometries, materials and textures when removing objects.
- Provide a quality setting (low/med/high) that scales instance counts, textures and post-processing.
- Target 60 fps; profile before optimizing.
