function fallbackUrl() {
  return 'https://loremflickr.com/600/400/toast,bread,breakfast?random=' + Date.now();
}

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function isAllowedImageUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)staticflickr\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

async function getRandomImage() {
  try {
    const data = await fetchJson('https://www.flickr.com/services/feeds/photos_public.gne?tags=toast,bread,breakfast&format=json&nojsoncallback=1&per_page=20');
    const items = data?.items || [];
    if (items.length) {
      const pick = items[Math.floor(Math.random() * items.length)];
      const url = pick?.media?.m?.replace('_m.', '_z.') || null;
      if (url && isAllowedImageUrl(url)) {
        const author = pick?.author?.match(/\("(.+?)"\)/)?.[1] || pick?.author || 'Unknown';
        return { url, credit: `cre: ${author} via Flickr` };
      }
    }
  } catch (_) {}

  return {
    url: fallbackUrl(),
    credit: 'cre: loremflickr.com (Flickr toast photos)',
  };
}

module.exports = { getRandomImage };
