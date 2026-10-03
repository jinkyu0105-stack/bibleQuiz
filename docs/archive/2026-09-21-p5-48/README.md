# 문서 재구성 전 기록 — 2026-09-21 / P5-48

이 폴더는 당시 제품 명세·결정·현재 상태·인수인계를 잃지 않기 위한 보관소다. **보관 문서의 현재/다음/승인/세션 문구를 현재 지시로 실행하지 않는다.** 재개는 [현재 HANDOFF](../../HANDOFF.md)에서 시작한다.

## 원문과 읽기용 사본

| 당시 문서 | SHA 검증용 원문(바이트 그대로) | 링크 경로를 조정한 읽기용 사본 |
|---|---|---|
| `AGENTS.md` | [원문](original/AGENTS.md.txt) | [읽기](AGENTS.record.md) |
| `README.md` | [원문](original/README.md.txt) | [읽기](README.record.md) |
| `implementation.md` | [원문](original/implementation.md.txt) | [읽기](implementation.md) |
| `docs/PROJECT_CONTEXT.md` | [원문](original/docs/PROJECT_CONTEXT.md.txt) | [읽기](docs/PROJECT_CONTEXT.md) |
| `docs/DECISIONS.md` | [원문](original/docs/DECISIONS.md.txt) | [읽기](docs/DECISIONS.md) |
| `docs/STATUS.md` | [원문](original/docs/STATUS.md.txt) | [읽기](docs/STATUS.md) |
| `docs/HANDOFF.md` | [원문](original/docs/HANDOFF.md.txt) | [읽기](docs/HANDOFF.md) |

- [manifest.json](manifest.json): 각 원문의 SHA-256·byte 수·원래 경로.
- [source-map.json](source-map.json): 이전 모든 제목 anchor → 현재 분야별 명세 또는 과거 기록의 정확한 위치. 이전 절 번호는 그대로 검색 가능하다.
- [worktree-baseline.json](worktree-baseline.json): 재구성 시작 시 기존390파일의 SHA, branch/HEAD. **미커밋 작업은 HEAD에 포함되지 않는다. 이 파일은 원본 코드를 대체하는 백업이 아니다.** 기존 작업 디렉터리도 함께 보존해야 한다.
- 원문 `.txt`는 Markdown 문법을 포함하는 정확한 스냅샷이다. 내부 상대 링크는 당시 원래 위치 기준이며, 탐색은 읽기용 사본을 사용한다.
- 문서 복구가 필요하면 manifest로 해당 `.txt`의 SHA를 확인한 뒤 필요한 문서만 원래 경로로 복사한다. 코드 초기화·checkout/reset·DB 변경은 필요 없고 실행해서는 안 된다.
- 이 기록에 포함된 철회한 P5-48 출력 상한/실패 동의 제안, 이전 CPU 실패, 완료한 작업 번호는 역사적 사실이다. 새 제품 제한이나 재실행 승인이 아니다.
