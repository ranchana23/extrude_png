# Extrude PNG to STL

This small Node.js utility converts black regions in `dd2.png` to an extruded 3D mesh and writes `output.stl`.

Defaults:
- Input: `dd2.png` (placed in project root)
- Output: `output.stl`
- Extrusion thickness: 2.0 mm
- Scale: 0.2645833 mm per pixel (96 DPI)

Install:

```bash
npm install
```

Run:

```bash
npm start
```

Notes:
- This is a simple implementation using a raster mask + earcut triangulation. It may produce multiple contours.
- If you need a higher-quality outline (bezier smoothing, offsets, holes), consider using a vectorization step (e.g., potrace) before triangulation.
