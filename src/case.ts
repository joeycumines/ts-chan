import {
  type Sender,
  type Receiver,
  type SenderCallback,
  type ReceiverCallback,
  type Receivable,
  getReceiver,
  getSender,
  type Sendable,
} from './protocol';

export const selectState = Symbol('ts-chan.selectState');

/**
 * SelectCase models the state of a single case in a {@link Select}.
 *
 * WARNING: The selectState symbol is deliberately not exported, as the
 * value of `SelectCase[selectState]` is not part of the API contract, and
 * is simply a mechanism to support typing.
 */
export type SelectCase<T> =
  | SelectCaseSender<T>
  | SelectCaseReceiver<T>
  | SelectCasePromise<T>;

export type SelectCaseSender<T> = {
  [selectState]: CaseStateSender<T>;
};

export type SelectCaseReceiver<T> = {
  [selectState]: CaseStateReceiver<T>;
};

export type SelectCasePromise<T> = {
  [selectState]: CaseStatePromise<T>;
};

export type CaseStateSender<T> = CaseStateCommon & {
  // where to send values
  send: Sender<T>;
  // original send callback, provided by {@link .send}
  oscb: SenderCallback<T>;
  // used to get a new "locked" send callback, see {@link .newLockedSenderCallback}
  lscb: (
    token: SelectSemaphoreToken,
    ...args: Parameters<SenderCallback<T>>
  ) => ReturnType<SenderCallback<T>>;
  // current send callback, stateful, locked to a specific {@link Select.wait}
  cscb?: SenderCallback<T>;

  recv?: undefined;
  lrcb?: undefined;
  crcb?: undefined;

  prom?: undefined;

  next?: undefined;
} & ( // not sent
    | {
        ok?: undefined;
      }
    // sent
    | {
        ok: true;
      }
  );

export type CaseStateReceiver<T> = CaseStateCommon & {
  // where to receive values
  recv: Receiver<T>;
  // used to get a new "locked" recv callback, see {@link .newLockedReceiverCallback}
  lrcb: (
    token: SelectSemaphoreToken,
    ...args: Parameters<ReceiverCallback<T>>
  ) => ReturnType<ReceiverCallback<T>>;
  // current recv callback, stateful, locked to a specific {@link Select.wait}
  crcb?: ReceiverCallback<T>;

  send?: undefined;
  oscb?: undefined;
  lscb?: undefined;
  cscb?: undefined;

  prom?: undefined;
} & ( // not received
    | {
        next?: undefined;
        ok?: undefined;
      }
    // received, not eof
    | {
        next: T;
        ok: true;
      }
    // received, eof (next will be default value, but only if supported by the receiver)
    | {
        next?: T;
        ok: false;
      }
  );

export type CaseStatePromise<T> = CaseStateCommon & {
  // original promise/value, wrapped (with catch) to propagate the result
  prom: Promise<void>;

  send?: undefined;
  lscb?: undefined;
  oscb?: undefined;
  cscb?: undefined;

  recv?: undefined;
  lrcb?: undefined;
  crcb?: undefined;
} & ( // not settled
    | {
        next?: undefined;
        ok?: undefined;
      }
    // settled, resolved
    | {
        next: T;
        ok: true;
      }
    // settled, rejected (next is the reason)
    | {
        next: unknown;
        ok: false;
      }
  );

export type CaseStateCommon = PromiseLike<number> & {
  // index in input cases array
  cidx: number;
  // index in the pending cases array
  pidx?: number;
};

/**
 * Prepares a {@link SelectCaseReceiver} case, to be used in a {@link Select}.
 *
 * WARNING: Cases may only be used in a single select instance, though select
 * instances are intended to be reused, e.g. when implementing control loops.
 */
export const recv = <T>(
  from: Receivable<T> | Receiver<T>
): SelectCaseReceiver<T> => ({
  [selectState]: {
    recv:
      getReceiver in from && from[getReceiver]
        ? from[getReceiver]()
        : (from as Receiver<T>),

    // set later

    cidx: undefined as any,
    lrcb: undefined as any,
    then: undefined as any,
  },
});

/**
 * Prepares a {@link SelectCaseSender} case, to be used in a {@link Select}.
 *
 * WARNING: Cases may only be used in a single select instance, though select
 * instances are intended to be reused, e.g. when implementing control loops.
 */
export const send = <T>(
  to: Sendable<T> | Sender<T>,
  scb: SenderCallback<T>
): SelectCaseSender<T> => ({
  [selectState]: {
    send:
      getSender in to && to[getSender] ? to[getSender]() : (to as Sender<T>),
    oscb: scb,

    // set later

    cidx: undefined as any,
    lscb: undefined as any,
    then: undefined as any,
  },
});

export type SelectSemaphoreToken = {
  readonly stop?: boolean;
};

export const newLockedSenderCallback = <T>(
  lscb: CaseStateSender<T>['lscb'],
  token: SelectSemaphoreToken
): SenderCallback<T> => lscb.bind(undefined, token) as SenderCallback<T>;

export const newLockedReceiverCallback = <T>(
  lrcb: CaseStateReceiver<T>['lrcb'],
  token: SelectSemaphoreToken
): ReceiverCallback<T> => lrcb.bind(undefined, token) as ReceiverCallback<T>;
