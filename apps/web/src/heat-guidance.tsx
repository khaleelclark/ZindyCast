import { TULSA_WBGT_SCALE, tulsaWbgtPosition } from '@zindycast/heat';
import type { Units } from './weather';

// Tulsa names heat stress for each of its four upper bands, without distinct
// symptoms. Durations are attributed source references, never safe-time limits.
const effects = [
  'No effect specified by the source; this does not mean no risk.',
  ...[45, 30, 20, 15].map(minutes => `Heat strain during direct-sun work or exercise; source reference: ${minutes} min.`),
] as const;
const domain = [(70 - 32) * 5 / 9, (100 - 32) * 5 / 9] as const;
export function bandLabel(index: number, units: Units) {
  if (units === 'us') return `${TULSA_WBGT_SCALE.labels[index]}°F`;
  const bounds = TULSA_WBGT_SCALE.boundariesF.map(f => ((f - 32) * 5 / 9).toFixed(1));
  return `${index === 0 ? `<${bounds[0]}` : index === 4 ? `>${bounds[3]}` : `${bounds[index - 1]}–${bounds[index]}`}°C`;
}
export function HeatBandStatus({valueC, units}: {valueC: number | null; units: Units}) {
  const position = tulsaWbgtPosition({metric:'wbgt',valueC},domain);
  if (position.status !== 'positioned') return null;
  return <p className="heat-band-status">{position.bandIndex == null
    ? 'At a reference boundary — see the adjacent bands below.'
    : <>Current reference band: <strong>{bandLabel(position.bandIndex,units)}</strong></>}
    <small>Green to red means increasing heat stress.</small></p>;
}
export function HeatGuidance({valueC, units}: {valueC:number|null;units:Units}) {
  const position = tulsaWbgtPosition({metric:'wbgt',valueC},domain);
  const active = position.status === 'positioned' ? position.bandIndex : null;
  return <details className="heat-guidance"><summary>Heat precautions</summary>
    <p><a href={TULSA_WBGT_SCALE.sourceUrl} target="_blank" rel="noreferrer">NWS Tulsa</a> describes heat stress during outdoor work or exercise in direct sun. It does not assign specific symptoms to each band.</p>
    <div className="heat-guidance-table"><table><caption>NWS Tulsa WBGT reference · {units === 'us' ? '°F' : '°C'}</caption><thead><tr><th scope="col">WBGT</th><th scope="col">Effects on body</th></tr></thead><tbody>{effects.map((effect,index)=><tr key={index} className={active === index ? 'heat-guidance-current' : undefined} aria-current={active === index ? 'true' : undefined}><th scope="row"><span className={`heat-band-swatch heat-band-swatch-${index}`} aria-hidden="true"/>{bandLabel(index,units)}{active===index && <small>Current band</small>}</th><td>{effect}</td></tr>)}</tbody></table></div>
    <p className="subtle">Source times describe heat strain, not safe exposure limits or personal predictions. Individual responses vary with exertion, clothing, health and heat acclimatization. The source leaves exact band boundaries unclear and labels its calculator a nonoperational prototype.</p>
    <ul><li>Plan shaded rest stops and wear a hat with loose, lightweight clothing.</li><li>Ease strenuous activity in direct sun, especially with little airflow.</li><li>Drink water regularly and limit sun exposure.</li></ul>
  </details>;
}
