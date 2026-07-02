const { build } = require('../package.json');

module.exports = {
  ...build,
  mac: {
    ...build.mac,
    target: ['dmg'],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    notarize: true,
  },
};
