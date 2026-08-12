const arm = require('./arm.cjs')

/**
 * Plays a program on the arm, one step at a time.
 *
 * # Why main drives this and not the renderer
 *
 * The firmware has no motion-script route — `hcr-fw/docs/API.md` lists those
 * under "not implemented" — so a program is not uploaded and run. It is a
 * series of individual angle writes that somebody has to space out in real
 * time. If that somebody were the renderer, closing the window mid-run would
 * abandon the arm wherever it happened to be, servos still loaded, with no
 * remaining code that knows a run was in progress.
 *
 * Holding the loop in main means there is always a live owner: one run at a
 * time, an abort that the UI can reach, and a shutdown path that parks the arm
 * instead of freezing it.
 *
 * # What a plan is
 *
 * The renderer builds the timeline, because it is the side that knows joint
 * speeds and can compute how long each move takes. It sends flat steps —
 * `{type: 'move', axis, value, durationMs}` and `{type: 'wait', durationMs}` —
 * which are re-validated here before anything is sent. A move's `durationMs` is
 * how long to hold before the next step, since the servo reports no completion
 * and the arm cannot be asked whether it has arrived.
 */

/** A program longer than this is a bug or a runaway loop, not a haircut. */
const MAX_STEPS = 512

/** No single step may block the run for more than a minute. */
const MAX_STEP_MS = 60_000

let active

/** Reject a plan whole rather than discover a bad step halfway through it. */
function validatePlan(plan) {
  if (!Array.isArray(plan) || plan.length === 0) {
    throw new Error('The program has no steps to send.')
  }
  if (plan.length > MAX_STEPS) {
    throw new Error(`The program has ${plan.length} steps; the arm accepts at most ${MAX_STEPS}.`)
  }
  return plan.map((step, index) => {
    const durationMs = Number(step?.durationMs ?? 0)
    if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > MAX_STEP_MS) {
      throw new Error(`Step ${index + 1} has an unusable duration of ${step?.durationMs}ms.`)
    }
    if (step?.type === 'wait') {
      return { type: 'wait', durationMs }
    }
    if (step?.type === 'move') {
      const axis = arm.axisName(step.axis)
      // Throws if out of range. Doing it now means a program that would stall
      // against a servo stop never moves the arm at all.
      arm.formatAngle(axis, Number(step.value))
      return { type: 'move', axis, value: Number(step.value), durationMs }
    }
    throw new Error(`Step ${index + 1} has unknown type "${step?.type}".`)
  })
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Run a plan, reporting progress through `onProgress`.
 *
 * Resolves with a summary; a caller-triggered abort resolves rather than
 * throws, because stopping is a normal outcome and not a failure.
 */
async function run(plan, onProgress) {
  if (active) {
    throw new Error('The arm is already running a program.')
  }
  const steps = validatePlan(plan)
  const controller = new AbortController()
  active = controller

  let completed = 0
  try {
    for (const [index, step] of steps.entries()) {
      if (controller.signal.aborted) {
        break
      }
      onProgress?.({ phase: 'step', index, total: steps.length, step })
      if (step.type === 'move') {
        await arm.setAngles([{ axis: step.axis, value: step.value }])
      }
      await sleep(step.durationMs, controller.signal)
      completed = index + 1
    }
    return { completed, total: steps.length, aborted: controller.signal.aborted }
  } catch (error) {
    if (controller.signal.aborted) {
      return { completed, total: steps.length, aborted: true }
    }
    throw error
  } finally {
    active = undefined
  }
}

function abort() {
  active?.abort()
  return Boolean(active)
}

function isRunning() {
  return Boolean(active)
}

/**
 * Stop and park.
 *
 * Called when the window closes or the app quits. Homing is best-effort: if the
 * arm is already unreachable there is nothing useful left to do, and throwing
 * here would only block shutdown.
 */
async function shutdown() {
  abort()
  try {
    await arm.home()
  } catch {
    // Unreachable arm on the way out; nothing to recover.
  }
}

module.exports = { run, abort, isRunning, shutdown, MAX_STEPS }
