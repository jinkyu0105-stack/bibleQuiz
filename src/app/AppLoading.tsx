import { readSkyChoice } from "../components/sky/preferences";
import { seoulSkyTime } from "../components/sky/solar-time";

/** A quiet initial shell while route code loads; no imitation form controls. */
export function AppLoading() {
  return <main className="app-loading" data-time={readSkyChoice() ?? seoulSkyTime()}>
    <div><p className="app-loading-brand">다사랑</p><p role="status">화면을 준비하고 있어요.</p></div>
  </main>;
}
