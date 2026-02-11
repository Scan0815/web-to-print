import { BgRemovalConfig, DEFAULT_BG_REMOVAL_CONFIG } from '../types';

export interface BgRemovalResult {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
}

/** Euclidean distance between two RGB colors. */
export function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

export interface PixelData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Find the dominant color among a list of RGB samples.
 *
 * Phase 1: Coarse quantization (step 24) to find the candidate color cluster center.
 * Phase 2: Count all samples within `tolerance` Euclidean RGB distance of that center.
 * This two-phase approach handles JPEG artifacts and gradients that split across
 * fine bucket boundaries.
 *
 * Returns [r, g, b] or null if no dominant color is found.
 */
export function findDominantColor(samples: [number, number, number][], minRatio: number, tolerance: number = 60): [number, number, number] | null {
  if (samples.length === 0) return null;

  // Phase 1: coarse buckets to find candidate center
  const step = 24;
  const buckets = new Map<string, { count: number; sumR: number; sumG: number; sumB: number }>();

  for (const [r, g, b] of samples) {
    const key = `${Math.floor(r / step)},${Math.floor(g / step)},${Math.floor(b / step)}`;
    const bucket = buckets.get(key);
    if (bucket !== undefined) {
      bucket.count++;
      bucket.sumR += r;
      bucket.sumG += g;
      bucket.sumB += b;
    } else {
      buckets.set(key, { count: 1, sumR: r, sumG: g, sumB: b });
    }
  }

  let maxBucket: { count: number; sumR: number; sumG: number; sumB: number } | null = null;
  for (const bucket of buckets.values()) {
    if (maxBucket === null || bucket.count > maxBucket.count) {
      maxBucket = bucket;
    }
  }

  if (maxBucket === null) return null;

  const candR = Math.round(maxBucket.sumR / maxBucket.count);
  const candG = Math.round(maxBucket.sumG / maxBucket.count);
  const candB = Math.round(maxBucket.sumB / maxBucket.count);

  // Phase 2: count all samples within tolerance of the candidate color
  let matchCount = 0;
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;

  for (const [r, g, b] of samples) {
    if (colorDistance(r, g, b, candR, candG, candB) <= tolerance) {
      matchCount++;
      totalR += r;
      totalG += g;
      totalB += b;
    }
  }

  if (matchCount / samples.length < minRatio) {
    return null;
  }

  return [
    Math.round(totalR / matchCount),
    Math.round(totalG / matchCount),
    Math.round(totalB / matchCount),
  ];
}

/**
 * Sample all pixels along the 4 image edges.
 * Returns array of [r, g, b] samples.
 */
export function sampleImageEdges(pixels: PixelData): [number, number, number][] {
  const { data, width, height } = pixels;
  const samples: [number, number, number][] = [];

  const sample = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    // Skip transparent pixels (e.g. PNGs with pre-existing transparent background)
    if (data[idx + 3] === 0) return;
    samples.push([data[idx], data[idx + 1], data[idx + 2]]);
  };

  for (let x = 0; x < width; x++) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    sample(0, y);
    sample(width - 1, y);
  }

  return samples;
}

/**
 * Sample opaque pixels that border transparent pixels (the transparency boundary).
 * Returns array of [r, g, b] samples.
 */
export function sampleTransparencyBoundary(pixels: PixelData): [number, number, number][] {
  const { data, width, height } = pixels;
  const samples: [number, number, number][] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] === 0) continue;

      let hasTransparentNeighbor = false;
      for (let dy = -1; dy <= 1 && !hasTransparentNeighbor; dy++) {
        for (let dx = -1; dx <= 1 && !hasTransparentNeighbor; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (data[(ny * width + nx) * 4 + 3] === 0) {
              hasTransparentNeighbor = true;
            }
          }
        }
      }

      if (hasTransparentNeighbor) {
        samples.push([data[idx], data[idx + 1], data[idx + 2]]);
      }
    }
  }

  return samples;
}

