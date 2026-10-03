# 한글 입력 상태 모델과 native 연결 — Phase 3

핵심 모델은 화면·React·DOM·저장소에 의존하지 않는다. 별도 `native-input.ts`가 실제 브라우저 이벤트와 연결하며 공개 `/`, `/quiz/:slug`와 개발 전용 `/dev/quiz`에서 같은 workspace를 사용한다.

- `grid.ts`: 검증된 `PublicPuzzleGrid`에서 셀·단어 탐색용 geometry만 복사한다.
- `types.ts`: 입력 상태, 명령, DOM 연결 계층에 전달할 결과를 정의한다.
- `controller.ts`: `reduceInput(grid, state, action)`으로 새 상태와 처리 결과를 반환한다.
- `controller.test.ts`: 공개 좌표만 가진 fixture로 입력 이벤트·탐색·수정 회귀를 검사한다.
- `native-input.ts`: 순서가 중요한 브라우저 이벤트를 동기적으로 처리하고 명시적 buffer 변경만 DOM에 반영한다. 조합 중 pointer focus/페이지 전환을 차단하며 cleanup으로 listener를 해제한다.

`createInputGrid`의 검사는 내부 geometry 일관성 검사이지 공개 API Zod schema나 퍼즐 발행 하드 게이트를 대체하지 않는다. API 응답은 `shared/api/public-quiz.ts`에서 strict Zod로 검사한 뒤 `quiz-view.ts`를 거쳐 연결한다. 이 모듈은 공식 정답을 읽거나 채점하지 않는다.

## 단일 실제 입력창 연결 계약

1. 네이티브 input 또는 textarea는 하나만 둔다. 각 시각적 셀에 `maxlength=1` 입력창을 만들지 않는다.
2. `compositionstart`, `compositionupdate`, `compositionend`, `beforeinput`, `input`, `keydown`을 모델의 동명 명령에 연결한다. `input`과 `compositionend`의 `value`는 **실제 입력창 전체 `.value`**다. `event.data` 조각을 누적해서 보내지 않는다. `compositionupdate.text`에는 조합 미리보기 원문을 보낸다.
3. 조합 중에는 `.value`·selection·focus를 수정하지 않는다. `InputEvent.isComposing`, `KeyboardEvent.isComposing`, 조합 중 키 코드 229를 전달한다. 모델은 조합 중 셀 값·선택을 유지하고 raw 미리보기만 바꾼다.
4. 자동 다음 셀 이동은 **시각적 선택만** 이동한다. 입력창 값은 비우지 않는다. 전체 buffer와 고정된 시작 셀을 유지하므로 종료 직전/직후 `input`이 같은 값을 다시 보내도 중복되지 않는다. 연속 `가`, `가가`, `가가가`도 구별된다. NFC는 확정 셀 값에만 적용하며 네이티브 자모 조합은 구현하지 않는다.
5. 결과에 `bufferValue`가 있을 때만 입력창 `.value`를 동기화한다. 이는 의도적인 셀 선택·이동·삭제, 붙여넣기, 무효 확정 입력의 복구에 쓰며 조합 중에는 나오지 않는다. buffer는 React controlled value로 조합 중 강제 렌더링하지 않는다.
6. `selectionIndex`는 현재 단어 안의 셀 인덱스다. DOM caret의 UTF-16 offset이 아니다. 네이티브 caret/선택 범위 관리는 별도 연결 계층의 책임이다.
7. `preventDefault`에 따라 취소 가능한 이벤트만 취소한다. 조합 중 키보드 이벤트는 OS에 맡긴다. 이동·방향 버튼·셀 선택은 조합 중 거부하므로, DOM 포커스도 먼저 이동하지 않게 pointer 동작을 연결해야 한다. 난이도·revision 전환 또한 조합 중 확정을 기다리고 새 grid/state를 만든다.
8. 데스크톱 Backspace는 keydown에서 처리·취소한다. 키 이벤트 없는 모바일은 취소 가능한 `beforeinput(deleteContentBackward)`에서 처리하며, 취소 불가능하면 실제 `input`에서 처리·buffer를 복구한다. 이미 취소한 작업을 별도 수동 input 명령으로 다시 보내지 않는다.
9. 명시적 `paste` 명령은 clipboard text가 있는 paste 이벤트 하나에 연결하고 기본 붙여넣기를 취소한다. 기본 입력 경로를 사용하는 경우에는 `input` 전체 값만 보낸다. 동일 paste를 두 경로에서 각각 실행하지 않는다.

