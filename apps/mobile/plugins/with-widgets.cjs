const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withMainApplication, withDangerousMod } = require('expo/config-plugins');
const providers = ['FeelsLikeWidget', 'AirTemperatureWidget', 'WbgtWidget', 'CombinedWidget'];
const names = ['feels', 'air', 'wbgt', 'combined'];

function registerPackage(contents) {
  if (contents.includes('add(ZindyCastWidgetPackage())')) return contents;
  const target = 'PackageList(this).packages.apply {';
  if (!contents.includes(target)) throw new Error('Widget plugin could not find the React package list.');
  return contents.replace(target, target + '\n          add(ZindyCastWidgetPackage())');
}

module.exports = config => {
  if (config.android?.package !== 'family.zindycast.app') throw new Error('Widget native sources require the ZindyCast Android package.');
  config = withMainApplication(config, result => {
    if (result.modResults.language !== 'kt') throw new Error('Widget plugin requires Kotlin MainApplication.');
    result.modResults.contents = registerPackage(result.modResults.contents);
    return result;
  });
  config = withAndroidManifest(config, result => {
    const app = result.modResults.manifest.application[0];
    app.receiver = (app.receiver || []).filter(item => !providers.some(name => item.$['android:name'] === '.' + name));
    providers.forEach((name, i) => app.receiver.push({
      $: { 'android:name': '.' + name, 'android:exported': 'false', 'android:label': '@string/widget_' + names[i] },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] }],
      'meta-data': [{ $: { 'android:name': 'android.appwidget.provider', 'android:resource': '@xml/widget_' + names[i] } }],
    }));
    app.service = (app.service || []).filter(item => item.$['android:name'] !== '.WidgetRefreshService');
    app.service.push({ $: { 'android:name': '.WidgetRefreshService', 'android:permission': 'android.permission.BIND_JOB_SERVICE', 'android:exported': 'false' } });
    return result;
  });
  return withDangerousMod(config, ['android', async result => {
    const main = path.join(result.modRequest.platformProjectRoot, 'app/src/main');
    const source = path.join(result.modRequest.projectRoot, 'widgets');
    fs.cpSync(path.join(source, 'java'), path.join(main, 'java/family/zindycast/app'), { recursive: true });
    fs.cpSync(path.join(source, 'res'), path.join(main, 'res'), { recursive: true });
    fs.copyFileSync(path.join(result.modRequest.projectRoot, 'assets/icon.png'), path.join(main, 'res/drawable/widget_logo.png'));
    return result;
  }]);
};
module.exports.registerPackage = registerPackage;
