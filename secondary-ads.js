import { createAdFallbackController } from './ad-fallback.js';
import { createSecondaryAdConsent } from './ad-consent.js';

const PLACEMENTS = new Set(['home-top', 'home-left', 'home-right', 'home-bottom', 'guide-top', 'guide-bottom']);
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const validVariants = (entry) => Array.isArray(entry?.variants) ? entry.variants.filter((variant) =>
  typeof variant?.id === 'string' && variant.id.trim()
  && (variant.responsive === true ? positiveInteger(variant.minWidth)
    : positiveInteger(variant.width) && positiveInteger(variant.height))) : [];
const variantFits = (variant, width) => Number.isFinite(width)
  && width > 0 && (variant.responsive === true ? variant.minWidth <= width : variant.width <= width);

export function selectAdVariant(entry, availableWidth) {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return null;
  const renderedWidth = (variant) => variant.responsive === true ? availableWidth : variant.width;
  return validVariants(entry).filter((variant) => variantFits(variant, availableWidth))
    .sort((a, b) => renderedWidth(b) - renderedWidth(a)
      || (b.minWidth ?? 0) - (a.minWidth ?? 0) || (b.height ?? 0) - (a.height ?? 0))[0] ?? null;
}

/**
 * Local-only orchestration; no config fetch, SDK, external URL or code evaluation.
 * Pass config {enabled:false, googleEligible:true, placements:{key:{variants:[]}}}.
 * Real variants carry {id,width,height,...opaqueFields}, or the native-responsive
 * shape {id,responsive:true,minWidth,...opaqueFields}. Responsive containers use
 * width:100% and height:auto; no placeholder pixel height or fixed-tag scaling.
 * Renderer receives the chosen variant as placement and owns its native tag.
 * It must honor signal, stay inside container, and return cleanup / {destroy()}.
 *
 * Native containers are siblings of ins.adsbygoogle, never its children. The
 * manager marks eligible parents data-fallback-ready="true" BEFORE measuring;
 * caller CSS must preserve these parents, put Google/native in the same grid
 * area, and keep mobile sidebars hidden. The manager never hides the Google ins.
 * Width/consent are checked again immediately before creating/loading anything.
 * Call refresh() after viewport changes; tags never reload and fixed ads never scale.
 * First rendering requires a foreground document. Already requested units survive
 * backgrounding, but consent withdrawal, Google fill and insufficient size still
 * remove them. An injected isVisible reports element/layout visibility only.
 *
 * requestConsent(store) is optional and called at most once for an unknown
 * choice with an eligible visible placement. Omit it to use stored choices only,
 * or supply a callback deferred until the caller's other CMP has completed.
 * Injected consentStore must expose getState(), subscribe(), and optionally
 * request()/openSettings(). Its lifetime remains the caller's responsibility.
 */
