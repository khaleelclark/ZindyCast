package family.zindycast.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.*
import android.widget.RemoteViews
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.*

/** Static artwork: no WebView, animations, GPS, or JS runtime on the home screen. */
object WidgetRenderer {
  private val ink = Color.rgb(35, 78, 71)
  private val muted = Color.rgb(83, 110, 101)
  private val amber = Color.rgb(211, 125, 38)
  private val violet = Color.rgb(105, 83, 155)
  private val colors = intArrayOf(Color.rgb(74, 148, 89), Color.rgb(239, 193, 74), Color.rgb(232, 142, 53), Color.rgb(208, 83, 73), Color.rgb(143, 54, 76))

  fun update(context: Context, manager: AppWidgetManager, id: Int, kind: String) {
    val config = WidgetStore.config(context)?.let { JSONObject(it) }
    val location = config?.optJSONObject("location")
    val snapshot = WidgetStore.snapshot(context)
    val now = System.currentTimeMillis()
    val metric = config?.optString("units") == "metric"
    val fresh = WidgetWeather.fresh(snapshot, now) && !WidgetStore.error(context)
    val wbgt = if (fresh) WidgetWeather.wbgt(snapshot, now) else null
    val temp = WidgetWeather.number(snapshot, "temperatureC")
    val feels = WidgetWeather.number(snapshot, "feelsC")
    val title = when (kind) { "FeelsLikeWidget" -> "Feels like"; "AirTemperatureWidget" -> "Air temperature"; "WbgtWidget" -> "Outdoor WBGT"; else -> "Your weather, together" }
    val options = manager.getAppWidgetOptions(id)
    val width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, if (kind == "CombinedWidget") 320 else 150).coerceIn(120, 500)
    val height = (options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 180) - 84).coerceIn(64, 320)
    val views = RemoteViews(context.packageName, R.layout.widget_weather)
    views.setTextViewText(R.id.widget_city, location?.optString("name") ?: "ZindyCast")
    views.setTextViewText(R.id.widget_title, title)
    val picture = artwork(width - 24, height, kind, temp, feels, wbgt, metric, location != null, snapshot != null, fresh)
    views.setImageViewBitmap(R.id.widget_art, picture)
    fun stamp(time: Long?): String? = time?.takeIf { it > 0 }?.let {
      SimpleDateFormat("MMM d · h:mm a", Locale.getDefault()).apply { timeZone = TimeZone.getTimeZone(location?.optString("timezone") ?: "UTC") }.format(Date(it))
    }
    val airDate = stamp(snapshot?.optLong("validAt"))
    val wbgtDate = stamp(snapshot?.optLong("wbgtAt"))
    val date = if (kind == "WbgtWidget") wbgtDate else airDate
    val status = when {
      location == null -> "Open app · choose a city"
      WidgetStore.error(context) -> if (date == null) "Check Tailscale · tap ↻" else "Old · $date · check Tailscale"
      snapshot == null -> "Waiting for weather · tap ↻"
      date == null -> "No current reading · tap ↻"
      !fresh -> "Old reading · $date"
      kind == "CombinedWidget" && wbgt != null -> "Air $airDate · WBGT $wbgtDate"
      kind == "WbgtWidget" && wbgt == null -> "WBGT unavailable · $date"
      else -> "As of $date"
    }
    views.setTextViewText(R.id.widget_status, status)
    views.setTextViewText(R.id.widget_source, if (location == null) "Weather beyond temperature" else "Open-Meteo · modeled")
    views.setContentDescription(R.id.widget_art, "$title. Air ${WidgetWeather.display(temp, metric)}. Feels like ${WidgetWeather.display(feels, metric)}. WBGT ${WidgetWeather.display(wbgt, metric, true)}, valid $wbgtDate. $status. Modeled estimates.")
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)!!
      .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    views.setOnClickPendingIntent(R.id.widget_open, PendingIntent.getActivity(context, id, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    val refresh = Intent(context, WidgetStore.providers.first { it.simpleName == kind })
      .setAction("family.zindycast.app.WIDGET_REFRESH").addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
    views.setOnClickPendingIntent(R.id.widget_refresh, PendingIntent.getBroadcast(context, id, refresh, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    manager.updateAppWidget(id, views)
  }

  private fun artwork(width: Int, height: Int, kind: String, temp: Double?, feels: Double?, wbgt: Double?, metric: Boolean, configured: Boolean, loaded: Boolean, fresh: Boolean): Bitmap {
    val bitmap = Bitmap.createBitmap(width * 2, height * 2, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.scale(2f, 2f)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    fun text(value: String, x: Float, y: Float, size: Float, color: Int = ink, bold: Boolean = false, align: Paint.Align = Paint.Align.CENTER) {
      paint.apply { this.color = color; style = Paint.Style.FILL; textSize = size; typeface = if (bold) Typeface.create("sans-serif", Typeface.BOLD) else Typeface.create("sans-serif-medium", Typeface.NORMAL); textAlign = align }
      canvas.drawText(value, x, y, paint)
    }
    fun round(x: Float, y: Float, w: Float, h: Float, color: Int, radius: Float = 18f) {
      paint.apply { this.color = color; style = Paint.Style.FILL }
      canvas.drawRoundRect(x, y, x + w, y + h, radius, radius, paint)
    }
    fun sun(x: Float, y: Float, radius: Float) {
      paint.apply { color = amber; style = Paint.Style.STROKE; strokeWidth = 2.5f; strokeCap = Paint.Cap.ROUND }
      for (i in 0..7) {
        val angle = i * PI / 4
        canvas.drawLine(x + cos(angle).toFloat() * (radius + 4), y + sin(angle).toFloat() * (radius + 4), x + cos(angle).toFloat() * (radius + 8), y + sin(angle).toFloat() * (radius + 8), paint)
      }
      paint.style = Paint.Style.FILL
      canvas.drawCircle(x, y, radius, paint)
    }
    fun gauge(x: Float, y: Float, w: Float, h: Float, value: Double?) {
      val radius = min(w * .4f, h * .57f)
      val cx = x + w / 2
      val cy = y + h * .7f
      val rect = RectF(cx - radius, cy - radius, cx + radius, cy + radius)
      paint.apply { style = Paint.Style.STROKE; strokeWidth = max(6f, radius * .13f); strokeCap = Paint.Cap.ROUND; color = Color.rgb(216, 229, 220) }
      canvas.drawArc(rect, 155f, 230f, false, paint)
      if (value != null) {
        // Temperature color is a continuous display scale, never a safety threshold.
        paint.color = if (value < 15) Color.rgb(78, 144, 163) else if (value < 28) ink else amber
        val position = ((value + 20) / 70).coerceIn(0.0, 1.0).toFloat()
        canvas.drawArc(rect, 155f, position * 230, false, paint)
        val angle = (155 + position * 230) * PI / 180
        paint.apply { style = Paint.Style.FILL; color = Color.WHITE }
        canvas.drawCircle(cx + cos(angle).toFloat() * radius, cy + sin(angle).toFloat() * radius, max(2.5f, radius * .055f), paint)
      }
      text(WidgetWeather.display(value, metric), cx, cy + 5, min(w * .25f, 35f), if (fresh) ink else muted, true)
      text("feels like", cx, cy + 24, 11f, muted)
      val left = WidgetWeather.display(-20.0, metric)
      val right = WidgetWeather.display(50.0, metric)
      text(left, cx - radius, cy + radius * .58f + 5, 9f, muted)
      text(right, cx + radius, cy + radius * .58f + 5, 9f, muted)
    }
    fun bands(x: Float, y: Float, w: Float, value: Double?) {
      val gap = 3f
      val block = (w - gap * 4) / 5
      for (i in 0..4) round(x + i * (block + gap), y, block, 7f, if (value == null) Color.rgb(218, 223, 219) else colors[i], 3f)
      if (value != null) {
        val f = value * 9 / 5 + 32
        val boundaries = doubleArrayOf(80.0, 85.0, 88.0, 90.0)
        val boundary = boundaries.indexOfFirst { abs(it - f) < 1e-8 }
        val pos = if (boundary >= 0) (boundary + 1) / 5f else (boundaries.count { f > it } + .5f) / 5
        text("▼", x + w * pos, y - 3, 9f, violet)
      }
    }
    if (!configured) {
      round(0f, 0f, width.toFloat(), height.toFloat(), Color.rgb(234, 241, 230))
      sun(width / 2f, height * .32f, 13f)
      text("A little weather", width / 2f, height * .65f, 16f, ink, true)
      text("for your home screen", width / 2f, height * .65f + 19, 11f, muted)
      return bitmap
    }
    val w = width.toFloat()
    val h = height.toFloat()
    if (kind == "CombinedWidget") {
      // Two halves retain readable text at 4x2 and 4x3, and grow with the host.
      val left = w * .49f
      round(0f, 0f, left, h, Color.rgb(234, 241, 230))
      gauge(0f, 0f, left, h * .9f, feels)
      val rx = left + 8
      val rw = w - rx
      val rh = (h - 8) / 2
      round(rx, 0f, rw, rh, Color.rgb(252, 239, 210))
      text("AIR TEMPERATURE", rx + 12, 15f, 9f, muted, align = Paint.Align.LEFT)
      text(WidgetWeather.display(temp, metric), rx + 12, rh * .74f + 7, min(30f, rh * .45f), if (fresh) ink else muted, true, Paint.Align.LEFT)
      if (rw > 120) sun(w - 22, rh * .55f, 7f)
      round(rx, rh + 8, rw, rh, Color.rgb(237, 230, 247))
      text("OUTDOOR WBGT", rx + 12, rh + 25, 9f, muted, align = Paint.Align.LEFT)
      text(WidgetWeather.display(wbgt, metric, true), rx + 12, rh + 8 + rh * .66f, min(25f, rh * .4f), violet, true, Paint.Align.LEFT)
      bands(rx + 12, h - 12, rw - 24, wbgt)
    } else if (kind == "FeelsLikeWidget") {
      round(0f, 0f, w, h, Color.rgb(234, 241, 230))
      gauge(0f, 0f, w, h * .95f, feels)
    } else if (kind == "AirTemperatureWidget") {
      round(0f, 0f, w, h, Color.rgb(252, 239, 210))
      sun(w / 2, h * .22f, min(10f, h * .1f))
      text(WidgetWeather.display(temp, metric), w / 2, h * .66f, min(43f, w * .30f), if (fresh) ink else muted, true)
      text("air temperature", w / 2, h * .66f + 20, 11f, muted)
    } else {
      round(0f, 0f, w, h, Color.rgb(237, 230, 247))
      text(WidgetWeather.display(wbgt, metric, true), w / 2, h * .43f, min(33f, w * .24f), violet, true)
      text("outdoor heat estimate", w / 2, h * .43f + 19, 10f, muted)
      bands(12f, h * .76f, w - 24, wbgt)
      text("NWS Tulsa reference", w / 2, h - 5, 9f, muted)
    }
    return bitmap
  }
}
