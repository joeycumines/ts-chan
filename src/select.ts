import {
  selectState,
  type SelectCase,
  type SelectCaseSender,
  type SelectCaseReceiver,
  type CaseStatePromise,
} from './case';
import {random as mathRandom} from './math';

export type SelectCases<T extends readonly unknown[] | []> = {
  readonly [P in keyof T]: SelectCase<UnwrapSelectCase<T[P]>>;
} & {readonly length: number};

export type UnwrapSelectCase<T> = T extends SelectCase<infer U>
  ? U
  : Awaited<T>;

/**
 * Select implements the functionality of Go's select statement, with support
 * for support cases comprised of {@link Sender}, {@link Receiver}, or values
 * (resolved as promises), which are treated as a single-value never-closed
 * channel.
 */
export class Select<T extends readonly unknown[] | []> {
  // Input cases, after converting any non-cases to the promise variant.
  // Returned via the cases property, which is used to provide per-element
  // types.
  #cases: SelectCases<T>;

  // Cases currently under consideration.
  #pending: SelectCase<unknown>[typeof selectState][];

  // Indicates that a wait is running, which is unsafe to run concurrently,
  // and disallows any recv calls.
  #waiting: boolean;

  // Indicates that the pending cases should be re-shuffled before the next
  // check, which is a synchronous operation that confirms that returns the
  // next available case, in a fair manner.
  #reshuffle: boolean;

  // Used to stage up promises on wait (reused each time).
  #buf2elem: [any, any] | undefined;

  // Caches checked values.
  // Calls to any of the public methods will consume this (dropping any
  // received value, if a method other than {@link recv} was called).
  // Used to ensure we don't buffer multiple received values.
  #next?: number;

  #stopToken: StopToken;

  constructor(cases: T) {
    this.#stopToken = {};
    this.#cases = mapPendingValues(
      cases,
      id => {
        const err = this.#stop(id);
        if (err !== undefined) {
          throw err;
        }
      },
      this.#stopToken
    );
    this.#pending = fisherYatesShuffle(this.#cases.map(v => v[selectState]));
    this.#waiting = false;
    this.#reshuffle = false;
  }

  /**
   * The cases for this select. When receiving a value, callers must provide
   * one of these, the index for which is determined by the return value of
   * either {@link poll} or {@link wait}.
   */
  get cases(): SelectCases<T> {
    return this.#cases;
  }

  /**
   * Poll returns the next case that is ready, or undefined if none are
   * ready. It must not be called concurrently with {@link wait} or
   * {@link recv}.
   * This is effectively a non-blocking version of {@link wait}, and fills the
   * same role as the `default` select case, in Go's select statement.
   */
  poll(): number | undefined {
    this.#throwIfInUse();

    // consume the last wait/check, if it hasn't been consumed already
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
        if (pending.prom !== undefined) {
          // promise cases will be removed on recv, meaning we don't need to re-shuffle
          this.#reshuffle = false;
        }
        this.#next = pending.cidx;
        return this.#next;
      }

      if (pending.send !== undefined) {
        if (!pending.send.addSender(pending.scb)) {
          this.#next = pending.cidx;
          return this.#next;
        }
        pending.send.removeSender(pending.scb);
      } else if (pending.recv !== undefined) {
        if (!pending.recv.addReceiver(pending.rcb)) {
          this.#next = pending.cidx;
          return this.#next;
        }
        pending.recv.removeReceiver(pending.rcb);
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

    // need to call check first - avoid accidentally buffering receives
    // (also consumes any this.#next value)
    {
      const i = this.poll();
      if (i !== undefined) {
        return i;
      }
    }

    this.#waiting = true;
    try {
      // allow stop, by consuming this token (while it's set)
      this.#stopToken.id = {};

      let i: number | undefined;
      let err: unknown;
      let rejectOnAbort: Promise<void> | undefined;
      let abortListener: (() => void) | undefined;
      if (abort !== undefined) {
        rejectOnAbort = new Promise((resolve, reject) => {
          abortListener = () => {
            abort.removeEventListener('abort', abortListener!);
            err ??= this.#stop(this.#stopToken);
            reject(abort.reason);
          };
          abort.addEventListener('abort', abortListener);
        });
        if (abortListener === undefined) {
          throw new Error(
            'js-chan: select: next: promise executor not called synchronously'
          );
        }
      }

      try {
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
        err ??= this.#stop(this.#stopToken);
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
          `js-chan: select: unexpected error that should never happen: invalid index: ${i}`
        );
      }

      this.#next = i;
      return i;
    } finally {
      this.#waiting = false;
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
      throw new Error('js-chan: select: case not found');
    }

    let result:
      | (IteratorResult<T, T | undefined> & {err?: undefined})
      | {value: unknown; err: true}
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
      } else if (v[selectState].prom !== undefined) {
        switch (v[selectState].ok) {
          case true:
            // resolved
            result = {
              value: v[selectState].next,
              done: true,
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
        throw new Error('js-chan: select: case not receivable');
      }
    }

    if (result === undefined) {
      throw new Error('js-chan: select: case not ready');
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
  #stop(id: object | undefined) {
    if (!id || this.#stopToken.id !== id) {
      return;
    }
    let err: unknown;
    for (const c of this.#pending) {
      if (c.hscb) {
        c.hscb = false;
        try {
          c.send.removeSender(c.scb);
        } catch (e: unknown) {
          err ??=
            e ?? new Error('js-chan: select: send: error removing sender');
        }
      }
      if (c.hrcb) {
        c.hrcb = false;
        try {
          c.recv.removeReceiver(c.rcb);
        } catch (e: unknown) {
          err ??=
            e ?? new Error('js-chan: select: recv: error removing receiver');
        }
      }
    }
    this.#stopToken.id = undefined;
    return err;
  }

  #throwIfInUse() {
    if (this.#waiting) {
      throw new Error('js-chan: select: cases in use');
    }
  }
}

