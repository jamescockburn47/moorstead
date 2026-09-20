import { element } from './ui.js';
import { PLAY_GUIDE } from './help-content.js';

export function playGuide(parent, topic = 'start') {
  const guide = element('div', 'fp-guide', null, parent);
  element('p', 'fp-guide-intro', 'Build together, explore, or lead opposite armies. Choose a topic below. This guide stops your controls, but the shared battle keeps running.', guide);
  const label = element('label', 'fp-guide-picker', 'Choose a topic', guide);
  const select = element('select', '', null, label);
  for (const [i, section] of PLAY_GUIDE.entries()) {
    const option = element('option', '', `${i + 1}. ${section.title}`, select);
    option.value = section.id;
  }
  const article = element('article', 'fp-guide-section', null, guide);
  const nav = element('nav', 'fp-guide-nav', null, guide);
  nav.setAttribute('aria-label', 'Guide pages');
  const previous = element('button', '', 'Previous topic', nav);
  const progress = element('span', '', '', nav);
  const next = element('button', '', 'Next topic', nav);
  previous.type = next.type = 'button';
  let index = Math.max(0, PLAY_GUIDE.findIndex(section => section.id === topic));
  const draw = (focus = false) => {
    const section = PLAY_GUIDE[index];
    select.value = section.id; article.replaceChildren();
    const heading = element('h3', '', section.title, article); heading.tabIndex = -1;
    element('p', 'fp-guide-lead', section.summary, article);
    for (const [key, title, tag] of [['steps', 'Step by step', 'ol'], ['facts', 'Good to know', 'ul']]) {
      element('h4', '', title, article);
      const list = element(tag, '', null, article);
      for (const text of section[key]) element('li', '', text, list);
    }
    element('p', 'fp-guide-tip', section.tip, article);
    previous.disabled = index === 0; next.disabled = index === PLAY_GUIDE.length - 1;
    progress.textContent = `${index + 1} / ${PLAY_GUIDE.length}`;
    if (focus) heading.focus();
  };
  select.onchange = () => { index = PLAY_GUIDE.findIndex(section => section.id === select.value); draw(true); };
  previous.onclick = () => { if (index > 0) { index--; draw(true); } };
  next.onclick = () => { if (index < PLAY_GUIDE.length - 1) { index++; draw(true); } };
  draw();
}