/** Backward-compatible wrapper: detect dominant color along image edges. */
export function detectBackgroundColor(pixels: PixelData, minEdgeRatio: number, tolerance: number = 60): [number, number, number] | null {
  return findDominantColor(sampleImageEdges(pixels), minEdgeRatio, tolerance);
}

/**
 * BFS flood-fill from all edge pixels that match the background color within tolerance.
 * Uses 8-directional connectivity for better coverage through diagonal gaps.
 * Sets alpha to 0 for all connected matching pixels.
 * Modifies `data` in place.
 */
export function floodFillFromEdges(pixels: PixelData, bgColor: [number, number, number], tolerance: number): void {
  const { data, width, height } = pixels;
  const total = width * height;
  const visited = new Uint8Array(total);

  // Index-pointer queue for O(n) BFS
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const [bgR, bgG, bgB] = bgColor;

  const enqueueIfMatch = (x: number, y: number) => {
    const pos = y * width + x;
    if (visited[pos] !== 0) return;
    visited[pos] = 1;

    const idx = pos * 4;
    // Skip already-transparent pixels — don't let BFS spread through them
    // into adjacent content (e.g. transparent-bg PNGs where RGB under alpha=0
    // happens to match foreground colors)
    if (data[idx + 3] === 0) return;

    const dist = colorDistance(data[idx], data[idx + 1], data[idx + 2], bgR, bgG, bgB);
    if (dist <= tolerance) {
      queue[tail++] = pos;
    }
  };

  // Seed from all 4 edges
  for (let x = 0; x < width; x++) {
    enqueueIfMatch(x, 0);
    enqueueIfMatch(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueueIfMatch(0, y);
    enqueueIfMatch(width - 1, y);
  }

  // BFS with 8-directional connectivity
  while (head < tail) {
    const pos = queue[head++];
    data[pos * 4 + 3] = 0;

    const x = pos % width;
    const y = (pos - x) / width;

    // Cardinal directions
    if (x > 0) enqueueIfMatch(x - 1, y);
    if (x < width - 1) enqueueIfMatch(x + 1, y);
    if (y > 0) enqueueIfMatch(x, y - 1);
    if (y < height - 1) enqueueIfMatch(x, y + 1);
    // Diagonal directions
    if (x > 0 && y > 0) enqueueIfMatch(x - 1, y - 1);
    if (x < width - 1 && y > 0) enqueueIfMatch(x + 1, y - 1);
    if (x > 0 && y < height - 1) enqueueIfMatch(x - 1, y + 1);
    if (x < width - 1 && y < height - 1) enqueueIfMatch(x + 1, y + 1);
  }
}

/**
 * BFS flood-fill inward from the transparency boundary (opaque pixels adjacent to transparent).
 * Removes connected pixels matching bgColor within tolerance.
 * Modifies `data` in place. Returns the number of pixels removed.
 */
export function floodFillFromBoundary(pixels: PixelData, bgColor: [number, number, number], tolerance: number): number {
  const { data, width, height } = pixels;
  const total = width * height;
  const visited = new Uint8Array(total);

  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  let removed = 0;

  const [bgR, bgG, bgB] = bgColor;

  const enqueueIfMatch = (x: number, y: number) => {
    const pos = y * width + x;
    if (visited[pos] !== 0) return;
    visited[pos] = 1;

    const idx = pos * 4;
    // Skip already transparent pixels
    if (data[idx + 3] === 0) return;

    const dist = colorDistance(data[idx], data[idx + 1], data[idx + 2], bgR, bgG, bgB);
    if (dist <= tolerance) {
      queue[tail++] = pos;
    }
  };

  // Seed: opaque pixels adjacent to transparent pixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = y * width + x;
      const idx = pos * 4;
      if (data[idx + 3] === 0) {
        visited[pos] = 1;
        continue;
      }

      let hasTransparentNeighbor = false;
      for (let dy = -1; dy <= 1 && !hasTransparentNeighbor; dy++) {
        for (let dx = -1; dx <= 1 && !hasTransparentNeighbor; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (data[(ny * width + nx) * 4 + 3] === 0) {
              hasTransparentNeighbor = true;
            }
          }
        }
      }

      if (hasTransparentNeighbor) {
        const dist = colorDistance(data[idx], data[idx + 1], data[idx + 2], bgR, bgG, bgB);
        if (dist <= tolerance) {
          visited[pos] = 1;
          queue[tail++] = pos;
        }
      }
    }
  }

  // BFS with 8-directional connectivity
  while (head < tail) {
    const pos = queue[head++];
    data[pos * 4 + 3] = 0;
    removed++;

    const x = pos % width;
    const y = (pos - x) / width;

    if (x > 0) enqueueIfMatch(x - 1, y);
    if (x < width - 1) enqueueIfMatch(x + 1, y);
    if (y > 0) enqueueIfMatch(x, y - 1);
    if (y < height - 1) enqueueIfMatch(x, y + 1);
    if (x > 0 && y > 0) enqueueIfMatch(x - 1, y - 1);
    if (x < width - 1 && y > 0) enqueueIfMatch(x + 1, y - 1);
    if (x > 0 && y < height - 1) enqueueIfMatch(x - 1, y + 1);
    if (x < width - 1 && y < height - 1) enqueueIfMatch(x + 1, y + 1);
  }

  return removed;
}

