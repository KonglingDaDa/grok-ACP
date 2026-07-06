import { describe, it, expect } from 'vitest'
import { formatCount, formatCardTime, shortModel } from './format'

describe('formatCount', () => {
  it('formats numbers < 1000 as integers', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(500)).toBe('500')
  })

  it('formats thousands with k suffix', () => {
    expect(formatCount(1000)).toBe('1k')
    expect(formatCount(1500)).toBe('1.5k')
    expect(formatCount(12400)).toBe('12.4k')
    expect(formatCount(200000)).toBe('200k')  // 200.0k → 200k（去掉 .0）
    expect(formatCount(999999)).toBe('1000k')
  })

  it('formats millions with m suffix', () => {
    expect(formatCount(1000000)).toBe('1m')
    expect(formatCount(1500000)).toBe('1.5m')
    expect(formatCount(2340000)).toBe('2.34m')
    expect(formatCount(10000000)).toBe('10m')  // 10.00m → 10m（去掉 .00）
  })

  it('handles edge cases', () => {
    expect(formatCount(NaN)).toBe('0')
    expect(formatCount(Infinity)).toBe('0')
    expect(formatCount(-Infinity)).toBe('0')
    expect(formatCount(-100)).toBe('-100')  // 负数按整数处理
  })
})

describe('formatCardTime', () => {
  it('formats ISO 8601 timestamp to MM-DD HH:mm', () => {
    expect(formatCardTime('2026-07-04T15:30:45+08:00')).toBe('07-04 15:30')
    expect(formatCardTime('2026-01-01T00:00:00Z')).toBe('01-01 00:00')
    expect(formatCardTime('2026-12-31T23:59:59+08:00')).toBe('12-31 23:59')
  })

  it('handles null or invalid input', () => {
    expect(formatCardTime(null)).toBe('—')
    expect(formatCardTime('')).toBe('—')
    expect(formatCardTime('invalid')).toBe('—')
  })
})

describe('shortModel', () => {
  it('removes grok- prefix', () => {
    expect(shortModel('grok-composer-2.5-fast')).toBe('composer-2.5-fast')
    expect(shortModel('grok-4.3')).toBe('4.3')
  })

  it('handles models without grok- prefix', () => {
    expect(shortModel('composer-2.5-fast')).toBe('composer-2.5-fast')
    expect(shortModel('claude-sonnet-4')).toBe('claude-sonnet-4')
  })

  it('handles empty or unusual input', () => {
    expect(shortModel('')).toBe('')
    expect(shortModel('grok-')).toBe('')  // 只有前缀无内容
  })
})