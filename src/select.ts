import {
  selectState,
  type SelectCase,
  newLockedSenderCallback,
  type SelectSemaphoreToken,
  newLockedReceiverCallback,
  wait,
  type SelectCaseSender,
  type SelectCaseReceiver,
  type SelectCasePromise,
} from './case';
import {random as mathRandom} from './math';
import {getYieldGeneration, yieldToMacrotaskQueue} from './yield';

/**
 * Select implements the functionality of Go's select statement, with support
 * for support cases comprised of {@link Sender}, {@link Receiver}, or
 * {@link PromiseLike}, which are treated as a single-value never-closed
 * channel.
 *
 * See also {@link promises}, which is a convenience method for creating a
 * select instance with promise cases, or a mix of both promises and other
 * cases.
 *
 * @param {Array<SelectCase|Promise|*>} cases The cases to select from, which
 *   must be initialized using {@link .send}, {@link .recv}, unless they are
 *   to be treated as a promise.
 *
 * @template T Array of cases to select from, providing type support for
 *   received values. See also {@link cases} and {@link recv}.
 */
export class Select<T extends readonly SelectCase<any>[] | []> {
  // Input cases, after converting any non-cases to the promise variant.
  // Returned via the cases property, which is used to provide per-element
  // types.
  #cases: T;

  // Cases currently under consideration.
  #pending: SelectCase<unknown>[typeof selectState][];

  // Indicates that a wait is running, which is unsafe to run concurrently,
  // and disallows any recv calls.
  #waiting: boolean;

  // Indicates that the pending cases should be re-shuffled before the next
  // poll, which is a synchronous operation that confirms that returns the
  // next available case, in a fair manner.
  #reshuffle: boolean;

  // Used to stage up promises on wait (reused each time).
  #buf2elem: [any, any] | undefined;

  // Caches checked values.
  // Calls to any of the public methods will consume this (dropping any
  // received value, if a method other than {@link recv} was called).
  // Used to ensure we don't buffer multiple received values.
  #next?: number;

  // Used to guard against misuse of callbacks, and to ensure that stop is
  // only called once per wait.
  #semaphore: SelectSemaphore;

