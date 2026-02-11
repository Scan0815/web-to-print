import { colorDistance, findDominantColor, sampleImageEdges, sampleTransparencyBoundary, detectBackgroundColor, floodFillFromEdges, floodFillFromBoundary, removeMatchingPixels, removeEnclosedBackground, antiAliasEdges, nonMatchingBoundaryFraction, largestMatchingComponentFraction, findOpaqueBoundingBox, PixelData, removeBackground } from './background-removal';

// Helper: create a PixelData from a flat array of [r,g,b,a] per pixel
function makePixels(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]): PixelData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y);
      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return { data, width, height };
}

describe('colorDistance', () => {
  it('returns 0 for identical colors', () => {
    expect(colorDistance(255, 255, 255, 255, 255, 255)).toBe(0);
    expect(colorDistance(0, 0, 0, 0, 0, 0)).toBe(0);
  });

  it('computes correct Euclidean distance', () => {
    // distance between (255,0,0) and (0,0,0) = 255
    expect(colorDistance(255, 0, 0, 0, 0, 0)).toBe(255);
    // distance between (255,255,255) and (0,0,0) = sqrt(3*255^2) ≈ 441.67
    expect(colorDistance(255, 255, 255, 0, 0, 0)).toBeCloseTo(Math.sqrt(3 * 255 * 255), 2);
  });

  it('is symmetric', () => {
    expect(colorDistance(100, 50, 200, 10, 80, 150)).toBe(colorDistance(10, 80, 150, 100, 50, 200));
  });
});

describe('findDominantColor', () => {
  it('finds dominant color from uniform samples', () => {
    const samples: [number, number, number][] = Array(20).fill([255, 255, 255]);
    const result = findDominantColor(samples, 0.3);
    expect(result).toEqual([255, 255, 255]);
  });

  it('returns null for empty samples', () => {
    expect(findDominantColor([], 0.3)).toBeNull();
  });

  it('returns null when no color reaches minRatio', () => {
    const samples: [number, number, number][] = [];
    for (let i = 0; i < 20; i++) {
      samples.push([(i * 73) % 256, (i * 137) % 256, (i * 199) % 256]);
    }
    expect(findDominantColor(samples, 0.3)).toBeNull();
  });
});

describe('sampleImageEdges', () => {
  it('samples all border pixels', () => {
    const pixels = makePixels(5, 5, () => [100, 100, 100, 255]);
    const samples = sampleImageEdges(pixels);
    // 5x5: top row (5) + bottom row (5) + left col excl corners (3) + right col excl corners (3) = 16
    expect(samples.length).toBe(16);
  });

  it('skips transparent edge pixels', () => {
    // 5x5: all edge pixels transparent, interior opaque
    const pixels = makePixels(5, 5, (x, y) => {
      const isEdge = x === 0 || x === 4 || y === 0 || y === 4;
      return isEdge ? [0, 0, 0, 0] : [100, 100, 100, 255];
    });
    const samples = sampleImageEdges(pixels);
    expect(samples.length).toBe(0);
  });

  it('only samples opaque edge pixels', () => {
    // 5x5: half of edge pixels transparent, half opaque
    const pixels = makePixels(5, 5, (x, y) => {
      const isEdge = x === 0 || x === 4 || y === 0 || y === 4;
      if (!isEdge) return [50, 50, 50, 255];
      // Top row opaque, bottom row transparent, sides mixed
      if (y === 0) return [200, 200, 200, 255];
      if (y === 4) return [200, 200, 200, 0];
      return x === 0 ? [200, 200, 200, 255] : [200, 200, 200, 0];
    });
    const samples = sampleImageEdges(pixels);
    // Top row: 5 opaque, bottom row: 0, left col (y=1-3): 3, right col (y=1-3): 0 = 8
    expect(samples.length).toBe(8);
  });
});

describe('sampleTransparencyBoundary', () => {
  it('finds opaque pixels adjacent to transparent pixels', () => {
    // 5x5: border transparent, interior opaque
    const pixels = makePixels(5, 5, (x, y) => {
      const isEdge = x === 0 || x === 4 || y === 0 || y === 4;
      return isEdge ? [255, 255, 255, 0] : [0, 0, 255, 255];
    });
    const samples = sampleTransparencyBoundary(pixels);
    // 8 of 9 interior pixels border the transparent edge (center pixel (2,2) does not)
    expect(samples.length).toBe(8);
    expect(samples[0]).toEqual([0, 0, 255]);
  });

  it('returns empty when no transparent pixels exist', () => {
    const pixels = makePixels(5, 5, () => [128, 128, 128, 255]);
    expect(sampleTransparencyBoundary(pixels).length).toBe(0);
  });
});

describe('detectBackgroundColor', () => {
  it('detects white edges as background color', () => {
    const pixels = makePixels(10, 10, () => [255, 255, 255, 255]);
    const result = detectBackgroundColor(pixels, 0.3);
    expect(result).not.toBeNull();
    expect(result![0]).toBe(255);
    expect(result![1]).toBe(255);
    expect(result![2]).toBe(255);
  });

  it('detects dominant edge color when edges are mostly one color', () => {
    const pixels = makePixels(10, 10, (x, y) => {
      const isEdge = x === 0 || x === 9 || y === 0 || y === 9;
      return isEdge ? [255, 0, 0, 255] : [0, 0, 255, 255];
    });
    const result = detectBackgroundColor(pixels, 0.3);
    expect(result).not.toBeNull();
    expect(result![0]).toBe(255);
    expect(result![1]).toBe(0);
    expect(result![2]).toBe(0);
  });

  it('returns null when edge colors are too diverse', () => {
    let counter = 0;
    const pixels = makePixels(10, 10, () => {
      counter++;
      const r = (counter * 73) % 256;
      const g = (counter * 137) % 256;
      const b = (counter * 199) % 256;
      return [r, g, b, 255];
    });
    const result = detectBackgroundColor(pixels, 0.3);
    expect(result).toBeNull();
  });

  it('respects minEdgeRatio threshold', () => {
    const pixels = makePixels(10, 10, (x, y) => {
      const isEdge = x === 0 || x === 9 || y === 0 || y === 9;
      if (!isEdge) return [128, 128, 128, 255];
      return y < 5 ? [255, 255, 255, 255] : [0, 0, 0, 255];
    });

    const result03 = detectBackgroundColor(pixels, 0.3);
    expect(result03).not.toBeNull();

    const result09 = detectBackgroundColor(pixels, 0.9);
    expect(result09).toBeNull();
  });
});

