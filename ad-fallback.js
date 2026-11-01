// Google status semantics: https://support.google.com/adsense/answer/10762946
// This controller contains no network SDK, tag, iframe, provider URL or timer.
const attemptedSlots = new WeakSet();
const protectedStatuses = new Set(['filled', 'unfill-optimized']);

function observeGoogleStatus(slot, changed) {
  if (typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(changed);
  observer.observe(slot, { attributes: true, attributeFilter: ['data-ad-status'] });
  return () => observer.disconnect();
}

function cleanupFunction(result) {
  if (typeof result === 'function') return result;
  if (typeof result?.destroy === 'function') return () => result.destroy();
  return null;
}

/**
 * Create one controller for the page's existing ins.adsbygoogle slots.
 *
 * render({slot, placement, container, signal}) may return a cleanup function,
 * {destroy()}, or a Promise of either. It must render only in its own container,
 * honor cancellation, and must not mutate or hide the supplied Google slot.
 * createContainer({slot, placement}) must return a separate native container,
 * never the Google slot, its child, or an ancestor containing it. No iframe is
 * assumed: the contracted renderer chooses its permitted native integration.
 *
 * Config: {enabled, googleEligible, placements: {[placementKey]: vendorValue}}.
 * placementKey prefers data-ad-placement, falling back to data-ad-slot for
 * existing integrations. Reused Google units can have distinct vendor codes.
 * googleEligible=false explicitly declares Google delivery unavailable,
 * verified externally (for example while the site awaits review).
 * Primary requests may continue so a later Google fill takes priority.
 * It permits an absent status, never a filled/optimized/pending/unknown status.
 * Consent defaults to false; isVisible must be supplied explicitly. Call
 * refresh() after setup/visibility changes, setConsent(true) only after the
 * provider's applicable consent is established, and revoke() upon withdrawal.
 * Each slot gets at most one attempt for this page lifetime, even across
 * controller instances, failed renders, consent changes, or viewport changes.
 */
export function createAdFallbackController({
  slots = [],
  config = {},
  consent = false,
  isVisible = () => false,
  createContainer,
  render,
  observeStatus = observeGoogleStatus,
  onError = () => {},
} = {}) {
  const settings = {
    enabled: config.enabled === true,
    googleEligible: config.googleEligible !== false,
    placements: Object.assign(Object.create(null), config.placements ?? {}),
  };
  const records = new Map();
  let consentGranted = consent === true;
  let destroyed = false;

  function report(error) { try { onError(error); } catch { /* Reporting must not block cleanup. */ } }
  function safely(callback) { try { callback?.(); } catch (error) { report(error); } }

  function permitted(record) {
    if (destroyed || !settings.enabled || !consentGranted) return false;
    if (typeof render !== 'function' || typeof createContainer !== 'function') return false;
    const { slot, placement } = record;
    if (placement === undefined || placement === null || placement === '') return false;
    const status = slot.getAttribute('data-ad-status');
    if (protectedStatuses.has(status)) return false;
    const explicitlyEmpty = status === 'unfilled';
    const reviewOnly = settings.googleEligible === false && (status === null || status === '');
    if (!explicitlyEmpty && !reviewOnly) return false;
    try { return isVisible(slot) === true; } catch (error) { report(error); return false; }
  }

  function stop(record) {
    record.generation += 1;
    const container = record.container;
    record.container = null;
    // Hide/remove only our container. A late Google fill is never hidden.
    if (container) safely(() => { container.hidden = true; });
    record.abort?.abort(); record.abort = null;
    const cleanup = record.cleanup;
    record.cleanup = null;
    safely(cleanup);
    if (container) safely(() => container.remove());
  }

  function evaluate(record) {
    if (!permitted(record)) { stop(record); return record.pending; }
    if (attemptedSlots.has(record.slot)) return record.pending;
    attemptedSlots.add(record.slot);
    const generation = ++record.generation;
    const abort = new AbortController();
    record.abort = abort;
    let result;
    try {
      const container = createContainer({ slot: record.slot, placement: record.placement });
      if (!container || container === record.slot || container.contains?.(record.slot) || record.slot.contains?.(container)) {
        throw new TypeError('Fallback container must be separate from the Google slot');
      }
      record.container = container;
      // A synchronous injected effect may have changed consent or Google state.
      if (generation !== record.generation || !permitted(record)) { stop(record); return null; }
      container.hidden = false;
      result = render({ slot: record.slot, placement: record.placement, container, signal: abort.signal });
    } catch (error) {
      stop(record); report(error); return null;
    }
    record.pending = Promise.resolve(result).then((value) => {
      const cleanup = cleanupFunction(value);
      if (generation !== record.generation || abort.signal.aborted) {
        // Late asynchronous completions must not resurrect an aborted fallback.
        safely(cleanup);
        return;
      }
      if (!permitted(record)) {
        record.cleanup = cleanup;
        stop(record);
        return;
      }
      record.cleanup = cleanup;
    }, (error) => {
      if (generation === record.generation) stop(record);
      report(error);
    });
    return record.pending;
  }

  for (const slot of slots) {
    if (records.has(slot) || slot?.matches?.('ins.adsbygoogle') !== true) continue;
    const key = slot.getAttribute('data-ad-placement') || slot.getAttribute('data-ad-slot');
    const placement = Object.hasOwn(settings.placements, key) ? settings.placements[key] : undefined;
    const record = { slot, placement, container: null, cleanup: null, abort: null, generation: 0, pending: null, disconnect: null };
    records.set(slot, record);
    try { record.disconnect = observeStatus(slot, () => { evaluate(record); }); }
    catch (error) { report(error); }
  }

  function refresh(slot) {
    if (destroyed) return Promise.resolve();
    const selected = slot ? [records.get(slot)].filter(Boolean) : [...records.values()];
    return Promise.all(selected.map(evaluate)).then(() => undefined);
  }
  function setConsent(granted) {
    consentGranted = granted === true;
    if (!consentGranted) {
      for (const record of records.values()) stop(record);
      return Promise.resolve();
    }
    return refresh();
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true; consentGranted = false;
    for (const record of records.values()) { safely(record.disconnect); stop(record); }
    records.clear();
  }
  return { refresh, setConsent, revoke: () => setConsent(false), destroy };
}
