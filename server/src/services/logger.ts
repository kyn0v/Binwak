/**
 * Structured JSON logger
 *
 * All output is single-line JSON for easy parsing (grep, jq, log aggregation).
 * Use `createRequestLogger(req)` in route handlers to auto-include traceId.
 */
import { Request } from 'express'

type LogLevel = 'info' | 'warn' | 'error'

interface LogEntry {
  time: string
  level: LogLevel
  traceId?: string
  msg: string
  [key: string]: unknown
}

function write(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  const entry: LogEntry = {
    time: new Date().toISOString(),
    level,
    msg,
    ...extra,
  }
  const line = JSON.stringify(entry)
  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
}

export const logger = {
  info:  (msg: string, extra?: Record<string, unknown>) => write('info', msg, extra),
  warn:  (msg: string, extra?: Record<string, unknown>) => write('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => write('error', msg, extra),
}

/** Creates a logger bound to a specific request's traceId */
export function createRequestLogger(req: Request) {
  const base = { traceId: req.traceId }
  return {
    info:  (msg: string, extra?: Record<string, unknown>) => write('info', msg, { ...base, ...extra }),
    warn:  (msg: string, extra?: Record<string, unknown>) => write('warn', msg, { ...base, ...extra }),
    error: (msg: string, extra?: Record<string, unknown>) => write('error', msg, { ...base, ...extra }),
  }
}
