/**
 * Receiver allows callers to receive values.
 * It uses a one-off callback that models what is going to receive the value.
 *
 * Unlike {@link Iterator}, it is not intended to support statefulness - a
 * {@link Receivable} should return equivalent (but not necessarily identical)
 * {@link Receiver} instances on each call to {@link getReceiver}.
 */
export type Receiver<T> = {
  /**
   * Add a receiver callback to a list of receivers, or call it immediately if
   * there is an available sender.
   * Returns true if the receiver was called added to the receiver list.
   * Returns false if the receiver was called immediately.
   */
  addReceiver: (callback: ReceiverCallback<T>) => boolean;
  /**
   * Immediately removes the receiver from the receiver list, if it is there.
   */
  removeReceiver: (callback: ReceiverCallback<T>) => void;
};

/**
 * ReceiverCallback is a callback that receives a value from a sender and true,
 * or a default value (or undefined if unsupported), and false, if the channel
 * is closed.
 */
export type ReceiverCallback<T> = (
  ...[value, ok]: [T, true] | [T | undefined, false]
) => void;

/**
 * Receivable is a value that can be converted to a {@link Receiver}.
 */
export type Receivable<T> = {
  [getReceiver]: () => Receiver<T>;
};

/**
 * See {@link Receivable}.
 */
export const getReceiver = Symbol('js-chan.getReceiver');

/**
 * Sender allows callers to send values.
 * It uses a one-off callback that models what is going to send the value.
 *
 * Unlike {@link Iterator}, it is not intended to support statefulness - a
 * {@link Sendable} should return equivalent (but not necessarily identical)
 * {@link Sender} instances on each call to {@link getSender}.
 *
 * See also {@link SendOnClosedChannelError}, which SHOULD be raised on
 * {@link addSender} (if closed on add) or passed into send callbacks
 * (otherwise), when attempting to send on a closed channel.
 */
export type Sender<T> = {
  /**
   * Add a sender callback to a list of senders, or call it immediately if
   * there is an available receiver.
   * Returns true if the sender was added to the sender list.
   * Returns false if the sender was called immediately.
   * If the channel is closed, SHOULD throw {@link SendOnClosedChannelError}.
   * If the channel is closed while the sender is waiting to be called, the
   * sender SHOULD be called with {@link SendOnClosedChannelError}.
   */
  addSender: (callback: SenderCallback<T>) => boolean;
  /**
   * Immediately removes the sender from the sender list, if it is there.
   */
  removeSender: (callback: SenderCallback<T>) => void;
  /**
   * Closes the channel, adhering to the following semantics similar to Go's
   * channels:
   *
   * - Once a channel is closed, no more values can be sent to it.
   * - If a channel is buffered, and there are still values in the buffer when
   *   the channel is closed, the receivers will continue to receive those
   *   values until the buffer is empty.
   * - It's the responsibility of the sender to close the channel, signaling to
   *   the receiver that no more data will be sent.
   * - Attempting to send to a closed channel MUST result in an error, and
   *   MUST un-block any such senders as part of said close.
   * - The error thrown when attempting to send on a closed channel SHOULD be
   *   {@link SendOnClosedChannelError}, but MAY be another error.
   * - Unless explicitly documented as idempotent, `close` SHOULD throw
   *   {@link CloseOfClosedChannelError} on subsequent calls, but MAY throw
   *   other errors.
   * - Channels should be closed to prevent potential deadlocks or to signal
   *   the end of data transmission. This ensures that receivers waiting on the
   *   channel don't do so indefinitely.
   *
   * Note: This method is optional. Some {@link Sendable} implementations may
   * specify their own rules and semantics for closing channels. Always refer
   * to the specific implementation's documentation to ensure correct usage and
   * to prevent potential memory leaks or unexpected behaviors.
   *
   * See also {@link SendOnClosedChannelError} and
   * {@link CloseOfClosedChannelError}.
   */
  close?: () => void;
};

/**
 * SenderCallback is called as a value is received, or when an error or some
 * other event occurs, which prevents the value from being received.
 * It accepts two parameters, an error (if any), and the boolean `ok`,
 * indicating if the value has been (will be, after return) received.
 * It MUST return the value (or throw) if `ok` is true, and SHOULD throw
 * `err` if `ok` is false.
 *
 * The `ok` parameter being true guarantees that a value (once returned) has
 * been received, though does not guarantee that anything will be done with it.
 *
 * If the `ok` parameter is false, the first parameter will contain any error,
 * and no value (regardless of what is returned) will be received.
 *
 * Note: The sender callback is _not_ called on `removeSender`.
 *
 * WARNING: If the same value (===) as err (when ok is false) is thrown, that
 * thrown error will not be bubbled - a mechanism used to avoid breaking the
 * typing of the return value.
 */
export type SenderCallback<T> = (
  ...[err, ok]: [undefined, true] | [unknown, false]
) => T;

/**
 * Sendable is a value that can be converted to a {@link Sender}.
 */
export type Sendable<T> = {
  [getSender]: () => Sender<T>;
};

/**
 * See {@link Sendable}.
 */
export const getSender = Symbol('js-chan.getSender');

/**
 * Provided as a convenience, that SHOULD be used by {@link Sender}
 * implementations, to indicate that a channel is closed.
 * Should be raised as a result of send attempts on a closed channel, where
 * the send operation is not allowed to proceed.
 */
export class SendOnClosedChannelError extends Error {
  constructor(...args: ConstructorParameters<typeof Error>) {
    if (args.length === 0) {
      args.length = 1;
    }
    if (args[0] === undefined) {
      args[0] = 'js-chan: send on closed channel';
    }
    super(...args);
  }
}

/**
 * Provided as a convenience, that SHOULD be used by {@link Sender}
 * implementations, in the event that a channel close is attempted more than
 * once.
 */
export class CloseOfClosedChannelError extends Error {
  constructor(...args: ConstructorParameters<typeof Error>) {
    if (args.length === 0) {
      args.length = 1;
    }
    if (args[0] === undefined) {
      args[0] = 'js-chan: close of closed channel';
    }
    super(...args);
  }
}
