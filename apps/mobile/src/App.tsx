import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Pressable, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import WebView from 'react-native-webview';
import { validateBase } from './api';
import { migrationFallbackScript, migrationScript, type PreviousPreferences } from './migration';

const preferencesKey = 'zindycast.preferences.v1';

function WeatherApp() {
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [origin, setOrigin] = useState('');
  const [input, setInput] = useState('');
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState('');
  const [webError, setWebError] = useState('');
  const [canGoBack, setCanGoBack] = useState(false);
  const [previous, setPrevious] = useState<PreviousPreferences>({});
  const [webVersion, setWebVersion] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(preferencesKey).then(raw => {
      const saved: PreviousPreferences = raw ? JSON.parse(raw) : {};
      setPrevious(saved);
      const candidate = typeof saved.server === 'string' && saved.server ? saved.server : process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
      try {
        const normalized = candidate.trim().replace(/\/$/, '');
        validateBase(normalized, !__DEV__);
        setOrigin(normalized);
        setInput(normalized);
      } catch { setSetup(true); }
    }).catch(() => {
      setError('Saved server settings could not be read. Enter the HTTPS address again.');
      setSetup(true);
    }).finally(() => setReady(true));
  }, []);

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (setup) {
        if (!origin) return false;
        setSetup(false);
      } else if (canGoBack) web.current?.goBack();
      else setSetup(true);
      return true;
    });
    return () => listener.remove();
  }, [canGoBack, origin, setup]);

  async function saveServer() {
    try {
      const normalized = input.trim().replace(/\/$/, '');
      validateBase(normalized, !__DEV__);
      await AsyncStorage.setItem(preferencesKey, JSON.stringify({ ...previous, server: normalized }));
      setPrevious(value => ({ ...value, server: normalized }));
      setOrigin(normalized);
      setWebError('');
      setError('');
      setCanGoBack(false);
      setWebVersion(value => value + 1);
      setSetup(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save the server address.'); }
  }

  function allowNavigation(url: string): boolean {
    if (url === 'about:blank' || url.startsWith('blob:' + origin + '/')) return true;
    try {
      const destination = new URL(url);
      if (destination.origin === origin) return true;
      if (['https:', 'http:', 'mailto:', 'tel:'].includes(destination.protocol)) {
        void Linking.openURL(url).catch(() => setWebError('The external link could not be opened.'));
      }
    } catch { /* Ignore unsupported navigation schemes. */ }
    return false;
  }

  if (!ready) return <SafeAreaView style={styles.loading}><ActivityIndicator color="#234e47" /></SafeAreaView>;
  return <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
    <StatusBar barStyle="dark-content" backgroundColor="#f7f7f0" />
    {setup ? <View style={styles.setup}>
      <Text style={styles.brand}>ZindyCast</Text>
      <Text style={styles.heading}>Connect your weather app</Text>
      <Text style={styles.copy}>Enter the same private HTTPS address you use for the mobile PWA. Connect Tailscale on this device if your server requires it.</Text>
      <TextInput accessibilityLabel="Weather server address" style={styles.input} value={input} onChangeText={setInput} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://your-server.example" placeholderTextColor="#647b83" />
      <Pressable accessibilityRole="button" onPress={() => { void saveServer(); }} style={styles.button}><Text style={styles.buttonText}>Open ZindyCast</Text></Pressable>
      {origin ? <Pressable accessibilityRole="button" onPress={() => { setError(''); setSetup(false); }}><Text style={styles.link}>Return to weather</Text></Pressable> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Text style={styles.note}>Enter the origin only. Do not add /api/v1 or put passwords here. Press Android Back from the main screen to change this address later.</Text>
    </View> : <>
      <WebView
        key={`${origin}:${webVersion}`}
        ref={web}
        source={{ uri: origin }}
        style={styles.web}
        javaScriptEnabled
        domStorageEnabled
        geolocationEnabled
        sharedCookiesEnabled
        mixedContentMode="never"
        setSupportMultipleWindows={false}
        injectedJavaScriptBeforeContentLoaded={migrationScript(previous)}
        onShouldStartLoadWithRequest={request => allowNavigation(request.url)}
        onNavigationStateChange={navigation => setCanGoBack(navigation.canGoBack)}
        onLoadStart={() => setWebError('')}
        onLoadEnd={() => web.current?.injectJavaScript(migrationFallbackScript(previous))}
        onError={() => setWebError('Unable to load ZindyCast. Check your connection, Tailscale, and server address.')}
        renderLoading={() => <View style={styles.loading}><ActivityIndicator color="#234e47" /></View>}
        startInLoadingState
      />
      {webError ? <View style={styles.problem}><Text style={styles.error}>{webError}</Text><Pressable accessibilityRole="button" onPress={() => web.current?.reload()} style={styles.button}><Text style={styles.buttonText}>Retry</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setSetup(true)}><Text style={styles.link}>Server settings</Text></Pressable></View> : null}
    </>}
  </SafeAreaView>;
}

export default function App() { return <SafeAreaProvider><WeatherApp /></SafeAreaProvider>; }

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f7f7f0' }, web: { flex: 1, backgroundColor: '#f7f7f0' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f7f7f0' },
  setup: { flex: 1, padding: 24, gap: 18, backgroundColor: '#f7f7f0' },
  brand: { color: '#234e47', fontSize: 25, fontWeight: '800', marginTop: 12 },
  heading: { color: '#17332e', fontSize: 28, fontWeight: '700', marginTop: 18 },
  copy: { color: '#29433f', fontSize: 16, lineHeight: 24 },
  input: { borderColor: '#809b95', borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 54, color: '#17332e', fontSize: 16 },
  button: { backgroundColor: '#234e47', borderRadius: 12, minHeight: 52, alignItems: 'center', justifyContent: 'center', padding: 12 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  link: { color: '#234e47', fontSize: 16, fontWeight: '700', paddingVertical: 8 },
  error: { color: '#9d2d2d', fontSize: 15, lineHeight: 22 },
  note: { color: '#526d67', fontSize: 13, lineHeight: 20, marginTop: 14 },
  problem: { position: 'absolute', left: 16, right: 16, bottom: 24, padding: 18, gap: 10, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: '#c7d8d3' },
});
