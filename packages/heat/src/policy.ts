/** Editorial adaptation of https://www.weather.gov/safety/heat-during.
 * No numerical category, individualized workload or exposure duration is inferred.
 */
export const EDUCATION_POLICY_VERSION = 'zindy-heat-education-2026-09-10-1';
export type HeatActivity = 'relaxing' | 'walking' | 'strenuous';
export const HEAT_LIMITATION = 'This is an estimate for outdoor weather conditions. Sun exposure, nearby surfaces, shelter, clothing, exertion and individual health can change heat stress. It does not tell you how long it is safe to stay outside.';
const messages: Record<HeatActivity, string> = {
  relaxing: 'Choose a cooler place and make shade or indoor cooling available. Pay attention to how everyone feels.',
  walking: 'Plan for breaks and cooling; ease the pace or choose a cooler time when conditions feel taxing.',
  strenuous: 'Exercise adds substantial heat load. Reduce intensity and use cooler times and places; organized activities should follow their own heat procedures.',
};
export function heatEducation(activity: HeatActivity) {
  if (!Object.hasOwn(messages, activity)) throw new RangeError('Unknown heat activity');
  return { activity, message: messages[activity], policyVersion: EDUCATION_POLICY_VERSION,
    source: 'https://www.weather.gov/safety/heat-during', limitation: HEAT_LIMITATION,
    category: null, categoryUnavailableReason: 'policy_unapproved' as const, categoricalNotificationsEnabled: false as const };
}
