import {setImmediatePolyfill} from './setImmediatePolyfill';

/**
 * Returns the current yield generation. This value is incremented on each
 * {@link yieldToMacrotaskQueue}, which is a self-conflating operation.
 *
 * See [The microtask queue: a footgun](#the-microtask-queue-a-footgun), in the
 * project README, for details on the purpose of this mechanism.
 */
export const getYieldGeneration = (): number => yieldGeneration;

/**
 * Returns a promise which will resolve on the next iteration of the event
 * loop. Intended to be used in concert with {@link getYieldGeneration}, this
 * mechanism allows implementers to reduce the risk of the "footgun" that the
 * microtask queue represents.
 *
 * Calls to this function are self-conflating, meaning that if this function is
 * called multiple times before the next iteration of the event loop, the same
 * promise will be returned.
 *
 * See [The microtask queue: a footgun](#the-microtask-queue-a-footgun), in the
 * project README, for details on the purpose of this mechanism.
 */
export const yieldToMacrotaskQueue = (): Promise<number> => {
  if (yieldPromise === undefined) {
    yieldPromise = new Promise(yieldToMacrotaskQueueExecutor);
  }
  return yieldPromise;
};

// incremented on each yield, "overflows" at max safe integer
let yieldGeneration = 0;
let yieldResolve: ((generation: number) => void) | undefined;
let yieldPromise: Promise<number> | undefined;

const yieldToMacrotaskQueueExecutor: ConstructorParameters<
  typeof Promise<number>
>[0] = resolve => {
  yieldResolve = resolve;
  setImmediatePolyfill(yieldComplete);
};

const yieldComplete = () => {
  yieldPromise = undefined;
  if (yieldGeneration === Number.MAX_SAFE_INTEGER) {
    yieldGeneration = Number.MIN_SAFE_INTEGER;
  } else {
    yieldGeneration++;
  }
  yieldResolve?.(yieldGeneration);
  yieldResolve = undefined;
};
