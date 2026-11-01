const NOTICE = 'Passage publicitaire avant accès à la source';
const PROTECTED_HOSTS = [
  'google.com', 'googlesyndication.com', 'googleadservices.com',
  'googletagservices.com', 'doubleclick.net', 'gstatic.com', 'googleusercontent.com',
];
const REDIRECT_PARAMETER = /^(?:url|u|target|dest|destination|redirect|redirect_uri|redirect_url|return|returnto|next|to|r)$/i;
const PROTECTED_PATH = /(?:^|\/)(?:privacy|confidentialite|confidentialité|cookies?|consent|terms|conditions)(?:[./_-]|$)/i;

function publicHostname(hostname) {
  return typeof hostname === 'string'
    && hostname.length <= 253
    && hostname === hostname.toLowerCase()
    && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)
    && !hostname.endsWith('.localhost')
    && !hostname.endsWith('.local');
}

function safeHttpsURL(value, destination = false) {
  if (typeof value !== 'string' || !value.startsWith('https://')
      || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const authority = value.slice(8).split(/[/?#]/, 1)[0];
    // Reject explicit ports (including :443), credentials and IP literals.
    if (!authority || /[:@\[\]]/.test(authority)) return null;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !publicHostname(url.hostname) || authority !== url.hostname) return null;
    if (destination && (url.search || url.hash || url.pathname === '/' || url.href !== value)) return null;
    for (const key of url.searchParams.keys()) {
      if (REDIRECT_PARAMETER.test(key)) return null;
    }
    return url;
  } catch {
    return null;
  }
}

function protectedSource(url) {
  return PROTECTED_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    || PROTECTED_PATH.test(url.pathname);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

// The configuration contains real, account-generated static links only.
// An invalid entry disables the entire mapping rather than partially applying it.
export function validateMonetizationConfig(config) {
  if (!plainObject(config) || config.enabled !== true
      || !Array.isArray(config.allowedHosts) || config.allowedHosts.length === 0
      || !plainObject(config.links)) return null;
  if (!config.allowedHosts.every(publicHostname)) return null;
  const allowedHosts = new Set(config.allowedHosts);
  const links = new Map();
  for (const [source, destination] of Object.entries(config.links)) {
    const sourceURL = safeHttpsURL(source);
    const destinationURL = safeHttpsURL(destination, true);
    if (!sourceURL || protectedSource(sourceURL) || !destinationURL
        || !allowedHosts.has(destinationURL.hostname)) return null;
    links.set(source, destination);
  }
  return links;
}

export function applyMonetizedLinks(document, links, currentHostname) {
  if (!(links instanceof Map) || links.size === 0 || typeof currentHostname !== 'string') return 0;
  const ownHost = currentHostname.toLowerCase().replace(/^www\./, '');
  let converted = 0;
  for (const anchor of document.querySelectorAll('a[href]')) {
    const source = anchor.getAttribute('href');
    if (!links.has(source) || anchor.getAttribute('data-monetized') === 'true') continue;
    const sourceURL = safeHttpsURL(source);
    if (!sourceURL || protectedSource(sourceURL)
        || sourceURL.hostname.replace(/^www\./, '') === ownHost) continue;
    if (anchor.closest('ins.adsbygoogle, [data-ad-client], [data-privacy-settings], [data-no-monetize], .fc-consent-root, .fc-dialog-container, [role="dialog"]')) continue;
    const rel = (anchor.getAttribute('rel') || '').split(/\s+/).filter(Boolean);
    if (rel.includes('privacy-policy') || rel.includes('terms-of-service')) continue;
    const title = anchor.getAttribute('title');
    const label = anchor.getAttribute('aria-label') || anchor.textContent.replace(/\s+/g, ' ').trim();
    anchor.setAttribute('href', links.get(source));
    anchor.setAttribute('data-monetized', 'true');
    anchor.setAttribute('title', title ? `${title} — ${NOTICE}` : NOTICE);
    anchor.setAttribute('aria-label', label ? `${label} — ${NOTICE}` : NOTICE);
    anchor.setAttribute('rel', [...new Set([...rel, 'sponsored', 'nofollow'])].join(' '));
    converted += 1;
  }
  if (converted > 0) {
    for (const notice of document.querySelectorAll('[data-monetization-notice]')) notice.hidden = false;
  }
  return converted;
}

async function initialize() {
  try {
    const response = await fetch(new URL('./monetization-config.json', import.meta.url), {
      credentials: 'omit', mode: 'same-origin',
    });
    if (!response.ok) return;
    const links = validateMonetizationConfig(await response.json());
    if (links) applyMonetizedLinks(document, links, window.location.hostname);
  } catch {
    // Missing, disabled or invalid configuration leaves the original links intact.
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') initialize();
