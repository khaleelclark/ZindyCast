package family.zindycast.app

import org.json.JSONObject
import java.text.SimpleDateFormat
import java.text.ParsePosition
import java.util.Locale
import java.util.TimeZone

/** SI only. Missing numbers stay null; readings retain their own valid time. */
object WidgetWeather {
  const val HOUR = 3600000L
  fun instant(value: String): Long {
    for (pattern in listOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")) {
      val position = ParsePosition(0)
      val date = SimpleDateFormat(pattern, Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC"); isLenient = false }.parse(value, position)
      if (date != null && position.index == value.length) return date.time
    }
    return 0L
  }
  fun number(data: JSONObject?, key: String): Double? =
    if (data == null || data.isNull(key)) null else (data.opt(key) as? Number)?.toDouble()?.takeIf { it.isFinite() }

  fun decode(response: JSONObject, location: JSONObject, now: Long): JSONObject {
    require(response.optString("status") == "success")
    val data = response.getJSONObject("data")
    val actual = data.getJSONObject("location")
    for (key in listOf("id", "name", "country", "timezone", "admin1", "admin2"))
      require(actual.optString(key) == location.optString(key)) { "Wrong location" }
    for (key in listOf("latitude", "longitude")) require(number(actual, key) == number(location, key)) { "Wrong coordinates" }
    val provenance = data.getJSONObject("provenance")
    require(provenance.optString("provider") == "Open-Meteo" && provenance.optString("classification") == "modeled")
    val retrieved = instant(provenance.optString("retrievedAt"))
    require(retrieved > 0 && retrieved <= now + 60000)
    val hours = data.getJSONArray("hours")
    require(hours.length() in 1..384)
    var previous = 0L
    var hour: JSONObject? = null
    for (i in 0 until hours.length()) {
      val item = hours.getJSONObject(i)
      val time = instant(item.optString("time"))
      require(time > previous)
      previous = time
      if (time <= now && now - time < HOUR) hour = item
    }
    val current = data.optJSONObject("current")?.takeIf {
      val time = instant(it.optString("time"))
      time > 0 && now - time in 0 until 1800000L
    }
    val conditions = current ?: hour
    val wbgt = hour?.optJSONObject("wbgt")?.takeIf {
      val diagnostics = it.optJSONObject("diagnostics")
      it.optString("status") == "success" &&
        diagnostics?.optJSONObject("input")?.optString("time") == hour?.optString("time") &&
        it.optString("exposure") == "modeled_outdoor_short_grass_reference" &&
        it.optString("policyVersion") == "liljegren-1.1-zindy-ts-1+fao56-eq47-10m+om-instant-v1" &&
        listOf("globe", "naturalWetBulb", "psychrometricWetBulb").all { key ->
          val component = diagnostics?.optJSONObject(key)
          component?.optString("status") == "success" && number(component, "temperatureC") != null
        }
    }
    return JSONObject().apply {
      put("temperatureC", number(conditions, "temperatureC") ?: JSONObject.NULL)
      put("feelsC", number(conditions, "apparentTemperatureC") ?: JSONObject.NULL)
      put("wbgtC", number(wbgt, "valueC") ?: JSONObject.NULL)
      put("weatherCode", number(conditions, "weatherCode") ?: JSONObject.NULL)
      put("validAt", instant(conditions?.optString("time") ?: ""))
      put("wbgtAt", instant(hour?.optString("time") ?: ""))
      put("retrievedAt", retrieved)
      put("checkedAt", now)
      put("fresh", response.optString("freshness") == "fresh" && now - retrieved < HOUR)
    }
  }

  fun fresh(snapshot: JSONObject?, now: Long): Boolean = snapshot != null && snapshot.optBoolean("fresh") &&
    now - snapshot.optLong("retrievedAt") in 0 until HOUR && now - snapshot.optLong("checkedAt") in 0 until HOUR &&
    now - snapshot.optLong("validAt") in 0 until HOUR

  fun wbgt(snapshot: JSONObject?, now: Long): Double? = if (fresh(snapshot, now) &&
    now - (snapshot?.optLong("wbgtAt") ?: 0) in 0 until HOUR) number(snapshot, "wbgtC") else null

  fun display(value: Double?, metric: Boolean, decimals: Boolean = false): String {
    if (value == null) return "—"
    val converted = if (metric) value else value * 9 / 5 + 32
    return String.format(java.util.Locale.US, if (decimals) "%.1f°%s" else "%.0f°%s", converted, if (metric) "C" else "F")
  }
}
