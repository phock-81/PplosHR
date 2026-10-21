// PWA bootstrap: registers the service worker, shows an update prompt, an offline read-only banner and an install button.
// Offline form submission is intentionally NOT supported (see public/sw.js and RELEASE_REPORT).
function bar(id, html, cls = '') {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.setAttribute('role', 'status');
    el.className = 'pwa-bar ' + cls;
    document.body.appendChild(el);
  }
  el.innerHTML = html;
  el.hidden = false;
  return el;
}
const hide = (id) => { const el = document.getElementById(id); if (el) el.hidden = true; };

export function initOfflineBanner() {
  const update = () => {
    if (navigator.onLine) hide('pwaOffline');
    else bar('pwaOffline', '<i class="bi bi-wifi-off"></i> You are offline. Data shown is read-only and new requests cannot be submitted until you reconnect.', 'pwa-bar-offline');
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

export function initInstallPrompt() {
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (typeof window !== 'undefined' && window.innerWidth >= 768) return;
    if (localStorage.getItem('pwaInstallDismissed')) return;
    const el = bar('pwaInstall', '<span><i class="bi bi-download"></i> Install PplosHR on this device</span><span><button type="button" id="pwaInstallBtn">Install</button><button type="button" id="pwaInstallNo" aria-label="Dismiss install prompt">Not now</button></span>', 'pwa-bar-install');
    el.querySelector('#pwaInstallBtn').onclick = async () => { hide('pwaInstall'); deferred.prompt(); await deferred.userChoice; deferred = null; };
    el.querySelector('#pwaInstallNo').onclick = () => { localStorage.setItem('pwaInstallDismissed', '1'); hide('pwaInstall'); };
  });
  window.addEventListener('appinstalled', () => hide('pwaInstall'));
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      const prompt = (worker) => {
        const el = bar('pwaUpdate', '<span><i class="bi bi-arrow-repeat"></i> A new version is available.</span><span><button type="button" id="pwaReload">Update now</button></span>', 'pwa-bar-update');
        el.querySelector('#pwaReload').onclick = () => worker.postMessage({ type: 'SKIP_WAITING' });
      };
      if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w); });
      });
    }).catch((err) => console.warn('Service worker registration failed', err));
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      // Guard against infinite reload loops across navigation
      const lastReload = Number(sessionStorage.getItem('pwaLastReload') || 0);
      if (Date.now() - lastReload < 15000) return;
      reloaded = true;
      sessionStorage.setItem('pwaLastReload', String(Date.now()));
      location.reload();
    });
  });
  // On logout, drop any cached data defensively.
  window.addEventListener('hr-session', (e) => {
    if (!e.detail && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHES' });
  });
}

export function initPwa() { initOfflineBanner(); initInstallPrompt(); registerServiceWorker(); }
