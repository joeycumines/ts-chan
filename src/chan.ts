import {
  type Receivable,
  type Receiver,
  getReceiver,
  type Sender,
  type Sendable,
  getSender,
  type ReceiverCallback,
  type SenderCallback,
  SendOnClosedChannelError,
  CloseOfClosedChannelError,
} from './protocol';
import {CircularBuffer} from './buffer';

/**
 * Provides a communication mechanism between two or more concurrent
 * operations.
 *
 * In addition to various utility methods, it implements:
 *
 * - {@link Sendable} and {@link Sender} (including {@link Sender.close}).
 * - {@link Receivable} and {@link Receiver}
 * - {@link Iterable} (see also {@link ChanIterator})
 * - {@link AsyncIterable} (see also {@link ChanAsyncIterator})
 */
export class Chan<T>
  implements
    Sender<T>,
    Sendable<T>,
    Receiver<T>,
    Receivable<T>,
    Iterable<T>,
    AsyncIterable<T>
{
  #buffer: CircularBuffer<T> | undefined;
  #newDefaultValue: (() => T) | undefined;
  #open: boolean;
  #sends: SenderCallback<T>[];
  #recvs: ReceiverCallback<T>[];

  constructor(capacity = 0, newDefaultValue?: () => T) {
    this.#buffer = capacity === 0 ? undefined : new CircularBuffer(capacity);
    this.#newDefaultValue = newDefaultValue;
    this.#open = true;
    this.#sends = [];
    this.#recvs = [];
  }

  [Symbol.asyncIterator](): ChanAsyncIterator<T> {
    return new ChanAsyncIterator(this);
  }

  [Symbol.iterator](): ChanIterator<T> {
    return new ChanIterator(this);
  }

  /**
   * Returns the maximum number of items the channel can buffer.
   */
  get capacity(): number {
    if (this.#buffer === undefined) {
      return 0;
    }
    return this.#buffer.capacity;
  }

  /**
   * Returns the number of items in the channel buffer.
   */
  get length(): number {
    if (this.#buffer === undefined) {
      return 0;
    }
    return this.#buffer.length;
  }

  /**
   * Returns an integer representing the number of blocking operations.
   * Positive values indicate senders, while negative values indicate
   * receivers.
   */
  get concurrency(): number {
    return this.#sends.length - this.#recvs.length;
  }

  /**
   * Performs a synchronous send operation on the channel, returning true if
   * it succeeds, or false if there are no waiting receivers, and the channel
   * is full.
   *
   * Will throw {@link SendOnClosedChannelError} if the channel is closed.
   */
  trySend(value: T): boolean {
    if (!this.#open) {
      throw new SendOnClosedChannelError();
    }
    if (this.#recvs.length !== 0) {
      const recv = this.#recvs.shift()!;
      recv(value, true);
      return true;
    }
    this.#fillBuffer();
    if (this.#buffer !== undefined && !this.#buffer.full) {
      this.#buffer.push(value);
      return true;
    }
    return false;
  }

  /**
   * Sends a value to the channel, returning a promise that resolves when it
   * has been received, and rejects on error, or on abort signal.
   */
  send(value: T, abort?: AbortSignal): Promise<void> {
    try {
      abort?.throwIfAborted();
      if (this.trySend(value)) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        let listener: (() => void) | undefined;
        const callback: SenderCallback<T> = (err: unknown, ok: boolean) => {
          if (abort !== undefined) {
            try {
              abort.removeEventListener('abort', listener!);
            } catch (e: unknown) {
              reject(e);
              throw e;
            }
          }
          if (!ok) {
            reject(err);
            throw err;
          }
          resolve();
          return value;
        };
        if (abort !== undefined) {
          listener = () => {
            try {
              try {
                abort!.removeEventListener('abort', listener!);
              } finally {
                this.removeSender(callback);
              }
              reject(abort.reason);
            } catch (e: unknown) {
              reject(e);
            }
          };
          abort.addEventListener('abort', listener);
        }
        this.#sends.push(callback);
      });
    } catch (e: unknown) {
      return Promise.reject(e);
    }
  }

  /**
   * Like {@link trySend}, this performs a synchronous recv operation on the
   * channel, returning undefined if no value is available, or an iterator
   * result, which models the received value, and whether the channel is open.
   */
  tryRecv(): IteratorResult<T, T | undefined> | undefined {
    this.#fillBuffer();
    if (this.#buffer !== undefined && !this.#buffer.empty) {
      const result = this.#buffer.shift()!;
      this.#fillBuffer();
      return {value: result};
    }
    if (this.#sends.length !== 0) {
      const callback = this.#sends.shift()!;
      return {value: callback(undefined, true)};
    }
    if (!this.#open) {
      return {
        value: this.#newDefaultValue?.(),
        done: true,
      };
    }
    return undefined;
  }

  /**
   * Receives a value from the channel, returning a promise that resolves with
   * an iterator (the value OR indicator that the channel is closed, possibly
   * with a default value), or rejects on error, or on abort signal.
   */
  recv(abort?: AbortSignal): Promise<IteratorResult<T, T | undefined>> {
    try {
      abort?.throwIfAborted();
      {
        const result = this.tryRecv();
        if (result !== undefined) {
          return Promise.resolve(result);
        }
      }
      return new Promise((resolve, reject) => {
        let listener: (() => void) | undefined;
        const callback: ReceiverCallback<T> = (value, ok) => {
          try {
            if (ok) {
              resolve({value});
            } else {
              try {
                resolve({
                  value: this.#newDefaultValue?.(),
                  done: true,
                });
              } catch (e: unknown) {
                reject(e);
                throw e;
              }
            }
          } finally {
            if (abort !== undefined) {
              abort.removeEventListener('abort', listener!);
            }
          }
        };
        if (abort !== undefined) {
          listener = () => {
            try {
              try {
                abort!.removeEventListener('abort', listener!);
              } finally {
                this.removeReceiver(callback);
              }
              reject(abort.reason);
            } catch (e: unknown) {
              reject(e);
            }
          };
          abort.addEventListener('abort', listener);
        }
        this.addReceiver(callback);
      });
    } catch (e: unknown) {
      return Promise.reject(e);
    }
  }

  addReceiver(callback: ReceiverCallback<T>): boolean {
    this.#fillBuffer();
    if (this.#buffer !== undefined && !this.#buffer.empty) {
      callback(this.#buffer.shift()!, true);
      this.#fillBuffer();
      return false;
    }
    if (this.#sends.length !== 0) {
      callback(this.#sends.shift()!(undefined, true), true);
      return false;
    }
    if (!this.#open) {
      callback(this.#newDefaultValue?.(), false);
      return false;
    }
    this.#recvs.push(callback);
    return true;
  }

  addSender(callback: SenderCallback<T>): boolean {
    if (!this.#open) {
      throw new SendOnClosedChannelError();
    }
    if (this.#recvs.length !== 0) {
      const recv = this.#recvs.shift()!;
      recv(callback(undefined, true), true);
      return false;
    }
    this.#fillBuffer();
    if (this.#buffer !== undefined && !this.#buffer.full) {
      this.#buffer.push(callback(undefined, true));
      return false;
    }
    this.#sends.push(callback);
    return true;
  }

  /**
   * Closes the channel, preventing further sending of values.
   *
   * See also {@link Sender} and {@link Sender.close}, which this implements.
   *
   * - Once a channel is closed, no more values can be sent to it.
   * - If the channel is buffered and there are still values in the buffer when
   *   the channel is closed, receivers will continue to receive those values
   *   until the buffer is empty.
   * - Attempting to send to a closed channel will result in an error and
   *   unblock any senders.
   * - If the channel is already closed, calling `close` again will throw a
   *   {@link CloseOfClosedChannelError}.
   * - This method should be used to signal the end of data transmission or
   *   prevent potential deadlocks.
   *
   * @throws {CloseOfClosedChannelError} When attempting to close a channel
   *   that is already closed.
   * @throws {Error} When an error occurs while closing the channel, and no
   *   other specific error is thrown.
   */
  close(): void {
    if (!this.#open) {
      throw new CloseOfClosedChannelError();
    }

    this.#open = false;

    let lastError: unknown;

    if (this.#recvs.length !== 0) {
      for (let i = 0; i < this.#recvs.length; i++) {
        const callback = this.#recvs[i];
        this.#recvs[i] = undefined!;
        try {
          callback(this.#newDefaultValue?.(), false);
        } catch (e: unknown) {
          lastError =
            e ??
            lastError ??
            new Error('ts-chan: chan: recv: error closing channel');
        }
      }
      this.#recvs.length = 0;
    } else {
      if (this.#buffer !== undefined) {
        while (!this.#buffer.full && this.#sends.length !== 0) {
          const callback = this.#sends.shift()!;
          let value: T;
          try {
            value = callback(undefined, true);
          } catch (e) {
            lastError =
              e ??
              lastError ??
              new Error('ts-chan: chan: send: error closing channel');
            continue;
          }
          this.#buffer.push(value);
        }
      }

      if (this.#sends.length !== 0) {
        const err = new SendOnClosedChannelError();
        for (let i = 0; i < this.#sends.length; i++) {
          const callback = this.#sends[i];
          this.#sends[i] = undefined!;
          try {
            callback(err, false);
          } catch (e: unknown) {
            if (e !== err) {
              lastError =
                e ??
                lastError ??
                new Error('ts-chan: chan: send: error closing channel');
            }
          }
        }
        this.#sends.length = 0;
      }
    }

    if (lastError !== undefined) {
      throw lastError;
    }
  }

  [getReceiver](): Receiver<T> {
    return this;
  }

  [getSender](): Sender<T> {
    return this;
  }

  removeReceiver(callback: ReceiverCallback<T>): void {
    if (this.#recvs.length === 0) {
      return;
    }
    if (this.#recvs[this.#recvs.length - 1] === callback) {
      this.#recvs.pop();
      return;
    }
    const i = this.#recvs.lastIndexOf(callback, -1);
    if (i !== -1) {
      this.#recvs.splice(i, 1);
    }
  }

  removeSender(callback: SenderCallback<T>): void {
    if (this.#sends.length === 0) {
      return;
    }
    if (this.#sends[this.#sends.length - 1] === callback) {
      this.#sends.pop();
      return;
    }
    const i = this.#sends.lastIndexOf(callback, -1);
    if (i !== -1) {
      this.#sends.splice(i, 1);
    }
  }

  #fillBuffer(): void {
    if (this.#buffer === undefined) {
      return;
    }
    while (!this.#buffer.full && this.#sends.length !== 0) {
      this.#buffer.push(this.#sends.shift()!(undefined, true));
    }
  }
}

/**
 * Iterates on all available values. May alternate between returning done and
 * not done, unless {@link ChanIterator.return} or {@link ChanIterator.throw}
 * are called.
 *
 * Only the type is exported - may be initialized only performing an
 * iteration on a {@link Chan} instance, or by calling
 * `chan[Symbol.iterator]()`.
 */
export class ChanIterator<T> implements Iterable<T>, Iterator<T> {
  #chan: Chan<T>;
  #outcome?: 'Return' | 'Throw';
  #error?: unknown;

  constructor(chan: Chan<T>) {
    this.#chan = chan;
  }

  /**
   * Returns this.
   */
  [Symbol.iterator](): Iterator<T> {
    return this;
  }

  /**
   * Next iteration.
   */
  next(): IteratorResult<T> {
    switch (this.#outcome) {
      case undefined: {
        const result = this.#chan.tryRecv();
        if (result !== undefined) {
          return result;
        }
        // note: not necessarily a permanent condition
        return {done: true, value: undefined};
      }
      case 'Return':
        return {done: true, value: undefined};
      case 'Throw':
        throw this.#error;
    }
  }

  /**
   * Ends the iterator, which is an idempotent operation.
   */
  return(): IteratorResult<T> {
    if (this.#outcome === undefined) {
      this.#outcome = 'Return';
    }
    return {done: true, value: undefined};
  }

  /**
   * Ends the iterator with an error, which is an idempotent operation.
   */
  throw(e?: unknown): IteratorResult<T> {
    if (this.#outcome === undefined) {
      this.#outcome = 'Throw';
      this.#error = e;
    }
    return {done: true, value: undefined};
  }
}

/**
 * Iterates by receiving values from the channel, until it is closed, or the
 * {@link ChanAsyncIterator.return} or {@link ChanAsyncIterator.throw} methods
 * are called.
 *
 * Only the type is exported - may be initialized only performing an async
 * iteration on a {@link Chan} instance, or by calling
 * `chan[Symbol.asyncIterator]()`.
 */
export class ChanAsyncIterator<T>
  implements AsyncIterable<T>, AsyncIterator<T>
{
  #chan: Chan<T>;
  #abort: AbortController;

  constructor(chan: Chan<T>) {
    this.#chan = chan;
    this.#abort = new AbortController();
  }

  /**
   * Returns this.
   */
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }

  /**
   * Next iteration.
   */
  async next(): Promise<IteratorResult<T>> {
    try {
      return await this.#chan.recv(this.#abort.signal);
    } catch (e) {
      if (e === chanAsyncIteratorReturned) {
        return {done: true, value: undefined};
      }
      throw e;
    }
  }

  /**
   * Ends the iterator, which is an idempotent operation.
   */
  async return(): Promise<IteratorResult<T>> {
    this.#abort.abort(chanAsyncIteratorReturned);
    return {done: true, value: undefined};
  }

  /**
   * Ends the iterator with an error, which is an idempotent operation.
   */
  async throw(e?: unknown): Promise<IteratorResult<T>> {
    this.#abort.abort(e);
    return {done: true, value: undefined};
  }
}

// sentinel value used as the reason for abort on ChanAsyncIterator.return
const chanAsyncIteratorReturned = Symbol('ts-chan.chanAsyncIteratorReturned');
