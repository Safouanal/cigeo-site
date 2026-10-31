const tabList = document.querySelector('[data-source-tabs]');
const tabs = [...document.querySelectorAll('[data-source-tab]')];
const panels = [...document.querySelectorAll('[data-source-panel]')];

if (tabList && tabs.length === 3 && panels.length === 3) {
  const panelFor = (tab) => panels.find((panel) => panel.dataset.sourcePanel === tab.dataset.sourceTab);

  function activate(tab, moveFocus = false) {
    for (const candidate of tabs) {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      panelFor(candidate).hidden = !selected;
    }
    if (moveFocus) tab.focus();
  }

  if (tabs.every(panelFor)) {
    tabList.setAttribute('role', 'tablist');
    for (const tab of tabs) {
      const panel = panelFor(tab);
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', panel.id);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panel.tabIndex = 0;
      tab.addEventListener('click', () => activate(tab));
      tab.addEventListener('keydown', (event) => {
        const index = tabs.indexOf(tab);
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else return;
        event.preventDefault();
        activate(tabs[next], true);
      });
    }
    activate(tabs[0]);
    tabList.hidden = false;
  }
}
