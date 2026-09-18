export type SkyPhase = 'dawn' | 'day' | 'dusk' | 'night' | 'neutral';

/** Decorative lighting windows, not a calculation of civil twilight or moon position.
 * Astronomy is already validated against the selected location's local date.
 * Absolute instants avoid browser timezone and DST assumptions.
 */
export function skyPhase(now: number, astronomy: {sunrise: string | null; sunset: string | null} | undefined,
  isDay: 0 | 1 | null | undefined, fresh: boolean): SkyPhase {
  if (!fresh || !Number.isFinite(now)) return 'neutral';
  const rise = Date.parse(astronomy?.sunrise ?? '');
  const set = Date.parse(astronomy?.sunset ?? '');
  if (Number.isFinite(rise) && Number.isFinite(set) && rise < set) {
    // Cap the lighting window for very short polar days; never overlap phases.
    const window = Math.min(45 * 60_000, (set - rise) / 4);
    if (Math.abs(now - rise) <= window) return 'dawn';
    if (Math.abs(now - set) <= window) return 'dusk';
    return now > rise && now < set ? 'day' : 'night';
  }
  // Missing/polar astronomy does not justify inventing a local sunrise time.
  return isDay === 1 ? 'day' : isDay === 0 ? 'night' : 'neutral';
}
