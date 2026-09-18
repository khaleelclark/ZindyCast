import {ClimateNormalsSchema,type ClimateNormals} from '../../contracts/src/climate-normals.js';
import {ProviderError} from './index.js';
const fields={averageHighC:'MLY-TMAX-NORMAL',averageLowC:'MLY-TMIN-NORMAL',meanC:'MLY-TAVG-NORMAL',precipitationMm:'MLY-PRCP-NORMAL'}as const;
/** RFC4180 quoting, bounded by caller; reject malformed quoting and duplicate columns. */
export function normalCsv(text:string):string[][] {
 if(text.length>524288)throw new Error('Normals too large');const rows:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
 if(c==='"'){if(field||closed)throw new Error('Malformed CSV quote');quoted=true;}
 else if(c===','||c==='\n'){row.push(field.trim());field='';closed=false;if(c==='\n'){if(row.some(Boolean))rows.push(row);row=[];}}
 else if(c==='\r'&&text[i+1]==='\n')continue;
 else{if(closed&&!/\s/.test(c))throw new Error('Malformed CSV');field+=c;}}
 if(quoted)throw new Error('Unclosed CSV');if(field||row.length){row.push(field.trim());rows.push(row);}if(rows.length>13)throw new Error('Too many normal rows');return rows;
}
export function parseClimateNormals(text:string,stationId:string,retrievedAt=new Date().toISOString()):ClimateNormals {
 if(!/^US[A-Z0-9]{9}$/.test(stationId))throw new Error('Invalid station');const [header,...rows]=normalCsv(text);if(!header||new Set(header).size!==header.length||rows.length!==12)throw new Error('Invalid normal rows');
 const records=rows.map(row=>{if(row.length!==header.length)throw new Error('CSV column mismatch');return Object.fromEntries(header.map((h,i)=>[h,row[i]]));});
 const first=records[0];const numeric=(v:string|undefined)=>{if(!v||!/^[-+]?\d+(\.\d+)?$/.test(v)||!Number.isFinite(Number(v)))throw new Error('Invalid number');return Number(v);};
 for(const r of records)if(r.STATION!==stationId||['LATITUDE','LONGITUDE','ELEVATION','NAME'].some(k=>r[k]!==first[k])||r.day!=='99'||r.hour!=='99')throw new Error('Station or monthly identity mismatch');
 const months=records.map(r=>({month:numeric(r.month),...Object.fromEntries(Object.entries(fields).map(([key,source])=>{
  const flag=r[`meas_flag_${source}`]??'M',complete=r[`comp_flag_${source}`]??'',raw=r[source],yearsRaw=r[`years_${source}`];
  const years=yearsRaw&&yearsRaw!=='-9999'?numeric(yearsRaw):null;
  let value:number|null=null;if(raw&&raw!=='-9999'&&['','X'].includes(flag)&&complete){const n=numeric(raw);if(key==='precipitationMm'&&n<0)throw new Error('Negative precipitation normal');value=key==='precipitationMm'?n*25.4:(n-32)*5/9;}
  return [key,{value,measurementFlag:flag,completenessFlag:complete,years}];}))})).sort((a,b)=>a.month-b.month);
 return ClimateNormalsSchema.parse({stationId,stationName:first.NAME,latitude:numeric(first.LATITUDE),longitude:numeric(first.LONGITUDE),elevationM:first.ELEVATION==='-999.9'?null:numeric(first.ELEVATION),baseline:'1991–2020',classification:'station-derived climate normals',retrievedAt,sourceUrl:`https://www.ncei.noaa.gov/data/normals-monthly/1991-2020/access/${stationId}.csv`,sourceUnits:'°F and inches',months});
}
export async function fetchClimateNormals(stationId:string,signal?:AbortSignal):Promise<ClimateNormals>{
 if(!/^US[A-Z0-9]{9}$/.test(stationId))throw new ProviderError('invalid_request','Invalid station ID');
 const response=await fetch(`https://www.ncei.noaa.gov/data/normals-monthly/1991-2020/access/${stationId}.csv`,{signal:AbortSignal.any([AbortSignal.timeout(10000),...(signal?[signal]:[])]),redirect:'error'});
 if(!response.ok){await response.body?.cancel();throw new ProviderError(response.status===404?'no_data':response.status===429?'rate_limited':'provider_error','Station normals unavailable');}
 const reader=response.body?.getReader();if(!reader)throw new Error('No normal data');let size=0;const parts:Uint8Array[]=[];
 try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>524288)throw new Error('Normal response too large');parts.push(r.value);}}finally{await reader.cancel();reader.releaseLock();}
 return parseClimateNormals(Buffer.concat(parts).toString('utf8'),stationId);
}
