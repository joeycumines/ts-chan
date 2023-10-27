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
 */
export class Chan<T>
  implements Sender<T>, Sendable<T>, Receiver<T>, Receivable<T>
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

  close(): void {
    if (!this.#open) {
      throw new CloseOfClosedChannelError();
    }

    this.#open = false;

    let lastError: unknown;

    if (this.#recvs.length !== 0) {
      for (let i = 0; i < this.#recvs.length; i++) {
        try {
          this.#recvs[i](this.#newDefaultValue?.(), false);
          this.#recvs[i] = undefined!;
        } catch (e: unknown) {
          lastError =
            e ??
            lastError ??
            new Error('ts-chan: chan: recv: error closing channel');
        }
      }
      this.#recvs.length = 0;
    }

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
        try {
          this.#sends[i](err, false);
          this.#sends[i] = undefined!;
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
