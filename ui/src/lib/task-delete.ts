import { deleteTask } from './api'
import { gsap, motionSafe } from './motion'

export function cardElementForId(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`)
}

/** GSAP fade-out then remove from store — shared by single-card delete and bulk clear (§7.1). */
export function fadeOutAndRemoveTask(
  id: string,
  removeTask: (id: string) => void,
  cardEl?: HTMLElement | null,
): Promise<void> {
  return new Promise((resolve) => {
    const el = cardEl ?? cardElementForId(id)
    const finish = () => {
      removeTask(id)
      resolve()
    }
    if (!el) {
      finish()
      return
    }
    motionSafe(
      () => {
        gsap.to(el, {
          autoAlpha: 0,
          y: -4,
          duration: 0.2,
          ease: 'token-ease-out',
          onComplete: finish,
        })
      },
      finish,
    )
  })
}

export async function deleteTaskWithFade(
  id: string,
  options: {
    demo: boolean
    removeTask: (id: string) => void
    markRemoving: (id: string) => void
    clearRemoving: (id: string) => void
  },
): Promise<void> {
  options.markRemoving(id)
  try {
    if (!options.demo) await deleteTask(id)
    await fadeOutAndRemoveTask(id, (removedId) => {
      options.removeTask(removedId)
      options.clearRemoving(removedId)
    })
  } catch (err) {
    options.clearRemoving(id)
    throw err
  }
}