조합 이벤트와 입력 이벤트의 역할은 [UI Events](https://w3c.github.io/uievents/#events-compositionevents), [Input Events](https://w3c.github.io/input-events/#interface-InputEvent)를 참조했다. 단위 테스트는 이 계약의 이벤트 순서를 재현할 뿐, 실제 기기·브라우저 호환성 통과를 의미하지 않는다.

## 동작과 오류

- 확정 입력은 NFC 완성형 한글만 셀에 저장한다. 무효 문자가 섞인 편집은 통째로 거부해 기존 셀을 보존하고 `INVALID_HANGUL_SYLLABLE`을 반환한다. 공백·기호를 자동 제거해 글자 위치를 당기지 않는다.
- 현재 단어에서 남은 칸만 채우고 초과분 수를 `ENTRY_OVERFLOW`로 알린다. 마지막 칸에서는 `ENTRY_END`를 반환하며 다음 단서로 자동 이동하지 않는다. 이 표시는 끝 도달이지 정답 판정이 아니다.
- 방향키는 바로 인접한 활성 셀로만 이동한다. 이동한 셀이 기존 방향의 단어에 속하면 방향을 유지하고, 그렇지 않으면 해당 셀의 단어로 바꾼다.
- Tab/Shift+Tab·모바일 이전/다음은 현재 단어 안에서 이동한다. Tab이 단어 경계에 도달하면 기본 동작을 허용해 격자 밖으로 나갈 수 있게 한다. 실제 focus 순서는 다음 UI 접근성 검사 대상이다.
- 현재 칸이 채워져 있으면 Backspace로 지운다. 비어 있으면 이전 칸으로만 이동하며 이전 글자까지 동시에 지우지 않는다.
- 교차 칸 재선택·방향 명령·Enter는 교차 방향을 바꾼다. 교차가 없는 칸의 Enter는 번호순(동일 번호 가로 우선) 다음 단서로 이동하며 마지막 단서에서는 처음으로 돌아온다.
- 교차 칸은 `cellValues` Map에서 하나의 값만 공유한다. 모델이 반환한 Map을 외부에서 직접 수정하지 않는다.

## 남은 검증

2026-08-31 사용자 보고로 Chrome 기본 세 사례를 확인했다: `값` 한 칸 입력, `갑세` 두 칸 입력, 두 번째 칸 삭제·`자`로 수정 후 F5에서 `갑 | 자` 복구. 정확한 OS/브라우저 버전·IME는 미수집이며 이 기록은 전체 실기기 행렬 통과가 아니다.

React/native DOM 연결, raw composition 투영, 난이도 전환 보호, local draft, 진행률, 입력 형식 확인, 모바일 toolbar·visualViewport 보정을 개발 시험 UI에 연결했다. Chromium·mobile Chromium·Firefox에서 합성 이벤트 회귀를 실행했으나 실제 OS IME/clipboard 검사는 아니다.

WebKit은 Linux 시스템 라이브러리 누락으로 실행하지 못했다. 실제 focus·caret·키보드 가림·스크린리더와 IME 행렬은 `implementation.md` 19.4절을 따르며 아직 통과하지 않았다. 좁은 화면은 D-015에 따라 칸을 줄여 전체 격자를 표시한다. 입력/이동 시 가로 scroll 보정은 제거했고 키보드 가림을 위한 세로 보정은 유지한다.
