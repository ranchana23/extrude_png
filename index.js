const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// Default config
let INPUT = path.join(__dirname, 'dd2.png');
let OUTPUT = path.join(__dirname, 'output.stl');
let THICKNESS_MM = 2.0; // extrusion depth for black pixels
let SCALE_MM_PER_PX = 0.2645833333; // default mm per pixel (96 DPI)
let THRESHOLD = 128; // grayscale threshold (0-255)

// CLI parsing (very small helper)
function parseArgs() {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input' && argv[i+1]) { INPUT = path.resolve(argv[++i]); }
    else if (a === '--output' && argv[i+1]) { OUTPUT = path.resolve(argv[++i]); }
    else if (a === '--thickness-mm' && argv[i+1]) { THICKNESS_MM = parseFloat(argv[++i]); }
    else if (a === '--scale-mm-per-px' && argv[i+1]) { SCALE_MM_PER_PX = parseFloat(argv[++i]); }
    else if (a === '--threshold' && argv[i+1]) { THRESHOLD = parseInt(argv[++i], 10); }
    else if (a === '--width-mm' && argv[i+1]) { process.env._WIDTH_MM = parseFloat(argv[++i]); }
  else if (a === '--max-px' && argv[i+1]) { process.env._MAX_PX = parseInt(argv[++i], 10); }
  else if (a === '--target-mb' && argv[i+1]) { process.env._TARGET_MB = parseFloat(argv[++i]); }
    else if (a === '--height-mm' && argv[i+1]) { process.env._HEIGHT_MM = parseFloat(argv[++i]); }
    else if (a === '--help' || a === '-h') { printHelpAndExit(); }
  }
}

function printHelpAndExit() {
  console.log('Usage: node index.js [--input dd2.png] [--output output.stl] [--thickness-mm N] [--scale-mm-per-px N] [--width-mm N] [--height-mm N] [--threshold N]');
  process.exit(0);
}

parseArgs();

