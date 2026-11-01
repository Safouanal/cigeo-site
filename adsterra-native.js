const SCRIPT_SRC = 'https://bauval.org/21/541b3ed47d68218b343e71e98b5d5ea7';
const CONTAINER_ID = 'container-541b3ed47d68218b343e71e98b5d5ea7';
const attemptedDocuments = new WeakSet();

export const ADSTERRA_NATIVE_DESCRIPTOR = Object.freeze({
  id: '32040685', responsive: true, minWidth: 250,
  scriptSrc: SCRIPT_SRC, containerId: CONTAINER_ID,
});

function abortError() {
  const error = new Error('Adsterra native rendering was aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * Insert only the approved native tag, once per document. The caller is
 * responsible for fresh provider consent, Google fallback eligibility and size.
 * No script URL, container ID or tag code is read from opaque placement fields.
 * Resolves at script load with idempotent cleanup; this is not proof of a filled
 * advertisement. Cleanup removes our two nodes, not unrelated page content, and
 * cannot undo actions already performed by the third-party script.
 */
export function renderAdsterraNative({ document, container, placement, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (placement?.id !== ADSTERRA_NATIVE_DESCRIPTOR.id && placement?.id !== 32040685) {
      reject(new TypeError('Unsupported Adsterra native placement')); return;
    }
    if (!document?.createElement || !document.createDocumentFragment || !document.getElementById || !container?.append) {
      reject(new TypeError('A document and native container are required')); return;
    }
    if (signal?.aborted) { reject(abortError()); return; }
    if (attemptedDocuments.has(document) || document.getElementById(CONTAINER_ID)) {
      reject(new Error('Adsterra native placement already exists or was attempted')); return;
    }

    let script;
    let native;
    let settled = false;
    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      script?.removeEventListener('load', loaded);
      script?.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
      script?.remove();
      native?.remove();
    }
    function aborted() {
      cleanup();
      if (!settled) { settled = true; reject(abortError()); }
    }
    function failed() {
      cleanup();
      if (!settled) { settled = true; reject(new Error('Adsterra native script failed to load')); }
    }
    function loaded() {
      if (signal?.aborted) { aborted(); return; }
      if (cleaned || settled) return;
      settled = true;
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', failed);
      // Keep the abort listener alive after load, until explicit cleanup.
      resolve(cleanup);
    }

    try {
      script = document.createElement('script');
      script.setAttribute('async', 'async');
      script.setAttribute('data-cfasync', 'false');
      script.setAttribute('src', SCRIPT_SRC);
      native = document.createElement('div');
      native.setAttribute('id', CONTAINER_ID);
      script.addEventListener('load', loaded);
      script.addEventListener('error', failed);
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) { aborted(); return; }
      const fragment = document.createDocumentFragment();
      fragment.append(script, native);
      attemptedDocuments.add(document);
      container.append(fragment);
      if (signal?.aborted) aborted();
    } catch (error) {
      cleanup();
      if (!settled) { settled = true; reject(error); }
    }
  });
}
