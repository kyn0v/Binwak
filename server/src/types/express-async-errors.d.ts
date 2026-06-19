// `express-async-errors` is a side-effect-only patch that makes Express 4
// forward rejected promises from async route handlers to the error middleware.
// It ships no type definitions, so declare it as a bare module.
declare module 'express-async-errors'
