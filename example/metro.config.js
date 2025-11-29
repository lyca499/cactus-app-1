const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const root = path.resolve(__dirname, '..');

const config = {
  watchFolders: [root],
  resolver: {
    extraNodeModules: {
      // Force Local React
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-native': path.resolve(__dirname, 'node_modules/react-native'),
      // Force Library Source
      'cactus-react-native': path.resolve(__dirname, '../src'),
    },
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  },
};

const defaultConfig = getDefaultConfig(__dirname);
module.exports = mergeConfig(defaultConfig, config);
