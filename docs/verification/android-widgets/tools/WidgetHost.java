package family.zindycast.widgetcheck;

import android.app.*;
import android.appwidget.*;
import android.content.*;
import android.os.*;
import android.graphics.Color;
import android.widget.*;
import org.json.*;
import dalvik.system.DexClassLoader;
import java.lang.reflect.*;

/** Local verification host only; never bundled in the ZindyCast app. */
public class WidgetHost extends Activity {
  AppWidgetHost host;
  int passed = 0;
  int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
  void check(boolean ok) { if (!ok) throw new AssertionError("Native weather check " + passed); passed++; }
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    ScrollView scroll = new ScrollView(this);
    scroll.setBackgroundColor(Color.rgb(37, 62, 65));
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(dp(16), dp(16), dp(16), dp(16));
    root.setOnApplyWindowInsetsListener((view, insets) -> {
      view.setPadding(dp(16), dp(16) + insets.getSystemWindowInsetTop(), dp(16), dp(16) + insets.getSystemWindowInsetBottom());
      return insets;
    });
    scroll.addView(root);
    setContentView(scroll);
    TextView status = new TextView(this);
    status.setTextColor(Color.WHITE);
    status.setTextSize(15);
    root.addView(status);
    try {
      runChecks();
      status.setText("ZindyCast widgets · emulator\n" + passed + " native data checks passed");
      android.util.Log.i("ZindyWidgetChecks", "PASS " + passed);
    } catch (Throwable error) {
      status.setText("FAILED: " + error);
      android.util.Log.e("ZindyWidgetChecks", "FAILED", error);
    }
    host = new AppWidgetHost(this, 4714);
    host.deleteHost();
    host.startListening();
    AppWidgetManager manager = AppWidgetManager.getInstance(this);
    LinearLayout row = new LinearLayout(this);
    root.addView(row);
    String[] classes = {"FeelsLikeWidget", "AirTemperatureWidget", "WbgtWidget", "CombinedWidget"};
    int screenWidth = Math.round(getResources().getDisplayMetrics().widthPixels / getResources().getDisplayMetrics().density);
    for (int i = 0; i < classes.length; i++) {
      int id = host.allocateAppWidgetId();
      ComponentName provider = new ComponentName("family.zindycast.app", "family.zindycast.app." + classes[i]);
      boolean combined = i == 3;
      int width = combined ? screenWidth - 32 : (screenWidth - 40) / 2;
      int height = combined ? 236 : 210;
      Bundle options = new Bundle();
      options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, width);
      options.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, width);
      options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, height);
      options.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, height);
      if (!manager.bindAppWidgetIdIfAllowed(id, provider, options)) throw new IllegalStateException("Grant widget bind permission to verification host");
      AppWidgetHostView widget = host.createView(this, id, manager.getAppWidgetInfo(id));
      widget.setPadding(0,0,0,0);
      LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(dp(width), dp(height));
      size.topMargin = dp(12);
      if (i == 1) size.leftMargin = dp(8);
      if (i < 2) row.addView(widget, size); else root.addView(widget, size);
    }
  }
  void runChecks() throws Exception {
    String apk = getPackageManager().getApplicationInfo("family.zindycast.app", 0).sourceDir;
    ClassLoader loader = new DexClassLoader(apk, getCodeCacheDir().toString(), null, getClassLoader());
    Class<?> weather = loader.loadClass("family.zindycast.app.WidgetWeather");
    Object instance = weather.getField("INSTANCE").get(null);
    Method decode = weather.getMethod("decode", JSONObject.class, JSONObject.class, long.class);
    Method fresh = weather.getMethod("fresh", JSONObject.class, long.class);
    Method wbgt = weather.getMethod("wbgt", JSONObject.class, long.class);
    Method display = weather.getMethod("display", Double.class, boolean.class, boolean.class);
    long now = 1791376200000L; // 2026-10-07 11:10 UTC, deterministic fixtures only.
    String time = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US) {{ setTimeZone(java.util.TimeZone.getTimeZone("UTC")); }}.format(new java.util.Date(now - 600000));
    JSONObject place = new JSONObject("{\"id\":\"fixture\",\"name\":\"Fixture City\",\"country\":\"US\",\"latitude\":21.3,\"longitude\":-157.8,\"timezone\":\"Pacific/Honolulu\"}");
    JSONObject hour = new JSONObject().put("time", time).put("temperatureC", 0).put("apparentTemperatureC", JSONObject.NULL);
    JSONObject estimate = new JSONObject().put("status", "success").put("valueC", 26.7).put("exposure", "modeled_outdoor_short_grass_reference").put("diagnostics", new JSONObject().put("input", new JSONObject().put("time", time)));
    estimate.put("policyVersion", "liljegren-1.1-zindy-ts-1+fao56-eq47-10m+om-instant-v1");
    for (String key : new String[]{"globe", "naturalWetBulb", "psychrometricWetBulb"}) estimate.getJSONObject("diagnostics").put(key, new JSONObject().put("status", "success").put("temperatureC", 25));
    hour.put("wbgt", estimate);
    JSONObject response = new JSONObject().put("status", "success").put("freshness", "fresh").put("data", new JSONObject().put("location", place).put("hours", new JSONArray().put(hour)).put("provenance", new JSONObject().put("provider", "Open-Meteo").put("classification", "modeled").put("retrievedAt", time)));
    JSONObject result = (JSONObject) decode.invoke(instance, response, place, now);
    check(result.getDouble("temperatureC") == 0);
    check(result.isNull("feelsC"));
    check(result.getDouble("wbgtC") == 26.7);
    check((Boolean) fresh.invoke(instance, result, now));
    check(!(Boolean) fresh.invoke(instance, result, now + 3600000));
    check(wbgt.invoke(instance, result, now + 3600000) == null);
    check(display.invoke(instance, Double.valueOf(0), false, false).equals("32°F"));
    check(display.invoke(instance, Double.valueOf(0), true, false).equals("0°C"));
    check(display.invoke(instance, null, true, false).equals("—"));
    estimate.getJSONObject("diagnostics").getJSONObject("input").put("time", "2020-01-01T00:00:00.000Z");
    check(((JSONObject)decode.invoke(instance, response, place, now)).isNull("wbgtC"));
    response.put("freshness", "stale");
    result = (JSONObject)decode.invoke(instance, response, place, now);
    check(!(Boolean)fresh.invoke(instance, result, now));
    JSONObject wrong = new JSONObject(place.toString()).put("longitude", -158);
    try { decode.invoke(instance, response, wrong, now); check(false); } catch (InvocationTargetException expected) { check(expected.getCause() instanceof IllegalArgumentException); }
    response.getJSONObject("data").getJSONArray("hours").put(new JSONObject(hour.toString()));
    try { decode.invoke(instance, response, place, now); check(false); } catch (InvocationTargetException expected) { check(expected.getCause() instanceof IllegalArgumentException); }
  }
  @Override public void onDestroy() { if (host != null) host.stopListening(); super.onDestroy(); }
}
