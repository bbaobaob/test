const UA = 'curl/8.0';
const FALLBACK = 'https://nekos.best/api/v2/waifu/6bbe46e3-6ea6-4960-92b6-36bd07871646.png';

const fs = require('fs');
const path = require('path');

const CATS = {
  female: ['waifu', 'neko', 'kitsune'],
  male: ['husbando'],
};

const SEEN_FILE = path.join(__dirname, '..', 'data', 'seen_images.json');

function validHttpsUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function loadSeen() {
  try { return JSON.parse(fs.readFileSync(SEEN_FILE, 'utf-8')); } catch { return {}; }
}

function saveSeen(data) {
  fs.mkdirSync(path.dirname(SEEN_FILE), { recursive: true });
  fs.writeFileSync(SEEN_FILE, JSON.stringify(data), 'utf-8');
}

function addSeen(tag, id) {
  const data = loadSeen();
  if (!data[tag]) data[tag] = [];
  if (!data[tag].includes(id)) data[tag].push(id);
  saveSeen(data);
}

async function fetchNekos(category) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let res;
  try {
    res = await fetch(`https://nekos.best/api/v2/${category}`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return null;
  const data = await res.json();
  return validHttpsUrl(data?.results?.[0]?.url) || null;
}

async function fetchSafebooru(tag) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  let res;
  try {
    res = await fetch(
      `https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&tags=${tag}+rating%3Asafe&limit=100`,
      {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !data.length) return null;

  const seenData = loadSeen();
  const seen = seenData[tag] || [];
  const fresh = data.filter(p => !seen.includes(p.id));
  const pool = fresh.length ? fresh : data;

  // Pool exhausted for THIS tag — reset only this tag's history so images can
  // repeat again. Other tags keep their seen lists.
  if (!fresh.length) {
    seenData[tag] = [];
    saveSeen(seenData);
  }

  const post = pool[Math.floor(Math.random() * pool.length)];
  addSeen(tag, post.id);
  return validHttpsUrl(post.file_url) || null;
}

// Fast fallback for femboy/tomboy via nekos.best (less accurate but faster)
async function fetchNekosBestGender(category) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  let res;
  try {
    res = await fetch(`https://nekos.best/api/v2/${category}`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return null;
  const data = await res.json();
  return validHttpsUrl(data?.results?.[0]?.url) || null;
}

async function getRandomWaifu(gender) {
  if (gender === 'femboy' || gender === 'tomboy') {
    const url = await fetchSafebooru(gender).catch(() => null);
    if (url) return { url };
    const fallbackTag = gender === 'femboy' ? 'neko' : 'husbando';
    const fallbackUrl = await fetchNekosBestGender(fallbackTag).catch(() => null);
    return { url: fallbackUrl || FALLBACK };
  }
  const pool = CATS[gender] || [...CATS.female, ...CATS.male];
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  for (const cat of shuffled) {
    const url = await fetchNekos(cat).catch(() => null);
    if (url) return { url };
  }
  return { url: FALLBACK };
}

module.exports = { getRandomWaifu };
