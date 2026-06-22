// Registers jest-image-snapshot's toMatchImageSnapshot matcher for visual
// regression tests. Loaded via jest's setupFilesAfterEach.
const { toMatchImageSnapshot } = require('jest-image-snapshot')

expect.extend({ toMatchImageSnapshot })
