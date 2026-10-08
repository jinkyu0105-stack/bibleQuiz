# OriginKit Grass Field 비교 적용

2026-10-08, P9-06. 사용자는 새 하늘 시안에 긍정적으로 응답하고 맨 아래를 [OriginKit Grass Field · base](https://www.originkit.dev/components/grass-field?preset=base)로 시험하도록 요청했다. 마음에 들지 않을 때 기존 모습으로 돌아갈 수 있어야 한다. 실제 앱의 최종 채택/배포와 구분한다.

## 사용한 경로와 코드

실제 사이트를 Playwright로 열어 **Get this component → MCP** 탭을 확인한 뒤, 설치된 OriginKit MCP의 `get_component`를 다음 값으로 호출했다.

```json
{"name":"grass-field","preset":"base","stack":"vite","styling":"css","typescript":true}
```

응답은 React/TypeScript canvas 컴포넌트와 `dependencies: []`, `registryDependencies: []`였다. 설치·결제·새 production 패키지를 추가하지 않았다. Refero MCP와 별개다. 이번 잔디는 새 이미지 생성물이나 CSS로 닮게 만든 대체물이 아니라 **MCP 반환 코드의 잔디/지형 구현을 사용**한다.

원본의 `FIELD_FS`, `HILL_GLSL`, `GROUND_VS`, `BLADE_VS` 네 shader 문자열이 [originkit-grass.js](originkit-grass.js)와 동일함을 대조했다. 원본의 비균일 blade 배치,9개 정점의 풀잎, 로그 간격의 지형, 바람·돌풍과 마우스 ray 계산을 이어받았다. 전체 React 컴포넌트를 수정 없이 설치한 것은 아니다. 현재 독립 HTML 검토본의 기존 하늘에 연결하려고 다음을 조정했다.

- 원본의 불투명 검정 하늘과 React lifecycle 대신 투명 canvas와 기존 `world.js`의 시계·스크롤·멈춤을 사용한다. 별도 애니메이션 루프를 만들지 않는다.
- 원본 base의 검정/형광 초록 색을 네 시간대의 지면/풀끝/원경 색으로 맞춘다. 기본 높이1.81, 바람1, 돌풍0.9, 방향15도, 시간 배수2, 마우스 강도 최대1.2를 유지한다.
- 첫 잔디 초기화 시700px 이하9,000개, 그보다 넓으면24,000개로 제한한다(원본 최대40,000개). DPR1/1.25, 잔디 draw 최대30Hz. 창 크기는 즉시 반영하며 밀도 단계는 새로고침 시 정한다.
- 공개 화면에서 지면에 가까워질 때만 모듈·GPU 자원을 만든다. 기본 사진/풀이/관리자는 잔디 모듈을 요청하지 않는다. 비교로 사진을 선택하면 잔디 그리기를 멈춘다.
- 사용자 멈춤/OS 움직임 감소/숨은 탭을 공유하고 터치 스크롤은 가로채지 않는다. 마우스가 버튼·입력 위에 있으면 반응을 줄인다. 초기화/모듈/WebGL 실패에는 원래 사진을 표시하고 context 복원 때 다시 연결한다.

원본 응답의 로컬 참고본과 실제 MCP 탭 캡처는 Git 제외 `.wrangler/design-references/p9-06-originkit/`에 있다. 줄바꿈을 정규화한 `grass-field-base.tsx`의 SHA256은 `3b549ca44727679741e6b76f78b2370605bf808966e8e1e676da6b15c1ac8d0b`다. 전송 원문 bytes의 해시라고 주장하지 않는다. 소스 주석과 이 문서에 출처를 보존한다.

## 비교와 되돌리기

- [움직이는 잔디에서 열기](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass#ground-controls)
- [기존 사진에서 열기](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=photo#ground-controls)

맨 아래 **기존 사진 / 움직이는 잔디** 버튼으로 같은 스크롤 위치에서 비교한다. 시간대·잔디 선택은 검토본 URL에만 남는다. 앱 설정/저장 데이터에는 쓰지 않는다. 매개변수 없는 원래 주소는 기존 사진이 기본이며 사진·구름·폰트 파일을 덮어쓰지 않았다.

즉시 복귀는 **기존 사진** 버튼이다. 잔디 코드까지 없애기로 결정하면 이번 변경만 담은 로컬 커밋을 식별해 후속 변경과 충돌 여부를 확인한 뒤 `git revert`로 되돌릴 수 있다. 수정 전 기준 커밋은 **8d5752b**다. reset/기존 자산 삭제/운영 배포가 필요하지 않다. 현재는 사용자 비교를 위해 두 안을 보존한다.

## 검증

관련 브라우저 검사와 남은 기기 한계는 [P9-06 작업 문서](../../../work/P9-06.md#originkit-잔디-비교--2026-10-08)에 기록한다. 기존 사진 버전의 Lighthouse 점수를 움직이는 잔디의 성능 점수로 사용하지 않는다.