  constructor(cases: T) {
    this.#semaphore = {};
    this.#cases = mapPendingValues(
      cases,
      id => {
        const err = this.#stop(id);
        if (err !== undefined) {
          throw err;
        }
      },
      this.#semaphore
    );
    this.#pending = fisherYatesShuffle(this.#cases.map(v => v[selectState]));
    this.#waiting = false;
    this.#reshuffle = false;
  }

  /**
   * Promises is a convenience method for creating a select instance with
   * promise cases, or a mix of both promises and other cases.
   *
   * Note that the behavior is identical to passing the same array to the
   * constructor. The constructor's typing is more strict, to simplify
   * implementations which encapsulate or construct select instances.
   */
  static promises<
    T extends readonly (SelectCase<any> | PromiseLike<any>)[] | [],
  >(
    cases: T
  ): Select<
    {
      readonly [K in keyof T]: T[K] extends SelectCaseSender<infer U>
        ? SelectCaseSender<U>
        : T[K] extends SelectCaseReceiver<infer U>
        ? SelectCaseReceiver<U>
        : T[K] extends SelectCasePromise<infer U>
        ? SelectCasePromise<U>
        : T[K] extends SelectCase<infer U>
        ? SelectCase<U>
        : T[K] extends PromiseLike<infer U>
        ? SelectCasePromise<Awaited<U>>
        : never;
    } & {
      readonly length: T['length'];
    }
  > {
    return new Select(cases as any);
  }

  /**
   * Retrieves the cases associated with this select instance.
   *
   * Each case corresponds to an input case (including order).
   * After selecting a case, via {@link Select.poll} or {@link Select.wait},
   * received values may be retrieved by calling {@link Select.recv} with the
   * corresponding case.
   *
   * @returns T
   *
   * @example
   * Accessing a (typed) received value:
   * ```ts
   * import {recv, Chan, Select} from 'ts-chan';
   *
   * const ch1 = new Chan<number>();
   * const ch2 = new Chan<string>();
   *
   * void sendsToCh1ThenEventuallyClosesIt();
   * void sendsToCh2();
   *
   * const select = new Select([recv(ch1), recv(ch2)]);
   * for (let running = true; running;) {
   *   const i = await select.wait();
   *   switch (i) {
   *   case 0: {
   *     const v = select.recv(select.cases[i]);
   *     if (v.done) {
   *       running = false;
   *       break;
   *     }
   *     console.log(`rounded value: ${Math.round(v.value)}`);
   *     break;
   *   }
   *   case 1: {
   *     const v = select.recv(select.cases[i]);
   *     if (v.done) {
   *       throw new Error('ch2 unexpectedly closed');
   *     }
   *     console.log(`uppercase string value: ${v.value.toUpperCase()}`);
   *     break;
   *   }
   *   default:
   *     throw new Error('unreachable');
   *   }
   * }
   * ```
   */
  get cases(): {
    readonly [K in keyof T]: T[K];
  } {
    return this.#cases;
  }

  /**
   * Poll returns the next case that is ready, or undefined if none are
   * ready. It must not be called concurrently with {@link Select.wait} or
   * {@link Select.recv}.
   *
   * This is effectively a non-blocking version of {@link Select.wait}, and
   * fills the same role as the `default` select case, in Go's select
   * statement.
   */
  poll(): number | undefined {
    this.#throwIfInUse();

    // sanity check - stop should always have been called
    if (this.#semaphore.token !== undefined) {
      throw new Error(
        'ts-chan: select: poll: unexpected error that should never happen: stop token not cleared'
      );
    }

    // consume the last poll/wait, if it hasn't been consumed already
    if (this.#next !== undefined) {
      this.#cases[this.#next][selectState].ok = undefined;
      this.#cases[this.#next][selectState].next = undefined;
      this.#next = undefined;
    }

    // note: set to false at the end if no case is ready, or if the case was a promise
    if (this.#reshuffle) {
      this.#pending = fisherYatesShuffle(this.#pending);
    } else {
      this.#reshuffle = true;
    }

    for (const pending of this.#pending) {
      // in all cases, a non-undefined ok means this case is up next
      if (pending.ok !== undefined) {
        if (pending.wait !== undefined) {
          // promise cases will be removed on recv, meaning we don't need to re-shuffle
          this.#reshuffle = false;
        }
        this.#next = pending.cidx;
        return this.#next;
      }

      if (pending.send !== undefined) {
        if (pending.cscb !== undefined) {
          throw new Error(
            'ts-chan: select: poll: unexpected error that should never happen: cscb set'
          );
        }
        this.#semaphore.token = {};
        try {
          const scb = newLockedSenderCallback(
            pending.lscb,
            this.#semaphore.token
          );
          if (!pending.send.addSender(scb)) {
            this.#next = pending.cidx;
            return this.#next;
          }
          pending.send.removeSender(scb);
        } finally {
          this.#semaphore.token = undefined;
        }
      } else if (pending.recv !== undefined) {
        if (pending.crcb !== undefined) {
          throw new Error(
            'ts-chan: select: poll: unexpected error that should never happen: crcb set'
          );
        }
        this.#semaphore.token = {};
        try {
          const rcb = newLockedReceiverCallback(
            pending.lrcb,
            this.#semaphore.token
          );
          if (!pending.recv.addReceiver(rcb)) {
            this.#next = pending.cidx;
            return this.#next;
          }
          pending.recv.removeReceiver(rcb);
        } finally {
          this.#semaphore.token = undefined;
        }
      }
    }

    this.#reshuffle = false;

    return undefined;
  }

  /**
   * Wait returns a promise that will resolve with the index of the next case
   * that is ready, or reject with the first error.
   */
  async wait(abort?: AbortSignal): Promise<number> {
    abort?.throwIfAborted();

    const yieldGeneration = getYieldGeneration();
    const yieldPromise = yieldToMacrotaskQueue();
    try {
      // need to call poll first - avoid accidentally buffering receives
      // (also consumes any this.#next value)
      {
        const i = this.poll();
        if (i !== undefined) {
          return i;
        }
      }

      this.#waiting = true;
      try {
        // identifies misuse of callbacks + indicates if stop is allowed
        // stop will consume this token, ensuring it's only performed once
        // (the "select next communication" behavior doesn't apply to promises)
        const token: SelectSemaphoreToken = {stop: true};

        let i: number | undefined;
        let err: unknown;
        let rejectOnAbort: Promise<void> | undefined;
        let abortListener: (() => void) | undefined;

        if (abort !== undefined) {
          rejectOnAbort = new Promise((resolve, reject) => {
            abortListener = () => {
              try {
                err ??= this.#stop(token);
                abort!.removeEventListener('abort', abortListener!);
                reject(abort.reason);
              } catch (e: unknown) {
                err ??= e;
                reject(e);
              }
            };
          });
          if (abortListener === undefined) {
            throw new Error(
              'ts-chan: select: next: promise executor not called synchronously'
            );
          }
          abort.addEventListener('abort', abortListener);
        }

        this.#semaphore.token = token;

        try {
          // WARNING: This implementation relies on all then functions being
          // called prior to allowing further calls to any of the methods.
          // (Due to the mechanism used to pass down the semaphore token.)
          let promise = Promise.race(this.#pending);
          if (rejectOnAbort !== undefined) {
            this.#buf2elem ??= [undefined, undefined];
            this.#buf2elem[0] = promise;
            this.#buf2elem[1] = rejectOnAbort;
            promise = Promise.race(this.#buf2elem);
          }

          i = await promise;
        } finally {
          if (this.#buf2elem !== undefined) {
            this.#buf2elem[0] = undefined;
            this.#buf2elem[1] = undefined;
          }
          err ??= this.#stop(token);
          abort?.removeEventListener('abort', abortListener!);
        }

        if (err !== undefined) {
          throw err;
        }

        if (
          !Number.isSafeInteger(i) ||
          i < 0 ||
          i >= this.#cases.length ||
          this.#cases[i][selectState].pidx === undefined ||
          this.#pending[this.#cases[i][selectState].pidx!] !==
            this.#cases[i][selectState]
        ) {
          throw new Error(
            `ts-chan: select: unexpected error that should never happen: invalid index: ${i}`
          );
        }

        this.#next = i;
        return i;
      } finally {
        this.#waiting = false;
      }
    } finally {
      if (getYieldGeneration() === yieldGeneration) {
        await yieldPromise;
      }
    }
  }

  /**
   * Consume the result of a ready case.
   */
  recv<T>(v: SelectCase<T>): IteratorResult<T, T | undefined> {
    this.#throwIfInUse();

    if (
      v?.[selectState]?.cidx === undefined ||
      this.#cases[v[selectState].cidx] !== v
    ) {
      throw new Error('ts-chan: select: case not found');
    }

    let result:
      | (IteratorResult<T, T | undefined> & {
          err?: undefined;
        })
      | {
          value: unknown;
          err: true;
        }
      | undefined;

    if (
      v[selectState].cidx === this.#next &&
      v[selectState].pidx !== undefined &&
      this.#pending[v[selectState].pidx] === v[selectState]
    ) {
      if (v[selectState].recv !== undefined) {
        switch (v[selectState].ok) {
          case true:
            result = {
              value: v[selectState].next,
            };
            break;
          case false:
            result = {
              value: v[selectState].next,
              done: true,
            };
            break;
        }
      } else if (v[selectState].wait !== undefined) {
        switch (v[selectState].ok) {
          case true:
            // resolved
            result = {
              value: v[selectState].next,
              done: false,
            };
            break;
          case false:
            // rejected
            result = {
              value: v[selectState].next,
              err: true,
            };
            break;
        }
        if (result !== undefined) {
          // only receives once per promise
          this.#pending.splice(v[selectState].pidx, 1);
          for (let i = v[selectState].pidx; i < this.#pending.length; i++) {
            this.#pending[i].pidx = i;
          }
          v[selectState].pidx = undefined;
        }
      } else {
        throw new Error('ts-chan: select: case not receivable');
      }
    }

    if (result === undefined) {
      throw new Error('ts-chan: select: case not ready');
    }

    // consuming the value
    this.#next = undefined;
    v[selectState].ok = undefined;
    v[selectState].next = undefined;

    if (result.err) {
      throw result.value;
    }

    return result;
  }

  // Stops further receives or sends - this must be called as soon as
  // possible after receive (that is, actual data being received, i.e. within
  // the callback passed to addReceiver or addSender, or after the promise).
  #stop(id: SelectSemaphoreToken) {
    if (this.#semaphore.token !== id || !id.stop) {
      return;
    }
    let err: unknown;
    for (const c of this.#pending) {
      if (c.cscb !== undefined) {
        try {
          c.send.removeSender(c.cscb);
        } catch (e: unknown) {
          err ??=
            e ?? new Error('ts-chan: select: send: error removing sender');
        }
        c.cscb = undefined;
      }
      if (c.crcb !== undefined) {
        try {
          c.recv.removeReceiver(c.crcb);
        } catch (e: unknown) {
          err ??=
            e ?? new Error('ts-chan: select: recv: error removing receiver');
        }
        c.crcb = undefined;
      }
    }
    this.#semaphore.token = undefined;
    return err;
  }

  #throwIfInUse() {
    if (this.#waiting) {
      throw new Error('ts-chan: select: cases in use');
    }
  }
}

