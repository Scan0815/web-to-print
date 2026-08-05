import { describe, it, expect } from '@stencil/vitest';
import { createImageThumbnail } from './canvas-helpers';

/** 40x40 blue PNG. */
const SQUARE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAALElEQVR4nO3NsQkAAAjAsP7/tD4huASyp5onYrFYLBaLxWKxWCwWi8Vi8ZkFNsE6Gz5864YAAAAASUVORK5CYII=';

function dimensionsOf(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('thumbnail did not decode'));
    img.src = dataUrl;
  });
}

describe('createImageThumbnail', () => {
  it('downscales to the requested longest side', async () => {
    const thumb = await createImageThumbnail(SQUARE_PNG, 20);
    expect(thumb).not.toBeNull();
    expect(await dimensionsOf(thumb as string)).toEqual({ width: 20, height: 20 });
  });

  it('never upscales a small image', async () => {
    const thumb = await createImageThumbnail(SQUARE_PNG, 120);
    expect(await dimensionsOf(thumb as string)).toEqual({ width: 40, height: 40 });
  });

  it('returns null for an image that cannot be loaded', async () => {
    expect(await createImageThumbnail('http://127.0.0.1:9/never.png', 120)).toBeNull();
  });
});
