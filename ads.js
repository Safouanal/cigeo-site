import { initializeDisplayFallback, waitForGoogleConsentFlow } from './display-fallback.js';

// Only the registered public domain may request real advertisements.
if (['cigeo.fr', 'www.cigeo.fr'].includes(window.location.hostname)) {
  window.googlefc = window.googlefc || {};
  window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];
  window.googlefc.callbackQueue.push({
    CONSENT_API_READY: function () {
      document.querySelectorAll('[data-privacy-settings]').forEach((button) => {
        button.hidden = false;
        button.addEventListener('click', () => {
          window.googlefc.callbackQueue.push(window.googlefc.showRevocationMessage);
        });
      });
    },
  });

  // Official Google recovery tag, copied from this account's published message.
  const recovery = document.createElement('script');
  recovery.async = true;
  recovery.src = 'https://fundingchoicesmessages.google.com/i/pub-4112623749902905?ers=1';
  const googleConsentFlow = waitForGoogleConsentFlow(window, recovery);
  document.head.append(recovery);
  if (!window.frames['googlefcPresent']) {
    const signal = document.createElement('iframe');
    signal.style = 'width:0;height:0;border:none;z-index:-1000;left:-1000px;top:-1000px;display:none';
    signal.name = 'googlefcPresent';
    document.body.append(signal);
  }
  const recoveryProtection = document.createElement('script');
  recoveryProtection.async = true;
  recoveryProtection.src = new URL('./google-recovery-protection.js', import.meta.url).href;
  document.head.append(recoveryProtection);

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4112623749902905';
  script.crossOrigin = 'anonymous';
  document.head.append(script);

  const placements = [...document.querySelectorAll('ins.adsbygoogle')];
  const requested = new WeakSet();
  function requestVisiblePlacements() {
    for (const placement of placements) {
      if (requested.has(placement) || placement.getBoundingClientRect().width === 0) continue;
      requested.add(placement);
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    }
  }
  requestVisiblePlacements();
  window.addEventListener('resize', requestVisiblePlacements, { passive: true });
  initializeDisplayFallback({ googleConsentFlow }).catch(() => {});
}
