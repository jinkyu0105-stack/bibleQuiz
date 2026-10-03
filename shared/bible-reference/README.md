# 성경 장절 도메인 경계

이 폴더는 성경 본문 없이 66권의 구조와 장절 주소만 다룬다. `verseCounts`의 숫자는 각 장의 마지막 절 번호이며 구절 문자열은 포함하지 않는다.

- 책 순서와 USFM 3글자 ID: [USFM Books and Peripherals](https://docs.usfm.bible/usfm/3.1/identification/books.html)
- 한국어 정식 책명과 약어: [대한성서공회 「성경원문연구」 원고 투고 규정의 낱권 약어표](https://www.bskorea.or.kr/images/pdf/2/ik_2.pdf)
- 장별 마지막 절 수 대조 자료: [Bible Passage Reference Parser의 한국어 기본 versification](https://github.com/openbibleinfo/Bible-Passage-Reference-Parser/blob/master/esm/lang/ko.js)
- 실제 읽기와 판본 표기 정본: [대한성서공회 성경플랫폼](https://bible.bskorea.or.kr/)

v1 결과에는 `개역개정`, 장절 label, 공식 읽기 포털 링크만 있다. 본문, 요약, 자막, AI 입력용 문자열은 이 경계에 추가하지 않는다. 장을 넘는 범위와 불연속 범위는 추측하지 않고 안정 오류로 거부한다.
