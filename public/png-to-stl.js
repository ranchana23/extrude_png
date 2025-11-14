// Client-side PNG to STL converter
// This runs entirely in the browser without needing a Node.js server

class PNGToSTLConverter {
  constructor() {
    this.THRESHOLD = 128;
    this.THICKNESS_MM = 2.0;
    this.SCALE_MM_PER_PX = 0.2645833333; // default 96 DPI
  }

  /**
   * Generate STL from an image file
   * @param {File} imageFile - The PNG image file
   * @param {Object} options - Generation options
   * @returns {Promise<Blob>} - Binary STL file as Blob
   */
  async generateSTL(imageFile, options = {}) {
    const {
      thickness = 2.0,
      threshold = 128,
      width_mm = null,
      height_mm = null,
      max_px = null,
      target_mb = null
    } = options;

    this.THRESHOLD = threshold;
    this.THICKNESS_MM = thickness;

    // Load image
    const img = await this.loadImage(imageFile);
    const { data, width, height } = await this.getImageData(img);

    // Calculate scale
    let scale;
    if (width_mm) {
      scale = width_mm / width;
    } else if (height_mm) {
      scale = height_mm / height;
    } else {
      scale = this.SCALE_MM_PER_PX;
    }

    // Calculate max_px from target_mb if specified
    let effectiveMaxPx = max_px;
    if (target_mb && !max_px) {
      effectiveMaxPx = this.estimateMaxPxFromTargetMB(data, width, height, target_mb);
    }

    // Downsample if needed
    let maskData, maskW, maskH, effectiveScale;
    if (effectiveMaxPx && Math.max(width, height) > effectiveMaxPx) {
      const result = this.downsampleImage(data, width, height, effectiveMaxPx);
      maskData = result.mask;
      maskW = result.width;
      maskH = result.height;
      effectiveScale = scale * (width / maskW);
    } else {
      maskData = this.createMask(data, width, height);
      maskW = width;
      maskH = height;
      effectiveScale = scale;
    }

    // Generate triangles
    const triangles = this.generateTriangles(maskData, maskW, maskH, effectiveScale);

    if (triangles.length === 0) {
      throw new Error('No black regions detected in image');
    }

    // Convert to binary STL
    const stlBlob = this.trianglesToBinarySTL(triangles);

    return stlBlob;
  }

  /**
   * Load image from file
   */
  loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  /**
   * Get image pixel data
   */
  async getImageData(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    return {
      data: imageData.data,
      width: img.width,
      height: img.height
    };
  }