describe('floodFillFromEdges', () => {
  it('makes background pixels transparent', () => {
    // 5x5 all-white image
    const pixels = makePixels(5, 5, () => [255, 255, 255, 255]);
    floodFillFromEdges(pixels, [255, 255, 255], 30);

    // All pixels should be transparent
    for (let i = 0; i < 5 * 5; i++) {
      expect(pixels.data[i * 4 + 3]).toBe(0);
    }
  });

  it('preserves foreground pixels not connected to edge', () => {
    // 5x5 image: white border, black center (3x3 black block at interior)
    const pixels = makePixels(5, 5, (x, y) => {
      const isEdge = x === 0 || x === 4 || y === 0 || y === 4;
      return isEdge ? [255, 255, 255, 255] : [0, 0, 0, 255];
    });

    floodFillFromEdges(pixels, [255, 255, 255], 30);

    // Edge pixels should be transparent
    for (let x = 0; x < 5; x++) {
      expect(pixels.data[(0 * 5 + x) * 4 + 3]).toBe(0); // top row
      expect(pixels.data[(4 * 5 + x) * 4 + 3]).toBe(0); // bottom row
    }
    for (let y = 1; y < 4; y++) {
      expect(pixels.data[(y * 5 + 0) * 4 + 3]).toBe(0); // left col
      expect(pixels.data[(y * 5 + 4) * 4 + 3]).toBe(0); // right col
    }

    // Interior black pixels should be preserved (alpha 255)
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        expect(pixels.data[(y * 5 + x) * 4 + 3]).toBe(255);
      }
    }
  });

  it('does not leak through 2-pixel-wide barriers of different color', () => {
    // 9x9: white bg, 2-pixel-wide black barrier at x=3..4 (8-dir BFS needs 2px to block)
    const pixels = makePixels(9, 9, (x) => {
      if (x === 3 || x === 4) return [0, 0, 0, 255]; // black barrier
      return [255, 255, 255, 255];
    });

    floodFillFromEdges(pixels, [255, 255, 255], 30);

    // Barrier pixels should remain opaque
    for (let y = 0; y < 9; y++) {
      expect(pixels.data[(y * 9 + 3) * 4 + 3]).toBe(255);
      expect(pixels.data[(y * 9 + 4) * 4 + 3]).toBe(255);
    }

    // Both sides of barrier reachable from edges should be transparent
    expect(pixels.data[(1 * 9 + 1) * 4 + 3]).toBe(0);
    expect(pixels.data[(1 * 9 + 6) * 4 + 3]).toBe(0);
  });

  it('reaches diagonally connected background pixels', () => {
    // 5x5: white bg with a single black pixel at (2,2) — diagonal should go around it
    const pixels = makePixels(5, 5, (x, y) => {
      if (x === 2 && y === 2) return [0, 0, 0, 255];
      return [255, 255, 255, 255];
    });

    floodFillFromEdges(pixels, [255, 255, 255], 30);

    // The black center pixel should remain opaque
    expect(pixels.data[(2 * 5 + 2) * 4 + 3]).toBe(255);
    // All white pixels should be transparent (8-dir reaches around the single black pixel)
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        if (x === 2 && y === 2) continue;
        expect(pixels.data[(y * 5 + x) * 4 + 3]).toBe(0);
      }
    }
  });

  it('respects tolerance for similar colors', () => {
    // 5x5: bg is (250, 250, 250), center is (200, 200, 200)
    const pixels = makePixels(5, 5, (x, y) => {
      const isCenter = x >= 1 && x <= 3 && y >= 1 && y <= 3;
      return isCenter ? [200, 200, 200, 255] : [250, 250, 250, 255];
    });

    // With low tolerance, interior should remain
    floodFillFromEdges(pixels, [250, 250, 250], 10);
    expect(pixels.data[(2 * 5 + 2) * 4 + 3]).toBe(255);

    // With high tolerance (distance ~86.6), interior should be removed
    const pixels2 = makePixels(5, 5, (x, y) => {
      const isCenter = x >= 1 && x <= 3 && y >= 1 && y <= 3;
      return isCenter ? [200, 200, 200, 255] : [250, 250, 250, 255];
    });
    floodFillFromEdges(pixels2, [250, 250, 250], 100);
    expect(pixels2.data[(2 * 5 + 2) * 4 + 3]).toBe(0);
  });
});

describe('floodFillFromBoundary', () => {
  it('removes inner background panel after outer bg is already transparent', () => {
    // 9x9: outer ring transparent (was white bg), middle ring blue, inner black content
    const pixels = makePixels(9, 9, (x, y) => {
      const isOuter = x === 0 || x === 8 || y === 0 || y === 8;
      if (isOuter) return [255, 255, 255, 0]; // already removed
      const isInner = x >= 3 && x <= 5 && y >= 3 && y <= 5;
      if (isInner) return [0, 0, 0, 255]; // black content
      return [0, 0, 200, 255]; // blue panel
    });

    const removed = floodFillFromBoundary(pixels, [0, 0, 200], 30);

    // Blue panel pixels should now be transparent
    expect(removed).toBeGreaterThan(0);
    expect(pixels.data[(1 * 9 + 1) * 4 + 3]).toBe(0); // was blue
    expect(pixels.data[(2 * 9 + 2) * 4 + 3]).toBe(0); // was blue

    // Black inner content should remain opaque
    expect(pixels.data[(4 * 9 + 4) * 4 + 3]).toBe(255);
  });

  it('returns 0 when no boundary pixels match', () => {
    // 5x5: border transparent, interior all black (very different from target white)
    const pixels = makePixels(5, 5, (x, y) => {
      const isEdge = x === 0 || x === 4 || y === 0 || y === 4;
      return isEdge ? [255, 255, 255, 0] : [0, 0, 0, 255];
    });

    const removed = floodFillFromBoundary(pixels, [255, 255, 255], 30);
    expect(removed).toBe(0);
  });
});

describe('removeMatchingPixels', () => {
  it('removes all pixels matching color within tolerance', () => {
    // 5x5: white border, black center, white trapped inside at (2,2)
    const pixels = makePixels(5, 5, (x, y) => {
      if (x === 2 && y === 2) return [255, 255, 255, 255]; // trapped white
      const isEdge = x === 0 || x === 4 || y === 0 || y === 4;
      return isEdge ? [255, 255, 255, 255] : [0, 0, 0, 255];
    });

    const removed = removeMatchingPixels(pixels, [255, 255, 255], 30);

    // All white pixels removed (16 border + 1 trapped = 17)
    expect(removed).toBe(17);
    // Trapped white pixel at (2,2) should be transparent
    expect(pixels.data[(2 * 5 + 2) * 4 + 3]).toBe(0);
    // Black pixels should remain
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        if (x === 2 && y === 2) continue;
        expect(pixels.data[(y * 5 + x) * 4 + 3]).toBe(255);
      }
    }
  });

  it('skips already transparent pixels', () => {
    const pixels = makePixels(3, 3, () => [255, 255, 255, 0]); // all transparent
    const removed = removeMatchingPixels(pixels, [255, 255, 255], 30);
    expect(removed).toBe(0);
  });

  it('respects tolerance', () => {
    // 3x3: all near-white with one exact white
    const pixels = makePixels(3, 3, (x, y) => {
      if (x === 1 && y === 1) return [255, 255, 255, 255]; // exact white
      return [200, 200, 200, 255]; // near-gray
    });

    // Low tolerance: only exact white removed
    const removed = removeMatchingPixels(pixels, [255, 255, 255], 10);
    expect(removed).toBe(1);
    expect(pixels.data[(1 * 3 + 1) * 4 + 3]).toBe(0);
    expect(pixels.data[(0 * 3 + 0) * 4 + 3]).toBe(255);
  });
});

describe('removeEnclosedBackground', () => {
  it('removes bg-colored clusters fully enclosed by non-bg opaque pixels', () => {
    // 10x10: white outer (transparent after edge fill), black frame, white trapped inside
    const pixels = makePixels(10, 10, (x, y) => {
      const isOuterEdge = x === 0 || x === 9 || y === 0 || y === 9;
      if (isOuterEdge) return [255, 255, 255, 0]; // already transparent (edge fill done)
      const isBlackFrame = x === 1 || x === 8 || y === 1 || y === 8;
      if (isBlackFrame) return [0, 0, 0, 255]; // black foreground
      return [255, 255, 255, 255]; // white trapped inside
    });

    const removed = removeEnclosedBackground(pixels, [255, 255, 255], 30);

    // The 6x6 interior white block should be removed (enclosed by black frame)
    expect(removed).toBe(36);
    expect(pixels.data[(5 * 10 + 5) * 4 + 3]).toBe(0); // center was white → now transparent
    // Black frame should remain
    expect(pixels.data[(1 * 10 + 1) * 4 + 3]).toBe(255);
  });

  it('preserves bg-colored pixels adjacent to transparent pixels (anti-aliased edges)', () => {
    // 5x5: outer transparent, near-white anti-alias ring, black center
    const pixels = makePixels(5, 5, (x, y) => {
      const isEdge = x === 0 || x === 4 || y === 0 || y === 4;
      if (isEdge) return [255, 255, 255, 0]; // already transparent
      const isCenter = x === 2 && y === 2;
      if (isCenter) return [0, 0, 0, 255]; // black center
      return [245, 245, 245, 255]; // near-white anti-alias ring (matches bg within tolerance)
    });

    const removed = removeEnclosedBackground(pixels, [255, 255, 255], 30);

    // Near-white ring touches transparent edge → NOT removed
    expect(removed).toBe(0);
    expect(pixels.data[(1 * 5 + 1) * 4 + 3]).toBe(255); // near-white preserved
  });

  it('returns 0 when no enclosed regions exist', () => {
    const pixels = makePixels(5, 5, () => [0, 0, 0, 255]); // all black, no bg pixels
    const removed = removeEnclosedBackground(pixels, [255, 255, 255], 30);
    expect(removed).toBe(0);
  });
});

