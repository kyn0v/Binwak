// Babel config used only by the E2E (jest + uni-automator) test run.
// Kept separate from the app build (Vite) so it never affects production output.
// ts-jest can't be used because the project is on TypeScript 6 and ts-jest@27
// only supports TS < 5; babel strips types without a TS version constraint.
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-typescript',
  ],
}
