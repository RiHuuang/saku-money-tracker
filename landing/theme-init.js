try {
  if (localStorage.getItem('saku-landing-theme-v1') === 'dark') {
    document.documentElement.dataset.theme = 'dark';
    document.querySelector('meta[name="theme-color"]').content = '#101d18';
  }
} catch (_) {}
