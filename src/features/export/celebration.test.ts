/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { exportResponse } from '../../../tests/fixtures/export-response';
import { createPoster } from './render';
import { sceneSvg } from './scene';

describe('P7B shared print illustration', () => {
  it('embeds the transparent master in the free footer area of PDF and PNG scenes', async () => {
    const font = readFileSync('public/fonts/NotoSansKR.ttf');
    const art = readFileSync('public/images/shared/celebration-print.png');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.endsWith('.png') ? art : font)));
    try {
      const result = await createPoster([exportResponse(1)]);
      const scene = result.scenes[0]!;
      expect(scene.celebration).toBeDefined();
      const decoration = scene.celebration!;
      expect(decoration.y).toBeGreaterThanOrEqual(scene.height - 80);
      expect(decoration.y + decoration.height).toBeLessThan(scene.height);
      expect(decoration.x).toBeGreaterThan(400);
      expect(sceneSvg(scene)).toContain('<image href="data:image/png;base64,');
      const pdf = await PDFDocument.load(result.pdf);
      const resources = pdf.getPage(0).node.Resources()!;
      expect(resources.has(PDFName.of('XObject'))).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
});
