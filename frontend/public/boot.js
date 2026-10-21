// Runs before the app loads: sets the saved theme so the first paint already has the right colours.
// (Kept in sync with applyMode in src/lib/theme.ts. Kept as a separate file so the page needs no inline script.)
(function () {
  try {
    var mode = localStorage.getItem('sam.theme') || 'dark';
    var root = document.documentElement;
    var light = mode === 'light' || mode === 'sunset' || mode === 'macos' || mode === 'macosglass';
    root.setAttribute('data-theme', light ? 'light' : 'dark');
    if (mode === 'calm' || mode === 'aurora' || mode === 'emerald' || mode === 'macosdark' || mode === 'macosglassdark') root.setAttribute('data-tone', 'calm');
    if (mode !== 'dark' && mode !== 'light') root.setAttribute('data-palette', mode);
  } catch (e) {}
})();

// Start the three data requests now, while the app bundle is still downloading; api.ts takes each answer once the app
// is ready, so the page no longer waits for the bundle before it even asks for its data.
(function () {
  try {
    var early = (window.__early = {});
    ['check', 'bots', 'databases'].forEach(function (k) {
      var p = fetch('/api/' + k).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
      p.catch(function () {});
      early[k] = p;
    });
  } catch (e) {}
})();
