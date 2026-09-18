import { z } from 'zod';

/** NOAA format and flags: https://www.ncei.noaa.gov/pub/data/ghcn/daily/readme.txt
 * Daily labels are NOT UTC instants. No station selection, splicing or eligibility policy.
 */
const DAY = 86400000;
const BASE = 'https://www.ncei.noaa.gov/pub/data/ghcn/daily/all/';
const DOC = 'https://www.ncei.noaa.gov/pub/data/ghcn/daily/readme.txt';
export const stationElements = ['TMAX', 'TMIN', 'PRCP'] as const;
type Element = typeof stationElements[number];
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const t = Date.parse(s); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s && s >= '0001-01-01';
});
export const StationQuerySchema = z.object({ stationId: z.string().regex(/^US[A-Z0-9]{9}$/), startDate: date, endDate: date }).strict()
  .refine(q => q.endDate >= q.startDate && (Date.parse(q.endDate) - Date.parse(q.startDate)) / DAY < 366,
    'Select 1–366 inclusive calendar dates.');
export type StationQuery = z.infer<typeof StationQuerySchema>;
const flag = z.string().regex(/^[ A-Za-z0-9]$/).nullable();
export const StationValueSchema = z.object({
  rawValue: z.number().int().min(-9999).max(99999).nullable(), value: z.number().finite().nullable(),
  measurementFlag: flag, qualityFlag: flag, sourceFlag: flag,
  missingReason: z.enum(['absent_month', 'source_missing']).nullable(),
  qcStatus: z.enum(['missing', 'unflagged', 'flagged', 'unknown_code']),
  trace: z.boolean(), presumedZero: z.boolean(), unknownFlags: z.array(z.enum(['measurement', 'quality', 'source'])),
}).strict();
export type StationValue = z.infer<typeof StationValueSchema>;
export const StationDaySchema = z.object({ date, TMAX: StationValueSchema, TMIN: StationValueSchema, PRCP: StationValueSchema }).strict();
const count = z.number().int().min(0).max(366);
const counts = z.object({ expected: count, present: count, missing: count, absentMonth: count, sourceMissing: count,
  unflagged: count, flagged: count, unknownQuality: count, unknownFlags: count, trace: count, presumedZero: count }).strict();
