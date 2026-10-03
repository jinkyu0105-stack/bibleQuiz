# Phase 7A 이미지 생성 prompt 기록

## 공통 prompt

- use case: `ui-mockup`
- one focused horizontal image per section; 8 sections, 8 separate generations
- concept spine: a quiet living garden, crossword trellis geometry
- palette: Everforest light + Gruvbox dark, moss, muted aqua/sky, restrained brass
- type hierarchy: serif display + rational sans, represented only by blank bars
- signature components: vertical rhythm lines, off-grid editorial layout, layered image crop frames, product UI panel stack
- motion language: cinematic fade-through, gentle parallax or restrained stagger
- no readable text, Korean/Latin letters, numbers, logos, watermark, Bible verses, answer syllables, fake glyphs
- no people or sensitive Bible-scene depictions; no generic religious stock imagery
- opaque interaction panels, accessible contrast, generous whitespace, implementation clarity
- no purple/blue AI gradient, glassmorphism, neon, card spam, fake analytics

## 섹션별 prompt

1. **Adult sermon hero**: full-bleed misty evergreen forest at first dawn, off-grid editorial composition, lower-right opaque metadata panel, left vertical rail, brass trellis.
2. **Child sermon hero**: sophisticated paper-cut and gouache garden path, small lantern and abstract dove shape, lower-center metadata ribbon, right vertical rail, warm but not preschool.
3. **Adult workspace**: Gruvbox dark 60:40 layout, plausible 8×8 crossword, two clue groups, top accessibility controls, bottom progress/save/deadline strip.
4. **Child workspace**: Everforest light 60:40 layout, plausible 7×7 crossword, leaf and sky accents, same functional density as adult track.
5. **Submission result**: result grid with check-corner, x-corner and dotted-empty shapes, submitted/solution comparison bands, summary rail and next actions.
6. **Participation and Top N**: participant cards transition into three elevated winner cards, restrained gold/silver/bronze edges, integrated A4 preview and print action.
7. **Archive**: search and two filters, one large recent item plus smaller chronological cards, separate child/adult controls, pressed-leaf second-read moment.
8. **Admin workflow**: non-technical operations dashboard, one next action first, six-node stepper, grid-placement previews and hard-gate checklist, secondary priority queue.

## 실행 정보

모든 이미지는 built-in `imagegen`으로 새로 생성했고 input reference image나 API/CLI fallback은 사용하지 않았다. 생성 PNG는 이 폴더에 프로젝트 reference로 복사했으며 기본 생성 원본은 Codex generated-images 폴더에 그대로 남겼다.
