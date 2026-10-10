/* global document */
import { mountGlassComponents } from './glass.js?v=20261010-components-1';
const root = document.querySelector('#examples');
let components = mountGlassComponents(root);
for (const group of root.querySelectorAll('.glass-segmented')) {
  for (const button of group.querySelectorAll('button')) button.addEventListener('click', () => {
    for (const item of group.querySelectorAll('button')) item.setAttribute('aria-pressed', String(item === button));
    document.querySelector('#example-result').textContent = `선택: ${button.textContent}`;
  });
}
document.querySelector('.example-action').addEventListener('click', () => {
  document.querySelector('#example-result').textContent = '버튼을 눌렀습니다. 실제 앱 동작은 실행하지 않습니다.';
});
document.querySelector('#example-theme').addEventListener('change', event => { document.body.dataset.time = event.target.value; });
document.querySelector('#example-clarity').addEventListener('click', event => {
  const high = document.body.dataset.transparency !== 'reduced';
  document.body.dataset.transparency = high ? 'reduced' : 'normal';
  event.currentTarget.setAttribute('aria-pressed', String(high));
});
document.querySelector('#example-motion').addEventListener('click', event => {
  const paused = document.body.dataset.motion !== 'off';
  document.body.dataset.motion = paused ? 'off' : 'on';
  event.currentTarget.setAttribute('aria-pressed', String(paused));
});
document.querySelector('#example-remount').addEventListener('click', () => {
  components.destroy();
  components = mountGlassComponents(root);
});
