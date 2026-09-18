import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parseBearerHeader, type InstallationRepository } from '@zindycast/installations';
import {
  VERIFICATION_BASELINE_MODEL,
  VerificationPlaceInputSchema,
  VerificationPlaceResponseSchema,
  VerificationPlacesResponseSchema,
  VerificationRemoveResponseSchema,
  VerificationScorecardResponseSchema,
  sanitizeForecast,
  type VerificationRepository,
} from '@zindycast/verification';
import type { Forecast } from '@zindycast/contracts';
import { fetchNearbyObservations } from '../../../packages/providers/src/observations.js';
import { ObservationsDataSchema, observationDistanceKm, type ObservationQuery, type ObservationsData } from '../../../packages/contracts/src/observations.js';

export interface VerificationApiServices {
  verification: VerificationRepository;
  installations: InstallationRepository;
  fetchStationCandidates?: (query: ObservationQuery, signal?: AbortSignal) => Promise<ObservationsData>;
  clock?: () => number;
}

function mutationAllowed(request: FastifyRequest): boolean {
  if (request.headers['x-zindycast-request'] !== '1') return false;
  const site = request.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
  if (!request.headers.origin) return true;
  try {
    const origin = new URL(request.headers.origin);
    return (origin.protocol === 'https:' || origin.protocol === 'http:') && origin.origin === request.headers.origin && origin.host === request.headers.host;
  } catch { return false; }
}

const error = (code: string, message: string) => ({ status: 'error', code, message });

/** Registration only. The app composition root owns constructing/closing the
 * dedicated repository and calling this function exactly once. */