  /**
   * Create binary mask from image data
   */
  createMask(data, width, height) {
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        const gray = a === 0 ? 255 : Math.round((r + g + b) / 3);
        mask[y * width + x] = gray < this.THRESHOLD ? 1 : 0;
      }
    }
    return mask;
  }

  /**
   * Downsample image to reduce triangle count
   */
  downsampleImage(data, origW, origH, maxPx) {
    const scaleRatio = maxPx / Math.max(origW, origH);
    const maskW = Math.max(1, Math.round(origW * scaleRatio));
    const maskH = Math.max(1, Math.round(origH * scaleRatio));
    const mask = new Uint8Array(maskW * maskH);

    for (let y2 = 0; y2 < maskH; y2++) {
      for (let x2 = 0; x2 < maskW; x2++) {
        const srcX = Math.min(origW - 1, Math.floor(x2 * origW / maskW));
        const srcY = Math.min(origH - 1, Math.floor(y2 * origH / maskH));
        const i = (srcY * origW + srcX) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        const gray = a === 0 ? 255 : Math.round((r + g + b) / 3);
        mask[y2 * maskW + x2] = gray < this.THRESHOLD ? 1 : 0;
      }
    }

    return { mask, width: maskW, height: maskH };
  }

  /**
   * Estimate max pixels from target MB
   */
  estimateMaxPxFromTargetMB(data, width, height, targetMB) {
    const targetBytes = Math.max(1, Math.floor(targetMB * 1024 * 1024));
    const desiredTri = Math.max(1, Math.floor((targetBytes - 84) / 50));

    // Count black pixels
    let blackCount = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        const gray = a === 0 ? 255 : Math.round((r + g + b) / 3);
        if (gray < this.THRESHOLD) blackCount++;
      }
    }

    const avgTriPerPixel = 6;
    const estOrigTriangles = Math.max(1, Math.floor(blackCount * avgTriPerPixel));

    if (estOrigTriangles <= desiredTri) {
      return Math.max(width, height);
    }

    const ratio = desiredTri / estOrigTriangles;
    const linearScale = Math.sqrt(Math.max(1e-6, ratio));
    return Math.max(1, Math.floor(Math.max(width, height) * linearScale));
  }

  /**
   * Generate triangles from mask
   */
  generateTriangles(mask, width, height, scale) {
    const triangles = [];
    const thickness = this.THICKNESS_MM;

    const idx = (x, y) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      return mask[y * width + x] === 1;
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!idx(x, y)) continue;

        // Pixel corners in mm (flip y so origin at bottom-left)
        const x0 = x * scale;
        const x1 = (x + 1) * scale;
        const y0 = (height - y - 1) * scale;
        const y1 = (height - y) * scale;
        const zTop = thickness;
        const zBot = 0;

        // Define 8 corners
        const c00 = [x0, y0, zTop];
        const c10 = [x1, y0, zTop];
        const c11 = [x1, y1, zTop];
        const c01 = [x0, y1, zTop];
        const b00 = [x0, y0, zBot];
        const b10 = [x1, y0, zBot];
        const b11 = [x1, y1, zBot];
        const b01 = [x0, y1, zBot];

        // Top face (2 triangles)
        triangles.push([c01, c11, c10]);
        triangles.push([c01, c10, c00]);

        // Bottom face (2 triangles)
        triangles.push([b11, b01, b00]);
        triangles.push([b11, b00, b10]);

        // Side faces (only where neighbor is empty)
        // Left
        if (!idx(x - 1, y)) {
          triangles.push([c01, b01, b00]);
          triangles.push([c01, b00, c00]);
        }
        // Right
        if (!idx(x + 1, y)) {
          triangles.push([c10, b10, b11]);
          triangles.push([c10, b11, c11]);
        }
        // Bottom
        if (!idx(x, y + 1)) {
          triangles.push([c00, b00, b10]);
          triangles.push([c00, b10, c10]);
        }
        // Top
        if (!idx(x, y - 1)) {
          triangles.push([c11, b11, b01]);
          triangles.push([c11, b01, c01]);
        }
      }
    }

    return triangles;
  }

  /**
   * Convert triangles to binary STL format
   */
  trianglesToBinarySTL(triangles, name = 'model') {
    const triCount = triangles.length;
    const bufferSize = 80 + 4 + triCount * 50;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // Header (80 bytes)
    const encoder = new TextEncoder();
    const nameBytes = encoder.encode(name.substring(0, 80));
    const headerArray = new Uint8Array(buffer, 0, 80);
    headerArray.set(nameBytes);

    // Triangle count (4 bytes)
    view.setUint32(80, triCount, true);

    let offset = 84;
    for (const tri of triangles) {
      const [v0, v1, v2] = tri;

      // Calculate normal
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

      // Write normal (12 bytes)
      view.setFloat32(offset, nx / nl, true); offset += 4;
      view.setFloat32(offset, ny / nl, true); offset += 4;
      view.setFloat32(offset, nz / nl, true); offset += 4;

      // Write vertices (36 bytes)
      for (const v of [v0, v1, v2]) {
        view.setFloat32(offset, v[0], true); offset += 4;
        view.setFloat32(offset, v[1], true); offset += 4;
        view.setFloat32(offset, v[2], true); offset += 4;
      }

      // Attribute byte count (2 bytes)
      view.setUint16(offset, 0, true); offset += 2;
    }

    return new Blob([buffer], { type: 'application/sla' });
  }
}

// Export for use in HTML
if (typeof window !== 'undefined') {
  window.PNGToSTLConverter = PNGToSTLConverter;
}
