const { withAppBuildGradle } = require('expo/config-plugins');
const marker = '// ZINDYCAST_RELEASE_SIGNING';
const signing = `
${marker}
def zindycastStore = System.getenv('ZINDYCAST_ANDROID_KEYSTORE_PATH')
def zindycastStorePassword = System.getenv('ZINDYCAST_ANDROID_KEYSTORE_PASSWORD')
def zindycastAlias = System.getenv('ZINDYCAST_ANDROID_KEY_ALIAS')
def zindycastKeyPassword = System.getenv('ZINDYCAST_ANDROID_KEY_PASSWORD')
android {
    signingConfigs {
        zindycastRelease {
            if (zindycastStore) storeFile file(zindycastStore)
            storePassword zindycastStorePassword
            keyAlias zindycastAlias
            keyPassword zindycastKeyPassword
        }
    }
    buildTypes {
        release { signingConfig signingConfigs.zindycastRelease }
    }
}
gradle.taskGraph.whenReady { graph ->
    if (graph.allTasks.any { it.project == project && it.name.toLowerCase().contains('release') }) {
        if (!zindycastStore || !zindycastStorePassword || !zindycastAlias || !zindycastKeyPassword) {
            throw new GradleException('Release signing requires the four ZINDYCAST_ANDROID_* environment variables documented in apps/mobile/README.md. Debug signing is not a release fallback.')
        }
    }
}
// END_ZINDYCAST_RELEASE_SIGNING
`;
function applySigning(contents) {
  const clean = contents.replace(/\n\/\/ ZINDYCAST_RELEASE_SIGNING[\s\S]*?\/\/ END_ZINDYCAST_RELEASE_SIGNING\n?/g, '');
  return clean.trimEnd() + '\n' + signing;
}
module.exports = config => withAppBuildGradle(config, config => {
  if (config.modResults.language !== 'groovy') throw new Error('ZindyCast signing plugin requires Groovy app/build.gradle.');
  config.modResults.contents = applySigning(config.modResults.contents);
  return config;
});
module.exports.applySigning = applySigning;
