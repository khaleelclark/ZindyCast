/** Browser-visible, URL-restricted public token only. Missing/invalid means OSM. */
export function publicMapboxToken(value: string | undefined): string {
  const token = value?.trim() ?? '';
  return /^pk\.[A-Za-z0-9_.-]+$/.test(token) && token.length <= 2048 ? token : '';
}
export const mapboxPublicToken = publicMapboxToken(process.env.PUBLIC_MAPBOX_ACCESS_TOKEN);
