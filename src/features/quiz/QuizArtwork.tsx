import type { Difficulty } from '../../../shared/api/public-quiz';

/** The API may choose a weekly image; null uses the reusable approved garden. */
export function QuizArtwork({ difficulty, desktopPath, mobilePath }: {
  difficulty: Difficulty;
  desktopPath?: string | null;
  mobilePath?: string | null;
}) {
  const base = `/images/garden-v1/${difficulty}`;
  const sizes = '(max-width: 1023px) calc(100vw - 32px), min(100vw - 128px, 1312px)';
  return <picture className="sermon-artwork" aria-hidden="true">
    {mobilePath ? <source media="(max-width: 767px)" srcSet={mobilePath} /> : <>
      <source media="(max-width: 767px)" type="image/avif" srcSet={`${base}-mobile-480.avif 480w, ${base}-mobile-960.avif 960w`} sizes={sizes} />
      <source media="(max-width: 767px)" type="image/webp" srcSet={`${base}-mobile-480.webp 480w, ${base}-mobile-960.webp 960w`} sizes={sizes} />
      <source media="(max-width: 767px)" srcSet={`${base}-mobile-480.jpg 480w, ${base}-mobile-960.jpg 960w`} sizes={sizes} />
    </>}
    {!desktopPath && <>
      <source type="image/avif" srcSet={`${base}-desktop-960.avif 960w, ${base}-desktop-1600.avif 1600w`} sizes={sizes} />
      <source type="image/webp" srcSet={`${base}-desktop-960.webp 960w, ${base}-desktop-1600.webp 1600w`} sizes={sizes} />
    </>}
    <img src={desktopPath ?? `${base}-desktop-960.jpg`} srcSet={desktopPath ? undefined : `${base}-desktop-960.jpg 960w, ${base}-desktop-1600.jpg 1600w`}
      sizes={sizes} width="1600" height="900" fetchPriority="high" alt="" />
  </picture>;
}