describe('antiAliasEdges', () => {
  it('softens edges between transparent and opaque pixels', () => {
    // 5x5: white border (already transparent), black interior
    const pixels = makePixels(5, 5, (x, y) => {
      const isEdge = x === 0 || x === 4 || y === 0 || y === 4;
      return isEdge ? [255, 255, 255, 0] : [0, 0, 0, 255]; // edge already transparent
    });

    antiAliasEdges(pixels, [255, 255, 255], 40);

    // Interior pixels adjacent to the transparent edge should have reduced alpha
    // Black (0,0,0) vs white bg (255,255,255) has distance ~441, so alpha = min(255, 255 * 441/40) = 255
    // They're far from the bg, so they should stay fully opaque
    expect(pixels.data[(2 * 5 + 2) * 4 + 3]).toBe(255); // center not adjacent to transparent

    // Edge-adjacent interior pixel (1,1): black, adjacent to transparent corner pixels
    // distance = ~441, alpha = min(255, round(255 * 441/40)) = 255 — black is very far from white bg
    expect(pixels.data[(1 * 5 + 1) * 4 + 3]).toBe(255);
  });

  it('makes near-background edge pixels partially transparent', () => {
    // 5x5: white border transparent, near-white interior ring, black center
    const pixels = makePixels(5, 5, (x, y) => {
      const isEdge = x === 0 || x === 4 || y === 0 || y === 4;
      if (isEdge) return [255, 255, 255, 0]; // already transparent
      const isCenter = x === 2 && y === 2;
      if (isCenter) return [0, 0, 0, 255]; // black center
      return [240, 240, 240, 255]; // near-white ring
    });

    antiAliasEdges(pixels, [255, 255, 255], 40);

    // Near-white pixel (1,1) adjacent to transparent edge: distance = sqrt(3*15^2) ≈ 26
    // alpha = min(255, round(255 * 26/40)) ≈ 166
    const alpha = pixels.data[(1 * 5 + 1) * 4 + 3];
    expect(alpha).toBeGreaterThan(100);
    expect(alpha).toBeLessThan(200);
  });

  it('does not modify pixels that have no transparent neighbors', () => {
    // 5x5: all opaque, no transparent pixels
    const pixels = makePixels(5, 5, () => [128, 128, 128, 255]);

    antiAliasEdges(pixels, [255, 255, 255], 40);

    // All pixels should remain fully opaque
    for (let i = 0; i < 5 * 5; i++) {
      expect(pixels.data[i * 4 + 3]).toBe(255);
    }
  });
});

describe('multi-pass: Wella-style logo (white outer + blue inner panel + black content)', () => {
  // Simulates the Wella Company logo structure:
  //   - 20x20 image
  //   - Outer 2px border: white/light-gray background (with JPEG-like noise ±5)
  //   - Blue dome: elliptical area roughly in the center (with color variation ±10)
  //   - Black logo elements: text-like block inside the blue dome
  //
  //   Layout (conceptual):
  //   WWWWWWWWWWWWWWWWWWWW
  //   WWWWWWWWWWWWWWWWWWWW
  //   WWWWBBBBBBBBBBBBWWWW
  //   WWWBBBBBBBBBBBBBBWWW
  //   WWWBBB██████BBBBBWWW
  //   WWWBBB██████BBBBBWWW
  //   WWWBBB██████BBBBBWWW
  //   WWWBBBBBBBBBBBBBBWWW
  //   WWWWBBBBBBBBBBBBWWWW
  //   WWWWWWWWWWWWWWWWWWWW
  //   (W = white, B = blue, █ = black)

  function makeWellaPixels(): PixelData {
    const w = 20;
    const h = 20;
    const data = new Uint8ClampedArray(w * h * 4);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;

        // Black logo content block (6x6 in center)
        if (x >= 7 && x <= 12 && y >= 7 && y <= 12) {
          data[idx] = 10;
          data[idx + 1] = 10;
          data[idx + 2] = 10;
          data[idx + 3] = 255;
          continue;
        }

        // Blue dome: ellipse centered at (10, 10), rx=7, ry=6
        const dx = (x - 10) / 7;
        const dy = (y - 10) / 6;
        if (dx * dx + dy * dy <= 1) {
          // Blue with JPEG-like noise (±10 per channel)
          const noise = ((x * 7 + y * 13) % 21) - 10;
          data[idx] = Math.max(0, Math.min(255, 40 + noise));
          data[idx + 1] = Math.max(0, Math.min(255, 60 + noise));
          data[idx + 2] = Math.max(0, Math.min(255, 180 + noise));
          data[idx + 3] = 255;
          continue;
        }

        // White outer background with slight noise (±5)
        const wNoise = ((x * 3 + y * 11) % 11) - 5;
        const wVal = Math.max(0, Math.min(255, 245 + wNoise));
        data[idx] = wVal;
        data[idx + 1] = wVal;
        data[idx + 2] = wVal;
        data[idx + 3] = 255;
      }
    }

    return { data, width: w, height: h };
  }

  it('pass 1: removes white outer background from edges', () => {
    const pixels = makeWellaPixels();

    // Detect white bg on image edges
    const bgColor = detectBackgroundColor(pixels, 0.3, 40);
    expect(bgColor).not.toBeNull();
    // Should be close to white (245 ± noise)
    expect(bgColor![0]).toBeGreaterThan(230);
    expect(bgColor![1]).toBeGreaterThan(230);
    expect(bgColor![2]).toBeGreaterThan(230);

    floodFillFromEdges(pixels, bgColor!, 40);

    // Corner pixels (white area) should now be transparent
    expect(pixels.data[(0 * 20 + 0) * 4 + 3]).toBe(0);
    expect(pixels.data[(0 * 20 + 19) * 4 + 3]).toBe(0);
    expect(pixels.data[(19 * 20 + 0) * 4 + 3]).toBe(0);

    // Blue dome center should still be opaque
    expect(pixels.data[(10 * 20 + 10) * 4 + 3]).toBe(255);

    // Black content should still be opaque
    expect(pixels.data[(9 * 20 + 9) * 4 + 3]).toBe(255);
  });

  it('pass 2: detects blue dome on transparency boundary and removes it', () => {
    const pixels = makeWellaPixels();

    // Pass 1: remove white outer
    const bgColor = detectBackgroundColor(pixels, 0.3, 40)!;
    floodFillFromEdges(pixels, bgColor, 40);

    // Boundary samples should now show the blue dome as dominant
    const boundarySamples = sampleTransparencyBoundary(pixels);
    expect(boundarySamples.length).toBeGreaterThan(0);

    const innerColor = findDominantColor(boundarySamples, 0.3, 40);
    expect(innerColor).not.toBeNull();
    // Should be close to blue (~40, ~60, ~180)
    expect(innerColor![2]).toBeGreaterThan(150);

    // Pass 2: remove blue dome
    const removed = floodFillFromBoundary(pixels, innerColor!, 40);
    expect(removed).toBeGreaterThan(0);

    // Blue dome pixel should now be transparent
    expect(pixels.data[(5 * 20 + 10) * 4 + 3]).toBe(0);
    expect(pixels.data[(14 * 20 + 10) * 4 + 3]).toBe(0);

    // Black content should STILL be opaque
    expect(pixels.data[(9 * 20 + 9) * 4 + 3]).toBe(255);
    expect(pixels.data[(10 * 20 + 10) * 4 + 3]).toBe(255);
  });

  it('full pipeline: both layers removed, black content preserved', () => {
    const pixels = makeWellaPixels();
    const tolerance = 40;
    const minEdgeRatio = 0.3;

    // Pass 1: remove outer white background via edge flood fill
    const bgColor = detectBackgroundColor(pixels, minEdgeRatio, tolerance)!;
    floodFillFromEdges(pixels, bgColor, tolerance);

    // Pass 1b: remove enclosed trapped bg-colored regions
    removeEnclosedBackground(pixels, bgColor, tolerance);

    // Pass 2+: remove inner layers using color-key removal with safety checks
    for (let pass = 0; pass < 3; pass++) {
      const boundarySamples = sampleTransparencyBoundary(pixels);
      const innerColor = findDominantColor(boundarySamples, minEdgeRatio, tolerance);
      if (innerColor === null) break;

      // Safety 1: foreground ratio check
      let opaque = 0;
      let matching = 0;
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (pixels.data[i + 3] > 0) {
          opaque++;
          if (colorDistance(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2], innerColor[0], innerColor[1], innerColor[2]) <= tolerance) {
            matching++;
          }
        }
      }
      if (opaque === 0 || matching / opaque > 0.9) break;

      // Safety 2: boundary ratio check
      let boundaryMatching = 0;
      for (const [r, g, b] of boundarySamples) {
        if (colorDistance(r, g, b, innerColor[0], innerColor[1], innerColor[2]) <= tolerance) {
          boundaryMatching++;
        }
      }
      if (matching > 0 && boundaryMatching / matching > 0.7) break;

      const removed = removeMatchingPixels(pixels, innerColor, tolerance);
      if (removed === 0) break;
    }

    // Count remaining opaque pixels — should only be the black content block
    let opaqueCount = 0;
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        if (pixels.data[(y * 20 + x) * 4 + 3] > 0) {
          opaqueCount++;
          // Every remaining opaque pixel should be dark (black content)
          expect(pixels.data[(y * 20 + x) * 4]).toBeLessThan(50);
        }
      }
    }

    // The 6x6 black block = 36 pixels
    expect(opaqueCount).toBe(36);
  });
});

