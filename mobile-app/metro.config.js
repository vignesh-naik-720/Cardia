const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Tell Metro to treat .gguf as a valid asset file
config.resolver.assetExts.push('gguf');

module.exports = config;