const ResultShape = z.object({ query: StationQuerySchema,
  station: z.object({ id: z.string(), name: z.null(), coordinates: z.null(), elevationM: z.null(), metadataStatus: z.literal('not_retrieved') }).strict(),
  timeContext: z.object({ basis: z.literal('source daily calendar labels'), timezone: z.null(), observationTime: z.null(),
    intervalStart: z.null(), intervalEnd: z.null() }).strict(),
  units: z.object({ TMAX: z.literal('°C'), TMIN: z.literal('°C'), PRCP: z.literal('mm') }).strict(),
  rawUnits: z.object({ TMAX: z.literal('tenths °C'), TMIN: z.literal('tenths °C'), PRCP: z.literal('tenths mm') }).strict(),
  provenance: z.object({ provider: z.literal('NOAA NCEI'), dataset: z.literal('GHCN-Daily'), datasetVersion: z.null(),
    classification: z.literal('station_daily_summary'), requestUrl: z.string().url(), sourceUrl: z.literal(DOC),
    retrievedAt: z.string().datetime(), sourceIssuedAt: z.null(), sourceUpdatedAt: z.null(),
    adapterVersion: z.literal('ghcnd-daily-v1') }).strict(),
  days: z.array(StationDaySchema).min(1).max(366),
  coverage: z.object({ TMAX: counts, TMIN: counts, PRCP: counts, jointUnflagged: count,
    eligibility: z.literal('not_assessed') }).strict(),
}).strict();
export type StationData = z.infer<typeof ResultShape>;
export function stationCell(rawValue: number | null, m: string | null, q: string | null, s: string | null): StationValue {
  const missing = rawValue === null || rawValue === -9999;
  const unknownFlags: StationValue['unknownFlags'] = [];
  if (m !== null && !' BDHKLOPTW'.includes(m)) unknownFlags.push('measurement');
  if (q !== null && !' DGIKLMNORSTWXZ'.includes(q)) unknownFlags.push('quality');
  if (s !== null && !' 01267AaBbCDdEFGHI KMfmNQRrSsTUuWXZz'.includes(s)) unknownFlags.push('source');
  return { rawValue, value: missing ? null : rawValue / 10, measurementFlag: m, qualityFlag: q, sourceFlag: s,
    missingReason: rawValue === null ? 'absent_month' : rawValue === -9999 ? 'source_missing' : null,
    qcStatus: missing ? 'missing' : q === ' ' ? 'unflagged' : unknownFlags.includes('quality') ? 'unknown_code' : 'flagged',
    trace: m === 'T', presumedZero: m === 'P', unknownFlags };
}
export function stationCoverage(days: StationData['days']): StationData['coverage'] {
  const result = {} as Pick<StationData['coverage'], Element>;
  for (const e of stationElements) {
    const v = days.map(d => d[e]);
    result[e] = { expected: v.length, present: v.filter(x => x.value !== null).length, missing: v.filter(x => x.value === null).length,
      absentMonth: v.filter(x => x.missingReason === 'absent_month').length, sourceMissing: v.filter(x => x.missingReason === 'source_missing').length,
      unflagged: v.filter(x => x.qcStatus === 'unflagged').length, flagged: v.filter(x => x.qcStatus === 'flagged').length,
      unknownQuality: v.filter(x => x.qcStatus === 'unknown_code').length, unknownFlags: v.filter(x => x.unknownFlags.length > 0).length,
      trace: v.filter(x => x.trace).length, presumedZero: v.filter(x => x.presumedZero).length };
  }
  return { ...result, jointUnflagged: days.filter(d => stationElements.every(e => d[e].qcStatus === 'unflagged')).length, eligibility: 'not_assessed' };
}
export const StationDataSchema = ResultShape.superRefine((d, ctx) => {
  const fail = () => ctx.addIssue({ code: 'custom', message: 'Inconsistent station timeline, values, or coverage.' });
  if (!StationQuerySchema.safeParse(d.query).success) { fail(); return; }
  if (d.station.id !== d.query.stationId || d.provenance.requestUrl !== BASE + d.query.stationId + '.dly' ||
    d.days.length !== (Date.parse(d.query.endDate) - Date.parse(d.query.startDate)) / DAY + 1) fail();
  d.days.forEach((row, i) => {
    if (row.date !== new Date(Date.parse(d.query.startDate) + i * DAY).toISOString().slice(0, 10)) fail();
    for (const e of stationElements) {
      const v = row[e];
      if (v.rawValue === null ? [v.measurementFlag,v.qualityFlag,v.sourceFlag].some(f => f !== null) :
        [v.measurementFlag,v.qualityFlag,v.sourceFlag].some(f => f === null)) fail();
      const expected = stationCell(v.rawValue, v.measurementFlag, v.qualityFlag, v.sourceFlag);
      for (const key of Object.keys(expected) as (keyof StationValue)[]) if (JSON.stringify(v[key]) !== JSON.stringify(expected[key])) fail();
    }
  });
  const expected = stationCoverage(d.days);
  for (const e of stationElements) for (const key of Object.keys(expected[e]) as (keyof typeof expected.TMAX)[])
    if (d.coverage[e][key] !== expected[e][key]) fail();
  if (d.coverage.jointUnflagged !== expected.jointUnflagged) fail();
});

export const StationResponseSchema = z.object({ status: z.literal('success'), freshness: z.literal('fresh'), data: StationDataSchema }).strict();
export type StationResponse = z.infer<typeof StationResponseSchema>;

/** Structural only: cross-field refinements require the runtime schemas. */
export const StationQueryJsonSchema = z.toJSONSchema(StationQuerySchema);
export const StationDataJsonSchema = z.toJSONSchema(StationDataSchema);