let stopForMapPendingValue: ((id: object | undefined) => void) | undefined;
let stopTokenForMapPendingValue: StopToken | undefined;

// Converts any non-cases to the promise variant, returns a new array.
const mapPendingValues = <T extends readonly unknown[] | []>(
  cases: T,
  stop: (id: object | undefined) => void,
  stopToken: StopToken
) => {
  stopForMapPendingValue = stop;
  stopTokenForMapPendingValue = stopToken;
  try {
    const mapped: SelectCase<unknown>[] = cases.map(mapPendingValue);
    return mapped as SelectCases<T>;
  } finally {
    stopForMapPendingValue = undefined;
    stopTokenForMapPendingValue = undefined;
  }
};

// Part of the implementation of {@link mapPendingValues}, should never be
// called directly.
const mapPendingValue = <T>(v: T, i: number) => {
  if (
    stopForMapPendingValue === undefined ||
    stopTokenForMapPendingValue === undefined
  ) {
    throw new Error(
      'js-chan: select: unexpected error that should never happen: stop vars not set'
    );
  }

  const stop = stopForMapPendingValue;
  const stopToken = stopTokenForMapPendingValue;
  let stopTokenId: object | undefined;

  if (isSelectCase(v)) {
    if (v[selectState].cidx !== undefined) {
      throw new Error('js-chan: select: case reused');
    }

    v[selectState].cidx = i;
    // note: pidx set on shuffle

    let pendingResolve: ((value: number) => void) | undefined;
    let pendingReject: ((reason: unknown) => void) | undefined;

    if (v[selectState].send !== undefined) {
      const s = v[selectState];

      // because we need to patch the original
      const scb = s.scb;

      s.scb = (err, ok) => {
        s.hscb = false;
        if (!ok) {
          // failed to send - reject with error
          pendingReject?.(err);
          pendingReject = undefined;
          pendingResolve = undefined;
          // throw err, as dictated by the protocol
          throw err;
        }
        try {
          stop(stopTokenId);
          const result = scb(undefined, true);
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
        stopTokenId = stopToken.id;

        return new Promise<number>((resolve, reject) => {
          if (s.hscb) {
            throw new Error('js-chan: select: send: already added sender');
          }

          pendingResolve = resolve;
          pendingReject = reject;
          try {
            if (s.send.addSender(s.scb)) {
              // added, all we can do is wait for the callback (after marking it as added)
              s.hscb = true;
              return;
            }

            // sanity check - scb should have been called synchronously
            if (pendingResolve !== undefined || pendingReject !== undefined) {
              reject(
                new Error(
                  'js-chan: select: send: addSender returned false but did not call the callback synchronously'
                )
              );
            }
          } catch (e) {
            pendingResolve = undefined;
            pendingReject = undefined;
            throw e;
          }
        }).then(onfulfilled, onrejected);
      };
    } else if (v[selectState].recv !== undefined) {
      const s = v[selectState];

      s.rcb = (val, ok) => {
        s.hrcb = false;
        try {
          s.next = val;
          s.ok = ok;
          // after handling the data but before resolve - in case it throws (it calls external code)
          stop(stopTokenId);
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
        stopTokenId = stopToken.id;

        return new Promise<number>((resolve, reject) => {
          if (s.hrcb) {
            throw new Error('js-chan: select: recv: already added receiver');
          }

          pendingResolve = resolve;
          pendingReject = reject;
          try {
            if (s.recv.addReceiver(s.rcb)) {
              // added, all we can do is wait for the callback (after marking it as added)
              s.hrcb = true;
              return;
            }

            // sanity check - rcb should have been called synchronously
            if (pendingResolve !== undefined || pendingReject !== undefined) {
              reject(
                new Error(
                  'js-chan: select: recv: addReceiver returned false but did not call the callback synchronously'
                )
              );
            }
          } catch (e) {
            pendingResolve = undefined;
            pendingReject = undefined;
            throw e;
          }
        }).then(onfulfilled, onrejected);
      };
    } else {
      throw new Error(
        'js-chan: select: unexpected error that should never happen: case has neither send nor recv'
      );
    }

    return v;
  }

  const prom = Promise.resolve(v)
    .then(v => {
      s.ok = true;
      s.next = v;
    })
    .catch(e => {
      s.ok = false;
      s.next = e;
    })
    .finally(() => {
      stop(stopTokenId);
    });

  const pi = thenReturnValue(prom, i);

  const s: CaseStatePromise<Awaited<T>> = {
    cidx: i,
    prom,
    then: (onfulfilled, onrejected) => {
      stopTokenId = stopToken.id;
      return pi.then(onfulfilled, onrejected);
    },
  };

  return {[selectState]: s};
};

const isSelectCase = <T>(
  value: T
): value is T & (SelectCaseSender<any> | SelectCaseReceiver<any>) => {
  return typeof value === 'object' && value !== null && selectState in value;
};

const thenReturnValue = async <T>(p: Promise<unknown>, v: T) => {
  await p;
  return v;
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
type StopToken = {
  id?: object;
};
