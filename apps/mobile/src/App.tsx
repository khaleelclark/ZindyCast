import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocationSchema, type Location } from '@zindycast/contracts';
import * as api from './api';
import { activeAlerts, amount, dayHours, dayKey, placeLabel, summary, temperature, wind, type Units } from './weather';
const KEY = 'zindycast.preferences.v1';
type Resource<T> = { data?: T; error?: string; loading: boolean };
function useResource<T>(location: Location | null, revision: number, fetcher: (location: Location, signal: AbortSignal) => Promise<T>): Resource<T> {
  const [state, setState] = useState<Resource<T> & { location?: Location; revision?: number }>({ loading: false });
  useEffect(() => {
    if (!location) return;
    const controller = new AbortController();
    setState({ loading: true, location, revision });
    fetcher(location, controller.signal).then(data => { if (!controller.signal.aborted) setState({ data, loading: false, location, revision }); }).catch(error => { if (!controller.signal.aborted) setState({ error: error instanceof Error ? error.message : 'Unable to load data.', loading: false, location, revision }); });
    return () => controller.abort();
  }, [location, revision, fetcher]);
  return state.location === location && state.revision === revision ? state : { loading: Boolean(location) };
}
function Button({ title, onPress, selected = false }: { title: string; onPress: () => void; selected?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.button, selected && styles.selected]}><Text style={styles.buttonText}>{title}</Text></Pressable>;
}
function Copy({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) { return <Text style={muted ? styles.muted : styles.copy}>{children}</Text>; }
function WeatherApp() {
  const [location, setLocation] = useState<Location | null>(null);
  const [units, setUnits] = useState<Units>('imperial');
  const [server, setServer] = useState(api.API_BASE);
  const [editingServer, setEditingServer] = useState(!api.API_BASE);
  const [serverError, setServerError] = useState('');
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Location[]>([]);
  const [searchError, setSearchError] = useState('');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [day, setDay] = useState(0);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [horizon, setHorizon] = useState(7);
  const weather = useResource(location, revision, api.forecast);
  const official = useResource(location, revision, api.alerts);
  const refresh = () => { setNow(Date.now()); setRevision(value => value + 1); };
  useEffect(() => {
    AsyncStorage.getItem(KEY).then(raw => {
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || !parsed) return;
      const saved = parsed as { location?: unknown; units?: unknown; server?: unknown };
      if (typeof saved.server === 'string' && saved.server) { api.configureApi(saved.server); setServer(api.API_BASE); setEditingServer(false); }
      const result = LocationSchema.safeParse(saved.location);
      if (result.success) { new Intl.DateTimeFormat('en-US', { timeZone: result.data.timezone }); setLocation(result.data); }
      if (saved.units === 'metric') setUnits('metric');
    }).catch(() => setStorageError('Saved preferences could not be read. Select a city again.')).finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(KEY, JSON.stringify({ location, units, server: api.API_BASE })).catch(() => setStorageError('Preferences could not be saved on this device.'));
  }, [ready, location, units, revision]);
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 60000);
    const timer = setInterval(() => { if (AppState.currentState === 'active') refresh(); }, 300000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { clearInterval(clock); clearInterval(timer); subscription.remove(); };
  }, []);
  useEffect(() => {
    setResults([]); setSearchError(''); setSearched(false); setSearching(false);
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      api.search(query.trim(), controller.signal).then(items => { if (!controller.signal.aborted) { setResults(items); setSearched(true); } }).catch(error => { if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : 'Search unavailable.'); }).finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, revision]);
  const data = weather.data?.data;
  const zone = location?.timezone ?? 'UTC';
  const stamp = (time: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(time));
  const chosen = data ? dayHours(data.hours, zone, dayKey(now, zone, day)) : [];
  const selectedSummary = summary(chosen);
  const current = day === 0 ? data?.current : undefined;
  const stale = weather.data?.freshness === 'stale' || (data && now - Date.parse(data.provenance.retrievedAt) > 1800000);
  const alertData = official.data?.data;
  const oldAlerts = official.data?.freshness === 'stale' || (alertData && now - Date.parse(alertData.retrievedAt) > 300000);
  const visibleAlerts = alertData ? activeAlerts(alertData.alerts, now) : [];
  return <SafeAreaView style={styles.safe}><StatusBar barStyle="light-content" /><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={weather.loading || official.loading} onRefresh={refresh} tintColor="#fff" />}>
    <Text style={styles.brand}>ZindyCast <Text style={styles.eyebrow}> / WEATHER</Text></Text>
    <Copy muted>Weather beyond temperature</Copy>
    {storageError ? <Copy>{storageError}</Copy> : null}
    <Button title={editingServer ? 'Server settings open' : 'Server settings'} onPress={() => setEditingServer(value => !value)} />
    {editingServer && <View style={styles.card}><Text style={styles.subheading}>Connect your weather server</Text><Copy>Enter your private HTTPS server origin. Connect Tailscale on this device if your server requires it.</Copy><TextInput accessibilityLabel="API server origin" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://your-private-host.example" placeholderTextColor="#aebfd0" style={styles.input} /><Button title="Save server" onPress={() => { try { api.configureApi(server); setServer(api.API_BASE); setServerError(''); setEditingServer(false); refresh(); } catch (error) { setServerError(error instanceof Error ? error.message : 'Invalid server origin.'); } }} />{serverError ? <Copy>{serverError}</Copy> : null}<Copy muted>The address stays on this device. Do not include passwords or API keys.</Copy></View>}
    <Text style={styles.label}>FIND YOUR PLACE</Text>
    <TextInput accessibilityLabel="Search city" placeholder="Search city or town" placeholderTextColor="#aebfd0" value={query} onChangeText={setQuery} maxLength={100} style={styles.input} autoCorrect={false} returnKeyType="search" />
    {searching && <ActivityIndicator accessibilityLabel="Searching cities" color="#7ce5d7" />}
    {searchError ? <Copy>{searchError}</Copy> : null}
    {searched && !results.length && <Copy>No cities found. Try a nearby city or another spelling.</Copy>}
    {results.map(item => <Button key={`${item.id}:${item.latitude}:${item.longitude}`} title={placeLabel(item)} onPress={() => { setLocation(item); setQuery(''); setDay(0); }} />)}
    {!ready ? <ActivityIndicator color="#7ce5d7" /> : !location ? <View style={styles.card}><Text style={styles.heading}>Your weather, your place.</Text><Copy>Search and choose a city to start. Your city and units stay on this device.</Copy></View> : <>
      <Text style={styles.heading}>{location.name}</Text><Copy muted>{placeLabel(location)} · {zone}</Copy>
      <View style={styles.row}><Button title="Today" selected={day === 0} onPress={() => setDay(0)} /><Button title="Tomorrow" selected={day === 1} onPress={() => setDay(1)} /><Button title={units === 'imperial' ? '°F · mph' : '°C · km/h'} onPress={() => setUnits(units === 'imperial' ? 'metric' : 'imperial')} /></View>
      {weather.loading && <Copy>Loading forecast…</Copy>}
      {weather.error && <View style={styles.card}><Copy>Forecast unavailable. {weather.error}</Copy><Button title="Try again" onPress={refresh} /></View>}
      {data && <>
        <View style={styles.hero}><Text style={styles.eyebrow}>{day === 0 ? 'TODAY' : 'TOMORROW'} · {dayKey(now, zone, day)}</Text>
          {stale && <Copy>STALE DATA · Refresh before relying on this forecast.</Copy>}
          <Text style={styles.temperature}>{temperature(current ? current.temperatureC : selectedSummary.high, units)}</Text>
          <Copy>{current ? `Modeled current · ${stamp(current.time)}` : 'Forecast high'}</Copy>
          {current && <Text style={styles.subheading}>Feels like {temperature(current.apparentTemperatureC, units)}</Text>}
          <Copy>High {temperature(selectedSummary.high, units)} · Low {temperature(selectedSummary.low, units)}</Copy>
          <Copy>Peak hourly rain chance {selectedSummary.rain == null ? '—' : `${selectedSummary.rain}%`}</Copy>
          {current && <Copy>Wind {wind(current.windSpeedMs, units)} · Humidity {current.humidityPercent == null ? '—' : `${current.humidityPercent}%`}</Copy>}
          <Copy muted>{chosen.length} forecast hours available for this local day. Missing values shown as —.</Copy>
        </View>
        <View style={styles.card}><Text style={styles.subheading}>{day === 0 ? 'Next 48 hours' : 'Tomorrow by hour'}</Text><Copy muted>All times in {zone}. Rain amounts/probability cover the preceding hour.</Copy>
          <ScrollView horizontal contentContainerStyle={styles.hourRow}>{(day === 0 ? data.hours.filter(hour => Date.parse(hour.time) >= now).slice(0, 48) : chosen).map(hour => <View key={hour.time} style={styles.hour}><Copy muted>{stamp(hour.time)}</Copy><Text style={styles.subheading}>{temperature(hour.temperatureC, units)}</Text><Copy>Feels {temperature(hour.apparentTemperatureC, units)}</Copy><Copy>Rain {hour.precipitationProbability == null ? '—' : `${hour.precipitationProbability}%`}</Copy><Copy>{amount(hour.precipitationMm, units)}</Copy><Copy>{wind(hour.windSpeedMs, units)}</Copy></View>)}</ScrollView>
        </View>
        <View style={styles.card}><Text style={styles.subheading}>Daily outlook</Text><View style={styles.row}>{[7, 10, 14].map(days => <Button key={days} title={`${days} days`} selected={days === horizon} onPress={() => setHorizon(days)} />)}</View>
          {Array.from({ length: horizon }, (_, offset) => { const key = dayKey(now, zone, offset); const hours = dayHours(data.hours, zone, key); const values = summary(hours); return <View key={key} style={styles.daily}><Copy>{key}</Copy><Copy>{temperature(values.high, units)} / {temperature(values.low, units)}</Copy><Copy muted>{hours.length ? `${hours.length} hours · peak rain ${values.rain == null ? '—' : `${values.rain}%`}` : 'Forecast unavailable'}</Copy></View>; })}
        </View>
        <View style={styles.card}><Text style={styles.subheading}>Source & freshness</Text><Copy>{data.provenance.provider} · {data.provenance.dataset} · {data.provenance.classification}</Copy><Copy>{data.provenance.attribution}</Copy><Copy muted>Retrieved {stamp(data.provenance.retrievedAt)}. Source issued: {data.provenance.sourceIssuedAt ? stamp(data.provenance.sourceIssuedAt) : 'not supplied'}. Retrieval is not model issue time.</Copy><Copy muted>Source grid {data.provenance.sourceCoordinates.latitude.toFixed(3)}, {data.provenance.sourceCoordinates.longitude.toFixed(3)}. {data.missingFields.length ? `Missing: ${data.missingFields.join(', ')}.` : ''}</Copy></View>
      </>}
        <View style={styles.card}><Text style={styles.subheading}>Official alerts · NWS</Text>
          {official.loading && <Copy>Checking official alerts…</Copy>}
          {official.error && <Copy>Alerts unavailable. {official.error}</Copy>}
          {oldAlerts && <Copy>Previously retrieved alerts may be outdated. Refresh to check updates and cancellations.</Copy>}
          {alertData && !visibleAlerts.length && <Copy>{oldAlerts ? 'No active alerts in the previously retrieved response.' : 'No active alerts reported in the latest response.'}</Copy>}
          {visibleAlerts.map(alert => <View key={alert.id} style={styles.alert}><Button title={`${alert.event} · ${alert.severity}`} onPress={() => setExpanded(expanded === alert.id ? null : alert.id)} />{expanded === alert.id && <><Copy>{alert.headline}</Copy><Copy>Sent {stamp(alert.sent)} · Expires {alert.expires ? stamp(alert.expires) : 'not supplied'}</Copy><Copy>{alert.areaDesc} · {alert.senderName}</Copy><Copy>{alert.description}</Copy><Copy>{alert.instruction ?? 'No additional instructions supplied.'}</Copy></>}</View>)}
          {alertData && <Copy muted>{alertData.attribution} · Retrieved {stamp(alertData.retrievedAt)}</Copy>}
          <Button title="Open weather.gov" onPress={() => { void Linking.openURL('https://www.weather.gov/').catch(() => setStorageError('Unable to open weather.gov.')); }} />
        </View>
    </>}
    <Copy muted>Pull to refresh. Checks every five minutes while open and when you return. Forecasts are modeled; no background notifications. Requires access to your configured server.</Copy>
  </ScrollView></SafeAreaView>;
}
export default function App() { return <SafeAreaProvider><WeatherApp /></SafeAreaProvider>; }
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a1728' }, page: { padding: 20, gap: 14, paddingBottom: 40 }, brand: { fontSize: 27, fontWeight: '800', color: '#fff' }, eyebrow: { color: '#a7ece3', fontSize: 12, fontWeight: '700', letterSpacing: 1 }, label: { color: '#aebfd0', fontSize: 12, fontWeight: '700', marginTop: 10 }, input: { minHeight: 52, borderWidth: 1, borderColor: '#4a647e', borderRadius: 14, paddingHorizontal: 16, color: '#fff', fontSize: 17, backgroundColor: '#14273d' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, button: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 15, paddingVertical: 12, borderRadius: 12, backgroundColor: '#243d56' }, selected: { backgroundColor: '#23685f' }, buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 }, card: { backgroundColor: '#14273d', borderRadius: 20, padding: 18, gap: 12 }, hero: { backgroundColor: '#164b5a', borderRadius: 24, padding: 24, gap: 12 }, temperature: { fontSize: 62, fontWeight: '700', color: '#fff' }, heading: { fontSize: 30, fontWeight: '700', color: '#fff' }, subheading: { fontSize: 20, fontWeight: '700', color: '#fff' }, copy: { color: '#f0f5fb', fontSize: 16, lineHeight: 24 }, muted: { color: '#b7cbdc', fontSize: 13, lineHeight: 20 }, hourRow: { gap: 12 }, hour: { width: 170, padding: 14, gap: 9, backgroundColor: '#1b354d', borderRadius: 14 }, daily: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#31475e', gap: 4 }, alert: { borderLeftWidth: 3, borderLeftColor: '#ffd393', paddingLeft: 10, gap: 12 }
});
