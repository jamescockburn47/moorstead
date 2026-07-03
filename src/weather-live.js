// weather-live.js — the moor's real weather.
//
// Pulls the *actual* current conditions over the North York Moors (Goathland)
// from Open-Meteo (keyless, CORS-friendly, free for non-commercial use) and maps
// them onto the game's existing weather states. We index the current UTC hour of
// the hourly forecast, so every client agrees on the same weather with no server
// coordination — the same shared-clock idea as the Great Fog and the seasons.
//
// `mapWeather` is pure (no fetch, no Date) so it's unit-tested headlessly. The
// fetch degrades gracefully: any failure leaves the game on its own random
// weather machine (see sky.js), so live weather is a layer, never a dependency.

const LAT = 54.40, LON = -0.72;   // Goathland, the heart of the moor
const URL = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`
  + `&hourly=weather_code,cloud_cover,precipitation,visibility,wind_speed_10m&timezone=UTC&forecast_days=1`;
const TTL = 15 * 60 * 1000;       // refresh every 15 minutes

let cached = null;                // last mapped weather, or null until first success

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// WMO weather code + fields → the game's weather. Pure, deterministic, testable.
export function mapWeather(s) {
  const code = s.weatherCode ?? 0;
  const cloud = s.cloudCover ?? 0;
  const precip = s.precipitation ?? 0;
  const vis = s.visibility ?? 30000;
  const wind = s.windSpeed ?? 10;
  let state;
  if (code === 45 || code === 48 || vis < 1000) state = 'fog';
  else if ((code >= 51 && code <= 99) || precip > 0.1) state = 'rain'; // drizzle/rain/snow/showers/storm
  // cloud>60 read almost every Goathland hour as 'misty' (real cloud cover there commonly
  // sits 60-85% on an ordinary, perfectly clear-feeling day — checked live 2026-07-03: 83%
  // at 00:00 UTC, no rain, 37 km visibility) — so misty was the de facto default rather
  // than the notable, atmospheric state the offline machine's rarity bias intends
  // (James 2026-07-03: "fog comes in too frequently"). Only near-total overcast now reads.
  else if (cloud > 85) state = 'misty';                                // properly overcast, not just cloudy
  else state = 'clear';
  return {
    state,
    rainAmount: clamp(precip / 4, 0, 1),       // 4 mm/h ≈ a proper downpour
    fogFar: clamp(20 + vis * 0.006, 25, 160),  // visibility (m) → draw distance (blocks)
    windiness: clamp(wind / 40, 0, 1),         // 40 km/h ≈ a gale on the tops
  };
}

async function fetchWeather() {
  try {
    const r = await fetch(URL);
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    const h = j.hourly;
    if (!h || !Array.isArray(h.weather_code) || !h.weather_code.length) throw new Error('no hourly data');
    const i = Math.min(new Date().getUTCHours(), h.weather_code.length - 1);
    cached = mapWeather({
      weatherCode: h.weather_code[i],
      cloudCover: h.cloud_cover?.[i],
      precipitation: h.precipitation?.[i],
      visibility: h.visibility?.[i],
      windSpeed: h.wind_speed_10m?.[i],
    });
  } catch {
    // leave `cached` as-is (null on first failure) → sky.js keeps its random weather
  }
  return cached;
}

// Kick off the polling loop. Safe to call once at startup; harmless at the title.
export function startLiveWeather() {
  fetchWeather();
  setInterval(fetchWeather, TTL);
}

// Latest mapped weather, or null if we've no live sample yet.
export function currentWeather() { return cached; }