export function registerVerification(app: FastifyInstance, services: VerificationApiServices): void {
  const { verification, installations } = services;
  const stationCandidates = services.fetchStationCandidates ?? fetchNearbyObservations;
  const clock = services.clock ?? Date.now;
  const identity = (request: FastifyRequest) => {
    const bearer = parseBearerHeader(request.headers.authorization);
    return bearer ? installations.authenticate(bearer) : null;
  };

  app.post('/api/v1/verification/places', async (request, reply) => {
    if (!mutationAllowed(request)) return reply.code(403).send(error('invalid_request', 'Same-origin application request required.'));
    const installation = identity(request);
    if (!installation) return reply.code(401).send(error('unauthorized', 'Installation credential required.'));
    const parsed = VerificationPlaceInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(error('invalid_request', 'A valid opted-in place and explicit observation station are required.'));
    try {
      const now = clock();
      const instant = new Date(now).toISOString();
      const query = { latitude: parsed.data.location.latitude, longitude: parsed.data.location.longitude,
        since: instant, until: instant, stationLimit: 3 as const };
      const controller = new AbortController();
      let rejectTimeout: (reason: unknown) => void = () => {};
      const timeout = new Promise<never>((_, reject) => { rejectTimeout = reject; });
      const timer = setTimeout(() => {
        const reason = new Error('station_validation_timeout');
        controller.abort(reason); rejectTimeout(reason);
      }, 10_000);
      let candidates: ObservationsData;
      try { candidates = ObservationsDataSchema.parse(await Promise.race([stationCandidates(query, controller.signal), timeout])); }
      finally { clearTimeout(timer); }
      const checkedAt = clock();
      if (candidates.query.latitude !== query.latitude || candidates.query.longitude !== query.longitude ||
          candidates.query.since !== instant || candidates.query.until !== instant || candidates.query.stationLimit !== 3 ||
          Date.parse(candidates.retrievedAt) > checkedAt || checkedAt - Date.parse(candidates.retrievedAt) > 5 * 60_000) {
        return reply.code(503).send(error('provider_error', 'Fresh station metadata could not be verified.'));
      }
      const selected = candidates.stations.find(station => station.stationId === parsed.data.station.id);
      if (!selected) return reply.code(400).send(error('invalid_request', 'The selected observation station is not in the current bounded candidate set.'));
      const place = verification.registerPlace(installation.id, {
        ...parsed.data,
        station: {
          id: selected.stationId,
          name: selected.name,
          coordinates: selected.coordinates,
          elevationM: selected.elevationM,
          distanceKm: observationDistanceKm(parsed.data.location, selected.coordinates),
          elevationDifferenceM: null,
          selectionVersion: 'user-selected-nws-v1',
        },
      });
      return reply.code(201).send(VerificationPlaceResponseSchema.parse({ status: 'success', place }));
    } catch (caught) {
      const conflict = caught instanceof RangeError && caught.message.includes('different immutable metadata');
      const capacity = caught instanceof RangeError && caught.message.includes('limit reached');
      return reply.code(conflict ? 409 : capacity ? 429 : 503).send(error(conflict ? 'conflict' : capacity ? 'rate_limited' : 'provider_error',
        conflict ? 'Remove the existing place before changing its station or location.' : capacity ? 'Verification place capacity is reached.' : 'Verification registration is temporarily unavailable.'));
    }
  });

  app.get('/api/v1/verification/places', async (request, reply) => {
    const installation = identity(request);
    if (!installation) return reply.code(401).send(error('unauthorized', 'Installation credential required.'));
    try { return VerificationPlacesResponseSchema.parse({ status: 'success', places: verification.listPlaces(installation.id) }); }
    catch { return reply.code(503).send(error('provider_error', 'Verification registrations are temporarily unavailable.')); }
  });

  app.delete<{ Params: { placeId: string } }>('/api/v1/verification/places/:placeId', async (request, reply) => {
    if (!mutationAllowed(request)) return reply.code(403).send(error('invalid_request', 'Same-origin application request required.'));
    const installation = identity(request);
    if (!installation) return reply.code(401).send(error('unauthorized', 'Installation credential required.'));
    try {
      if (!verification.removePlace(installation.id, request.params.placeId)) return reply.code(404).send(error('not_found', 'Verification place is not registered.'));
      return reply.code(204).send();
    } catch { return reply.code(404).send(error('not_found', 'Verification place is not registered.')); }
  });

  app.post<{ Params: { placeId: string } }>('/api/v1/verification/places/:placeId/remove', async (request, reply) => {
    if (!mutationAllowed(request)) return reply.code(403).send(error('invalid_request', 'Same-origin application request required.'));
    const installation = identity(request);
    if (!installation) return reply.code(401).send(error('unauthorized', 'Installation credential required.'));
    try {
      if (!verification.removePlace(installation.id, request.params.placeId)) return reply.code(404).send(error('not_found', 'Verification place is not registered.'));
      return VerificationRemoveResponseSchema.parse({ status: 'success' });
    } catch { return reply.code(404).send(error('not_found', 'Verification place is not registered.')); }
  });

  app.get<{ Params: { placeId: string } }>('/api/v1/verification/scorecards/:placeId', async (request, reply) => {
    const installation = identity(request);
    if (!installation) return reply.code(401).send(error('unauthorized', 'Installation credential required.'));
    try {
      const place = verification.place(installation.id, request.params.placeId);
      if (!place) return reply.code(404).send(error('not_found', 'Verification scorecard is unavailable.'));
      return VerificationScorecardResponseSchema.parse({ status: 'success', scorecard: verification.scorecard(place.targetKey) });
    } catch { return reply.code(503).send(error('provider_error', 'Verification scorecard is temporarily unavailable.')); }
  });
}

/** Safe forecast-route hook: stores only a received response already being returned
 * to a user and never performs provider work. Callers may log errors but must not
 * turn archive capacity into a forecast failure. */
export function archiveReceivedForecast(
  verification: VerificationRepository,
  forecast: Forecast,
  providerRequestVersion: string,
): { matchedTargets: number; insertedSnapshots: number; failedTargets: number } {
  const targets = verification.targetsForLocation(forecast.location.latitude, forecast.location.longitude, forecast.location.timezone);
  let insertedSnapshots = 0, failedTargets = 0;
  for (const target of targets) {
    try {
      if (verification.addForecastSnapshot(sanitizeForecast(target, VERIFICATION_BASELINE_MODEL, forecast, providerRequestVersion,
        forecast.provenance.sourceElevationM ?? null)).inserted) insertedSnapshots++;
    } catch { failedTargets++; }
  }
  return { matchedTargets: targets.length, insertedSnapshots, failedTargets };
}