let stopForMapPendingValue: ((id: SelectSemaphoreToken) => void) | undefined;
let selectSemaphoreForMapPendingValue: SelectSemaphore | undefined;

// Converts any non-cases to the promise variant, returns a new array.
const mapPendingValues = <T extends readonly SelectCase<any>[] | []>(
  cases: T,
  stop: Exclude<typeof stopForMapPendingValue, undefined>,
  selectSemaphore: Exclude<typeof selectSemaphoreForMapPendingValue, undefined>
): T => {
  if (
    stopForMapPendingValue !== undefined ||
    selectSemaphoreForMapPendingValue !== undefined
  ) {
    throw new Error(
      'ts-chan: select: unexpected error that should never happen: stop vars set'
    );
  }
  stopForMapPendingValue = stop;
  selectSemaphoreForMapPendingValue = selectSemaphore;
  try {
    return cases.map(mapPendingValue) as T;
  } finally {
    stopForMapPendingValue = undefined;
    selectSemaphoreForMapPendingValue = undefined;
  }
};

// Part of the implementation of {@link mapPendingValues}, should never be
// called directly.
const mapPendingValue = <T extends SelectCase<any>>(v: T, i: number): T => {
  if (
    stopForMapPendingValue === undefined ||
    selectSemaphoreForMapPendingValue === undefined
  ) {
    throw new Error(
      'ts-chan: select: unexpected error that should never happen: stop vars not set'
    );
  }
  const stop = stopForMapPendingValue;
  const selectSemaphore = selectSemaphoreForMapPendingValue;

  if (!isSelectCase(v)) {
    v = wait(v as any) as T;
  }

  if (v[selectState].cidx !== undefined) {
    throw new Error('ts-chan: select: case reused');
  }

  v[selectState].cidx = i;
  // note: pidx set on shuffle

  let pendingResolve: ((value: number) => void) | undefined;
  let pendingReject: ((reason: unknown) => void) | undefined;

  if (v[selectState].send !== undefined) {
    const s = v[selectState];

    s.lscb = (token, err, ok) => {
      if (token !== selectSemaphore.token) {
        throw new Error(
          'ts-chan: select: send: channel protocol misuse: callback called after remove'
        );
      }

      // always this callback (instance - bound token) or already undefined
      s.cscb = undefined;

      if (!ok) {
        // failed to send - reject with error
        pendingReject?.(err);
        pendingReject = undefined;
        pendingResolve = undefined;
        // throw err, as dictated by the protocol
        throw err;
      }

      try {
        stop(token);
        const result = s.expr();
        s.ok = true;
        pendingResolve?.(i);
        return result;
      } catch (e) {
        pendingReject?.(e);
        throw e;
      } finally {
        pendingResolve = undefined;
        pendingReject = undefined;
      }
    };

    // kicks off send
    s.then = (onfulfilled, onrejected) => {
      return new Promise<number>((resolve, reject) => {
        if (selectSemaphore.token === undefined) {
          throw errThenCalledAfterStop;
        }
        if (s.cscb !== undefined) {
          throw new Error(
            'ts-chan: select: send: unexpected error that should never happen: already added sender'
          );
        }

        const scb = newLockedSenderCallback(s.lscb, selectSemaphore.token);

        pendingResolve = resolve;
        pendingReject = reject;
        try {
          if (s.send.addSender(scb)) {
            // added, all we can do is wait for the callback
            s.cscb = scb;
            return;
          }
        } catch (e) {
          pendingResolve = undefined;
          pendingReject = undefined;
          throw e;
        }

        // sanity check - scb should have been called synchronously
        if (pendingResolve !== undefined || pendingReject !== undefined) {
          pendingResolve = undefined;
          pendingReject = undefined;
          throw new Error(
            'ts-chan: select: send: channel protocol misuse: addSender returned false but did not call the callback synchronously'
          );
        }
      }).then(onfulfilled, onrejected);
    };
  } else if (v[selectState].recv !== undefined) {
    const s = v[selectState];

    s.lrcb = (token: SelectSemaphoreToken, val, ok) => {
      if (token !== selectSemaphore.token) {
        throw new Error(
          'ts-chan: select: recv: channel protocol misuse: callback called after remove'
        );
      }

      // always this callback (instance - bound token) or already undefined
      s.crcb = undefined;

      try {
        s.next = val;
        s.ok = ok;
        // after handling the data but before resolve - in case it throws (it calls external code)
        stop(token);
        pendingResolve?.(i);
      } catch (e) {
        pendingReject?.(e);
        throw e;
      } finally {
        pendingResolve = undefined;
        pendingReject = undefined;
      }
    };

    // kicks off recv
    s.then = (onfulfilled, onrejected) => {
      return new Promise<number>((resolve, reject) => {
        if (selectSemaphore.token === undefined) {
          throw errThenCalledAfterStop;
        }
        if (s.crcb !== undefined) {
          throw new Error(
            'ts-chan: select: recv: unexpected error that should never happen: already added receiver'
          );
        }

        const rcb = newLockedReceiverCallback(s.lrcb, selectSemaphore.token);

        pendingResolve = resolve;
        pendingReject = reject;
        try {
          if (s.recv.addReceiver(rcb)) {
            // added, all we can do is wait for the callback
            s.crcb = rcb;
            return;
          }
        } catch (e) {
          pendingResolve = undefined;
          pendingReject = undefined;
          throw e;
        }

        // sanity check - rcb should have been called synchronously
        if (pendingResolve !== undefined || pendingReject !== undefined) {
          pendingResolve = undefined;
          pendingReject = undefined;
          throw new Error(
            'ts-chan: select: recv: channel protocol misuse: addReceiver returned false but did not call the callback synchronously'
          );
        }
      }).then(onfulfilled, onrejected);
    };
  } else if (v[selectState].pval !== undefined) {
    const s = v[selectState];

    s.wait = Promise.resolve(s.pval)
      .then(v => {
        s.ok = true;
        s.next = v;
      })
      .catch(e => {
        s.ok = false;
        s.next = e;
      });

    s.then = (onfulfilled, onrejected) => {
      if (selectSemaphore.token === undefined) {
        return Promise.reject(errThenCalledAfterStop);
      }
      const token = selectSemaphore.token;
      return s.wait
        .then(() => {
          stop(token);
          return i;
        })
        .then(onfulfilled, onrejected);
    };
  } else {
    let d: unknown;
    try {
      d = JSON.stringify(v);
    } catch {
      d = v;
    }
    throw new Error(`ts-chan: select: invalid case at ${i}: ${d}`);
  }

  return v;
};

const isSelectCase = <T>(value: T): value is T & SelectCase<unknown> => {
  return typeof value === 'object' && value !== null && selectState in value;
};

const fisherYatesShuffle = <T extends SelectCase<any>[typeof selectState]>(
  values: T[]
) => {
  let j: number;
  let t: T;
  for (let i = values.length - 1; i > 0; i--) {
    // 0 <= j <= i
    j = Math.floor(mathRandom() * (i + 1));
    // swap
    t = values[i];
    values[i] = values[j];
    values[i].pidx = i;
    values[j] = t;
    values[j].pidx = j;
  }
  if (values.length > 0) {
    values[0].pidx = 0;
  }
  return values;
};

// used as a mechanism to prevent stop from racing between calls to wait
type SelectSemaphore = {
  token?: SelectSemaphoreToken;
};

const errThenCalledAfterStop =
  'ts-chan: select: normal internal error that should never bubble: then called after stop';
