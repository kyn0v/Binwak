import { CROP_CANVAS_SIZE, UPLOAD_IMAGE_FILE_TYPE, UPLOAD_IMAGE_QUALITY, IMAGE_SIZE_TYPE } from '@/config/image'

const CROP_CANVAS_ID = 'cropCanvas'

async function chooseSquareImage() {
  const result = await new Promise<UniApp.ChooseImageSuccessCallbackResult>((resolve, reject) => {
    uni.chooseImage({
      count: 1,
      sizeType: [...IMAGE_SIZE_TYPE],
      sourceType: ['album', 'camera'],
      success: resolve,
      fail: reject,
    })
  })

  return result.tempFilePaths[0]
}

/**
 * Interactive crop: uses WeChat's native wx.cropImage (base library 2.26.0+)
 * Provides zoom + drag + 1:1 crop frame so the user picks the area
 * Falls back to automatic centered crop when unavailable
 */
async function cropImageInteractive(src: string): Promise<string> {
  // Try the native crop
  const wxApi = (globalThis as { wx?: { cropImage?: (options: any) => void } }).wx
  const cropImage = wxApi?.cropImage
  if (typeof cropImage === 'function') {
    return new Promise<string>((resolve, reject) => {
      cropImage({
        src,
        cropScale: '1:1',
        success: (res: any) => resolve(res.tempFilePath),
        fail: (err: any) => reject(err),
      })
    })
  }
  // Fallback: automatic centered crop
  return cropImageToSquare(src)
}

/** Auto-center crop to a square (canvas-based, no user interaction) */
async function cropImageToSquare(path: string) {
  const info = await getImageInfo(path)
  const side = Math.min(info.width, info.height)
  const sx = Math.floor((info.width - side) / 2)
  const sy = Math.floor((info.height - side) / 2)

  const { canvas, ctx } = await getCropCanvas2D()

  // Load image via Canvas 2D API
  const img = canvas.createImage()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = (e: any) => reject(e)
    img.src = info.path
  })

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CROP_CANVAS_SIZE, CROP_CANVAS_SIZE)
  ctx.drawImage(img, sx, sy, side, side, 0, 0, CROP_CANVAS_SIZE, CROP_CANVAS_SIZE)

  return exportCanvasToTempFile(canvas)
}

async function compressImageForUpload(path: string) {
  const info = await getImageInfo(path)
  const { canvas, ctx } = await getCropCanvas2D()

  const img = canvas.createImage()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = (e: any) => reject(e)
    img.src = info.path
  })

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CROP_CANVAS_SIZE, CROP_CANVAS_SIZE)
  ctx.drawImage(img, 0, 0, info.width, info.height, 0, 0, CROP_CANVAS_SIZE, CROP_CANVAS_SIZE)

  return exportCanvasToTempFile(canvas, {
    fileType: UPLOAD_IMAGE_FILE_TYPE,
    quality: UPLOAD_IMAGE_QUALITY,
  })
}

async function prepareImageForUpload(path: string) {
  const croppedPath = await cropImageInteractive(path)
  return compressImageForUpload(croppedPath)
}

function exportCanvasToTempFile(
  canvas: any,
  options?: {
    fileType?: 'jpg' | 'png'
    quality?: number
  },
) {
  return new Promise<string>((resolve, reject) => {
    ;(uni.canvasToTempFilePath as any)({
      canvasId: CROP_CANVAS_ID,
      canvas,
      destWidth: CROP_CANVAS_SIZE,
      destHeight: CROP_CANVAS_SIZE,
      fileType: options?.fileType,
      quality: options?.quality,
      success: (res: { tempFilePath: string }) => resolve(res.tempFilePath),
      fail: reject,
    })
  })
}

function getCropCanvas2D(): Promise<{ canvas: any; ctx: any }> {
  return new Promise((resolve, reject) => {
    const query = uni.createSelectorQuery()
    ;(query.select('#cropCanvas') as any).fields({ node: true, size: true })
    query.exec((res: any) => {
      if (!res?.[0]?.node) {
        reject(new Error('cropCanvas not found'))
        return
      }
      const canvas = res[0].node
      canvas.width = CROP_CANVAS_SIZE
      canvas.height = CROP_CANVAS_SIZE
      const ctx = canvas.getContext('2d')
      resolve({ canvas, ctx })
    })
  })
}

async function saveImage(tempPath: string) {
  try {
    const fs = uni.getFileSystemManager()
    const savedFilePath = await new Promise<string>((resolve, reject) => {
      fs.saveFile({
        tempFilePath: tempPath,
        success: (res) => resolve(res.savedFilePath),
        fail: reject,
      })
    })
    return savedFilePath
  } catch {
    return tempPath
  }
}

function getImageInfo(path: string) {
  return new Promise<UniNamespace.GetImageInfoSuccessData>((resolve, reject) => {
    uni.getImageInfo({
      src: path,
      success: resolve,
      fail: reject,
    })
  })
}

export { chooseSquareImage, cropImageInteractive, cropImageToSquare, compressImageForUpload, prepareImageForUpload, saveImage, getImageInfo }
