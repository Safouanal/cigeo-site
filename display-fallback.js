import { createSecondaryAdsManager } from './secondary-ads.js';
import { createSecondaryAdConsent } from './ad-consent.js';
import { renderAdsterraNative } from './adsterra-native.js';

const NATIVE_ID = '32040685';
const PLACEMENTS = new Set(['home-top', 'guide-top']);

export function validateDisplayFallbackConfig(value) {
  if (!value || value.enabled !== true || typeof value.googleEligible !== 'boolean'
    || !value.placements || typeof value.placements !== 'object'
    || Array.isArray(value.placements)) return null;
  const entries = Object.entries(value.placements);
  if (!entries.length || entries.some(([key, entry]) => !PLACEMENTS.has(key)
    || !Array.isArray(entry?.variants) || entry.variants.length !== 1
    || entry.variants.some(v => v?.id !== NATIVE_ID || v.responsive !== true
      || !Number.isSafeInteger(v.minWidth) || v.minWidth < 250))) return null;
  return value;
}

// Register before inserting the CMP script so an early failure is not missed.
// Both outcomes only release our separate question; neither grants consent or
// changes Google's ad eligibility / placement status.
export function waitForGoogleConsentFlow(view, script) {
  return new Promise(resolve => {
    let settled = false;
    const finish = state => {
      if (settled) return;
      settled = true;
      script?.removeEventListener?.('error', failed);
      resolve(state);
    };
    const failed = () => finish('unavailable');
    script?.addEventListener?.('error', failed, { once: true });
    view.googlefc = view.googlefc || {};
    view.googlefc.callbackQueue = view.googlefc.callbackQueue || [];
    view.googlefc.callbackQueue.push({ CONSENT_DATA_READY: () => finish('ready') });
    view.googlefc.callbackQueue.push({ CONSENT_MODE_DATA_READY: () => finish('ready') });
  });
}

export async function initializeDisplayFallback({
  document = globalThis.document, view = globalThis.window,
  fetchConfig = globalThis.fetch, createManager = createSecondaryAdsManager,
  createConsent = createSecondaryAdConsent, renderer = renderAdsterraNative,
  googleConsentFlow,
} = {}) {
  if (!['cigeo.fr', 'www.cigeo.fr'].includes(view?.location?.hostname)
    || !document || typeof fetchConfig !== 'function') return null;
  // The entry point supplies the flow registered before its CMP script append.
  // Direct callers register now, before even waiting for configuration.
  const primaryConsentFlow = googleConsentFlow ?? waitForGoogleConsentFlow(view);
  let config;
  try {
    const response = await fetchConfig(new URL('./ad-fallback-config.json', import.meta.url), {
      credentials: 'omit', mode: 'same-origin',
    });
    if (!response.ok) return null;
    config = validateDisplayFallbackConfig(await response.json());
  } catch { return null; }
  if (!config) return null;

  const slots = [...document.querySelectorAll('ins.adsbygoogle')];
  const configured = slots.filter(slot => config.placements[slot.getAttribute('data-ad-placement')]);
  // The account provides one responsive native unit; never duplicate it on a page.
  if (configured.length > 1) return null;
  const consent = createConsent({ document });
  let tagStarted = false;
  let disposed = false;
  let reloading = false;
  const manager = createManager({
    document, slots, config, consentStore: consent,
    requestConsent: async store => {
      await primaryConsentFlow;
      return !disposed && await store.request();
    },
    renderer: input => {
      if (disposed || input.signal.aborted || consent.getState() !== 'accepted') {
        throw new Error('Secondary advertising consent is not available');
      }
      tagStarted = true;
      return renderer({ document, ...input });
    },
    onError: error => {
      if (error?.name === 'AbortError') return;
      document.documentElement.dataset.secondaryAdsState = 'unavailable';
    },
  });
  const settings = [...document.querySelectorAll('[data-secondary-privacy-settings]')];
  const openSettings = () => { consent.openSettings(); };
  for (const button of settings) {
    button.hidden = false;
    button.addEventListener('click', openSettings);
  }
  const unsubscribe = consent.subscribe(state => {
    if (state !== 'accepted' && tagStarted && !disposed && !reloading) {
      reloading = true;
      // Persisted refusal takes effect before reloading away any vendor globals.
      queueMicrotask(() => { if (!disposed) view.location.reload(); });
    }
  });
  const refresh = () => { manager.refresh(); };
  view.addEventListener('resize', refresh, { passive: true });
  document.addEventListener('visibilitychange', refresh);
  document.documentElement.dataset.secondaryAdsState = 'configured';
  await manager.start();

  return {
    manager, consent,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      view.removeEventListener('resize', refresh);
      document.removeEventListener('visibilitychange', refresh);
      for (const button of settings) {
        button.removeEventListener('click', openSettings);
        button.hidden = true;
      }
      manager.destroy();
      consent.destroy();
    },
  };
}
