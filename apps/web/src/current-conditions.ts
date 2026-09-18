import type { Forecast } from '@zindycast/contracts';
/** Current modeled estimate is independently timed; never interpolate hourly heat inputs. */
export function eligibleCurrent(forecast: Forecast | undefined, now: number, fresh: boolean) {
 const current=forecast?.current;
 if(!fresh||!current)return undefined;
 const age=now-Date.parse(current.time);
 return age>=0&&age<30*60000 ? current : undefined;
}
