const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Web intentionally uses a different React version. Apply this to requests from
// every importer, including hoisted Expo/RN packages, and to JSX subpaths.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    const mobileReact = require.resolve(moduleName, { paths: [__dirname] });
    return context.resolveRequest(context, mobileReact, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