describe('trapped interior regions: black-on-white logo', () => {
  // Simulates a logo like the Wella Company: black line art on white background.
  // After edge flood fill, white trapped inside enclosed shapes (like inside 'O', 'A')
  // must also be removed. The color-key cleanup pass handles this.
  //
  //   Layout (10x10):
  //   WWWWWWWWWW    W = white background
  //   W████████W    █ = black foreground
  //   W█WWWWWW█W    Interior white trapped inside black frame
  //   W█WWWWWW█W
  //   W█WWWWWW█W
  //   W█WWWWWW█W
  //   W█WWWWWW█W
  //   W█WWWWWW█W
  //   W████████W
  //   WWWWWWWWWW

  function makeLetterOPixels(): PixelData {
    return makePixels(10, 10, (x, y) => {
      const isOuterEdge = x === 0 || x === 9 || y === 0 || y === 9;
      if (isOuterEdge) return [255, 255, 255, 255]; // white outer bg

      const isBlackFrame = x === 1 || x === 8 || y === 1 || y === 8;
      if (isBlackFrame) return [0, 0, 0, 255]; // black foreground

      return [255, 255, 255, 255]; // white trapped inside
    });
  }

  it('edge flood fill alone does NOT remove trapped interior white', () => {
    const pixels = makeLetterOPixels();
    const bgColor: [number, number, number] = [255, 255, 255];

    floodFillFromEdges(pixels, bgColor, 30);

    // Outer white removed
    expect(pixels.data[(0 * 10 + 0) * 4 + 3]).toBe(0);

    // Trapped interior white at (5,5) is NOT removed — flood fill can't reach it
    expect(pixels.data[(5 * 10 + 5) * 4 + 3]).toBe(255);
  });

  it('removeEnclosedBackground removes trapped interior white after edge fill', () => {
    const pixels = makeLetterOPixels();
    const bgColor: [number, number, number] = [255, 255, 255];

    // Pass 1: edge flood fill
    floodFillFromEdges(pixels, bgColor, 30);
    // Pass 1b: enclosed region cleanup
    removeEnclosedBackground(pixels, bgColor, 30);

    // Outer white removed
    expect(pixels.data[(0 * 10 + 0) * 4 + 3]).toBe(0);

    // Trapped interior white now also removed
    expect(pixels.data[(5 * 10 + 5) * 4 + 3]).toBe(0);

    // Black frame preserved
    expect(pixels.data[(1 * 10 + 1) * 4 + 3]).toBe(255);
    expect(pixels.data[(4 * 10 + 1) * 4 + 3]).toBe(255);

    // Count remaining opaque pixels: black frame only
    let opaqueCount = 0;
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i + 3] > 0) opaqueCount++;
    }
    // 8x8 frame: top row (8) + bottom row (8) + left col excl corners (6) + right col excl corners (6) = 28
    expect(opaqueCount).toBe(28);
  });
});

describe('transparent-bg PNG: black content on already-transparent background', () => {
  // Simulates a PNG exported from SVG with transparent background (like L'Oréal_logo.svg.png).
  // The edge pixels are transparent (alpha=0). The content is black text touching the edges.
  // The algorithm must NOT treat the content as "background" and remove it.
  //
  //   20x8 layout (T = transparent, B = black text, G = gray AA):
  //   TTTTTTTTTTTTTTTTTTTT
  //   TGBBBBBBBBBBBBBBBBGT   (text extends close to edges)
  //   TGBBBBBBBBBBBBBBBBGT
  //   TGBBBBBBBBBBBBBBBBGT
  //   TGBBBBBBBBBBBBBBBBGT
  //   TGBBBBBBBBBBBBBBBBGT
  //   TGBBBBBBBBBBBBBBBBGT
  //   TTTTTTTTTTTTTTTTTTTT

  function makeTransparentBgPixels(): PixelData {
    return makePixels(20, 8, (x, y) => {
      // Transparent border (already-removed background)
      if (x === 0 || x === 19 || y === 0 || y === 7) return [0, 0, 0, 0];
      // Gray AA ring
      if (x === 1 || x === 18) return [40, 40, 40, 128]; // semi-transparent AA
      // Black text content
      return [5, 5, 5, 255];
    });
  }

  it('detects that edges are already transparent and skips edge flood fill', () => {
    const pixels = makeTransparentBgPixels();
    const edgeSamples = sampleImageEdges(pixels);
    // All edge pixels are transparent → 0 samples
    expect(edgeSamples.length).toBe(0);
  });

  it('preserves all content when background is already transparent', () => {
    const pixels = makeTransparentBgPixels();
    const tolerance = 40;
    const minEdgeRatio = 0.3;

    // Replicate the removeBackground pipeline logic
    const edgeSamples = sampleImageEdges(pixels);
    const totalEdgePixels = 2 * pixels.width + 2 * Math.max(0, pixels.height - 2);
    const opaqueEdgeRatio = edgeSamples.length / totalEdgePixels;

    // Most edges are transparent → skip edge flood fill
    expect(opaqueEdgeRatio).toBeLessThan(0.5);

    let bgColor: [number, number, number] | null = null;
    if (opaqueEdgeRatio >= 0.5) {
      bgColor = findDominantColor(edgeSamples, minEdgeRatio, tolerance);
    }
    expect(bgColor).toBeNull();

    // No edge flood fill or enclosed bg removal needed
    // Inner passes should also preserve the content
    for (let pass = 0; pass < 3; pass++) {
      const boundarySamples = sampleTransparencyBoundary(pixels);
      const innerColor = findDominantColor(boundarySamples, minEdgeRatio, tolerance);
      if (innerColor === null) break;

      let opaqueCount = 0;
      let matchCount = 0;
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (pixels.data[i + 3] > 0) {
          opaqueCount++;
          if (colorDistance(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2], innerColor[0], innerColor[1], innerColor[2]) <= tolerance) {
            matchCount++;
          }
        }
      }
      if (opaqueCount === 0 || matchCount / opaqueCount > 0.9) break;

      // Safety 1b
      if (matchCount / opaqueCount > 0.4) {
        const nmBoundaryFrac = nonMatchingBoundaryFraction(pixels, innerColor, tolerance);
        if (nmBoundaryFrac > 0.5) break;
      }

      // Safety 2
      let boundaryMatching = 0;
      for (const [r, g, b] of boundarySamples) {
        if (colorDistance(r, g, b, innerColor[0], innerColor[1], innerColor[2]) <= tolerance) {
          boundaryMatching++;
        }
      }
      if (matchCount > 0 && boundaryMatching / matchCount > 0.7) break;

      const removed = removeMatchingPixels(pixels, innerColor, tolerance);
      if (removed === 0) break;
    }

    // Count remaining opaque pixels — all content must be preserved
    let opaqueAfter = 0;
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i + 3] > 0) opaqueAfter++;
    }

    // 16*6 = 96 black + 2*6 = 12 gray AA = 108 total content pixels
    expect(opaqueAfter).toBe(108);
  });
});

