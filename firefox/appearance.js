const preferences = [
  {key: 'vector-feature-custom-font-size', title: 'Text', options: [['0', 'Small'], ['1', 'Standard'], ['2', 'Large']]},
  {key: 'vector-feature-limited-width', title: 'Width', options: [['1', 'Standard'], ['0', 'Wide']]},
  {key: 'skin-theme', title: 'Color', options: [['os', 'Automatic'], ['day', 'Light'], ['night', 'Dark']]}
];

export function connectAppearance(doc, hostname) {
  if (!/(^|\.)wikipedia\.org$/i.test(hostname)) return;
  const pane = doc.getElementById('vector-appearance');
  if (!pane) return;
  const root = doc.documentElement;

  for (const {key, title, options} of preferences) {
    const prefix = key + '-clientpref-';
    const name = 'skin-client-pref-' + key + '-group';
    const idPrefix = 'skin-client-pref-' + key + '-value-';
    let controls = [...pane.querySelectorAll('input[type="radio"]')].filter(control =>
      control.name === name || control.id.startsWith(idPrefix));
    if (!controls.length) {
      // Public crawl responses omit controls populated by Wikipedia's live scripts.
      const group = doc.createElement('fieldset');
      const legend = doc.createElement('legend');
      legend.textContent = title;
      group.append(legend);
      const current = [...root.classList].find(value => value.startsWith(prefix))?.slice(prefix.length);
      controls = options.map(([value, text]) => {
        const label = doc.createElement('label');
        const input = doc.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.id = idPrefix + value;
        input.value = value;
        input.checked = value === (current || (key === 'skin-theme' ? 'day' : '1'));
        label.append(input, ' ' + text);
        const row = doc.createElement('div');
        row.append(label);
        group.append(row);
        return input;
      });
      pane.append(group);
    }
    for (const control of controls) {
      const value = control.getAttribute('value') || control.id.split('-value-')[1];
      if (!options.some(([candidate]) => candidate === value)) continue;
      control.disabled = false;
      control.name = name;
      control.value = value;
      control.addEventListener('change', () => {
        if (!control.checked) return;
        for (const className of [...root.classList]) {
          if (className.startsWith(prefix)) root.classList.remove(className);
        }
        root.classList.add(prefix + value);
      });
    }
  }

  const menu = doc.getElementById('vector-appearance-dropdown-checkbox');
  if (menu) menu.disabled = false;
  for (const [buttonClass, pinned] of [['pin', true], ['unpin', false]]) {
    const button = pane.querySelector('.vector-pinnable-header-' + buttonClass + '-button');
    if (!button) continue;
    button.disabled = false;
    button.type = 'button';
    button.addEventListener('click', () => {
      const destination = doc.getElementById(pinned ? 'vector-appearance-pinned-container' : 'vector-appearance-unpinned-container');
      if (!destination) return;
      root.classList.toggle('vector-feature-appearance-pinned-clientpref-1', pinned);
      root.classList.toggle('vector-feature-appearance-pinned-clientpref-0', !pinned);
      const header = pane.querySelector('.vector-pinnable-header');
      header?.classList.toggle('vector-pinnable-header-pinned', pinned);
      header?.classList.toggle('vector-pinnable-header-unpinned', !pinned);
      if (menu) menu.checked = false;
      destination.append(pane);
      if (!pinned) menu?.focus();
    });
  }
}