// Exported function to generate STL from buffer or input path
async function generate(options = {}) {
  const inputPath = options.input || INPUT;
  const outputPath = options.output || OUTPUT;
  const thickness = typeof options.thickness === 'number' ? options.thickness : THICKNESS_MM;
  const threshold = typeof options.threshold === 'number' ? options.threshold : THRESHOLD;
  let scale = typeof options.scale === 'number' ? options.scale : null;
  let buffer = options.buffer || null;

  // read image data
  let png;
  if (buffer) {
    png = PNG.sync.read(buffer);
  } else {
    const data = fs.readFileSync(inputPath);
    png = PNG.sync.read(data);
  }
  const origW = png.width;
  const origH = png.height;
  const pdata = png.data;

  // compute scale from provided width/height_mm (use origW/origH)
  if (!scale) {
    if (options.width_mm) scale = options.width_mm / origW;
    else if (options.height_mm) scale = options.height_mm / origH;
    else scale = SCALE_MM_PER_PX;
  }

  // If user provided a target output size in MB, estimate a max_px to reach that target.
  // This is a heuristic: binary STL has ~50 bytes per triangle (plus 84-byte header).
  if (options.target_size_mb && Number.isFinite(options.target_size_mb) && !options.max_px) {
    try {
      const targetBytes = Math.max(1, Math.floor(options.target_size_mb * 1024 * 1024));
      const desiredTri = Math.max(1, Math.floor((targetBytes - 84) / 50));
      // count black pixels at original resolution
      let origBlack = 0;
      for (let y = 0; y < origH; y++) {
        for (let x = 0; x < origW; x++) {
          const i = (y * origW + x) * 4;
          const r = pdata[i];
          const g = pdata[i + 1];
          const b = pdata[i + 2];
          const a = pdata[i + 3];
          const gray = a === 0 ? 255 : Math.round((r + g + b) / 3);
          if (gray < threshold) origBlack++;
        }
      }
      const avgTriPerPixel = 6; // heuristic
      const estOrigTriangles = Math.max(1, Math.floor(origBlack * avgTriPerPixel));
      if (estOrigTriangles <= desiredTri) {
        options.max_px = Math.max(origW, origH);
      } else {
        const ratio = desiredTri / estOrigTriangles;
        const linearScale = Math.sqrt(Math.max(1e-6, ratio));
        const candidateMax = Math.max(1, Math.floor(Math.max(origW, origH) * linearScale));
        options.max_px = candidateMax;
      }
    } catch (e) {
      // fall back silently if estimation fails
    }
  }
  // If nothing specified, default to a safe downsample to reduce huge STL sizes
  if (!options.max_px && !options.target_size_mb) {
    const envMax = process.env._MAX_PX ? parseInt(process.env._MAX_PX, 10) : null;
    const envTarget = process.env._TARGET_MB ? parseFloat(process.env._TARGET_MB) : null;
    if (envMax) options.max_px = envMax;
    else if (envTarget) options.target_size_mb = envTarget;
    else options.max_px = 400; // default long-side downsample to 400 px
  }

  // optionally downsample the image to reduce triangle count / STL size
  let maskW = origW, maskH = origH;
  let mask = null;
  if (options.max_px && Number.isFinite(options.max_px) && Math.max(origW, origH) > options.max_px) {
    const maxPx = Math.max(1, Math.floor(options.max_px));
    const scaleRatio = maxPx / Math.max(origW, origH); // < 1
    maskW = Math.max(1, Math.round(origW * scaleRatio));
    maskH = Math.max(1, Math.round(origH * scaleRatio));
    mask = new Uint8Array(maskW * maskH);
    for (let y2 = 0; y2 < maskH; y2++) {
      for (let x2 = 0; x2 < maskW; x2++) {
        const srcX = Math.min(origW - 1, Math.floor(x2 * origW / maskW));
        const srcY = Math.min(origH - 1, Math.floor(y2 * origH / maskH));
        const i = (srcY * origW + srcX) * 4;
        const r = pdata[i];
        const g = pdata[i + 1];
        const b = pdata[i + 2];
        const a = pdata[i + 3];
        const gray = a === 0 ? 255 : Math.round((r + g + b) / 3);
        mask[y2 * maskW + x2] = gray < threshold ? 1 : 0;
      }
    }
  } else {
    // no downsampling: build mask at original resolution
    maskW = origW; maskH = origH;
    mask = new Uint8Array(maskW * maskH);
    for (let y = 0; y < maskH; y++) {
      for (let x = 0; x < maskW; x++) {
        const i = (y * maskW + x) * 4;
        const r = pdata[i];
        const g = pdata[i + 1];
        const b = pdata[i + 2];
        const a = pdata[i + 3];
        const gray = a === 0 ? 255 : Math.round((r + g + b) / 3);
        mask[y * maskW + x] = gray < threshold ? 1 : 0;
      }
    }
  }

  // create triangles per (possibly downsampled) pixel
  const triangles = [];
  const idx = (xx, yy) => yy * maskW + xx;
  // compute scale so physical model size remains consistent even after downsampling
  // originalScale = either user-provided width_mm/origW or height_mm/origH or default
  let originalScale;
  if (options.width_mm) originalScale = options.width_mm / origW;
  else if (options.height_mm) originalScale = options.height_mm / origH;
  else originalScale = SCALE_MM_PER_PX;
  const effectiveScale = originalScale * (origW / maskW);
  for (let y = 0; y < maskH; y++) {
    for (let x = 0; x < maskW; x++) {
      if (!mask[y * maskW + x]) continue;
      const x0 = x * effectiveScale;
      const x1 = (x + 1) * effectiveScale;
      const y0 = (maskH - y - 1) * effectiveScale;
      const y1 = (maskH - y) * effectiveScale;
      const zTop = thickness;
      const zBot = 0;
      const c00 = [x0, y0, zTop];
      const c10 = [x1, y0, zTop];
      const c11 = [x1, y1, zTop];
      const c01 = [x0, y1, zTop];
      const b00 = [x0, y0, zBot];
      const b10 = [x1, y0, zBot];
      const b11 = [x1, y1, zBot];
      const b01 = [x0, y1, zBot];
      // top/bottom
      triangles.push([c01, c11, c10]);
      triangles.push([c01, c10, c00]);
      triangles.push([b11, b01, b00]);
      triangles.push([b11, b00, b10]);
      // side faces
      if (x === 0 || !mask[idx(x - 1, y)]) {
        triangles.push([c01, b01, b00]);
        triangles.push([c01, b00, c00]);
      }
      if (x === maskW - 1 || !mask[idx(x + 1, y)]) {
        triangles.push([c10, b10, b11]);
        triangles.push([c10, b11, c11]);
      }
      if (y === maskH - 1 || !mask[idx(x, y + 1)]) {
        triangles.push([c00, b00, b10]);
        triangles.push([c00, b10, c10]);
      }
      if (y === 0 || !mask[idx(x, y - 1)]) {
        triangles.push([c11, b11, b01]);
        triangles.push([c11, b01, c01]);
      }
    }
  }

  if (triangles.length === 0) throw new Error('No black regions detected');
  const bufferOut = meshTrianglesToBinarySTL(triangles, 'extruded');
  fs.writeFileSync(outputPath, bufferOut);
  return { output: outputPath, width_mm: origW * scale, height_mm: origH * scale, scale_mm_per_px: scale };
}

module.exports = { generate };

