// Runs before the app loads: sets the saved theme so the first paint already has the right colours.
// (Kept in sync with applyMode in src/lib/theme.ts. Kept as a separate file so the page needs no inline script.)
(function () {
  try {
    var mode = localStorage.getItem('sam.theme') || 'dark';
    var root = document.documentElement;
    var light = mode === 'light' || mode === 'sunset';
    root.setAttribute('data-theme', light ? 'light' : 'dark');
    if (mode === 'calm' || mode === 'aurora' || mode === 'emerald') root.setAttribute('data-tone', 'calm');
    if (mode !== 'dark' && mode !== 'light') root.setAttribute('data-palette', mode);
  } catch (e) {}
})();
