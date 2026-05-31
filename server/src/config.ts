import dotenv from 'dotenv'
import path from 'path'

dotenv.config()

const serverRoot = process.cwd()

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  jwt: {
    secret: (() => {
      const s = process.env.JWT_SECRET
      if (!s && process.env.NODE_ENV === 'production') {
        throw new Error('FATAL: JWT_SECRET must be set in production')
      }
      return s || 'dev-secret-change-me'
    })(),
    expiresIn: process.env.JWT_EXPIRES_IN || '2h',
    refreshSecret: (() => {
      const s = process.env.JWT_REFRESH_SECRET
      if (!s && process.env.NODE_ENV === 'production') {
        throw new Error('FATAL: JWT_REFRESH_SECRET must be set in production')
      }
      return s || 'dev-refresh-secret-change-me'
    })(),
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  wx: {
    appId: process.env.WX_APPID || '',
    secret: process.env.WX_SECRET || '',
  },

  // Storage configuration
  storage: {
    // 'local' | 'oss'
    driver: (process.env.STORAGE_DRIVER || 'local') as 'local' | 'oss',

    localDir: path.resolve(serverRoot, 'uploads'),

    // OSS config (required when driver = 'oss')
    oss: {
      region: process.env.OSS_REGION || '',
      bucket: process.env.OSS_BUCKET || '',
      accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
      cdnDomain: process.env.OSS_CDN_DOMAIN || '',
      prefix: process.env.OSS_PREFIX || 'uploads/',
    },
  },

  github: {
    token: process.env.GH_ISSUES_TOKEN || '',
    repo: process.env.GH_ISSUES_REPO || '',
  },

  uploadDir: path.resolve(serverRoot, 'uploads'),

  // Database file
  dbPath: path.resolve(serverRoot, 'data/bingo.db'),
}