async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error('Input file dd2.png not found in project root.');
    process.exit(1);
  }

  const data = fs.readFileSync(INPUT);
  const png = PNG.sync.read(data);
  const w = png.width;
  const h = png.height;
  const pdata = png.data;

  // Create a simple binary mask for black pixels
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = pdata[i];
      const g = pdata[i + 1];
      const b = pdata[i + 2];
      const a = pdata[i + 3];
      const gray = a === 0 ? 255 : Math.round((r + g + b) / 3);
      mask[y * w + x] = gray < THRESHOLD ? 1 : 0;
    }
  }

  // Build mesh by extruding each black pixel. Only create side faces when neighbor is empty
  // If user supplied a target real-world width or height, compute scale mm/px
  const mmScale = (() => {
    const dataWidthPx = w;
    const dataHeightPx = h;
    const targetW = process.env._WIDTH_MM ? parseFloat(process.env._WIDTH_MM) : null;
    const targetH = process.env._HEIGHT_MM ? parseFloat(process.env._HEIGHT_MM) : null;
    if (targetW) {
      return targetW / dataWidthPx;
    }
    if (targetH) {
      return targetH / dataHeightPx;
    }
    return SCALE_MM_PER_PX;
  })();

  console.log('Using scale (mm/px):', mmScale.toFixed(6));
  console.log('Resulting model size (mm):', (w * mmScale).toFixed(2), '×', (h * mmScale).toFixed(2));
  const triangles = [];

  const idx = (xx, yy) => yy * w + xx;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      // pixel corners in mm (flip y so origin at bottom-left)
      const x0 = x * mmScale;
      const x1 = (x + 1) * mmScale;
      const y0 = (h - y - 1) * mmScale;
      const y1 = (h - y) * mmScale;
      const zTop = THICKNESS_MM;
      const zBot = 0;

      const c00 = [x0, y0, zTop]; // bottom-left top
      const c10 = [x1, y0, zTop]; // bottom-right top
      const c11 = [x1, y1, zTop]; // top-right top
      const c01 = [x0, y1, zTop]; // top-left top

      const b00 = [x0, y0, zBot];
      const b10 = [x1, y0, zBot];
      const b11 = [x1, y1, zBot];
      const b01 = [x0, y1, zBot];

      // top face (two triangles)
      triangles.push([c01, c11, c10]);
      triangles.push([c01, c10, c00]);
      // bottom face (two triangles) - reverse winding
      triangles.push([b11, b01, b00]);
      triangles.push([b11, b00, b10]);

      // side faces only where neighboring pixel is empty
      // left neighbor
      if (x === 0 || !mask[idx(x - 1, y)]) {
        // left quad between c01-c00 and b00-b01
        triangles.push([c01, b01, b00]);
        triangles.push([c01, b00, c00]);
      }
      // right neighbor
      if (x === w - 1 || !mask[idx(x + 1, y)]) {
        // right quad between c10-c11 and b11-b10
        triangles.push([c10, b10, b11]);
        triangles.push([c10, b11, c11]);
      }
      // bottom neighbor (y+1 is below since y increases downward) - neighbor below is y+1
      if (y === h - 1 || !mask[idx(x, y + 1)]) {
        // bottom quad between c00-c10 and b10-b00
        triangles.push([c00, b00, b10]);
        triangles.push([c00, b10, c10]);
      }
      // top neighbor (y-1)
      if (y === 0 || !mask[idx(x, y - 1)]) {
        // top quad between c11-c01 and b01-b11
        triangles.push([c11, b11, b01]);
        triangles.push([c11, b01, c01]);
      }
    }
  }

  if (triangles.length === 0) {
    console.error('No black regions detected.');
    process.exit(1);
  }

  const buffer = meshTrianglesToBinarySTL(triangles, 'extruded');
  fs.writeFileSync(OUTPUT, buffer);
  console.log('Wrote', OUTPUT);
}

function meshTrianglesToBinarySTL(triangles, name = '') {
  // triangles: array of [[x,y,z],[x,y,z],[x,y,z]]
  const header = Buffer.alloc(80);
  header.write(name.substring(0, 80));
  const triCount = triangles.length;
  const buf = Buffer.alloc(80 + 4 + triCount * 50);
  header.copy(buf, 0);
  buf.writeUInt32LE(triCount, 80);

  let offset = 84;
  for (const tri of triangles) {
    const v0 = tri[0];
    const v1 = tri[1];
    const v2 = tri[2];
    const ux = v1[0] - v0[0];
    const uy = v1[1] - v0[1];
    const uz = v1[2] - v0[2];
    const vx = v2[0] - v0[0];
    const vy = v2[1] - v0[1];
    const vz = v2[2] - v0[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    buf.writeFloatLE(nx / nl, offset); offset += 4;
    buf.writeFloatLE(ny / nl, offset); offset += 4;
    buf.writeFloatLE(nz / nl, offset); offset += 4;
    // write vertices
    for (const v of [v0, v1, v2]) {
      buf.writeFloatLE(v[0], offset); offset += 4;
      buf.writeFloatLE(v[1], offset); offset += 4;
      buf.writeFloatLE(v[2], offset); offset += 4;
    }
    buf.writeUInt16LE(0, offset); offset += 2;
  }
  return buf;
}

// (removed contour-based code; we extrude per-pixel instead)

// CLI entrypoint (backwards compatible)
async function main() {
  try {
    const opts = { input: INPUT, output: OUTPUT, thickness: THICKNESS_MM, threshold: THRESHOLD };
    // honor CLI width/height via env set earlier
    if (process.env._WIDTH_MM) opts.width_mm = parseFloat(process.env._WIDTH_MM);
    if (process.env._HEIGHT_MM) opts.height_mm = parseFloat(process.env._HEIGHT_MM);
    const res = await generate(opts);
    console.log('Wrote', res.output, 'size(mm):', res.width_mm.toFixed(2), 'x', res.height_mm.toFixed(2));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
