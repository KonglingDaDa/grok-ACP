import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { CustomEase } from 'gsap/CustomEase'

gsap.registerPlugin(useGSAP, CustomEase)

// Exact control points from tokens.css §6 --ease-out/in/in-out — GSAP can't consume var()
// directly, and §4.7 restricts every GSAP tween to these three curves (no bounce/custom easing).
CustomEase.create('token-ease-out', '0.16, 1, 0.3, 1')
CustomEase.create('token-ease-in', '0.7, 0, 0.84, 0')
CustomEase.create('token-ease-in-out', '0.65, 0, 0.35, 1')

export { gsap, useGSAP }

/**
 * Branches a GSAP setup on `prefers-reduced-motion`. Call from inside a useGSAP()/gsap.context()
 * callback so the resulting gsap.matchMedia() instance is tracked and auto-reverted (§4.7).
 */
export function motionSafe(full: () => void, reduced: () => void): void {
  const mm = gsap.matchMedia()
  mm.add('(prefers-reduced-motion: no-preference)', full)
  mm.add('(prefers-reduced-motion: reduce)', reduced)
}