/**
 * Remove all opaque pixels matching `color` within `tolerance` (color-key removal).
 * Unlike flood-fill, this does not require connectivity — it removes matching pixels
 * anywhere in the image. Useful for cleaning up trapped interior regions and bypassing
 * anti-aliased fringes that block BFS-based approaches.
 * Modifies `data` in place. Returns the number of pixels removed.
 */
export function removeMatchingPixels(pixels: PixelData, color: [number, number, number], tolerance: number): number {
  const { data } = pixels;
  const [cR, cG, cB] = color;
  let removed = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    if (colorDistance(data[i], data[i + 1], data[i + 2], cR, cG, cB) <= tolerance) {
      data[i + 3] = 0;
      removed++;
    }
  }

  return removed;
}

/**
 * Remove bg-colored pixel clusters that are fully enclosed by non-bg opaque pixels
 * (no pixel in the cluster is adjacent to a transparent pixel). These are trapped
 * interior regions — e.g. white background inside a letter 'O' — that edge flood fill
 * can't reach because the foreground forms a closed boundary.
 * Unlike removeMatchingPixels, this preserves bg-colored pixels at foreground edges
 * (anti-aliased transitions), preventing the inner-pass safety check from failing.
 * Modifies `data` in place. Returns the number of pixels removed.
 */
export function removeEnclosedBackground(pixels: PixelData, bgColor: [number, number, number], tolerance: number): number {
  const { data, width, height } = pixels;
  const total = width * height;
  const [bgR, bgG, bgB] = bgColor;

  // Mark bg-colored opaque pixels
  const isBg = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    if (data[idx + 3] > 0 && colorDistance(data[idx], data[idx + 1], data[idx + 2], bgR, bgG, bgB) <= tolerance) {
      isBg[i] = 1;
    }
  }

  // Find connected components of bg-colored pixels via DFS
  const compId = new Int32Array(total).fill(-1);
  const touchesTransparent: boolean[] = [];
  let nextId = 0;

  for (let start = 0; start < total; start++) {
    if (isBg[start] !== 1 || compId[start] !== -1) continue;

    const id = nextId++;
    touchesTransparent.push(false);

    const stack = [start];
    compId[start] = id;

    while (stack.length > 0) {
      const pos = stack.pop()!;
      const x = pos % width;
      const y = (pos - x) / width;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nPos = ny * width + nx;

          if (data[nPos * 4 + 3] === 0) {
            touchesTransparent[id] = true;
            continue;
          }

          if (isBg[nPos] === 1 && compId[nPos] === -1) {
            compId[nPos] = id;
            stack.push(nPos);
          }
        }
      }
    }
  }

  // Remove pixels in enclosed components (not touching any transparent pixel)
  let removed = 0;
  for (let i = 0; i < total; i++) {
    if (compId[i] !== -1 && !touchesTransparent[compId[i]]) {
      data[i * 4 + 3] = 0;
      removed++;
    }
  }

  return removed;
}

