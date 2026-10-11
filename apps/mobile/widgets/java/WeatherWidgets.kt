package family.zindycast.app

import android.appwidget.AppWidgetProvider
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.os.Bundle

open class WeatherWidget : AppWidgetProvider() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == "family.zindycast.app.WIDGET_REFRESH") {
      WidgetStore.render(context)
      WidgetStore.schedule(context)
    } else super.onReceive(context, intent)
  }
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    WidgetStore.render(context)
    WidgetStore.schedule(context)
  }
  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
    WidgetRenderer.update(context, manager, id, javaClass.simpleName)
  }
}
class FeelsLikeWidget : WeatherWidget()
class AirTemperatureWidget : WeatherWidget()
class WbgtWidget : WeatherWidget()
class CombinedWidget : WeatherWidget()
