package family.zindycast.app

import android.app.job.JobParameters
import android.app.job.JobService
import android.net.Uri
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicInteger
import java.io.ByteArrayOutputStream

/** Android owns job lifetime; the receiver never blocks on private-network I/O. */
class WidgetRefreshService : JobService() {
  private val executor = Executors.newSingleThreadExecutor()
  private var task: Future<*>? = null
  @Volatile private var connection: HttpsURLConnection? = null
  private val generation = AtomicInteger(0)

  override fun onStartJob(params: JobParameters): Boolean {
    val token = generation.incrementAndGet()
    val expected = WidgetStore.config(this) ?: return false
    task = executor.submit {
      try {
        val config = JSONObject(expected)
        val origin = config.getString("server")
        require(WidgetStore.validOrigin(origin))
        val location = config.getJSONObject("location")
        val builder = Uri.parse("$origin/api/v1/forecast").buildUpon()
        for (key in listOf("id", "name", "latitude", "longitude", "timezone", "admin1", "admin2", "country"))
          if (location.has(key)) builder.appendQueryParameter(key, location.getString(key))
        val conn = URL(builder.build().toString()).openConnection() as HttpsURLConnection
        connection = conn
        conn.connectTimeout = 10000
        conn.readTimeout = 10000
        conn.instanceFollowRedirects = false
        conn.setRequestProperty("Accept", "application/json")
        require(conn.responseCode == 200)
        val started = android.os.SystemClock.elapsedRealtime()
        val bytes = conn.inputStream.use { stream ->
          val output = ByteArrayOutputStream()
          val buffer = ByteArray(8192)
          while (true) {
            require(generation.get() == token && android.os.SystemClock.elapsedRealtime() - started < 20000)
            val count = stream.read(buffer)
            if (count < 0) break
            output.write(buffer, 0, count)
            require(output.size() <= 1500000)
          }
          output.toByteArray()
        }
        val snapshot = WidgetWeather.decode(JSONObject(String(bytes, Charsets.UTF_8)), location, System.currentTimeMillis())
        if (generation.get() == token) WidgetStore.save(this, expected, snapshot, false)
      } catch (_: Exception) {
        if (generation.get() == token) WidgetStore.save(this, expected, null, true)
      } finally {
        connection?.disconnect()
        connection = null
        if (generation.get() == token) jobFinished(params, false)
      }
    }
    return true
  }
  override fun onStopJob(params: JobParameters): Boolean {
    generation.incrementAndGet()
    connection?.disconnect()
    task?.cancel(true)
    return false
  }
  override fun onDestroy() {
    executor.shutdownNow()
    super.onDestroy()
  }
}