/**
 * Anti-alias edges between transparent (removed) and opaque (kept) pixels.
 * For each opaque pixel adjacent to a transparent pixel, set partial alpha
 * based on its color distance from the background — creating smooth transitions.
 * Modifies `data` in place.
 */
export function antiAliasEdges(pixels: PixelData, bgColor: [number, number, number], tolerance: number): void {
  const { data, width, height } = pixels;
  const [bgR, bgG, bgB] = bgColor;

  // Collect edge pixel positions first, then modify (avoid read-during-write)
  const edgePositions: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = y * width + x;
      const idx = pos * 4;

      // Skip already transparent pixels
      if (data[idx + 3] === 0) continue;

      // Check 8 neighbors for at least one transparent pixel
      let hasTransparentNeighbor = false;
      for (let dy = -1; dy <= 1 && !hasTransparentNeighbor; dy++) {
        for (let dx = -1; dx <= 1 && !hasTransparentNeighbor; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (data[(ny * width + nx) * 4 + 3] === 0) {
              hasTransparentNeighbor = true;
            }
          }
        }
      }

      if (hasTransparentNeighbor) {
        edgePositions.push(pos);
      }
    }
  }

  // Apply soft alpha to edge pixels based on color distance from background
  for (const pos of edgePositions) {
    const idx = pos * 4;
    const dist = colorDistance(data[idx], data[idx + 1], data[idx + 2], bgR, bgG, bgB);
    // Scale alpha: pixels close to bg become mostly transparent, far from bg stay opaque
    const alpha = Math.min(255, Math.round(255 * (dist / tolerance)));
    data[idx + 3] = alpha;
  }
}

/**
 * Compute the fraction of non-matching opaque pixels that sit on the transparency
 * boundary (adjacent to a transparent pixel). A high fraction indicates the non-matching
 * pixels are anti-aliased foreground edges, meaning the matching color IS the foreground
 * content and should not be removed.
 */
export function nonMatchingBoundaryFraction(pixels: PixelData, color: [number, number, number], tolerance: number): number {
  const { data, width, height } = pixels;
  const [cR, cG, cB] = color;
  let nonMatchTotal = 0;
  let nonMatchAtBoundary = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] === 0) continue;
      if (colorDistance(data[idx], data[idx + 1], data[idx + 2], cR, cG, cB) <= tolerance) continue;

      nonMatchTotal++;

      let adjTransparent = false;
      for (let dy = -1; dy <= 1 && !adjTransparent; dy++) {
        for (let dx = -1; dx <= 1 && !adjTransparent; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (data[(ny * width + nx) * 4 + 3] === 0) {
              adjTransparent = true;
            }
          }
        }
      }

      if (adjTransparent) nonMatchAtBoundary++;
    }
  }

  return nonMatchTotal === 0 ? 0 : nonMatchAtBoundary / nonMatchTotal;
}

/**
 * Compute the fraction of matching pixels in the largest connected component.
 * Text consists of multiple disconnected components (individual letters);
 * background panels are one large contiguous region.
 * Uses 8-directional connectivity for consistency with flood fill.
 */
export function largestMatchingComponentFraction(pixels: PixelData, color: [number, number, number], tolerance: number, matchCount: number): number {
  if (matchCount === 0) return 0;

  const { data, width, height } = pixels;
  const total = width * height;
  const [cR, cG, cB] = color;

  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let largestSize = 0;

  for (let start = 0; start < total; start++) {
    if (visited[start] !== 0) continue;
    visited[start] = 1;
    const startIdx = start * 4;
    if (data[startIdx + 3] === 0) continue;
    if (colorDistance(data[startIdx], data[startIdx + 1], data[startIdx + 2], cR, cG, cB) > tolerance) continue;

    // BFS from this matching pixel
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    let size = 1;

    while (head < tail) {
      const pos = queue[head++];
      const x = pos % width;
      const y = (pos - x) / width;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nPos = ny * width + nx;
          if (visited[nPos] !== 0) continue;
          visited[nPos] = 1;
          const nIdx = nPos * 4;
          if (data[nIdx + 3] === 0) continue;
          if (colorDistance(data[nIdx], data[nIdx + 1], data[nIdx + 2], cR, cG, cB) > tolerance) continue;
          queue[tail++] = nPos;
          size++;
        }
      }
    }

    if (size > largestSize) largestSize = size;
    // Early exit: single large region clearly dominates
    if (largestSize >= matchCount * 0.8) return largestSize / matchCount;
  }

  return largestSize / matchCount;
}

