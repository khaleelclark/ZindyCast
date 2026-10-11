package family.zindycast.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import org.json.JSONObject

class ZindyCastWidgetPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(ZindyCastWidgets(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class ZindyCastWidgets(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "ZindyCastWidgets"
  @ReactMethod fun configure(raw: String) {
    try {
      WidgetStore.configure(context, raw)
    } catch (cause: Exception) { android.util.Log.w("ZindyCastWidgets", "Widget preferences could not be applied: " + cause.javaClass.simpleName) }
  }
  @ReactMethod fun resetServer(server: String) {
    if (!WidgetStore.validOrigin(server)) return
    val old = WidgetStore.config(context)?.let { JSONObject(it) }
    if (old?.optString("server") == server) return
    configure(JSONObject().put("server", server).put("units", "us").put("location", JSONObject.NULL).toString())
  }
}
