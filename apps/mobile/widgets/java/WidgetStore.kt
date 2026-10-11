package family.zindycast.app

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import org.json.JSONObject
import java.net.URI
import java.util.TimeZone

object WidgetStore {
  const val JOB_ID = 73421
  val providers = listOf(FeelsLikeWidget::class.java, AirTemperatureWidget::class.java, WbgtWidget::class.java, CombinedWidget::class.java)
  private fun prefs(context: Context) = context.getSharedPreferences("zindycast.widgets.v1", Context.MODE_PRIVATE)
  fun config(context: Context): String? = prefs(context).getString("config", null)
  fun snapshot(context: Context): JSONObject? = try { JSONObject(prefs(context).getString("snapshot", "")!!) } catch (_: Exception) { null }
  fun error(context: Context): Boolean = prefs(context).getBoolean("error", false)

  fun validOrigin(server: String): Boolean = try {
    val uri = URI(server)
    val host = uri.host?.lowercase() ?: ""
    uri.scheme == "https" && host.isNotEmpty() && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null &&
      (uri.path.isNullOrEmpty() || uri.path == "/") &&
      !Regex("(^|\\.)(example|invalid|test|localhost)$|(^|\\.)example\\.(com|org|net)$|^127\\.").containsMatchIn(host) &&
      host !in listOf("0.0.0.0", "10.0.2.2", "[::1]", "[::]", "::1")
  } catch (_: Exception) { false }

  @Synchronized fun configure(context: Context, raw: String) {
    require(raw.length <= 8192)
    val data = JSONObject(raw)
    require(validOrigin(data.getString("server")))
    require(data.getString("units") in listOf("us", "metric"))
    val location = data.optJSONObject("location")
    if (location != null) {
      require(WidgetWeather.number(location, "latitude")?.let { it in -90.0..90.0 } == true)
      require(WidgetWeather.number(location, "longitude")?.let { it in -180.0..180.0 } == true)
      require(location.getString("name").length in 1..200 && location.getString("id").isNotEmpty())
      require(location.getString("timezone") in TimeZone.getAvailableIDs())
    }
    val old = config(context)?.let { JSONObject(it) }
    if (old != null && old.toString() == data.toString()) {
      render(context)
      if (System.currentTimeMillis() - (snapshot(context)?.optLong("checkedAt") ?: 0) > 300000) schedule(context)
      return
    }
    // Unit changes preserve SI data. City/server changes invalidate it immediately.
    val same = old?.optString("server") == data.optString("server") && old?.optJSONObject("location")?.toString() == location?.toString()
    val editor = prefs(context).edit().putString("config", data.toString()).putBoolean("error", false)
    if (!same) editor.remove("snapshot")
    editor.commit()
    context.getSystemService(JobScheduler::class.java).cancel(JOB_ID)
    render(context)
    schedule(context)
  }

  @Synchronized fun save(context: Context, expected: String, snapshot: JSONObject?, failed: Boolean) {
    if (config(context) != expected) return // Late previous-city results must never win.
    val editor = prefs(context).edit().putBoolean("error", failed)
    if (snapshot != null) editor.putString("snapshot", snapshot.toString())
    editor.commit()
    render(context)
  }

  fun render(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    providers.forEach { provider -> manager.getAppWidgetIds(ComponentName(context, provider)).forEach { id -> WidgetRenderer.update(context, manager, id, provider.simpleName) } }
  }

  fun schedule(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    if (providers.none { manager.getAppWidgetIds(ComponentName(context, it)).isNotEmpty() }) return
    val data = config(context)?.let { JSONObject(it) } ?: return
    if (data.optJSONObject("location") == null) return
    val scheduler = context.getSystemService(JobScheduler::class.java)
    if (scheduler.getPendingJob(JOB_ID) != null) return
    scheduler.schedule(JobInfo.Builder(JOB_ID, ComponentName(context, WidgetRefreshService::class.java))
      .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setMinimumLatency(0).build())
  }
}
