import { LocationSchema } from '@zindycast/contracts';
import { validateBase } from './api';

export type WidgetPreferences = { server: string; location: ReturnType<typeof LocationSchema.parse> | null; units: 'us' | 'metric' };

/** Only the configured first-party WebView may change the native widget selection. */
export function widgetPreferences(message: string, page: string, server: string): WidgetPreferences | null {
  try {
    if (message.length > 8192 || new URL(page).origin !== server) return null;
    validateBase(server, true);
    const value = JSON.parse(message);
    if (value.type !== 'zindycast.widget.preferences' || !value.preferences ||
        !['us', 'metric'].includes(value.preferences.units)) return null;
    const location = value.preferences.selected == null ? null : LocationSchema.parse(value.preferences.selected);
    if (location) new Intl.DateTimeFormat('en-US', { timeZone: location.timezone });
    return { server, location, units: value.preferences.units };
  } catch { return null; }
}

/** Observe the existing PWA preference writes without requiring a web deployment. */
export function widgetBridgeScript(): string {
  return `(function () {
    if (window.__zindycastWidgets) { window.__zindycastWidgets(); return; }
    var last = null;
    function send() {
      try {
        var raw = localStorage.getItem('zindycast.preferences.v1');
        if (!raw || raw === last) return;
        var preferences = JSON.parse(raw);
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'zindycast.widget.preferences',preferences:preferences}));
        last = raw;
      } catch (_) {}
    }
    var original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      original.call(this, key, value);
      if (this === localStorage && key === 'zindycast.preferences.v1') send();
    };
    window.__zindycastWidgets = send;
    window.addEventListener('pageshow', send);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { last = null; send(); } });
    send();
  })(); true;`;
}
