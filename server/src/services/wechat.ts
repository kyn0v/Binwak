import { config } from '../config'

interface Code2SessionResult {
  openid: string
  session_key: string
  errcode?: number
  errmsg?: string
}

/**
 * Call WeChat code2Session to exchange code for openid
 */
export async function code2Session(code: string): Promise<Code2SessionResult> {
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${config.wx.appId}&secret=${config.wx.secret}&js_code=${code}&grant_type=authorization_code`

  const res = await fetch(url)
  const data = (await res.json()) as Code2SessionResult

  if (data.errcode) {
    throw new Error(`微信登录失败: ${data.errcode} ${data.errmsg}`)
  }

  return data
}