/**
 * Find the bounding box of all opaque pixels (alpha > threshold).
 * Returns [minX, minY, maxX, maxY] or null if no opaque pixels are found.
 */
export function findOpaqueBoundingBox(pixels: PixelData, alphaThreshold: number = 0): [number, number, number, number] | null {
  const { data, width, height } = pixels;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX === -1) return null;
  return [minX, minY, maxX, maxY];
}

function loadImageFromSource(source: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

export async function removeBackground(source: File | Blob, config?: Partial<BgRemovalConfig>): Promise<BgRemovalResult> {
  const { tolerance, minEdgeRatio, autoCrop, autoCropPadding } = { ...DEFAULT_BG_REMOVAL_CONFIG, ...config };

  const img = await loadImageFromSource(source);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;

  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('Could not get canvas 2d context');

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const pixels: PixelData = { data: imageData.data, width: canvas.width, height: canvas.height };

  // Pass 1: detect dominant color on image edges and flood-fill from edges.
  // First check if the background is already transparent (e.g. PNG with alpha channel).
  // If most edge pixels are transparent, there's no opaque background to remove.
  const edgeSamples = sampleImageEdges(pixels);
  const totalEdgePixels = 2 * pixels.width + 2 * Math.max(0, pixels.height - 2);
  const opaqueEdgeRatio = totalEdgePixels > 0 ? edgeSamples.length / totalEdgePixels : 0;

  let bgColor: [number, number, number] | null = null;
  if (opaqueEdgeRatio >= 0.5) {
    // Enough opaque edges to detect a background color
    bgColor = findDominantColor(edgeSamples, minEdgeRatio, tolerance);
  }

  if (bgColor !== null) {
    floodFillFromEdges(pixels, bgColor, tolerance);

    // Pass 1b: remove trapped interior regions of the edge background color.
    // After edge flood fill, pockets enclosed by foreground (e.g. white inside letter 'O')
    // are not reached. Remove bg-colored clusters that don't touch any transparent pixel.
    // This is more surgical than removeMatchingPixels — it preserves anti-aliased edges,
    // preventing the inner-pass from misidentifying foreground as a removable layer.
    removeEnclosedBackground(pixels, bgColor, tolerance);
  }

  // If no background was removed and no transparent pixels exist, there's nothing to do.
  let hasTransparent = false;
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (pixels.data[i + 3] === 0) { hasTransparent = true; break; }
  }
  if (!hasTransparent) {
    throw new Error('No dominant background color detected');
  }

  // Pass 2+: detect dominant color on the transparency boundary and remove by color-key.
  // This removes inner background panels (e.g. colored rectangle behind a logo).
  // Uses color-key removal instead of boundary flood fill to bypass anti-aliased fringes.
  let lastBgColor: [number, number, number] = bgColor ?? [255, 255, 255];
  for (let pass = 0; pass < 3; pass++) {
    const boundarySamples = sampleTransparencyBoundary(pixels);
    const innerColor = findDominantColor(boundarySamples, minEdgeRatio, tolerance);
    if (innerColor === null) break;

    // Safety 1: if this color matches >90% of remaining opaque pixels, it's likely
    // the actual foreground content, not an inner background layer — stop.
    let opaqueCount = 0;
    let matchCount = 0;
    let matchMinX = pixels.width;
    let matchMaxX = 0;
    let matchMinY = pixels.height;
    let matchMaxY = 0;
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i + 3] > 0) {
        opaqueCount++;
        if (colorDistance(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2], innerColor[0], innerColor[1], innerColor[2]) <= tolerance) {
          matchCount++;
          const pixelIdx = i / 4;
          const px = pixelIdx % pixels.width;
          const py = (pixelIdx - px) / pixels.width;
          if (px < matchMinX) matchMinX = px;
          if (px > matchMaxX) matchMaxX = px;
          if (py < matchMinY) matchMinY = py;
          if (py > matchMaxY) matchMaxY = py;
        }
      }
    }
    if (opaqueCount === 0 || matchCount / opaqueCount > 0.9) break;

    // Safety 1b: if non-matching pixels are predominantly anti-aliased edges
    // (adjacent to transparent), the matching color is the foreground content.
    // For text-only logos after bg removal, the non-matching pixels are the thin
    // gray anti-aliased ring around letters — nearly all at the transparency boundary.
    // For legitimate panels, non-matching pixels are foreground content in the interior.
    // Only check when the matching color covers a significant portion of content.
    if (matchCount / opaqueCount > 0.4) {
      const nmBoundaryFrac = nonMatchingBoundaryFraction(pixels, innerColor, tolerance);
      if (nmBoundaryFrac > 0.5) break;
    }

    // Safety 2: if most matching pixels are at the transparency boundary (thin shell),
    // they're anti-aliased foreground edges, not a removable background layer.
    // A true inner background extends deep past the boundary into the interior.
    let boundaryMatchCount = 0;
    for (const [r, g, b] of boundarySamples) {
      if (colorDistance(r, g, b, innerColor[0], innerColor[1], innerColor[2]) <= tolerance) {
        boundaryMatchCount++;
      }
    }
    if (matchCount > 0 && boundaryMatchCount / matchCount > 0.7) break;

    // Safety 3: check spatial compactness. Background panels fill their bounding box
    // densely (fill ratio well above 0.45), while foreground text/logos are sparse
    // (letters with gaps give fill ratios well below 0.45).
    const bboxArea = (matchMaxX - matchMinX + 1) * (matchMaxY - matchMinY + 1);
    if (bboxArea > 0 && matchCount / bboxArea < 0.45) break;

    // Safety 4: check component fragmentation. Text consists of multiple disconnected
    // components (individual letters), while a background panel is one large region.
    // Only run this when fill ratio didn't catch it (the check is O(n)).
    const largestFraction = largestMatchingComponentFraction(pixels, innerColor, tolerance, matchCount);
    if (largestFraction < 0.8) break;

    const removed = removeMatchingPixels(pixels, innerColor, tolerance);
    if (removed === 0) break;
    lastBgColor = innerColor;
  }

  antiAliasEdges(pixels, lastBgColor, tolerance);

  ctx.putImageData(imageData, 0, 0);

  // Auto-crop to opaque content bounding box
  let outputCanvas: HTMLCanvasElement = canvas;
  if (autoCrop) {
    const bbox = findOpaqueBoundingBox(pixels);
    if (bbox !== null) {
      const [bMinX, bMinY, bMaxX, bMaxY] = bbox;
      const cropX = Math.max(0, bMinX - autoCropPadding);
      const cropY = Math.max(0, bMinY - autoCropPadding);
      const cropRight = Math.min(canvas.width, bMaxX + 1 + autoCropPadding);
      const cropBottom = Math.min(canvas.height, bMaxY + 1 + autoCropPadding);
      const cropW = cropRight - cropX;
      const cropH = cropBottom - cropY;

      if (cropW < canvas.width || cropH < canvas.height) {
        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = cropW;
        croppedCanvas.height = cropH;
        const croppedCtx = croppedCanvas.getContext('2d');
        if (croppedCtx !== null) {
          croppedCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
          outputCanvas = croppedCanvas;
        }
      }
    }
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    outputCanvas.toBlob(b => {
      if (b !== null) resolve(b);
      else reject(new Error('Canvas toBlob failed'));
    }, 'image/png');
  });

  const dataUrl = outputCanvas.toDataURL('image/png');

  return { blob, dataUrl, width: outputCanvas.width, height: outputCanvas.height };
}
