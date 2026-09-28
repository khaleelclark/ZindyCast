import { LocationSchema, type Location } from '@zindycast/contracts';

export type PreviousPreferences = { server?: unknown; location?: unknown; units?: unknown };
const preferencesKey = 'zindycast.preferences.v1';
const migrationKey = 'zindycast.native-migration.v1';

function savedLocation(candidate: unknown): Location | null {
  const result = LocationSchema.safeParse(candidate);
  if (!result.success) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: result.data.timezone }); }
  catch { return null; }
  return result.data;
}

/** Seed a fresh WebView profile from the prior native app before the PWA bundle starts. */
function webPreferences(previous: PreviousPreferences) {
  return {
    units: previous.units === 'metric' ? 'metric' : 'us',
    activity: 'walking',
    saved: [] as Location[],
    selected: savedLocation(previous.location),
    backgroundMotion: true,
  };
}

export function migrationScript(previous: PreviousPreferences): string {
  return `try { if (!localStorage.getItem(${JSON.stringify(preferencesKey)})) localStorage.setItem(${JSON.stringify(preferencesKey)}, ${JSON.stringify(JSON.stringify(webPreferences(previous)))}); } catch (_) {} true;`;
}

/** Android's early injection can miss a load; recover once after load, then preserve web choices. */
export function migrationFallbackScript(previous: PreviousPreferences): string {
  const next = webPreferences(previous);
  return `try {
    if (!localStorage.getItem(${JSON.stringify(migrationKey)})) {
      var key = ${JSON.stringify(preferencesKey)};
      var current = JSON.parse(localStorage.getItem(key) || 'null');
      var next = ${JSON.stringify(next)};
      var empty = !current || (current.selected == null && (!current.saved || current.saved.length === 0) && current.units === 'us');
      if (empty && (next.selected || next.units === 'metric')) {
        localStorage.setItem(key, JSON.stringify(next));
        localStorage.setItem(${JSON.stringify(migrationKey)}, '1');
        location.reload();
      } else localStorage.setItem(${JSON.stringify(migrationKey)}, '1');
    }
  } catch (_) {} true;`;
}