describe('L\'Oréal-style: black text on white, foreground must not be removed', () => {
  // Simulates a logo with black text (including anti-aliased gray edges) on white.
  // After background removal, all black/gray text content must be preserved.
  //
  //   10x10 layout:
  //   WWWWWWWWWW    W = white background
  //   WGGG██GGGW    G = gray anti-alias, █ = black core
  //   WG██████GW
  //   W████WW██W    W inside = trapped white (like inside 'O')
  //   W████WW██W
  //   WG██████GW
  //   WGGG██GGGW
  //   WWWWWWWWWW

  function makeLorealPixels(): PixelData {
    return makePixels(10, 10, (x, y) => {
      // Outer white background (rows 0, 7-9 and cols 0, 9)
      if (y <= 0 || y >= 7 || x === 0 || x === 9) return [255, 255, 255, 255];

      // Trapped white inside "letter" at (4,3), (5,3), (4,4), (5,4)
      if ((x === 4 || x === 5) && (y === 3 || y === 4)) return [255, 255, 255, 255];

      // Gray anti-aliased edges (ring around the text)
      if (y === 1 || y === 6) {
        if (x <= 3 || x >= 6) return [160, 160, 160, 255]; // gray
      }
      if ((x === 1 || x === 8) && y >= 2 && y <= 5) return [160, 160, 160, 255];

      // Black core text
      return [10, 10, 10, 255];
    });
  }

  it('preserves all foreground content (black + gray anti-alias)', () => {
    const pixels = makeLorealPixels();
    const tolerance = 40;
    const minEdgeRatio = 0.3;

    // Pass 1: edge flood fill
    const bgColor = detectBackgroundColor(pixels, minEdgeRatio, tolerance)!;
    expect(bgColor).not.toBeNull();
    floodFillFromEdges(pixels, bgColor, tolerance);

    // Pass 1b: enclosed region cleanup
    removeEnclosedBackground(pixels, bgColor, tolerance);

    // Pass 2+: inner passes with both safety checks (same logic as removeBackground)
    for (let pass = 0; pass < 3; pass++) {
      const boundarySamples = sampleTransparencyBoundary(pixels);
      const innerColor = findDominantColor(boundarySamples, minEdgeRatio, tolerance);
      if (innerColor === null) break;

      // Safety 1: foreground ratio check
      let opaque = 0;
      let matching = 0;
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (pixels.data[i + 3] > 0) {
          opaque++;
          if (colorDistance(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2], innerColor[0], innerColor[1], innerColor[2]) <= tolerance) {
            matching++;
          }
        }
      }
      if (opaque === 0 || matching / opaque > 0.9) break;

      // Safety 2: boundary ratio check — if most matching pixels are at the boundary,
      // they're anti-aliased edges, not a background layer
      let boundaryMatching = 0;
      for (const [r, g, b] of boundarySamples) {
        if (colorDistance(r, g, b, innerColor[0], innerColor[1], innerColor[2]) <= tolerance) {
          boundaryMatching++;
        }
      }
      if (matching > 0 && boundaryMatching / matching > 0.7) break;

      const removed = removeMatchingPixels(pixels, innerColor, tolerance);
      if (removed === 0) break;
    }

    // Black core pixels must be preserved
    expect(pixels.data[(3 * 10 + 2) * 4 + 3]).toBe(255); // black core
    expect(pixels.data[(4 * 10 + 6) * 4 + 3]).toBe(255); // black core

    // Gray anti-alias pixels must be preserved
    expect(pixels.data[(1 * 10 + 1) * 4 + 3]).toBe(255); // gray edge

    // Outer white must be removed
    expect(pixels.data[(0 * 10 + 0) * 4 + 3]).toBe(0);

    // Trapped white inside letter must be removed
    expect(pixels.data[(3 * 10 + 4) * 4 + 3]).toBe(0);
    expect(pixels.data[(4 * 10 + 5) * 4 + 3]).toBe(0);

    // Count remaining — should be significant (all the foreground text)
    let opaqueCount = 0;
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i + 3] > 0) opaqueCount++;
    }
    expect(opaqueCount).toBeGreaterThan(20);
  });
});

describe('nonMatchingBoundaryFraction', () => {
  it('returns 1.0 when all non-matching pixels are at transparency boundary', () => {
    // 8x6: transparent border, black core, gray AA ring adjacent to transparent
    const pixels = makePixels(8, 6, (x, y) => {
      if (x === 0 || x === 7 || y === 0 || y === 5) return [0, 0, 0, 0];
      if (y === 1 || y === 4 || x === 1 || x === 6) return [80, 80, 80, 255]; // gray ring
      return [5, 5, 5, 255]; // black core
    });
    // Gray (80,80,80) distance from (5,5,5) = sqrt(3*75^2) ≈ 129.9 > 40 → non-matching
    // All gray pixels are adjacent to the transparent border
    const result = nonMatchingBoundaryFraction(pixels, [5, 5, 5], 40);
    expect(result).toBe(1.0);
  });

  it('returns 0 when no non-matching pixels are at transparency boundary', () => {
    // 12x10: transparent border, blue panel, black text in center (surrounded by blue)
    const pixels = makePixels(12, 10, (x, y) => {
      if (x === 0 || x === 11 || y === 0 || y === 9) return [0, 0, 0, 0];
      if (x >= 4 && x <= 7 && y >= 3 && y <= 6) return [5, 5, 5, 255]; // black text
      return [30, 60, 180, 255]; // blue panel
    });
    // Black text is surrounded by blue, NOT adjacent to transparent
    const result = nonMatchingBoundaryFraction(pixels, [30, 60, 180], 40);
    expect(result).toBe(0);
  });

  it('returns 0 when there are no non-matching pixels', () => {
    const pixels = makePixels(4, 4, () => [100, 100, 100, 255]);
    expect(nonMatchingBoundaryFraction(pixels, [100, 100, 100], 40)).toBe(0);
  });

  it('returns fraction for mixed scenario', () => {
    // 12x8: transparent border, blue panel, black text in two locations
    const pixels = makePixels(12, 8, (x, y) => {
      if (x === 0 || x === 11 || y === 0 || y === 7) return [0, 0, 0, 0];
      // Black text at bottom row (y=6), adjacent to transparent y=7
      if (y === 6 && x >= 2 && x <= 5) return [5, 5, 5, 255];
      // Black text in deep interior (y=3), NOT adjacent to transparent
      if (y === 3 && x >= 4 && x <= 7) return [5, 5, 5, 255];
      return [30, 60, 180, 255]; // blue
    });
    // Non-matching (black): 4 at bottom (adjacent to transparent) + 4 in interior (not adjacent) = 8 total
    // At boundary: 4/8 = 0.5
    const result = nonMatchingBoundaryFraction(pixels, [30, 60, 180], 40);
    expect(result).toBe(0.5);
  });
});

