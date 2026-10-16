// Card stills of DOM replays and traces (D-183): size and production mask geometry.
import { describe, expect, it } from 'vitest';
import { CARD_W, cardSize, maskFills, type MaskRects } from '../lib/capture/card-still';

describe('card still', () => {
  it('scales to the card width and never upscales', () => {
    expect(cardSize(2560, 1600)).toEqual({ w: CARD_W, h: 400, scale: 0.25 });
    expect(cardSize(500, 300)).toEqual({ w: 500, h: 300, scale: 1 });
  });

  it('maps CSS rects of text, fields and media onto card pixels, media first and text bars last', () => {
    const r: MaskRects = {
      viewport: { w: 1280, h: 800 },
      text: [[100, 50, 400, 20]],
      fields: [[100, 100, 300, 40]],
      media: [[0, 200, 1280, 400]],
    };
    const f = maskFills(r, 640);
    expect(f.map((x) => x.kind)).toEqual(['box', 'box', 'bar']);
    expect(f[0]).toEqual({ x: 0, y: 100, w: 640, h: 200, kind: 'box' });
    expect(f[1]).toEqual({ x: 50, y: 50, w: 150, h: 20, kind: 'box' });
    // a text line keeps its length and loses a little height at the top and bottom
    expect(f[2]).toMatchObject({ x: 50, w: 200, kind: 'bar' });
    expect(f[2]!.y).toBeGreaterThanOrEqual(25);
    expect(f[2]!.h).toBeLessThan(10);
    expect(f[2]!.h).toBeGreaterThan(5);
  });
});
