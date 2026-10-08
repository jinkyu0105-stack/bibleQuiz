/* global window, document, URLSearchParams, setTimeout, structuredClone */
import { createWorld } from './world.js';

const params = new URLSearchParams(window.location.search);
const view = ['home', 'quiz', 'admin'].includes(params.get('view')) ? params.get('view') : 'home';
const level = params.get('level') === 'adults' ? 'adults' : 'children';
document.body.dataset.view = view;
for (const panel of document.querySelectorAll('.view')) panel.hidden = panel.id !== `${view}-view`;
for (const link of document.querySelectorAll('[data-view-link]')) if (link.dataset.viewLink === view) link.setAttribute('aria-current', 'page');
if (view !== 'home') {
  const destination = view === 'quiz' ? document.querySelector('.quiz-heading') : document.querySelector('.admin-layout');
  destination.before(document.querySelector('.time-rail'));
}
const world = createWorld();
function setGround(mode) {
  const choice = mode === 'grass' ? 'grass' : 'photo';
  world.setGround(choice);
  for (const button of document.querySelectorAll('button[data-ground]')) button.setAttribute('aria-pressed', String(button.dataset.ground === choice));
  const query = new URLSearchParams(window.location.search); query.set('ground', choice);
  window.history.replaceState(null, '', `?${query}${window.location.hash}`);
  for (const link of document.querySelectorAll('a[href^="?view="]')) {
    const [path, hash] = link.getAttribute('href').split('#');
    const linkParams = new URLSearchParams(path.slice(1)); linkParams.set('ground', choice);
    link.setAttribute('href', `?${linkParams}${hash ? `#${hash}` : ''}`);
  }
}
setGround(params.get('ground'));
for (const button of document.querySelectorAll('button[data-ground]')) button.addEventListener('click', () => setGround(button.dataset.ground));
const validThemes = ['dawn', 'day', 'dusk', 'night'];
function setTheme(theme) {
  if (!validThemes.includes(theme)) return;
  document.body.dataset.time = theme;
  const query = new URLSearchParams(window.location.search); query.set('time', theme);
  window.history.replaceState(null, '', `?${query}${window.location.hash}`);
  for (const button of document.querySelectorAll('.time-options button')) button.setAttribute('aria-pressed', String(button.dataset.time === theme));
  world.setTheme(theme);
  // Keep the choice across this independent review's views without altering app storage.
  for (const link of document.querySelectorAll('a[href^="?view="]')) {
    const [path, hash] = link.getAttribute('href').split('#');
    const linkParams = new URLSearchParams(path.slice(1)); linkParams.set('time', theme);
    link.setAttribute('href', `?${linkParams}${hash ? `#${hash}` : ''}`);
  }
}
setTheme(params.get('time') || 'day');
for (const button of document.querySelectorAll('.time-options button')) button.addEventListener('click', () => setTheme(button.dataset.time));

const dialog = document.querySelector('#review-dialog');
function explain(title, message) {
  document.querySelector('#dialog-title').textContent = title;
  document.querySelector('#dialog-message').textContent = message;
  dialog.showModal();
}
// Deliberately synthetic reading/typing sample; no actual quiz answers or AI outputs.
const words = [
  { number: 1, answer: '창세기', clue: '성경의 첫 번째 책은 무엇일까요?', cells: [17, 18, 19] },
  { number: 2, answer: '시편', clue: '기도와 찬양이 담긴 성경의 책이에요.', cells: [34, 35] },
  { number: 3, answer: '요한복음', clue: '요한이 기록한 복음서의 이름이에요.', cells: [49, 50, 51, 52] },
];
let activeWord = 0;
let answers = ['', '', ''];
const activeCells = new Set([...words.flatMap(word => word.cells), 10, 26, 27, 28, 36, 42, 43, 44, 45, 53]);
const board = document.querySelector('#puzzle-board');
for (let index = 0; index < 64; index++) {
  const active = activeCells.has(index);
  const wordIndex = words.findIndex(word => word.cells.includes(index));
  const cell = document.createElement(active && wordIndex !== -1 ? 'button' : 'div');
  cell.className = `cell${active ? '' : ' block'}`;
  cell.dataset.index = String(index);
  if (wordIndex !== -1) {
    cell.type = 'button';
    cell.setAttribute('aria-label', `${Math.floor(index / 8) + 1}행 ${index % 8 + 1}열, ${wordIndex + 1}번 단어`);
    cell.addEventListener('click', () => { selectWord(wordIndex); document.querySelector('#word-input').focus({ preventScroll: true }); });
  } else { cell.setAttribute('aria-hidden', 'true'); }
  const number = words.find(word => word.cells[0] === index);
  if (number) { const label = document.createElement('small'); label.textContent = String(number.number); cell.append(label); }
  const letter = document.createElement('span'); letter.className = 'letter'; cell.append(letter);
  board.append(cell);
}
words.forEach((word, index) => {
  const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-pressed', String(index === 0));
  const number = document.createElement('span'); number.textContent = String(word.number);
  const text = document.createElement('span'); text.textContent = word.clue;
  const length = document.createElement('small'); length.textContent = `${word.answer.length}글자`;
  text.append(length); button.append(number, text);
  button.addEventListener('click', () => selectWord(index));
  document.querySelector('#clue-list').append(button);
});
function selectWord(index) {
  activeWord = (index + words.length) % words.length;
  const selected = words[activeWord];
  document.querySelectorAll('#clue-list button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === activeWord)));
  document.querySelectorAll('.cell').forEach(cell => {
    const cellIndex = Number(cell.dataset.index);
    cell.classList.toggle('highlight', selected.cells.includes(cellIndex));
    cell.classList.toggle('chosen', cellIndex === selected.cells[0]);
  });
  const input = document.querySelector('#word-input'); input.maxLength = selected.answer.length; input.value = answers[activeWord];
  document.querySelector('#word-label').textContent = `${selected.number}번 단어 · ${selected.answer.length}글자`;
  document.querySelector('#word-feedback').textContent = '한글을 모두 입력한 뒤 ‘입력’을 눌러 주세요.';
}
document.querySelector('#word-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = document.querySelector('#word-input'); const value = input.value.trim().normalize('NFC'); const word = words[activeWord];
  if (!new RegExp(`^[가-힣]{${word.answer.length}}$`, 'u').test(value)) {
    document.querySelector('#word-feedback').textContent = `완성된 한글 ${word.answer.length}글자를 입력해 주세요.`; return;
  }
  answers[activeWord] = value;
  word.cells.forEach((cell, index) => {
    const element = board.querySelector(`[data-index="${cell}"]`);
    element.querySelector('.letter').textContent = value[index];
    element.setAttribute('aria-label', `${Math.floor(cell / 8) + 1}행 ${cell % 8 + 1}열, ${word.number}번 단어, ${value[index]}`);
  });
  document.querySelector('#word-count').textContent = `${answers.filter(Boolean).length} / 3 단어`;
  document.querySelector('#word-feedback').textContent = '입력했어요. 다음 단서도 풀어 보세요.';
});
document.querySelector('#previous-word').addEventListener('click', () => selectWord(activeWord - 1));
document.querySelector('#next-word').addEventListener('click', () => selectWord(activeWord + 1));
document.querySelector('#reset-puzzle').addEventListener('click', () => {
  answers = ['', '', ''];
  board.querySelectorAll('.letter').forEach(letter => { letter.textContent = ''; });
  words.forEach(word => word.cells.forEach(cell => board.querySelector(`[data-index="${cell}"]`).setAttribute('aria-label', `${Math.floor(cell / 8) + 1}행 ${cell % 8 + 1}열, ${word.number}번 단어`)));
  document.querySelector('#word-count').textContent = '0 / 3 단어'; selectWord(0);
});
document.querySelector('#quiz-level').textContent = level === 'adults' ? '장년 성경퀴즈' : '어린이 성경퀴즈';
for (const link of document.querySelectorAll('[data-level]')) if (link.dataset.level === level) link.setAttribute('aria-current', 'page');
selectWord(0);

const steps = ['설교 영상', '설교 의도', '요약과 문제', '격자 배치', '최종 확인', '발행'];
steps.forEach((name, index) => {
  const item = document.createElement('li'); const button = document.createElement('button'); button.type = 'button';
  const number = document.createElement('span'); number.className = 'step-number'; number.textContent = index < 2 ? '✓' : String(index + 1);
  const text = document.createElement('span'); text.textContent = name; button.append(number, text);
  if (index < 2) button.classList.add('step-complete');
  if (index === 2) button.setAttribute('aria-current', 'step');
  button.addEventListener('click', () => { if (index !== 2) explain(name, '이번 검토본은 요약과 문제를 검수하는 대표 화면입니다. 실제 앱에 적용할 때 기존 6단계의 작업·확정·발행 조건을 모두 유지합니다.'); });
  item.append(button); document.querySelector('.admin-steps').append(item);
});
const examples = {
  summary: { heading: '설교 요약 검토', label: '요약 내용', title: '말씀을 따라 걷는 한 주', body: '설교의 중심 내용을 함께 돌아보고, 한 주의 일상에서 실천할 일을 생각해 봅니다.\n\n이 문장은 화면 검토를 위한 예시입니다. 실제 설교나 AI 생성 결과가 아닙니다.' },
  children: { heading: '어린이 문제 검토', label: '문제와 단서', title: '어린이와 함께 기억해요', body: '단어 예시: 창세기\n단서 예시: 성경의 첫 번째 책은 무엇일까요?\n\n화면 배치를 위한 예시입니다. 실제 주간 문제나 생성 결과가 아닙니다.' },
  adults: { heading: '장년 문제 검토', label: '문제와 단서', title: '말씀을 깊이 생각해요', body: '단어 예시: 요한복음\n단서 예시: 요한이 기록한 복음서의 이름은 무엇인가요?\n\n화면 배치를 위한 예시입니다. 실제 주간 문제나 생성 결과가 아닙니다.' },
};
let content = 'summary';
const drafts = structuredClone(examples);
function updatePreview() {
  document.querySelector('#preview-title').textContent = document.querySelector('#review-title').value;
  document.querySelector('#preview-body').textContent = document.querySelector('#review-body').value;
}
function loadContent(key) {
  content = key;
  document.querySelector('#editor-title').textContent = examples[key].heading;
  document.querySelector('#review-body-label').textContent = examples[key].label;
  document.querySelector('#review-title').value = drafts[key].title;
  document.querySelector('#review-body').value = drafts[key].body;
  for (const button of document.querySelectorAll('[data-content]')) button.setAttribute('aria-pressed', String(button.dataset.content === key));
  document.querySelector('#review-check').checked = false;
  document.querySelector('#review-next').disabled = true;
  document.querySelector('#edit-state').textContent = '예시 내용을 수정해 볼 수 있습니다.';
  updatePreview();
}
for (const button of document.querySelectorAll('[data-content]')) button.addEventListener('click', () => loadContent(button.dataset.content));
for (const field of document.querySelectorAll('#review-title,#review-body')) field.addEventListener('input', () => {
  drafts[content].title = document.querySelector('#review-title').value; drafts[content].body = document.querySelector('#review-body').value;
  updatePreview(); document.querySelector('#edit-state').textContent = '검토 화면에만 반영했습니다. 저장하지 않았습니다.';
  document.querySelector('#review-check').checked = false; document.querySelector('#review-next').disabled = true;
});
document.querySelector('#restore-example').addEventListener('click', () => { drafts[content] = { ...examples[content] }; loadContent(content); });
document.querySelector('#review-check').addEventListener('change', event => { document.querySelector('#review-next').disabled = !event.target.checked; });
document.querySelector('#review-next').addEventListener('click', () => explain('검수 흐름 확인', '확인 표시와 다음 단계 버튼의 동작을 확인했습니다. 실제 격자 배치·검사·발행은 기존 앱 연결 단계에서 이어집니다.'));
for (const button of document.querySelectorAll('[data-admin-page]')) button.addEventListener('click', () => { if (button.dataset.adminPage !== 'weekly') explain(button.textContent.trim(), '기존 운영 메뉴를 보존한 디자인 검토본입니다. 이 메뉴의 실제 작업은 현재 운영 앱에서 계속 이용할 수 있습니다.'); });
world.reset();
if (['#weekly', '#archive', '#ground-controls'].includes(window.location.hash) && view === 'home') setTimeout(() => document.querySelector(window.location.hash)?.scrollIntoView(), 100);
