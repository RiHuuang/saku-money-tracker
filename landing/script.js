// Reading, navigation, and downloads remain available without JavaScript.
document.documentElement.classList.add('js');
const root = document.documentElement;
const themeButton = document.querySelector('.theme-toggle');
const themeLabel = themeButton.querySelector('.theme-label');
const themeMeta = document.querySelector('meta[name="theme-color"]');
const themeKey = 'saku-landing-theme-v1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const desktopJourney = matchMedia('(min-width: 901px) and (min-height: 650px)');

document.getElementById('year').textContent = String(new Date().getFullYear());

document.querySelectorAll('.dark-image').forEach(image => {
  image.alt = image.previousElementSibling.alt;
  image.removeAttribute('aria-hidden');
});

function paintTheme(theme) {
  const dark = theme === 'dark';
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  themeMeta.setAttribute('content', dark ? '#101d18' : '#f7f6f0');
  themeButton.setAttribute('aria-pressed', String(dark));
  themeButton.setAttribute('aria-label', dark ? 'Aktifkan tema terang' : 'Aktifkan tema gelap');
  themeLabel.textContent = dark ? 'Tema terang' : 'Tema gelap';
}

paintTheme(root.dataset.theme);
themeButton.hidden = false;
themeButton.addEventListener('click', () => {
  const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  paintTheme(nextTheme);
  try { localStorage.setItem(themeKey, nextTheme); } catch (_) {}
});

const steps = [...document.querySelectorAll('[data-step]')];
const screens = [...document.querySelectorAll('[data-screen]')];
const controls = [...document.querySelectorAll('[data-select-step]')];
const stageCounter = document.querySelector('.stage-counter');
const stageProgress = document.querySelector('.stage-progress span');
const stageVisual = document.querySelector('.stage-visual');
const stageWord = document.querySelector('.stage-word');
const stageWords = ['CATAT', 'ATUR', 'PAHAMI'];
let activeStep = -1;

function selectStep(index) {
  if (index === activeStep) return;
  const previousStep = activeStep;
  activeStep = index;
  steps.forEach((step, i) => step.classList.toggle('is-active', i === index));
  screens.forEach((screen, i) => {
    const active = i === index;
    screen.classList.toggle('is-active', active);
    screen.setAttribute('aria-hidden', String(!active));
  });
  controls.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
  stageCounter.textContent = String(index + 1).padStart(2, '0') + ' / 03';
  stageProgress.style.transform = 'scaleX(' + ((index + 1) / steps.length) + ')';
  stageVisual.dataset.phase = String(index);
  stageWord.textContent = stageWords[index];
  if (!reducedMotion.matches && previousStep >= 0) {
    stageWord.animate([
      { opacity: 0, transform: 'translateY(18px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration: 550, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
}

controls.forEach((button, index) => button.addEventListener('click', () => {
  selectStep(index);
  steps[index].scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}));
selectStep(0);

const mobileNav = document.querySelector('.mobile-nav');
mobileNav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => { mobileNav.open = false; }));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && mobileNav.open) {
    mobileNav.open = false;
    mobileNav.querySelector('summary').focus();
  }
});
document.addEventListener('click', event => {
  if (mobileNav.open && !mobileNav.contains(event.target)) mobileNav.open = false;
});

const navLinks = [...document.querySelectorAll('.nav-links a, .mobile-nav-panel a')];
const navSections = [...new Set(navLinks.map(link => link.hash))].map(hash => document.querySelector(hash));
let framePending = false;
function updateScrollState() {
  framePending = false;
  if (desktopJourney.matches) {
    const center = innerHeight * .52;
    const distances = steps.map(step => {
      const rect = step.getBoundingClientRect();
      return Math.abs(rect.top + rect.height / 2 - center);
    });
    selectStep(distances.indexOf(Math.min(...distances)));
  }
  let current = -1;
  navSections.forEach((section, index) => {
    if (section.getBoundingClientRect().top <= innerHeight * .4) current = index;
  });
  const currentHash = current >= 0 ? '#' + navSections[current].id : null;
  navLinks.forEach(link => {
    if (link.hash === currentHash) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}
function queueScrollUpdate() {
  if (!framePending) {
    framePending = true;
    requestAnimationFrame(updateScrollState);
  }
}
addEventListener('scroll', queueScrollUpdate, { passive: true });
addEventListener('resize', queueScrollUpdate, { passive: true });
updateScrollState();

const revealTargets = [...document.querySelectorAll('.browser-window, .feature-row, .control-items p')];
revealTargets.forEach(target => target.dataset.reveal = '');
let revealObserver;
function configureReveals() {
  revealObserver?.disconnect();
  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    revealTargets.forEach(target => target.classList.add('is-visible'));
    return;
  }
  revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: .09 });
  revealTargets.forEach(target => {
    if (target.classList.contains('is-visible') || target.getBoundingClientRect().top < innerHeight) {
      target.classList.add('is-visible');
    } else {
      revealObserver.observe(target);
    }
  });
}
configureReveals();
reducedMotion.addEventListener('change', configureReveals);
