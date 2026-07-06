import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { connectEventStream, fetchTaskDetail, fetchTasks, type ConnectionState } from './api'
import { runDemoEngine } from './demo'
import type { Sample, TaskMeta } from './types'

/** Per-task in-memory sample cap (§4.2) — oldest points drop first. */
export const MAX_SAMPLES_PER_TASK = 3600

export interface StoreState {
  tasks: Map<string, TaskMeta>
  samples: Map<string, Sample[]>
  samplesLoaded: Set<string>
  /** Local delete animations — suppress immediate SSE `deleted` handling (§7.1). */
  removingIds: Set<string>
  connection: ConnectionState
  demo: boolean
  loaded: boolean
}

export type StoreAction =
  | { type: 'tasks/set'; tasks: TaskMeta[] }
  | { type: 'task/upsert'; task: TaskMeta }
  | { type: 'task/remove'; id: string }
  | { type: 'task/markRemoving'; id: string }
  | { type: 'task/clearRemoving'; id: string }
  | { type: 'samples/set'; id: string; samples: Sample[] }
  | { type: 'sample/add'; id: string; sample: Sample }
  | { type: 'connection/set'; state: ConnectionState }
  | { type: 'demo/set'; demo: boolean }

export type MonitorDispatch = (action: StoreAction) => void

function appendSample(existing: Sample[] | undefined, sample: Sample): Sample[] {
  const next = existing ? existing.slice() : []
  next.push(sample)
  if (next.length > MAX_SAMPLES_PER_TASK) {
    next.splice(0, next.length - MAX_SAMPLES_PER_TASK)
  }
  return next
}

function reducer(state: StoreState, action: StoreAction): StoreState {
  switch (action.type) {
    case 'tasks/set': {
      const tasks = new Map(state.tasks)
      for (const task of action.tasks) {
        tasks.set(task.id, task)
      }
      return { ...state, tasks, loaded: true }
    }
    case 'task/upsert': {
      const tasks = new Map(state.tasks)
      tasks.set(action.task.id, action.task)
      return { ...state, tasks, loaded: true }
    }
    case 'task/remove': {
      if (!state.tasks.has(action.id)) return state
      const tasks = new Map(state.tasks)
      tasks.delete(action.id)
      const samples = new Map(state.samples)
      samples.delete(action.id)
      const samplesLoaded = new Set(state.samplesLoaded)
      samplesLoaded.delete(action.id)
      const removingIds = new Set(state.removingIds)
      removingIds.delete(action.id)
      return { ...state, tasks, samples, samplesLoaded, removingIds }
    }
    case 'task/markRemoving': {
      const removingIds = new Set(state.removingIds)
      removingIds.add(action.id)
      return { ...state, removingIds }
    }
    case 'task/clearRemoving': {
      if (!state.removingIds.has(action.id)) return state
      const removingIds = new Set(state.removingIds)
      removingIds.delete(action.id)
      return { ...state, removingIds }
    }
    case 'samples/set': {
      const samples = new Map(state.samples)
      const capped = action.samples.slice(-MAX_SAMPLES_PER_TASK)
      samples.set(action.id, capped)
      const samplesLoaded = new Set(state.samplesLoaded)
      samplesLoaded.add(action.id)
      return { ...state, samples, samplesLoaded }
    }
    case 'sample/add': {
      const samples = new Map(state.samples)
      samples.set(action.id, appendSample(samples.get(action.id), action.sample))
      return { ...state, samples }
    }
    case 'connection/set':
      return { ...state, connection: action.state }
    case 'demo/set':
      return { ...state, demo: action.demo }
    default:
      return state
  }
}

function initialState(demo: boolean): StoreState {
  return {
    tasks: new Map(),
    samples: new Map(),
    samplesLoaded: new Set(),
    removingIds: new Set(),
    connection: 'live',
    demo,
    loaded: false,
  }
}

export interface MonitorStore {
  state: StoreState
  ensureSamples: (id: string) => void
  removeTask: (id: string) => void
  markRemoving: (id: string) => void
  clearRemoving: (id: string) => void
}

export function useMonitorStore(demo: boolean): MonitorStore {
  const [state, dispatch] = useReducer(reducer, demo, initialState)
  const inFlight = useRef<Set<string>>(new Set())
  const removingIdsRef = useRef(state.removingIds)
  removingIdsRef.current = state.removingIds

  const calibrate = useCallback(() => {
    fetchTasks()
      .then((tasks) => dispatch({ type: 'tasks/set', tasks }))
      .catch(() => {
        /* transient — SSE reconnect or next poll will retry */
      })
  }, [])

  useEffect(() => {
    if (demo) {
      dispatch({ type: 'connection/set', state: 'live' })
      return runDemoEngine(dispatch)
    }

    let disposed = false
    calibrate()
    const close = connectEventStream({
      onTask: (task) => {
        if (!disposed) dispatch({ type: 'task/upsert', task })
      },
      onSample: (id, t, tps, cum) => {
        if (!disposed) dispatch({ type: 'sample/add', id, sample: [t, tps, cum] })
      },
      onDeleted: (id) => {
        if (disposed || removingIdsRef.current.has(id)) return
        dispatch({ type: 'task/remove', id })
      },
      onConnectionChange: (connState) => {
        if (!disposed) dispatch({ type: 'connection/set', state: connState })
      },
      onCalibrate: calibrate,
    })
    return () => {
      disposed = true
      close()
    }
  }, [demo, calibrate])

  const ensureSamples = useCallback(
    (id: string) => {
      if (demo) return
      if (state.samplesLoaded.has(id) || inFlight.current.has(id)) return
      inFlight.current.add(id)
      fetchTaskDetail(id)
        .then((detail) => {
          dispatch({ type: 'samples/set', id, samples: detail.samples })
          dispatch({ type: 'task/upsert', task: detail.meta })
        })
        .catch(() => {
          /* leave unloaded — a future viewport entry / SSE update may retry */
        })
        .finally(() => {
          inFlight.current.delete(id)
        })
    },
    [demo, state.samplesLoaded],
  )

  const removeTask = useCallback((id: string) => {
    dispatch({ type: 'task/remove', id })
  }, [])

  const markRemoving = useCallback((id: string) => {
    dispatch({ type: 'task/markRemoving', id })
  }, [])

  const clearRemoving = useCallback((id: string) => {
    dispatch({ type: 'task/clearRemoving', id })
  }, [])

  return useMemo(
    () => ({ state, ensureSamples, removeTask, markRemoving, clearRemoving }),
    [state, ensureSamples, removeTask, markRemoving, clearRemoving],
  )
}