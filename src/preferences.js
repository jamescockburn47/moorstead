// One boundary for local comfort and guidance preferences; no network or player identity.
export const PREFERENCE_KEY = 'moorstead-preferences';
export const DEFAULT_PREFERENCES = Object.freeze({
  largerWords: false, steadyCamera: true, lookSpeed: 1,
  plainInstructions: true, guidedStart: true, hasPlayed: false,
});

export function normalizePreferences(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const result = { ...DEFAULT_PREFERENCES };
  for (const key of ['largerWords', 'steadyCamera', 'plainInstructions', 'guidedStart', 'hasPlayed']) {
    if (typeof raw[key] === 'boolean') result[key] = raw[key];
  }
  if (typeof raw.lookSpeed === 'number' && Number.isFinite(raw.lookSpeed)) {
    result.lookSpeed = Math.max(0.5, Math.min(2, raw.lookSpeed));
  }
  return result;
}

export function readPreferences(storage) {
  try { return normalizePreferences(JSON.parse(storage.getItem(PREFERENCE_KEY))); }
  catch { return { ...DEFAULT_PREFERENCES }; } // unavailable/corrupt preferences never prevent play
}

export function writePreferences(storage, preferences) {
  try { storage.setItem(PREFERENCE_KEY, JSON.stringify(normalizePreferences(preferences))); return true; }
  catch { return false; } // caller reports session-only setting
}

export function comfortCamera(preferences, sprinting, fatigueAmplitude, time) {
  // Motion is opt-in, including during restore or with incomplete old preferences.
  if (preferences?.steadyCamera !== false) return { fov: 75, roll: 0, pitch: 0 };
  return { fov: sprinting ? 82 : 75,
    roll: Math.sin(time * 0.6) * 0.05 * fatigueAmplitude,
    pitch: Math.sin(time * 0.37 + 1.3) * 0.02 * fatigueAmplitude };
}

export async function captureMouse(canvas, unavailable) {
  if (!canvas.requestPointerLock) { unavailable(); return false; }
  try { await canvas.requestPointerLock({ unadjustedMovement: true }); return true; }
  catch {
    try { await canvas.requestPointerLock(); return true; }
    catch { unavailable(); return false; }
  }
}
