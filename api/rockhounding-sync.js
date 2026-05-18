import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SOURCE_URL = 'https://rockhounding.org/maps/us/wyoming';
const BASELINE_PATH = join(process.cwd(), 'src/data/rockhounding-wyoming-baseline.json');

function decodeSourceValue(value) {
  return value.replace(/\\u0026/g, '&').trim();
}

function normalizeFoundHere(value) {
  return [...value.matchAll(/"([^"]*)"/g)].map((item) => decodeSourceValue(item[1])).filter(Boolean);
}

export function parseRockhoundingLocations(html) {
  const normalized = html.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const locationPattern =
    /\{"id":"([^"]+)","slug":"([^"]+)","name":"([^"]+)","lng":(-?\d+(?:\.\d+)?),"lat":(-?\d+(?:\.\d+)?),"state_code":"WY","country_code":"US","location_type":"([^"]*)","found_here":\[(.*?)\]\}/g;
  const locations = [];
  const seenSlugs = new Set();
  let match;

  while ((match = locationPattern.exec(normalized))) {
    const [, id, slug, name, lng, lat, locationType, foundRaw] = match;
    if (seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    locations.push({
      id,
      slug,
      name: decodeSourceValue(name),
      lat: Number(lat),
      lng: Number(lng),
      locationType: decodeSourceValue(locationType),
      foundHere: normalizeFoundHere(foundRaw),
      sourceUrl: `https://rockhounding.org/us/wy/${slug}`,
    });
  }

  return locations.sort((a, b) => a.slug.localeCompare(b.slug));
}

function canonicalLocation(location) {
  return {
    slug: location.slug,
    name: location.name,
    lat: Number(location.lat.toFixed(6)),
    lng: Number(location.lng.toFixed(6)),
    locationType: location.locationType,
    foundHere: [...location.foundHere].sort((a, b) => a.localeCompare(b)),
  };
}

function hashLocations(locations) {
  const canonical = locations.map(canonicalLocation).sort((a, b) => a.slug.localeCompare(b.slug));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function compareLocations(baselineLocations, currentLocations) {
  const baselineBySlug = new Map(baselineLocations.map((location) => [location.slug, location]));
  const currentBySlug = new Map(currentLocations.map((location) => [location.slug, location]));
  const newLocations = currentLocations.filter((location) => !baselineBySlug.has(location.slug));
  const removedLocations = baselineLocations.filter((location) => !currentBySlug.has(location.slug));
  const changedLocations = currentLocations.flatMap((current) => {
    const baseline = baselineBySlug.get(current.slug);
    if (!baseline) return [];
    const before = hashLocations([baseline]);
    const after = hashLocations([current]);
    if (before === after) return [];

    return [
      {
        slug: current.slug,
        name: current.name,
        sourceUrl: current.sourceUrl,
        before: canonicalLocation(baseline),
        after: canonicalLocation(current),
      },
    ];
  });

  return { newLocations, removedLocations, changedLocations };
}

async function loadBaseline() {
  return JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
}

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return { ok: true, mode: 'readonly-no-secret' };
  }

  const authorization = request.headers.authorization || request.headers.Authorization;
  return {
    ok: authorization === `Bearer ${secret}`,
    mode: 'bearer-secret',
  };
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload, null, 2));
}

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method || 'GET')) {
    sendJson(response, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  const auth = isAuthorized(request);
  if (!auth.ok) {
    sendJson(response, 401, { ok: false, error: 'Unauthorized' });
    return;
  }

  try {
    const [baseline, sourceResponse] = await Promise.all([
      loadBaseline(),
      fetch(SOURCE_URL, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'WY Rock Radar source monitor (+https://wy-rock-radar.vercel.app)',
        },
      }),
    ]);

    if (!sourceResponse.ok) {
      sendJson(response, 502, {
        ok: false,
        error: `Rockhounding.org returned ${sourceResponse.status}`,
        sourceUrl: SOURCE_URL,
      });
      return;
    }

    const html = await sourceResponse.text();
    const currentLocations = parseRockhoundingLocations(html);
    const comparison = compareLocations(baseline.locations, currentLocations);
    const baselineHash = hashLocations(baseline.locations);
    const currentHash = hashLocations(currentLocations);
    const hasChanges =
      comparison.newLocations.length > 0 ||
      comparison.removedLocations.length > 0 ||
      comparison.changedLocations.length > 0;

    sendJson(response, 200, {
      ok: true,
      checkedAt: new Date().toISOString(),
      authMode: auth.mode,
      sourceUrl: SOURCE_URL,
      baselineCapturedAt: baseline.capturedAt,
      baselineCount: baseline.locations.length,
      currentCount: currentLocations.length,
      baselineHash,
      currentHash,
      hasChanges,
      newLocations: comparison.newLocations,
      removedLocations: comparison.removedLocations,
      changedLocations: comparison.changedLocations,
      warning:
        'Community-submitted locations are discovery inputs only. Verify coordinates, access, ownership, claims, and collecting rules before field use.',
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown sync error',
      sourceUrl: SOURCE_URL,
    });
  }
}
