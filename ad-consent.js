const STORAGE_KEY = 'cigeo.adsterra-consent.v1';
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
let nextDialogId = 0;

/**
 * A separate, opt-in choice for Adsterra. Creating this object sends no request
 * and creates no interface. The caller loads ad-consent.css when enabling it.
 * Recheck getState() immediately before inserting any advertising code.
 */
export function createSecondaryAdConsent({ document, storage, now = Date.now } = {}) {
  if (!document || typeof document.createElement !== 'function') {
    throw new TypeError('A document is required.');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function.');

  const view = document.defaultView;
  if (storage === undefined) {
    try { storage = view?.localStorage; } catch { storage = null; }
  }
  const listeners = new Set();
  let destroyed = false;
  let pending = null;
  let expiryTimer = null;

  function timestamp() {
    try {
      const value = now();
      return Number.isSafeInteger(value) && value >= 0 ? value : null;
    } catch { return null; }
  }

  function readRecord() {
    try {
      const value = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
      const time = timestamp();
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== 5 || value.version !== 1
        || value.provider !== 'adsterra'
        || !['accepted', 'rejected'].includes(value.state)
        || !Number.isSafeInteger(value.decidedAt) || value.decidedAt < 0
        || !Number.isSafeInteger(value.expiresAt)
        || value.expiresAt !== value.decidedAt + RETENTION_MS
        || time === null || value.decidedAt > time || value.expiresAt <= time) return null;
      return value;
    } catch { return null; }
  }

  let record = readRecord();

  function clearExpiry() {
    if (expiryTimer !== null) view?.clearTimeout?.(expiryTimer);
    expiryTimer = null;
  }

  function scheduleExpiry() {
    clearExpiry();
    const time = timestamp();
    if (!destroyed && record?.expiresAt && time !== null && view?.setTimeout) {
      expiryTimer = view.setTimeout(() => {
        expiryTimer = null;
        getState();
        scheduleExpiry();
      }, Math.min(Math.max(record.expiresAt - time, 1), 2147483647));
    }
  }

  function updateRecord(next) {
    const previousState = record?.state ?? 'unknown';
    record = next;
    scheduleExpiry();
    const state = record?.state ?? 'unknown';
    if (state !== previousState && !destroyed) {
      for (const listener of [...listeners]) {
        if (destroyed) break;
        try { listener(state); } catch { /* One consumer cannot change the choice. */ }
      }
    }
  }

  function getState() {
    if (destroyed) return 'unknown';
    const time = timestamp();
    if (record?.expiresAt !== null && record
      && (time === null || time < record.decidedAt || time >= record.expiresAt)) {
      updateRecord(null);
    }
    return record?.state ?? 'unknown';
  }

  function saveChoice(state) {
    const time = timestamp();
    const next = {
      version: 1,
      provider: 'adsterra',
      state,
      decidedAt: time,
      expiresAt: time === null ? null : time + RETENTION_MS,
    };
    // If persistence fails, only this instance remembers the explicit action.
    try {
      if (time !== null) storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // A full storage area can allow removal even when writing is denied.
      try { storage?.removeItem(STORAGE_KEY); } catch { /* Keep the current choice in memory. */ }
    }
    updateRecord(next);
  }

  function removeDialog(session) {
    session.dialog.removeEventListener('cancel', session.cancel);
    session.dialog.removeEventListener('close', session.close);
    session.dialog.removeEventListener('click', session.backdrop);
    session.refuse.removeEventListener('click', session.reject);
    session.accept.removeEventListener('click', session.allow);
    if (session.dialog.open) session.dialog.close();
    session.dialog.remove();
    if (session.previousFocus?.isConnected && session.previousFocus.focus) {
      session.previousFocus.focus();
    }
  }

  function finish(state, persist = true) {
    const session = pending;
    if (!session) return;
    pending = null;
    removeDialog(session);
    if (persist && !destroyed) saveChoice(state);
    session.resolve(!destroyed && state === 'accepted' && getState() === 'accepted');
  }

  function append(parent, tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    parent.append(element);
    return element;
  }

  function showChoice() {
    if (destroyed) return Promise.resolve(false);
    if (pending) return pending.promise;
    if (!document.body) return Promise.resolve(false);

    const dialog = document.createElement('dialog');
    if (typeof dialog.showModal !== 'function') return Promise.resolve(false);
    const id = `secondary-ad-consent-${++nextDialogId}`;
    dialog.className = 'secondary-ad-consent';
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.setAttribute('aria-describedby', `${id}-description`);
    const panel = append(dialog, 'div', '', 'secondary-ad-consent__panel');
    const title = append(panel, 'h2', 'Autoriser les annonces Adsterra ?');
    title.id = `${id}-title`;
    const description = append(panel, 'p', 'Adsterra (Ad Market Limited et Admedia LLC FZ) peut utiliser des cookies, votre adresse IP et des informations sur votre navigateur pour personnaliser les publicités et mesurer leur diffusion. Ces annonces peuvent remplacer un emplacement Google indisponible.');
    description.id = `${id}-description`;
    append(panel, 'p', 'Vous pouvez refuser et continuer à consulter le site. Votre choix est conservé pendant 180 jours. Vous pouvez le modifier à tout moment dans les paramètres publicitaires.', 'secondary-ad-consent__detail');
    const links = append(panel, 'p', '', 'secondary-ad-consent__links');
    const providerPrivacy = append(links, 'a', 'Confidentialité Adsterra');
    providerPrivacy.href = 'https://adsterra.com/privacy-policy-managed/';
    providerPrivacy.target = '_blank';
    providerPrivacy.rel = 'noopener noreferrer';
    const localPrivacy = append(links, 'a', 'Confidentialité du site');
    localPrivacy.href = './confidentialite.html';
    const actions = append(panel, 'div', '', 'secondary-ad-consent__actions');
    const refuse = append(actions, 'button', 'Refuser');
    const accept = append(actions, 'button', 'Accepter');
    refuse.type = accept.type = 'button';
    refuse.setAttribute('autofocus', '');

    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    const session = {
      dialog, refuse, accept, promise, resolve,
      previousFocus: document.activeElement,
      reject: () => finish('rejected'),
      allow: () => finish('accepted'),
      cancel: (event) => { event.preventDefault(); finish('rejected'); },
      close: () => finish('rejected'),
      backdrop: (event) => { if (event.target === dialog) finish('rejected'); },
    };
    pending = session;
    dialog.addEventListener('cancel', session.cancel);
    dialog.addEventListener('close', session.close);
    dialog.addEventListener('click', session.backdrop);
    refuse.addEventListener('click', session.reject);
    accept.addEventListener('click', session.allow);
    document.body.append(dialog);
    try {
      dialog.showModal();
      refuse.focus();
    } catch {
      finish('rejected', false);
    }
    return promise;
  }

  function request() {
    if (destroyed) return Promise.resolve(false);
    if (pending) return pending.promise;
    const state = getState();
    return state === 'unknown' ? showChoice() : Promise.resolve(state === 'accepted');
  }

  function onStorage(event) {
    if (destroyed || (event.key !== STORAGE_KEY && event.key !== null)
      || (event.storageArea && event.storageArea !== storage)) return;
    updateRecord(readRecord());
    if (pending) finish(record?.state ?? 'unknown', false);
  }

  view?.addEventListener?.('storage', onStorage);
  scheduleExpiry();

  return {
    getState,
    request,
    openSettings: showChoice,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('A listener is required.');
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearExpiry();
      listeners.clear();
      view?.removeEventListener?.('storage', onStorage);
      if (pending) finish('unknown', false);
      record = null;
    },
  };
}
