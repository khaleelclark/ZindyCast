/* Independent verification caller by OpenAI Codex for ZindyCast, 2026-09-10.
 * Original file included verbatim; only its demonstration main is renamed.
 * No original calculation body is patched. Outputs include component sentinels.
 */
#define main original_demonstration_main
#include "wbgt-original.c"
#undef main
int main(void) {
  char id[80];
  int year, month, day, hour, minute, status;
  float lat, lon, temp, rh, pressure, wind, solar;
  float cza, fdir, adjusted;
  float estimated, globe, natural, psychrometric, wbgt;
  while (scanf("%79s %d %d %d %d %d %f %f %f %f %f %f %f", id,
      &year, &month, &day, &hour, &minute, &lat, &lon, &temp, &rh, &pressure, &wind, &solar) == 13) {
    estimated = -9999;
    status = calc_wbgt(year, month, day, hour, minute, 0, 0, lat, lon,
      solar, pressure, temp, rh, wind, 2.0, -0.5, 0,
      &estimated, &globe, &natural, &psychrometric, &wbgt);
    adjusted = solar;
    calc_solar_parameters(year, month, day + (hour + minute / 60.0) / 24.0, lat, lon, &adjusted, &cza, &fdir);
    printf("%s %d %.9g %.9g %.9g %.9g %.9g %.9g %.9g\n", id, status, globe, natural, psychrometric, wbgt, cza, fdir, adjusted);
  }
  return 0;
}
