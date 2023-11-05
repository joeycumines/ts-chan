import {Select} from './select';
import {
  type Receiver,
  type ReceiverCallback,
  type Sender,
  type SenderCallback,
} from './protocol';
import {
  type SelectCase,
  type SelectCaseReceiver,
  type SelectCaseSender,
  selectState,
  send,
  recv,
} from './case';

export type SelectFactoryCase<T> =
  | SelectFactoryCaseSender<T>
  | SelectFactoryCaseReceiver<T>;

export type SelectFactoryCaseSender<T> = {
  readonly send: Sender<T>;
  readonly value: T;
};

export type SelectFactoryCaseReceiver<T> = {
  readonly recv: Receiver<T>;
};

/**
 * A wrapper of {@link Select} that's intended for use within loops, that
 * allows the contents of select cases (but not the structure, namely the
 * direction/type of communication) to be updated, and evaluated as
 * expressions, in code order.
 *
 * With the caveat that it does not support promises, this is the closest
 * analogue to Go's select statement, provided by this module.
 */
export class SelectFactory {
  #select: Select<any> | undefined;
  #values = new Map<number, any>();

  /**
   * Clears references to values to send, receives and senders, but not the
   * select cases themselves. Use cases include avoiding retaining references
   * between iterations of a loop, if such references are not needed, or may
   * be problematic.
   *
   * WARNING: Must not be called concurrently with {@link Select.wait} (on the
   * underlying instance for this factory). Calling this method then calling
   * either {@link Select.wait} or {@link Select.poll} (prior to another
   * {@link with}) may result in an error.
   */
  clear() {
    this.#values.clear();
    if (this.#select !== undefined) {
      for (const c of this.#select.cases) {
        const s = c[selectState];
        if (s.send instanceof SenderProxy) {
          s.send[proxyKey] = undefined;
        } else if (s.recv instanceof ReceiverProxy) {
          s.recv[proxyKey] = undefined;
        } else {
          throw new Error(
            'ts-chan: select-factory: unexpected error that should never happen: invalid case'
          );
        }
      }
    }
  }

  /**
   * With should be to configure and retrieve (or initialize) the underlying
   * {@link Select} instance.
   *
   * Must be called with the same number of cases each time, with each case
   * having the same direction.
   */
  with<T extends readonly SelectFactoryCase<any>[] | []>(
    cases: T
  ): Select<
    {
      readonly [K in keyof T]: T[K] extends SelectFactoryCaseSender<infer U>
        ? SelectCaseSender<U>
        : T[K] extends SelectFactoryCaseReceiver<infer U>
        ? SelectCaseReceiver<U>
        : T[K] extends SelectFactoryCase<infer U>
        ? SelectCase<U>
        : never;
    } & {
      readonly length: T['length'];
    }
  > {
    // TODO: consider hooks to automatically clear values on selection, to avoid retaining references any longer than necessary

    if (this.#select === undefined) {
      // initial select - init
      this.#select = new Select(mapInitialCases(cases, this.#values));
      return this.#select;
    }

    // subsequent select - set values + validate in a single iteration
    // (returns the existing select, which will pick up the values)

    if (this.#select.cases.length !== cases.length) {
      throw new Error(
        `ts-chan: select-factory: invalid number of cases: expected ${
          this.#select.cases.length
        } got ${cases.length}`
      );
    }

    for (let i = 0; i < this.#select.cases.length; i++) {
      const v = cases[i];
      const c = this.#select.cases[i][selectState];
      if ('send' in v && v.send !== undefined) {
        if (!(c.send instanceof SenderProxy)) {
          throw new Error(
            `ts-chan: select-factory: invalid case at ${i}: unexpected sender: ${v.send}`
          );
        }
        c.send[proxyKey] = v.send;
        this.#values.set(i, v.value);
      } else if ('recv' in v && v.recv !== undefined) {
        if (!(c.recv instanceof ReceiverProxy)) {
          throw new Error(
            `ts-chan: select-factory: invalid case at ${i}: unexpected receiver: ${v.recv}`
          );
        }
        c.recv[proxyKey] = v.recv;
      } else {
        let d: unknown;
        try {
          d = JSON.stringify(v);
        } catch {
          d = v;
        }
        throw new Error(`ts-chan: select-factory: invalid case at ${i}: ${d}`);
      }
    }

    return this.#select;
  }
}

