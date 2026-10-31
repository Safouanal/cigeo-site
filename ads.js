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

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4112623749902905';
  script.crossOrigin = 'anonymous';
  document.head.append(script);

  document.querySelectorAll('ins.adsbygoogle').forEach(() => {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  });
}