describe('text-only logo: Safety 1b prevents foreground removal', () => {
  // Simulates a text-only logo (like L'ORÉAL) where after white background removal,
  // thick black text with thin gray anti-aliased edges remains. The match ratio is
  // 0.8-0.9, slipping past Safety 1 (>0.9). Safety 1b detects that non-matching
  // pixels are just AA edges and prevents removal.
  //
  // Layout (20x10):
  //   WWWWWWWWWWWWWWWWWWWW   W = white (removed by edge flood fill → transparent)
  //   WG██████████████████GW  G = gray AA (50,50,50), █ = black text (5,5,5)
  //   WG██████████████████GW
  //   WG██████████████████GW
  //   WG██████████████████GW
  //   WG██████████████████GW
  //   WG██████████████████GW
  //   WG██████████████████GW
  //   WG██████████████████GW
  //   WWWWWWWWWWWWWWWWWWWW

  function makeTextOnlyPixels(): PixelData {
    return makePixels(20, 10, (x, y) => {
      if (x === 0 || x === 19 || y === 0 || y === 9) return [255, 255, 255, 255];
      // Gray AA at left/right edge of text
      if (x === 1 || x === 18) return [50, 50, 50, 255];
      // Black core text
      return [5, 5, 5, 255];
    });
  }

  it('preserves text when match ratio is 0.8-0.9 and non-matching is AA edges', () => {
    const pixels = makeTextOnlyPixels();
    const tolerance = 40;
    const minEdgeRatio = 0.3;

    // Pass 1: remove white background
    const bgColor = detectBackgroundColor(pixels, minEdgeRatio, tolerance)!;
    expect(bgColor).not.toBeNull();
    floodFillFromEdges(pixels, bgColor, tolerance);
    removeEnclosedBackground(pixels, bgColor, tolerance);

    // Count opaque after white removal
    let totalOpaque = 0;
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i + 3] > 0) totalOpaque++;
    }
    // Interior: 18*8 = 144 pixels (16 gray + 128 black)
    expect(totalOpaque).toBe(144);

    // Pass 2+: inner passes with ALL safety checks (same as removeBackground)
    for (let pass = 0; pass < 3; pass++) {
      const boundarySamples = sampleTransparencyBoundary(pixels);
      const innerColor = findDominantColor(boundarySamples, minEdgeRatio, tolerance);
      if (innerColor === null) break;

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
            const pixIdx = i / 4;
            const px = pixIdx % pixels.width;
            const py = (pixIdx - px) / pixels.width;
            if (px < matchMinX) matchMinX = px;
            if (px > matchMaxX) matchMaxX = px;
            if (py < matchMinY) matchMinY = py;
            if (py > matchMaxY) matchMaxY = py;
          }
        }
      }
      if (opaqueCount === 0 || matchCount / opaqueCount > 0.9) break;

      // Safety 1b: AA edge check
      if (matchCount / opaqueCount > 0.4) {
        const nmBoundaryFrac = nonMatchingBoundaryFraction(pixels, innerColor, tolerance);
        if (nmBoundaryFrac > 0.5) break;
      }

      let boundaryMatching = 0;
      for (const [r, g, b] of boundarySamples) {
        if (colorDistance(r, g, b, innerColor[0], innerColor[1], innerColor[2]) <= tolerance) {
          boundaryMatching++;
        }
      }
      if (matchCount > 0 && boundaryMatching / matchCount > 0.7) break;

      const bboxArea = (matchMaxX - matchMinX + 1) * (matchMaxY - matchMinY + 1);
      if (bboxArea > 0 && matchCount / bboxArea < 0.45) break;

      const largestFraction = largestMatchingComponentFraction(pixels, innerColor, tolerance, matchCount);
      if (largestFraction < 0.8) break;

      const removed = removeMatchingPixels(pixels, innerColor, tolerance);
      if (removed === 0) break;
    }

    // Black core text must be preserved
    expect(pixels.data[(5 * 20 + 10) * 4 + 3]).toBe(255);
    expect(pixels.data[(3 * 20 + 5) * 4 + 3]).toBe(255);

    // Gray AA pixels should still be opaque (or removed — either is OK since they're edges)
    // The key assertion: the bulk of content is NOT wiped
    let opaqueAfter = 0;
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i + 3] > 0) opaqueAfter++;
    }
    // At minimum, the 128 black core pixels must survive
    expect(opaqueAfter).toBeGreaterThanOrEqual(128);
  });
});

describe('largestMatchingComponentFraction', () => {
  it('returns 1.0 for a single contiguous region', () => {
    // 5x5: one 3x3 red block in center, rest transparent
    const pixels = makePixels(5, 5, (x, y) => {
      if (x >= 1 && x <= 3 && y >= 1 && y <= 3) return [200, 30, 30, 255];
      return [0, 0, 0, 0];
    });
    const result = largestMatchingComponentFraction(pixels, [200, 30, 30], 40, 9);
    expect(result).toBe(1.0);
  });

  it('returns fraction < 1.0 for multiple disconnected components', () => {
    // 10x5: two 3x3 red blocks separated by a gap
    const pixels = makePixels(10, 5, (x, y) => {
      if (y >= 1 && y <= 3 && ((x >= 1 && x <= 3) || (x >= 6 && x <= 8))) return [200, 30, 30, 255];
      return [0, 0, 0, 0];
    });
    // Each block = 9 pixels, total = 18. Largest = 9/18 = 0.5
    const result = largestMatchingComponentFraction(pixels, [200, 30, 30], 40, 18);
    expect(result).toBe(0.5);
  });

  it('returns 0 when no matching pixels', () => {
    const pixels = makePixels(5, 5, () => [0, 0, 0, 0]);
    expect(largestMatchingComponentFraction(pixels, [200, 30, 30], 40, 0)).toBe(0);
  });

  it('ignores non-matching opaque pixels', () => {
    // 7x3: one red block + one dark block (different color, not matching)
    const pixels = makePixels(7, 3, x => {
      if (x >= 0 && x <= 2) return [200, 30, 30, 255]; // red
      if (x >= 4 && x <= 6) return [30, 30, 30, 255]; // dark, not matching
      return [0, 0, 0, 0];
    });
    // Only red pixels (9) match. They form 1 component → 1.0
    const result = largestMatchingComponentFraction(pixels, [200, 30, 30], 40, 9);
    expect(result).toBe(1.0);
  });
});