let valuesForMapInitialCases: Map<number, any> | undefined;

const mapInitialCases = (
  cases: readonly SelectFactoryCase<any>[],
  values: Map<number, any>
): SelectCase<any>[] => {
  if (values.size !== 0) {
    throw new Error(
      'ts-chan: select-factory: unexpected error that should never happen: init map not empty'
    );
  }
  if (valuesForMapInitialCases !== undefined) {
    throw new Error(
      'ts-chan: select-factory: unexpected error that should never happen: init map vars set'
    );
  }
  valuesForMapInitialCases = values;
  try {
    return cases.map(mapInitialCase);
  } finally {
    valuesForMapInitialCases = undefined;
  }
};

const mapInitialCase = (
  v: SelectFactoryCase<any>,
  i: number
): SelectCase<any> => {
  if (valuesForMapInitialCases === undefined) {
    throw new Error(
      'ts-chan: select-factory: unexpected error that should never happen: init map vars not set'
    );
  }
  if ('send' in v && v.send !== undefined) {
    const values = valuesForMapInitialCases;
    values.set(i, v.value);
    return send(new SenderProxy(v.send), () => {
      if (!values.has(i)) {
        throw new Error(
          `ts-chan: select-factory: missing value for index ${i}: possible misuse of clear method`
        );
      }
      const value = values.get(i);
      values.delete(i);
      return value;
    });
  } else if ('recv' in v && v.recv !== undefined) {
    return recv(new ReceiverProxy(v.recv));
  } else {
    let d: unknown;
    try {
      d = JSON.stringify(v);
    } catch {
      d = v;
    }
    throw new Error(`ts-chan: select-factory: invalid case at ${i}: ${d}`);
  }
};

const proxyKey = Symbol('ts-chan.proxyKey');
const senderProxyErrorMessage =
  'ts-chan: select-factory: missing proxy sender: possible misuse of clear method';
const receiverProxyErrorMessage =
  'ts-chan: select-factory: missing proxy receiver: possible misuse of clear method';

class SenderProxy<T> implements Sender<T> {
  [proxyKey]: Sender<T> | undefined;

  constructor(value?: Sender<T>) {
    Object.defineProperty(this, proxyKey, {
      value,
      writable: true,
      enumerable: false,
      configurable: false,
    });
  }

  addSender(callback: SenderCallback<T>): boolean {
    if (this[proxyKey] === undefined) {
      throw new Error(senderProxyErrorMessage);
    }
    return this[proxyKey].addSender(callback);
  }

  removeSender(callback: SenderCallback<T>): void {
    if (this[proxyKey] === undefined) {
      throw new Error(senderProxyErrorMessage);
    }
    return this[proxyKey].removeSender(callback);
  }
}

class ReceiverProxy<T> implements Receiver<T> {
  [proxyKey]: Receiver<T> | undefined;

  constructor(value?: Receiver<T>) {
    Object.defineProperty(this, proxyKey, {
      value,
      writable: true,
      enumerable: false,
      configurable: false,
    });
  }

  addReceiver(callback: ReceiverCallback<T>): boolean {
    if (this[proxyKey] === undefined) {
      throw new Error(receiverProxyErrorMessage);
    }
    return this[proxyKey].addReceiver(callback);
  }

  removeReceiver(callback: ReceiverCallback<T>): void {
    if (this[proxyKey] === undefined) {
      throw new Error(receiverProxyErrorMessage);
    }
    return this[proxyKey].removeReceiver(callback);
  }
}
