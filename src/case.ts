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

/**
 * Sender select case.
 * See also {@link .send}.
 */
export type SelectCaseSender<T> = {
  /**
   * Type is provided to support type guards, and reflection-style logic.
   */
  readonly type: 'Sender';
  readonly [selectState]: CaseStateSender<T>;
};

/**
 * Receiver select case.
 * See also {@link .recv}.
 */
export type SelectCaseReceiver<T> = {
  /**
   * Type is provided to support type guards, and reflection-style logic.
   */
  readonly type: 'Receiver';
  readonly [selectState]: CaseStateReceiver<T>;
};

/**
 * Promise (or PromiseLike) select case.
 */
export type SelectCasePromise<T> = {
  /**
   * Type is provided to support type guards, and reflection-style logic.
   */
  readonly type: 'Promise';
  readonly [selectState]: CaseStatePromise<T>;
};

export type CaseStateSender<T> = CaseStateCommon & {
  // where to send values
  send: Sender<T>;
  // send callback expression, provided by {@link .send}
  expr: () => T;
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

  pval?: undefined;
  wait?: undefined;

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
  expr?: undefined;
  lscb?: undefined;
  cscb?: undefined;

  pval?: undefined;
  wait?: undefined;
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
  // original PromiseLike value
  pval?: unknown;
  // original promise/value, wrapped (with catch) to propagate the result
  wait: Promise<void>;

  send?: undefined;
  lscb?: undefined;
  expr?: undefined;
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
): SelectCaseReceiver<T> =>
  newSelectCase('Receiver', {
    recv:
      getReceiver in from && from[getReceiver]
        ? from[getReceiver]()
        : (from as Receiver<T>),

    // set later

    cidx: undefined!,
    lrcb: undefined!,
    then: undefined!,
  });

/**
 * Prepares a {@link SelectCaseSender} case, to be used in a {@link Select}.
 *
 * WARNING: Cases may only be used in a single select instance, though select
 * instances are intended to be reused, e.g. when implementing control loops.
 *
 * @param to Target Sendable or Sender.
 * @param expr Expression to evaluate when sending. WARNING: Unlike Go, this
 *   is only evaluated when the case is selected, and only for the selected
 *   case. See the project README for more details.
 */
export const send = <T>(
  to: Sendable<T> | Sender<T>,
  expr: () => T
): SelectCaseSender<T> =>
  newSelectCase('Sender', {
    send:
      getSender in to && to[getSender] ? to[getSender]() : (to as Sender<T>),
    expr,

    // set later

    cidx: undefined!,
    lscb: undefined!,
    then: undefined!,
  });

/**
 * Prepares a {@link SelectCasePromise} case, to be used in a {@link Select}.
 *
 * WARNING: Cases may only be used in a single select instance, though select
 * instances are intended to be reused, e.g. when implementing control loops.
 */
export const wait = <T>(value: PromiseLike<T>): SelectCasePromise<Awaited<T>> =>
  newSelectCase('Promise', {
    // WARNING: any additional logic that assumes value is actually PromiseLike will break where this is used in select.ts
    pval: value,

    // set later

    wait: undefined!,
    cidx: undefined!,
    then: undefined!,
  });

const newSelectCase = <R extends SelectCase<V>, T extends R['type'], V>(
  type: T,
  state: SelectCase<V>[typeof selectState]
): R => {
  const c: Omit<SelectCase<V>, typeof selectState | 'type'> = {};
  Object.defineProperty(c, 'type', {
    value: type,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(c, selectState, {
    value: state,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return c as R;
};

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