describe('compact multi-component text: Safety 4 catches what fill ratio misses', () => {
  // Simulates compact ALL CAPS text (like "L'ORÉAL") where letters are wide/thick
  // enough that fill ratio is above 0.45, but they form multiple separate components.
  //
  //   Layout (24x10):
  //   WWWWWWWWWWWWWWWWWWWWWWWW
  //   WRRRRR WW RRRRRWW RRRRRW   R = red (200,30,30) "letter" blocks (5x8 each)
  //   WRRRRR WW RRRRRWW RRRRRW
  //   WRRRRR WW RRRRRWW RRRRRW
  //   WRRRRRDDWWRRRRRWW RRRRRW   D = dark (30,30,30) non-matching content
  //   WRRRRRDDWWRRRRRWW RRRRRW
  //   WRRRRR WW RRRRRWW RRRRRW
  //   WRRRRR WW RRRRRWW RRRRRW
  //   WRRRRR WW RRRRRWW RRRRRW
  //   WWWWWWWWWWWWWWWWWWWWWWWW

  function makeCompactTextPixels(): PixelData {
    return makePixels(24, 10, (x, y) => {
      if (x === 0 || x === 23 || y === 0 || y === 9) return [255, 255, 255, 255];
      // Dark content at x=7-8, y=4-5
      if (x >= 7 && x <= 8 && y >= 4 && y <= 5) return [30, 30, 30, 255];
      // Red blocks: x=1-5, x=10-14, x=18-22, y=1-8
      if (y >= 1 && y <= 8 && ((x >= 1 && x <= 5) || (x >= 10 && x <= 14) || (x >= 18 && x <= 22))) {
        return [200, 30, 30, 255];
      }
      return [255, 255, 255, 255];
    });
  }

  it('preserves compact text via component fragmentation check', () => {
    const pixels = makeCompactTextPixels();
    const tolerance = 40;
    const minEdgeRatio = 0.3;

    // Pass 1: remove white outer background
    const bgColor = detectBackgroundColor(pixels, minEdgeRatio, tolerance)!;
    expect(bgColor).not.toBeNull();
    floodFillFromEdges(pixels, bgColor, tolerance);
    removeEnclosedBackground(pixels, bgColor, tolerance);

    // Verify fill ratio is ABOVE 0.45 (Safety 3 won't catch it)
    // Red bounding box: x=1-22, y=1-8 → 22*8=176. Red pixels: 3*5*8=120. Fill: 120/176=0.68
    // So Safety 3 passes and we need Safety 4 (component analysis).

    for (let pass = 0; pass < 3; pass++) {
      const boundarySamples = sampleTransparencyBoundary(pixels);
      const innerColor = findDominantColor(boundarySamples, minEdgeRatio, tolerance);
      if (innerColor === null) break;

      let opaque = 0;
      let matching = 0;
      let minX = pixels.width;
      let maxX = 0;
      let minY = pixels.height;
      let maxY = 0;
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (pixels.data[i + 3] > 0) {
          opaque++;
          if (colorDistance(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2], innerColor[0], innerColor[1], innerColor[2]) <= tolerance) {
            matching++;
            const px = (i / 4) % pixels.width;
            const py = Math.floor((i / 4) / pixels.width);
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }
        }
      }
      if (opaque === 0 || matching / opaque > 0.9) break;

      let boundaryMatching = 0;
      for (const [r, g, b] of boundarySamples) {
        if (colorDistance(r, g, b, innerColor[0], innerColor[1], innerColor[2]) <= tolerance) {
          boundaryMatching++;
        }
      }
      if (matching > 0 && boundaryMatching / matching > 0.7) break;

      // Safety 3: fill ratio
      const bboxArea = (maxX - minX + 1) * (maxY - minY + 1);
      if (bboxArea > 0 && matching / bboxArea < 0.45) break;

      // Safety 4: component fragmentation
      const largestFraction = largestMatchingComponentFraction(pixels, innerColor, tolerance, matching);
      if (largestFraction < 0.8) break;

      const removed = removeMatchingPixels(pixels, innerColor, tolerance);
      if (removed === 0) break;
    }

    // Red blocks must be preserved
    expect(pixels.data[(3 * 24 + 3) * 4 + 3]).toBe(255);
    expect(pixels.data[(5 * 24 + 12) * 4 + 3]).toBe(255);
    expect(pixels.data[(2 * 24 + 20) * 4 + 3]).toBe(255);

    // Dark content must be preserved
    expect(pixels.data[(4 * 24 + 7) * 4 + 3]).toBe(255);

    // White background must be removed
    expect(pixels.data[(0 * 24 + 0) * 4 + 3]).toBe(0);

    // Total: 120 red + 4 dark = 124 opaque pixels preserved
    let opaqueCount = 0;
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i + 3] > 0) opaqueCount++;
    }
    expect(opaqueCount).toBe(124);
  });
});

describe('colored text on white: inner pass must not remove foreground', () => {
  // Simulates a logo like Viebrockhaus: colored (red) text + dark text on white.
  // After white bg removal, the inner pass detects red as the dominant boundary color.
  // Safety 3 (spatial compactness) must prevent removal because the red "letter strokes"
  // are sparsely distributed within their bounding box (fill ratio < 0.5).
  //
  //   Layout (32x12):
  //   WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW
  //   WWRRRRWWWWWWWWRRRRWWWWWWWWRRRRWW   R = red (200,30,30), simulated letter strokes
  //   WWRRRRWWWWWWWWRRRRWWWWWWWWRRRRWW
  //   WWRRRRWWWWWWWWRRRRWWWWWWWWRRRRWW
  //   WWRRRRWWWWWWWWRRRRWWWWWWWWRRRRWW
  //   WWRRRRWWWWWWWWRRRRWWWWWWWWRRRRWW
  //   WWRRRRWWWWWWWWRRRRWWWWWWWWRRRRWW
  //   WWWWWWWWDDDDDDDDDDDDDDDDWWWWWW   D = dark (30,30,30)
  //   WWWWWWWWDDDDDDDDDDDDDDDDWWWWWW
  //   WWWWWWWWDDDDDDDDDDDDDDDDWWWWWW
  //   WWWWWWWWDDDDDDDDDDDDDDDDWWWWWW
  //   WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW

  function makeColoredTextPixels(): PixelData {
    return makePixels(32, 12, (x, y) => {
      if (x <= 1 || x >= 30 || y === 0 || y === 11) return [255, 255, 255, 255];
      if (y >= 7 && y <= 10 && x >= 8 && x <= 23) return [30, 30, 30, 255];
      if (y >= 1 && y <= 6 && ((x >= 2 && x <= 5) || (x >= 14 && x <= 17) || (x >= 26 && x <= 29))) {
        return [200, 30, 30, 255];
      }
      return [255, 255, 255, 255];
    });
  }

  it('preserves colored text with sparse spatial distribution', () => {
    const pixels = makeColoredTextPixels();
    const tolerance = 40;
    const minEdgeRatio = 0.3;

    // Pass 1: remove white outer background
    const bgColor = detectBackgroundColor(pixels, minEdgeRatio, tolerance)!;
    expect(bgColor).not.toBeNull();
    floodFillFromEdges(pixels, bgColor, tolerance);

    // Pass 1b: remove enclosed bg regions
    removeEnclosedBackground(pixels, bgColor, tolerance);

    // Pass 2+: inner passes with all safety checks (mirrors removeBackground logic)
    for (let pass = 0; pass < 3; pass++) {
      const boundarySamples = sampleTransparencyBoundary(pixels);
      const innerColor = findDominantColor(boundarySamples, minEdgeRatio, tolerance);
      if (innerColor === null) break;

      let opaque = 0;
      let matching = 0;
      let minX = pixels.width;
      let maxX = 0;
      let minY = pixels.height;
      let maxY = 0;
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (pixels.data[i + 3] > 0) {
          opaque++;
          if (colorDistance(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2], innerColor[0], innerColor[1], innerColor[2]) <= tolerance) {
            matching++;
            const px = (i / 4) % pixels.width;
            const py = Math.floor((i / 4) / pixels.width);
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }
        }
      }
      if (opaque === 0 || matching / opaque > 0.9) break;

      let boundaryMatching = 0;
      for (const [r, g, b] of boundarySamples) {
        if (colorDistance(r, g, b, innerColor[0], innerColor[1], innerColor[2]) <= tolerance) {
          boundaryMatching++;
        }
      }
      if (matching > 0 && boundaryMatching / matching > 0.7) break;

      // Safety 3: spatial compactness check (fill ratio in bounding box)
      const bboxArea = (maxX - minX + 1) * (maxY - minY + 1);
      if (bboxArea > 0 && matching / bboxArea < 0.45) break;

      const removed = removeMatchingPixels(pixels, innerColor, tolerance);
      if (removed === 0) break;
    }

    // Red text must be preserved
    expect(pixels.data[(3 * 32 + 3) * 4 + 3]).toBe(255);
    expect(pixels.data[(2 * 32 + 15) * 4 + 3]).toBe(255);
    expect(pixels.data[(4 * 32 + 27) * 4 + 3]).toBe(255);

    // Dark text must be preserved
    expect(pixels.data[(8 * 32 + 15) * 4 + 3]).toBe(255);

    // White background must be removed
    expect(pixels.data[(0 * 32 + 0) * 4 + 3]).toBe(0);
    expect(pixels.data[(3 * 32 + 10) * 4 + 3]).toBe(0);

    // All foreground pixels should remain: 72 red + 64 dark = 136
    let opaqueCount = 0;
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i + 3] > 0) opaqueCount++;
    }
    expect(opaqueCount).toBe(136);
  });
});

