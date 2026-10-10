import { useEffect, useLayoutEffect, useRef } from "react";
import { createWorld, type SkyTime, type WorldController } from "../../../docs/design/phase-9/sky-v2/world.js";
import { skyImages, skyMovies } from "./media";
import { readSkyFlag, saveSkyPreference } from "./preferences";

const asset = (path: string) => skyImages[path] ?? path;
export type SkyView = "home" | "quiz" | "admin" | "archive";

export function SkyScene({ time, view }: { time: SkyTime; view: SkyView }) {
  const world = useRef<WorldController | null>(null);
  useLayoutEffect(() => {
    document.body.dataset.view = view;
    document.body.dataset.time = time;
    document.body.dataset.glass = "on";
    document.body.dataset.glassMaterial = "prism";
    document.documentElement.dataset.theme = time === "night" ? "dark" : "light";
    world.current?.setTheme(time);
    world.current?.reset();
  }, [time, view]);
  useEffect(() => {
    const controller = createWorld({ asset, videoMedia: skyMovies,
      initiallyPaused: readSkyFlag("motion-paused"),
      onMotionChange: paused => { saveSkyPreference("motion-paused", String(paused)); },
    });
    world.current = controller;
    controller.setTheme(document.body.dataset.time as SkyTime);
    controller.setGround("grass");
    return () => { controller.dispose(); world.current = null; };
  }, []);
  return <div id="world" aria-hidden="true">
    <div className="atmosphere" />
    <div className="sky-vault">
      {(["day", "night"] as const).map(theme => <picture key={theme}>
        <source media="(max-width: 700px)" srcSet={asset(`assets/${theme}-small.webp`)} />
        <img className={`${theme}-sky`} src={asset(`assets/${theme}.webp`)} alt="" width="1672" height="941" fetchPriority={theme === "day" ? "high" : "auto"} />
      </picture>)}
      <canvas id="sky-banks" hidden />
      <div className="sky-video" hidden><img alt="" width="3840" height="2160" /><video muted playsInline loop preload="none" disablePictureInPicture tabIndex={-1} width="3840" height="2160" hidden /></div>
    </div>
    <div className="sunlight" /><div className="moonlight" />
    <div className="meadow"><picture><source media="(max-width: 700px)" srcSet={asset("assets/meadow-small.webp")} /><img src={asset("assets/meadow.webp")} alt="" width="1672" height="941" /></picture></div>
    <div className="distant-mountains" hidden><img alt="" width="1600" height="900" decoding="async" /></div>
    <canvas id="origin-grass" hidden /><canvas id="clouds" /><div className="world-shade" />
  </div>;
}
