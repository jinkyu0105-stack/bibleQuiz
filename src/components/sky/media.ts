import type { SkyMovie, SkyTime } from "../../../docs/design/phase-9/sky-v2/world.js";

export const skyImages: Record<string, string> = {
  "assets/day.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/day.webp", import.meta.url).href,
  "assets/night.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/night.webp", import.meta.url).href,
  "assets/meadow.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/meadow.webp", import.meta.url).href,
  "assets/mountains.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/mountains.webp", import.meta.url).href,
  "assets/mountains-4k.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/mountains-4k.webp", import.meta.url).href,
  "assets/day-small.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/day-small.webp", import.meta.url).href,
  "assets/night-small.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/night-small.webp", import.meta.url).href,
  "assets/meadow-small.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/meadow-small.webp", import.meta.url).href,
  "assets/cumulus-crown.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/cumulus-crown.webp", import.meta.url).href,
  "assets/cumulus-crown-small.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/cumulus-crown-small.webp", import.meta.url).href,
  "assets/cumulus-tower.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/cumulus-tower.webp", import.meta.url).href,
  "assets/cumulus-tower-small.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/cumulus-tower-small.webp", import.meta.url).href,
  "assets/cumulus-island.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/cumulus-island.webp", import.meta.url).href,
  "assets/cumulus-island-small.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/cumulus-island-small.webp", import.meta.url).href,
  "assets/cumulus-drift.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/cumulus-drift.webp", import.meta.url).href,
  "assets/cumulus-drift-small.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/cumulus-drift-small.webp", import.meta.url).href,
  "assets/cumulus-billow.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/cumulus-billow.webp", import.meta.url).href,
  "assets/cumulus-billow-small.webp": new URL("../../../docs/design/phase-9/sky-v2/assets/cumulus-billow-small.webp", import.meta.url).href,
};

export const skyMovies: Record<SkyTime, SkyMovie> = {
  dawn: {
    desktop: new URL("../../../docs/design/phase-9/sky-v2/assets/video/billowing/sky-dawn-4k.mp4", import.meta.url).href,
    mobile: new URL("../../../docs/design/phase-9/sky-v2/assets/video/billowing/sky-dawn-1080p.mp4", import.meta.url).href,
    poster: new URL("../../../docs/design/phase-9/sky-v2/assets/video/billowing/sky-dawn-poster-4k.webp", import.meta.url).href,
    smallPoster: new URL("../../../docs/design/phase-9/sky-v2/assets/video/billowing/sky-dawn-poster-small.webp", import.meta.url).href,
  },
  day: {
    desktop: new URL("../../../docs/design/phase-9/sky-v2/assets/video/day/sky-day-4k.mp4", import.meta.url).href,
    mobile: new URL("../../../docs/design/phase-9/sky-v2/assets/video/day/sky-day-1080p.mp4", import.meta.url).href,
    poster: new URL("../../../docs/design/phase-9/sky-v2/assets/video/day/sky-day-poster-4k.webp", import.meta.url).href,
    smallPoster: new URL("../../../docs/design/phase-9/sky-v2/assets/video/day/sky-day-poster-small.webp", import.meta.url).href,
  },
  dusk: {
    desktop: new URL("../../../docs/design/phase-9/sky-v2/assets/video/dusk/sky-dusk-4k.mp4", import.meta.url).href,
    mobile: new URL("../../../docs/design/phase-9/sky-v2/assets/video/dusk/sky-dusk-1080p.mp4", import.meta.url).href,
    poster: new URL("../../../docs/design/phase-9/sky-v2/assets/video/dusk/sky-dusk-poster-4k.webp", import.meta.url).href,
    smallPoster: new URL("../../../docs/design/phase-9/sky-v2/assets/video/dusk/sky-dusk-poster-small.webp", import.meta.url).href,
  },
  night: {
    desktop: new URL("../../../docs/design/phase-9/sky-v2/assets/video/night-v2/sky-night-4k-optimized.mp4", import.meta.url).href,
    mobile: new URL("../../../docs/design/phase-9/sky-v2/assets/video/night-v2/sky-night-1080p.mp4", import.meta.url).href,
    poster: new URL("../../../docs/design/phase-9/sky-v2/assets/video/night-v2/sky-night-poster-4k.webp", import.meta.url).href,
    smallPoster: new URL("../../../docs/design/phase-9/sky-v2/assets/video/night-v2/sky-night-poster-small.webp", import.meta.url).href,
  },
};
