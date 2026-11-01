import { ADSTERRA_UNITS } from './adsterra-units.js';

const documents = new WeakMap();
const abortError = () => Object.assign(new Error('Adsterra banner rendering was aborted'), { name: 'AbortError' });

function documentQueue(document) {
  if (!documents.has(document)) documents.set(document, { pending: [], active: null, attempted: new Set() });
  return documents.get(document);
}

function pump(queue) {
  if (queue.active) return;
  let next;
  while ((next = queue.pending.shift())) {
    if (next.phase !== 'queued') continue;
    queue.active = next;
    next.start();
    return;
  }
}

/**
 * Load the exact approved classic banner snippet into a native container.
 * The caller checks provider consent, dimensions and Google fallback eligibility.
 * Only placement.id selects a static registry entry; other fields are ignored.
 *
 * One attempt per document/unit, serialized until the emitted script's actual
 * load/error. Aborting an emitted script cleans/rejects immediately but retains
 * its lock/options: removing a script does not reliably cancel execution. Abort
 * before external emission releases immediately. The genuine loader immediately
 * reads/deletes window.atOptions. Script load
 * means only that the loader ran, never that an advertisement was filled.
 * Cleanup is scoped to our scripts and new content inside this container. It
 * cannot undo vendor globals or actions already performed by a third-party tag.
 */
export function renderAdsterraBanner({ document, container, placement, signal } = {}) {
  return new Promise((resolve, reject) => {
    const id = placement?.id;
    const unit = typeof id === 'string' && Object.hasOwn(ADSTERRA_UNITS, id) ? ADSTERRA_UNITS[id] : null;
    if (!unit || unit.type !== 'banner') { reject(new TypeError('Unsupported Adsterra banner unit')); return; }
    const view = document?.defaultView;
    if (!document?.createElement || !view || !container?.append) {
      reject(new TypeError('A document, its view and a native container are required')); return;
    }
    if (signal?.aborted) { reject(abortError()); return; }
    const queue = documentQueue(document);
    if (queue.attempted.has(id) || document.querySelector?.('script[src="' + unit.scriptSrc + '"]')) {
      reject(new Error('Adsterra banner unit was already attempted')); return;
    }
    queue.attempted.add(id);
    let inline;
    let external;
    let baseline;
    let previous;
    let ownedOptions;
    let restored = false;
    let cleaned = false;
    let settled = false;
    let terminal = false;
    let externalEmitted = false;
    let preparingInline = false;
    const job = { phase: 'queued', start };

    function restoreOptions() {
      if (restored) return;
      restored = true;
      if (!ownedOptions) return;
      const current = Object.getOwnPropertyDescriptor(view, 'atOptions');
      // A missing value is expected when this loader consumed/deleted our object.
      // Never overwrite a different value installed by unrelated code.
      if (current && (!('value' in current) || current.value !== ownedOptions)) return;
      if (previous) Object.defineProperty(view, 'atOptions', previous);
      else delete view.atOptions;
    }
    function removeNodes() {
      if (!cleaned) {
        cleaned = true;
        signal?.removeEventListener('abort', aborted);
        inline?.remove();
        external?.remove();
      }
      // A prepared loader may add content after its earlier abort cleanup.
      // Sweep this renderer's own container again at the real terminal event.
      if (baseline) {
        for (const node of [...container.childNodes]) if (!baseline.has(node)) node.remove();
      }
    }
    function release() {
      if (queue.active === job) queue.active = null;
      pump(queue);
    }
    function cleanup() { removeNodes(); }
    function finish(error, externalTerminal = false) {
      if (error) {
        if (!settled) { settled = true; reject(error); }
        removeNodes();
      }
      if (terminal) return;
      if (externalEmitted && !externalTerminal) {
        // Keep terminal listeners even after DOM cleanup. An old prepared loader
        // must never see a following unit's atOptions if it executes after abort.
        job.phase = 'awaiting-terminal';
        return;
      }
      terminal = true;
      external?.removeEventListener('load', loaded);
      external?.removeEventListener('error', failed);
      try { restoreOptions(); } catch { /* An unrelated global may have become protected. */ }
      if (!settled) { settled = true; job.phase = 'loaded'; resolve(cleanup); }
      else job.phase = 'finished';
      // Abort remains subscribed after load so consent withdrawal removes content.
      release();
    }
    function fail(error) { finish(error); }
    function aborted() {
      // Finish the synchronous inline assignment first, so its exact object can
      // be restored before releasing a pre-external cancellation.
      if (!preparingInline) finish(abortError());
    }
    function failed() { finish(new Error('Adsterra banner script failed to load'), true); }
    function loaded() { finish(signal?.aborted ? abortError() : null, true); }
    function start() {
      if (signal?.aborted) { aborted(); return; }
      job.phase = 'loading';
      try {
        previous = Object.getOwnPropertyDescriptor(view, 'atOptions');
        if (previous && (!('value' in previous) || previous.writable === false)) {
          throw new Error('Existing atOptions cannot be safely preserved');
        }
        baseline = new Set(container.childNodes);
        const options = { key: unit.key, format: 'iframe', height: unit.height, width: unit.width, params: {} };
        inline = document.createElement('script');
        inline.type = 'text/javascript';
        inline.textContent = 'atOptions = ' + JSON.stringify(options) + ';';
        external = document.createElement('script');
        external.type = 'text/javascript';
        external.async = false;
        external.src = unit.scriptSrc;
        external.addEventListener('load', loaded);
        external.addEventListener('error', failed);
        if (signal?.aborted) { aborted(); return; }
        preparingInline = true;
        container.append(inline);
        const assigned = Object.getOwnPropertyDescriptor(view, 'atOptions');
        const value = assigned && 'value' in assigned ? assigned.value : null;
        if (!value || value === previous?.value || value.key !== unit.key || value.format !== 'iframe'
          || value.width !== unit.width || value.height !== unit.height) {
          throw new Error('Approved inline banner configuration did not execute');
        }
        ownedOptions = value;
        preparingInline = false;
        if (signal?.aborted) { aborted(); return; }
        externalEmitted = true;
        container.append(external);
        if (signal?.aborted) aborted();
      } catch (error) { preparingInline = false; fail(error); }
    }

    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    queue.pending.push(job);
    pump(queue);
  });
}
