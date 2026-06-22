// Jest config for uni-automator E2E tests.
//
// uni-automator drives a real mini-program runtime (WeChat DevTools for
// mp-weixin, a headless browser for h5) and injects a global `program` object
// (plus `uni`) into every test. It plugs into Jest via the testEnvironment +
// globalTeardown shipped in @dcloudio/uni-automator/dist.
//
// Run via the test:e2e:* scripts. For mp-weixin you must build the bundle first
// (npm run build:mp-weixin) and enable WeChat DevTools "service port"
// (设置 → 安全设置 → 服务端口) with the IDE logged in.
//
// Override the WeChat CLI path with WX_CLI_PATH if your install differs.

const path = require('path')

const WX_CLI =
  process.env.WX_CLI_PATH ||
  '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'

module.exports = {
  rootDir: __dirname,
  globalTeardown: '@dcloudio/uni-automator/dist/teardown.js',
  testEnvironment: '@dcloudio/uni-automator/dist/environment.js',
  testEnvironmentOptions: {
    // We build the bundle ourselves in the npm script, so don't auto-compile.
    compile: false,
    'mp-weixin': {
      port: 9420,
      launch: true, // let the runner boot DevTools
      teardown: 'disconnect', // leave the IDE open after the run
      // Built bundle the IDE should open.
      projectPath: path.resolve(__dirname, 'dist/build/mp-weixin'),
      executablePath: WX_CLI,
    },
    h5: {
      // Reuse an already-served H5 site to save time; falls back to dev:h5.
      url: process.env.H5_URL || 'http://localhost:8847',
      options: { headless: true },
    },
  },
  transform: {
    '^.+\\.[jt]s$': [
      'babel-jest',
      { configFile: path.resolve(__dirname, 'babel.config.e2e.js') },
    ],
  },
  testMatch: ['<rootDir>/tests/e2e/**/*.e2e.[jt]s'],
  moduleFileExtensions: ['js', 'ts', 'json'],
  setupFilesAfterEnv: ['<rootDir>/tests/e2e/setup.image.js'],
  testTimeout: 120000,
  watchPathIgnorePatterns: ['/node_modules/', '/dist/', '/.git/'],
}
