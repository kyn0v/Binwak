/**
 * WeChat Mini Program CI upload script.
 * Uses miniprogram-ci to upload the build output to the WeChat console.
 */
const ci = require('miniprogram-ci')
const path = require('path')

const appid = process.env.WX_APPID
if (!appid) {
  console.error('Missing WX_APPID environment variable')
  process.exit(1)
}
const projectPath = path.resolve(__dirname, 'dist/build/mp-weixin')
const keyContent = process.env.WX_UPLOAD_KEY

if (!keyContent) {
  console.error('Missing WX_UPLOAD_KEY environment variable')
  process.exit(1)
}

// Version: use env or fallback to timestamp
const version = process.env.VERSION || `1.0.${Math.floor(Date.now() / 1000)}`
const desc = process.env.UPLOAD_DESC || `CI auto-upload ${new Date().toISOString().slice(0, 10)}`

async function main() {
  const project = new ci.Project({
    appid,
    type: 'miniProgram',
    projectPath,
    privateKey: keyContent,
    ignores: ['node_modules/**/*'],
  })

  console.log(`Uploading v${version}: ${desc}`)
  console.log(`Project path: ${projectPath}`)

  const result = await ci.upload({
    project,
    version,
    desc,
    setting: {
      es6: true,
      es7: true,
      minify: true,
      autoPrefixWXSS: true,
      minifyWXML: true,
    },
  })

  console.log('Upload success!')
  console.log('Size info:', JSON.stringify(result.subPackageInfo || result, null, 2))
}

main().catch((err) => {
  console.error('Upload failed:', err)
  process.exit(1)
})
