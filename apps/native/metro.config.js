const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { resolve } = require("metro-resolver");
const { withUniwindConfig } = require("uniwind/metro");

/** @type {import('expo/metro-config').MetroConfig} */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const rootNodeModules = path.resolve(workspaceRoot, "node_modules");
const projectNodeModules = path.resolve(projectRoot, "node_modules");
const config = getDefaultConfig(projectRoot);
const rootResolvedPackages = new Set([
  "react",
  "react-dom",
  "react-native",
  "react-native-web",
]);

function getRootResolvedModule(moduleName) {
  for (const packageName of rootResolvedPackages) {
    if (moduleName === packageName || moduleName.startsWith(`${packageName}/`)) {
      return path.join(rootNodeModules, moduleName);
    }
  }

  return null;
}

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [projectNodeModules, rootNodeModules];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const rootResolvedModule = getRootResolvedModule(moduleName);

  return resolve(context, rootResolvedModule ?? moduleName, platform);
};
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  react: path.join(rootNodeModules, "react"),
  "react-dom": path.join(rootNodeModules, "react-dom"),
  "react-native": path.join(rootNodeModules, "react-native"),
  "react-native-web": path.join(rootNodeModules, "react-native-web"),
};

const uniwindConfig = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
});

module.exports = uniwindConfig;
