(function () {
  const tabs = document.querySelectorAll('.about-tab');
  const panels = {
    about: document.getElementById('panel-about'),
    security: document.getElementById('panel-security'),
  };
  if (!tabs.length || !panels.about || !panels.security) return;

  function show(name) {
    for (const t of tabs) t.classList.toggle('active', t.dataset.tab === name);
    for (const [k, el] of Object.entries(panels)) el.classList.toggle('hidden', k !== name);
    document.title = name === 'security'
      ? 'Moorstead — security & privacy'
      : 'Moorstead: how I built it and how it works';
    history.replaceState(null, '', name === 'security' ? '?tab=security' : location.pathname);
  }

  for (const t of tabs) t.addEventListener('click', () => show(t.dataset.tab));
  if (new URLSearchParams(location.search).get('tab') === 'security') show('security');
})();
