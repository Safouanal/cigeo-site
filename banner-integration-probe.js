import { createSecondaryAdConsent } from '/ad-consent.js';

const UNIT_ID = '32040499';
const SOURCE = 'https://bauval.org/22/e8881df7d6bce10516d9572f5d224c50';
const CONFIGURATION = "atOptions = { 'key': 'e8881df7d6bce10516d9572f5d224c50', 'format': 'iframe', 'height': 300, 'width': 160, 'params': {} };";
const mount = document.querySelector('[data-probe-slot]');
const button = document.querySelector('[data-probe-test]');
const settings = document.querySelector('[data-probe-settings]');
const status = document.querySelector('[data-probe-state]');
const report = document.querySelector('[data-probe-report]');
const iframeCount = document.querySelector('[data-probe-iframe-count]');
const imageCount = document.querySelector('[data-probe-image-count]');
let state = 'initial';
let attempted = false;
let inserted = false;

function update(message) {
  const iframes = mount.querySelectorAll('iframe').length;
  const images = mount.querySelectorAll('img').length;
  iframeCount.textContent = String(iframes);
  imageCount.textContent = String(images);
  if (message) status.textContent = message;
  document.documentElement.dataset.bannerProbeState = state;
  report.textContent = JSON.stringify({ unitId: UNIT_ID, state, attempted, inserted, iframes, images }, null, 2);
}

if (!['cigeo.fr', 'www.cigeo.fr'].includes(window.location.hostname)) {
  state = 'blocked-host';
  update('Sonde bloquée sur cet hôte. Aucun tag publicitaire ne sera chargé, notamment sur localhost.');
} else {
  const consent = createSecondaryAdConsent({ document });
  const observer = new MutationObserver(() => update());
  observer.observe(mount, { childList: true, subtree: true });
  button.disabled = false;
  settings.hidden = false;
  state = 'ready';
  update('Prêt. Une seule tentative sera autorisée après vérification du consentement Adsterra.');

  button.addEventListener('click', async () => {
    if (attempted) return;
    attempted = true;
    button.disabled = true;
    state = 'consent';
    update('Vérification de votre choix Adsterra. Aucun tag inséré pour le moment.');
    const accepted = await consent.request();
    if (!accepted || consent.getState() !== 'accepted') {
      state = 'denied';
      update('Accord non obtenu : aucun tag inséré. Cette sonde ne relancera pas le test.');
      return;
    }
    const configuration = document.createElement('script');
    configuration.type = 'text/javascript';
    configuration.textContent = CONFIGURATION;
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = false;
    script.src = SOURCE;
    script.addEventListener('load', () => {
      if (state !== 'waiting') return;
      state = 'loaded';
      update('Script chargé. Vérifiez les compteurs et le rendu ; ce signal ne confirme pas une annonce diffusée.');
    }, { once: true });
    script.addEventListener('error', () => {
      if (state !== 'waiting') return;
      state = 'error';
      update('Erreur de chargement du script. Aucun repli ni nouvelle tentative ne sera effectué.');
    }, { once: true });
    if (consent.getState() !== 'accepted') {
      state = 'denied';
      update('Accord retiré avant insertion : aucun tag chargé.');
      return;
    }
    state = 'waiting';
    inserted = true;
    update('Tag inséré dans son conteneur natif. En attente du chargement et d’un éventuel contenu.');
    // Exact classic snippet order: synchronous inline atOptions, then ordered
    // external script. No iframe, document.write hook or code evaluation here.
    mount.append(configuration);
    mount.append(script);
  });

  settings.addEventListener('click', () => { consent.openSettings(); });
  const unsubscribe = consent.subscribe((value) => {
    if (value === 'accepted' || !inserted) return;
    mount.replaceChildren();
    state = 'revoked';
    update('Accord retiré : contenu du conteneur supprimé, sans rechargement. Les actions déjà exécutées par le fournisseur ne peuvent pas être annulées.');
  });
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    unsubscribe();
    consent.destroy();
  }, { once: true });
}
