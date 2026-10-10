import type { SkyTime } from "../../../docs/design/phase-9/sky-v2/world.js";

const DAY = 86_400_000;
const KST = 9 * 60 * 60 * 1000;
const radians = Math.PI / 180;
// Seoul, chosen by the user. No geolocation or runtime network requests.
const latitude = 37.5665 * radians;
const longitude = 126.978;

/** NOAA's approximate solar equations; minutes after midnight in Korea.
 * https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 * These are theme boundaries, not weather observations or an almanac service.
 */
export function seoulSolarTimes(now: Date) {
  const korean = new Date(now.getTime() + KST);
  const year = korean.getUTCFullYear();
  const date = Date.UTC(year, korean.getUTCMonth(), korean.getUTCDate());
  const yearStart = Date.UTC(year, 0, 1);
  const daysInYear = (Date.UTC(year + 1, 0, 1) - yearStart) / DAY;
  const dayOfYear = (date - yearStart) / DAY + 1;
  const gamma = 2 * Math.PI / daysInYear * (dayOfYear - 1);
  const equation = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const noon = 720 - 4 * longitude - equation + 540;
  const offset = (altitude: number) => Math.acos((Math.sin(altitude * radians)
    - Math.sin(latitude) * Math.sin(declination)) / (Math.cos(latitude) * Math.cos(declination))) / radians * 4;
  const horizon = offset(-0.833);
  const twilight = offset(-6);
  const daylight = offset(6);
  return { dawn: noon - twilight, sunrise: noon - horizon, day: noon - daylight,
    noon, dusk: noon + daylight, sunset: noon + horizon, night: noon + twilight };
}

export function seoulSkyTime(now = new Date()): SkyTime {
  const korean = new Date(now.getTime() + KST);
  const minute = korean.getUTCHours() * 60 + korean.getUTCMinutes() + korean.getUTCSeconds() / 60;
  const times = seoulSolarTimes(now);
  if (minute < times.dawn || minute >= times.night) return "night";
  if (minute < times.day) return "dawn";
  if (minute < times.dusk) return "day";
  return "dusk";
}