describe('findOpaqueBoundingBox', () => {
  it('returns null for fully transparent image', () => {
    const pixels = makePixels(5, 5, () => [0, 0, 0, 0]);
    expect(findOpaqueBoundingBox(pixels)).toBeNull();
  });

  it('finds single opaque pixel', () => {
    const pixels = makePixels(5, 5, (x, y) => {
      return x === 2 && y === 3 ? [255, 0, 0, 255] : [0, 0, 0, 0];
    });
    expect(findOpaqueBoundingBox(pixels)).toEqual([2, 3, 2, 3]);
  });

  it('finds rectangle of opaque pixels', () => {
    const pixels = makePixels(10, 10, (x, y) => {
      return x >= 2 && x <= 6 && y >= 1 && y <= 4 ? [255, 0, 0, 255] : [0, 0, 0, 0];
    });
    expect(findOpaqueBoundingBox(pixels)).toEqual([2, 1, 6, 4]);
  });

  it('finds L-shaped opaque region', () => {
    const pixels = makePixels(8, 8, (x, y) => {
      // Vertical bar at x=1, y=1-5 and horizontal bar at y=5, x=1-5
      if (x === 1 && y >= 1 && y <= 5) return [255, 0, 0, 255];
      if (y === 5 && x >= 1 && x <= 5) return [255, 0, 0, 255];
      return [0, 0, 0, 0];
    });
    expect(findOpaqueBoundingBox(pixels)).toEqual([1, 1, 5, 5]);
  });

  it('returns full canvas bounds when all pixels are opaque', () => {
    const pixels = makePixels(4, 3, () => [128, 128, 128, 255]);
    expect(findOpaqueBoundingBox(pixels)).toEqual([0, 0, 3, 2]);
  });

  it('respects alpha threshold', () => {
    // All pixels have alpha=100, only one pixel has alpha=200
    const pixels = makePixels(5, 5, (x, y) => {
      return x === 3 && y === 1 ? [255, 0, 0, 200] : [128, 128, 128, 100];
    });
    // With threshold 0, all pixels count
    expect(findOpaqueBoundingBox(pixels, 0)).toEqual([0, 0, 4, 4]);
    // With threshold 150, only the high-alpha pixel counts
    expect(findOpaqueBoundingBox(pixels, 150)).toEqual([3, 1, 3, 1]);
    // With threshold 200, no pixels exceed threshold
    expect(findOpaqueBoundingBox(pixels, 200)).toBeNull();
  });
});

describe('removeBackground', () => {
  let originalCreateElement: typeof document.createElement;
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;
  let originalImage: typeof globalThis.Image;

  beforeEach(() => {
    originalCreateElement = document.createElement;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    originalImage = globalThis.Image;
  });

  afterEach(() => {
    document.createElement = originalCreateElement;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    globalThis.Image = originalImage;
  });

  it('returns blob and dataUrl on success', async () => {
    const mockImageData = {
      data: new Uint8ClampedArray(4 * 4 * 4).fill(255), // 4x4 all white
      width: 4,
      height: 4,
    };
    const mockBlob = new Blob(['png'], { type: 'image/png' });

    const mockCtx = {
      drawImage: jest.fn(),
      getImageData: jest.fn(() => mockImageData),
      putImageData: jest.fn(),
    };
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: jest.fn(() => mockCtx),
      toBlob: jest.fn((cb: (b: Blob | null) => void) => cb(mockBlob)),
      toDataURL: jest.fn(() => 'data:image/png;base64,abc'),
    };

    document.createElement = jest.fn((tag: string) => {
      if (tag === 'canvas') return mockCanvas as unknown as HTMLCanvasElement;
      return originalCreateElement.call(document, tag);
    });

    URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = jest.fn();

    globalThis.Image = jest.fn(() => {
      const img = { onload: null as (() => void) | null, onerror: null as (() => void) | null, src: '', naturalWidth: 4, naturalHeight: 4 };
      setTimeout(() => img.onload?.(), 0);
      return img;
    }) as unknown as typeof Image;

    const source = new File(['test'], 'test.png', { type: 'image/png' });
    const result = await removeBackground(source);

    expect(result.blob).toBe(mockBlob);
    expect(result.dataUrl).toBe('data:image/png;base64,abc');
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    expect(mockCtx.drawImage).toHaveBeenCalled();
    expect(mockCtx.putImageData).toHaveBeenCalled();
  });

  it('throws on image load failure', async () => {
    URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = jest.fn();

    globalThis.Image = jest.fn(() => {
      const img = { onload: null as (() => void) | null, onerror: null as (() => void) | null, src: '' };
      setTimeout(() => img.onerror?.(), 0);
      return img;
    }) as unknown as typeof Image;

    const source = new File(['test'], 'test.png', { type: 'image/png' });
    await expect(removeBackground(source)).rejects.toThrow('Failed to load image');
  });

  it('throws when no dominant background color detected', async () => {
    // Create pixel data where every pixel has a wildly different color
    const size = 4;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      data[i * 4] = (i * 73) % 256;
      data[i * 4 + 1] = (i * 137) % 256;
      data[i * 4 + 2] = (i * 199) % 256;
      data[i * 4 + 3] = 255;
    }

    const mockCtx = {
      drawImage: jest.fn(),
      getImageData: jest.fn(() => ({ data, width: size, height: size })),
      putImageData: jest.fn(),
    };
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: jest.fn(() => mockCtx),
      toBlob: jest.fn(),
      toDataURL: jest.fn(),
    };

    document.createElement = jest.fn((tag: string) => {
      if (tag === 'canvas') return mockCanvas as unknown as HTMLCanvasElement;
      return originalCreateElement.call(document, tag);
    });

    URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = jest.fn();

    globalThis.Image = jest.fn(() => {
      const img = { onload: null as (() => void) | null, onerror: null as (() => void) | null, src: '', naturalWidth: size, naturalHeight: size };
      setTimeout(() => img.onload?.(), 0);
      return img;
    }) as unknown as typeof Image;

    const source = new File(['test'], 'test.png', { type: 'image/png' });
    await expect(removeBackground(source)).rejects.toThrow('No dominant background color detected');
  });
});
