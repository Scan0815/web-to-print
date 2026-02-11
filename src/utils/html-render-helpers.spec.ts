import { computeContainFit, centerOriginToTopLeft, getSvgIntrinsicSize } from './html-render-helpers';

describe('computeContainFit', () => {
  it('scales down a landscape image to fit a square container', () => {
    const { fittedW, fittedH } = computeContainFit(200, 200, 400, 200);
    expect(fittedW).toBe(200);
    expect(fittedH).toBe(100);
  });

  it('scales down a portrait image to fit a square container', () => {
    const { fittedW, fittedH } = computeContainFit(200, 200, 100, 400);
    expect(fittedW).toBe(50);
    expect(fittedH).toBe(200);
  });

  it('returns exact dimensions when image matches container', () => {
    const { fittedW, fittedH } = computeContainFit(300, 200, 300, 200);
    expect(fittedW).toBe(300);
    expect(fittedH).toBe(200);
  });

  it('scales up a small image to fill container', () => {
    const { fittedW, fittedH } = computeContainFit(600, 400, 60, 40);
    expect(fittedW).toBe(600);
    expect(fittedH).toBe(400);
  });

  it('handles landscape container with portrait image', () => {
    const { fittedW, fittedH } = computeContainFit(800, 400, 200, 600);
    // scale = min(800/200, 400/600) = min(4, 0.667) = 0.667
    expect(fittedW).toBeCloseTo(133.33, 1);
    expect(fittedH).toBeCloseTo(400, 1);
  });
});

describe('centerOriginToTopLeft', () => {
  it('converts center position to top-left for a 1:1 scale object', () => {
    const { left, top } = centerOriginToTopLeft({ x: 100, y: 100, scaleX: 1, scaleY: 1, angle: 0 }, 50, 30);
    expect(left).toBe(75); // 100 - 50/2
    expect(top).toBe(85); // 100 - 30/2
  });

  it('uses unscaled dimensions (CSS transform-origin: center)', () => {
    const { left, top } = centerOriginToTopLeft({ x: 200, y: 150, scaleX: 2, scaleY: 3, angle: 0 }, 40, 20);
    // CSS transform-origin: center means the element center is at left + naturalW/2
    // So left = x - naturalW/2, top = y - naturalH/2 (independent of scale)
    expect(left).toBe(180); // 200 - 40/2
    expect(top).toBe(140); // 150 - 20/2
  });

  it('works with fractional scales', () => {
    const { left, top } = centerOriginToTopLeft({ x: 50, y: 50, scaleX: 0.5, scaleY: 0.5, angle: 0 }, 100, 100);
    expect(left).toBe(0);  // 50 - 100/2
    expect(top).toBe(0);   // 50 - 100/2
  });
});

describe('getSvgIntrinsicSize', () => {
  it('returns null for non-SVG data URLs', () => {
    expect(getSvgIntrinsicSize('data:image/png;base64,abc')).toBeNull();
  });

  it('returns null for plain strings', () => {
    expect(getSvgIntrinsicSize('https://example.com/logo.svg')).toBeNull();
  });

  it('extracts size from viewBox in a plain-text SVG data URL', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"></svg>';
    const dataUrl = 'data:image/svg+xml,' + encodeURIComponent(svg);
    const size = getSvgIntrinsicSize(dataUrl);
    expect(size).toEqual({ width: 200, height: 100 });
  });

  it('extracts size from viewBox in a base64 SVG data URL', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"></svg>';
    const dataUrl = 'data:image/svg+xml;base64,' + btoa(svg);
    const size = getSvgIntrinsicSize(dataUrl);
    expect(size).toEqual({ width: 300, height: 150 });
  });

  it('extracts size from width/height attributes when no viewBox', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"></svg>';
    const dataUrl = 'data:image/svg+xml,' + encodeURIComponent(svg);
    const size = getSvgIntrinsicSize(dataUrl);
    expect(size).toEqual({ width: 120, height: 80 });
  });

  it('prefers viewBox over width/height', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 500 250"></svg>';
    const dataUrl = 'data:image/svg+xml,' + encodeURIComponent(svg);
    const size = getSvgIntrinsicSize(dataUrl);
    expect(size).toEqual({ width: 500, height: 250 });
  });

  it('returns null when no dimensions can be determined', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const dataUrl = 'data:image/svg+xml,' + encodeURIComponent(svg);
    expect(getSvgIntrinsicSize(dataUrl)).toBeNull();
  });
});