export function createSecondaryAdsManager({
  document = globalThis.document,
  slots = document?.querySelectorAll?.('ins.adsbygoogle') ?? [],
  config = {}, consentStore, requestConsent, renderer,
  isVisible, measureWidth, observeStatus, onError = () => {},
} = {}) {
  const known = [...slots].filter((slot) => PLACEMENTS.has(slot.getAttribute('data-ad-placement')));
  const entries = Object.assign(Object.create(null), config.placements ?? {});
  const choices = new WeakMap();
  const requestedSlots = new WeakSet();
  const marked = new Map();
  let store = consentStore;
  let ownsStore = false;
  let started = false;
  let destroyed = false;
  let requested = false;
  let controller;
  let unsubscribe;
  const keyFor = (slot) => slot.getAttribute('data-ad-placement');
  const parentFor = (slot) => slot.closest?.('.ad-placeholder') ?? slot.parentElement;
  const report = (error) => { try { onError(error); } catch { /* Reporting stays optional. */ } };
  function state() { try { return store?.getState() ?? 'unknown'; } catch (error) { report(error); return 'unknown'; } }
  function googleAvailableForFallback(slot) {
    const status = slot.getAttribute('data-ad-status');
    return status === 'unfilled' || (config.googleEligible === false && (status === null || status === ''));
  }
  function restore(parent) {
    if (!marked.has(parent)) return;
    const previous = marked.get(parent);
    if (previous === null) parent.removeAttribute('data-fallback-ready');
    else parent.setAttribute('data-fallback-ready', previous);
    marked.delete(parent);
  }
  function mark(slot) {
    const parent = parentFor(slot);
    if (!parent) return;
    if (!googleAvailableForFallback(slot) || !validVariants(entries[keyFor(slot)]).length) { restore(parent); return; }
    if (!marked.has(parent)) marked.set(parent, parent.getAttribute('data-fallback-ready'));
    parent.setAttribute('data-fallback-ready', 'true');
  }
  function width(slot) {
    if (measureWidth) return measureWidth(slot);
    const parent = parentFor(slot);
    const rectWidth = parent?.getBoundingClientRect?.().width;
    const style = document?.defaultView?.getComputedStyle?.(parent);
    const px = (name) => Number.parseFloat(style?.[name]) || 0;
    const padding = px('paddingLeft') + px('paddingRight');
    const borders = Number.isFinite(rectWidth) ? px('borderLeftWidth') + px('borderRightWidth') : 0;
    return Math.max(0, (Number.isFinite(rectWidth) ? rectWidth : parent?.clientWidth ?? 0) - padding - borders);
  }
  function visible(slot, preserveRequested = false) {
    if (document?.visibilityState === 'hidden' && !(preserveRequested && requestedSlots.has(slot))) return false;
    if (isVisible) return isVisible(slot) === true;
    const parent = parentFor(slot);
    if (!parent || parent.isConnected === false || parent.hidden) return false;
    const style = document?.defaultView?.getComputedStyle?.(parent);
    return style?.display !== 'none' && style?.visibility !== 'hidden' && Boolean(parent.getClientRects?.().length);
  }
  function fits(slot, preserveRequested = false) {
    try {
      if (!visible(slot, preserveRequested)) return false;
      const choice = choices.get(slot);
      return choice ? variantFits(choice, width(slot)) : Boolean(selectAdVariant(entries[keyFor(slot)], width(slot)));
    } catch (error) { report(error); return false; }
  }
  function freshPermission(slot) { return state() === 'accepted' && googleAvailableForFallback(slot) && fits(slot); }
  function keepEligible(slot) { return state() === 'accepted' && googleAvailableForFallback(slot) && fits(slot, true); }
  function observe(slot, changed) {
    const notify = () => { mark(slot); changed(); };
    if (observeStatus) return observeStatus(slot, notify);
    const Observer = document?.defaultView?.MutationObserver ?? globalThis.MutationObserver;
    if (!Observer) return () => {};
    const observer = new Observer(notify);
    observer.observe(slot, { attributes: true, attributeFilter: ['data-ad-status'] });
    return () => observer.disconnect();
  }
  function createContainer({ slot }) {
    if (!freshPermission(slot)) throw new Error('Secondary ad permission or visibility is no longer valid');
    const variant = selectAdVariant(entries[keyFor(slot)], width(slot));
    if (!variant) throw new Error('No secondary ad variant fits');
    choices.set(slot, variant);
    const container = document.createElement('div');
    container.className = 'ad-secondary-native';
    container.setAttribute('data-ad-placement', keyFor(slot));
    container.style.width = variant.responsive === true ? '100%' : variant.width + 'px';
    container.style.height = variant.responsive === true ? 'auto' : variant.height + 'px';
    slot.parentNode.insertBefore(container, slot.nextSibling);
    return container;
  }
  function render(input) {
    if (!freshPermission(input.slot) || input.signal.aborted) throw new Error('Secondary ad permission was withdrawn');
    requestedSlots.add(input.slot);
    return renderer({ ...input, placement: choices.get(input.slot), placementKey: keyFor(input.slot) });
  }

  function refresh() {
    if (destroyed) return Promise.resolve();
    if (!started) return start();
    if (!controller) return Promise.resolve();
    known.forEach(mark);
    const current = state();
    if (current === 'accepted') return controller.setConsent(true);
    controller.revoke();
    if (current === 'unknown' && !requested && typeof requestConsent === 'function'
      && known.some((slot) => googleAvailableForFallback(slot) && fits(slot))) {
      requested = true;
      try { Promise.resolve(requestConsent(store)).then(() => refresh(), report); } catch (error) { report(error); }
    }
    return Promise.resolve();
  }
  function start() {
    if (destroyed) return Promise.resolve();
    if (started) return refresh();
    started = true;
    if (config.enabled !== true || typeof renderer !== 'function' || !document?.createElement
      || !known.some((slot) => validVariants(entries[keyFor(slot)]).length)) return Promise.resolve();
    try {
      if (!store) { store = createSecondaryAdConsent({ document }); ownsStore = true; }
      if (typeof store.getState !== 'function' || typeof store.subscribe !== 'function') throw new TypeError('A valid secondary consent store is required');
      controller = createAdFallbackController({ slots: known, config: { ...config, placements: entries }, consent: false,
        isVisible: keepEligible, createContainer, render, observeStatus: observe, onError: report });
      unsubscribe = store.subscribe((value) => {
        if (value !== 'accepted') controller.revoke();
        queueMicrotask(() => { if (!destroyed) refresh(); });
      });
      return refresh();
    } catch (error) { report(error); return Promise.resolve(); }
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    try { unsubscribe?.(); } catch (error) { report(error); }
    controller?.destroy();
    for (const parent of [...marked.keys()]) restore(parent);
    if (ownsStore) store?.destroy();
  }
  return { start, refresh, destroy, get consentStore() { return store; } };
}
