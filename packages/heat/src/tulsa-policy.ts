/** Source reference visualization only; never a personal risk or notification policy.
 * Audit and source distinctions: docs/decisions/tulsa-wbgt.md.
 */
export const TULSA_WBGT_SCALE = Object.freeze({
  version: 'nws-tulsa-text-reference-2026-09-11-v1',
  sourceUrl: 'https://www.weather.gov/tsa/wbgt',
  title: 'NWS Tulsa WBGT reference bands',
  sourceStatus: 'nonoperational_prototype',
  metric: 'wbgt',
  sourceUnit: '°F',
  labels: Object.freeze(['<80', '80–85', '85–88', '88–90', '>90'] as const),
  boundariesF: Object.freeze([80, 85, 88, 90] as const),
  boundaryPolicy: 'unresolved_at_printed_endpoints',
  limitation: 'Reference bands, not personal safety limits. The source does not establish precise endpoint rules or a safe exposure time.',
  categoricalNotificationsEnabled: false,
} as const);

export type TulsaWbgtPosition =
  | { status: 'unavailable'; reason: 'wrong_metric' | 'missing_value' | 'invalid_domain' }
  | { status: 'positioned'; valueC: number; valueF: number; fraction: number;
      clipped: 'below' | 'above' | null; bandIndex: number | null;
      boundaryF: number | null; policyVersion: typeof TULSA_WBGT_SCALE.version };

/** Domain is a caller's finite chart viewport in °C, never a safety threshold.
 * Classify unrounded canonical °C against converted source endpoints. Exact
 * endpoints remain unresolved; no implicit half-open convention or rounding.
 * Callers must provide a successful WBGT calculation, its time and provenance.
 */
export function tulsaWbgtPosition(
  input: { metric: 'wbgt' | 'ordinary_wet_bulb' | 'heat_index'; valueC: number | null },
  domainC: readonly [number, number],
): TulsaWbgtPosition {
  if (input.metric !== 'wbgt') return { status: 'unavailable', reason: 'wrong_metric' };
  const valueC = input.valueC;
  if (typeof valueC !== 'number' || !Number.isFinite(valueC) || !Number.isFinite(valueC * 9 / 5 + 32))
    return { status: 'unavailable', reason: 'missing_value' };
  const [minimum, maximum] = domainC;
  const width = maximum - minimum;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || !Number.isFinite(width) || width <= 0)
    return { status: 'unavailable', reason: 'invalid_domain' };
  const boundariesC = TULSA_WBGT_SCALE.boundariesF.map(f => (f - 32) * 5 / 9);
  const boundaryIndex = boundariesC.indexOf(valueC);
  const nextBoundary = boundariesC.findIndex(c => valueC < c);
  return {
    status: 'positioned', valueC, valueF: valueC * 9 / 5 + 32,
    fraction: valueC <= minimum ? 0 : valueC >= maximum ? 1 : (valueC - minimum) / width,
    clipped: valueC < minimum ? 'below' : valueC > maximum ? 'above' : null,
    bandIndex: boundaryIndex >= 0 ? null : nextBoundary < 0 ? 4 : nextBoundary,
    boundaryF: boundaryIndex >= 0 ? TULSA_WBGT_SCALE.boundariesF[boundaryIndex] : null,
    policyVersion: TULSA_WBGT_SCALE.version,
  };
}
