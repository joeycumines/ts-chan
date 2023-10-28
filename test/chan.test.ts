import {jest} from '@jest/globals';

import {Chan} from '../src/chan';
import {
  CloseOfClosedChannelError,
  type ReceiverCallback,
  type SenderCallback,
  SendOnClosedChannelError,
} from '../src/protocol';

describe('Chan', () => {
  describe('constructor', () => {
    it('should initialize a channel with correct capacity and open state', () => {
      const chan = new Chan(5);
      expect(chan.capacity).toBe(5);
      expect(chan.length).toBe(0);
    });

    it('should initialize a buffer-less channel if capacity is zero', () => {
      const chan = new Chan(0);
      expect(chan.capacity).toBe(0);
      expect(chan.length).toBe(0);
    });
  });

  describe('addReceiver', () => {
    it('should handle buffer data before senders', () => {
      const chan = new Chan(1);
      const data = 'test-data';
      const recvCallback = jest.fn();

      chan.addSender((err, ok) => {
        if (!ok) {
          throw err;
        }
        return data;
      });
      chan.addReceiver(recvCallback);

      expect(recvCallback).toBeCalledWith(data, true);
    });

    it('should handle closed channel', () => {
      const chan = new Chan(0);
      const recvCallback = jest.fn();

      chan.close();
      chan.addReceiver(recvCallback);

      expect(recvCallback).toBeCalledWith(undefined, false);
    });

    it('should receive in fifo order', () => {
      const chan = new Chan<number>();
      expect(chan.addSender(() => 0)).toBe(true);
      expect(chan.addSender(() => 1)).toBe(true);
      expect(chan.addSender(() => 2)).toBe(true);
      const recv = jest.fn<ReceiverCallback<number>>();
      for (let i = 0; i < 3; i++) {
        expect(chan.addReceiver(recv)).toBe(false);
        expect(recv).toBeCalledWith(i, true);
        recv.mockClear();
      }
      expect(chan.addReceiver(recv)).toBe(true);
    });
  });

  describe('addSender', () => {
    it('should add data to the buffer if a receiver is not waiting', () => {
      const chan = new Chan(1);
      const data = 'test-data';

      chan.addSender(() => data);

      expect(chan.length).toBe(1);
    });

    it('should throw error when adding to a closed channel', () => {
      const chan = new Chan(0);
      chan.close();

      expect(() => chan.addSender(jest.fn())).toThrow(SendOnClosedChannelError);
    });

    it('should send in fifo order', () => {
      const chan = new Chan<number>();

      const recvs = [
        jest.fn<ReceiverCallback<number>>(),
        jest.fn<ReceiverCallback<number>>(),
        jest.fn<ReceiverCallback<number>>(),
      ];

      for (const recv of recvs) {
        expect(chan.addReceiver(recv)).toBe(true);
      }

      let next = 0;
      const send = jest.fn<SenderCallback<number>>(() => next++);

      for (let i = 0; i < recvs.length; i++) {
        expect(chan.addSender(send)).toBe(false);
        expect(send).toBeCalledWith(undefined, true);
        send.mockClear();
      }

      expect(chan.addSender(send)).toBe(true);
    });
  });

  describe('close', () => {
    it('should close the channel and notify receivers', () => {
      const chan = new Chan(0);
      const recvCallback = jest.fn();

      chan.addReceiver(recvCallback);
      chan.close();

      expect(recvCallback).toBeCalledWith(undefined, false);
    });

    it('should close the channel and notify senders', () => {
      const chan = new Chan(0);
      const sendCallback = jest.fn();

      chan.addSender(sendCallback);
      chan.close();

      expect(sendCallback).toBeCalledWith(
        expect.any(SendOnClosedChannelError),
        false
      );
    });

    it('should handle multiple errors and throw the last one', () => {
      const chan = new Chan(1);
      const error1 = new Error('Error 1');
      const error2 = new Error('Error 2');

      chan.addReceiver(() => {
        throw error1;
      });
      chan.addReceiver(() => {
        throw error2;
      });

      expect(() => chan.close()).toThrow(error2);
    });

    it('should throw CloseOfClosedChannelError when closing a closed channel', () => {
      const chan = new Chan(0);
      chan.close();
      expect(() => chan.close()).toThrow(CloseOfClosedChannelError);
    });

    test('complete buffer filling on close', () => {
      // If the buffer is not full but there are senders staged (due to errors
      // within callback provided to addReceiver, when there are more sends
      // than there is buffer), then, on close, the buffer should be
      // exhaustively filled (senders consumed until buffer is full), prior
      // to discarding the remaining senders.

      const chan = new Chan<number>(4);
      expect(chan.capacity).toBe(4);
      expect(chan.length).toBe(0);

      const errThrownByIndex5 = new Error('error thrown by index 5');
      const errThrownByIndex6 = new Error('error thrown by index 6');
      let closeErr: unknown;
      const sends = [
        jest.fn<SenderCallback<number>>(() => 0),
        jest.fn<SenderCallback<number>>(() => 1),
        jest.fn<SenderCallback<number>>(() => 2),
        jest.fn<SenderCallback<number>>(() => 3),
        jest.fn<SenderCallback<number>>(() => 4),
        jest.fn<SenderCallback<number>>(() => {
          throw errThrownByIndex5;
        }),
        jest.fn<SenderCallback<number>>(() => {
          throw errThrownByIndex6;
        }),
        jest.fn<SenderCallback<number>>(() => 7),
        jest.fn<SenderCallback<number>>((err, ok) => {
          if (!ok) {
            closeErr = err;
            throw err;
          }
          return 8;
        }),
        jest.fn<SenderCallback<number>>(() => 9),
      ];

      {
        const actual: unknown[] = [];
        const expected: unknown[] = [];
        for (let i = 0; i < sends.length; i++) {
          actual.push(chan.addSender(sends[i]));
          expected.push(i >= 4);
        }
        expect(actual).toStrictEqual(expected);
      }

      expect(chan.length).toBe(4);
      for (let i = 0; i < sends.length; i++) {
        if (i < 4) {
          expect(sends[i]).toBeCalledWith(undefined, true);
        } else {
          expect(sends[i]).not.toBeCalled();
        }
      }

      // simulate 2x errors receiving
      {
        const err = new Error('some error');
        const recvWillError = jest.fn<ReceiverCallback<number>>(() => {
          throw err;
        });
        for (let i = 0; i < 2; i++) {
          try {
            chan.addReceiver(recvWillError);
            expect('did error').toBe('did not error');
          } catch (e: unknown) {
            expect(e).toBe(err);
          }
          expect(recvWillError).toBeCalledWith(i, true);
          recvWillError.mockClear();
          expect(chan.length).toBe(3);
        }

        for (let i = 0; i < sends.length; i++) {
          if (i < 5) {
            expect(sends[i]).toBeCalledWith(undefined, true);
          } else {
            expect(sends[i]).not.toBeCalled();
          }
        }
      }

      // close the thing
      try {
        chan.close();
        expect('did error').toBe('did not error');
      } catch (e: unknown) {
        expect(e).toBe(errThrownByIndex6);
      }

      expect(chan.length).toBe(4);
      expect(closeErr).not.toBeUndefined();
      for (let i = 0; i < sends.length; i++) {
        if (i < 8) {
          expect(sends[i]).toBeCalledWith(undefined, true);
        } else {
          expect(sends[i]).toBeCalledWith(closeErr, false);
        }
        expect(sends[i]).toBeCalledTimes(1);
      }

      // verify receives
      const recv = jest.fn<ReceiverCallback<number>>();
      for (const [i, v] of [2, 3, 4, 7].entries()) {
        expect(chan.addReceiver(recv)).toBe(false);
        expect(recv).toBeCalledWith(v, true);
        recv.mockClear();
        expect(chan.length).toBe(3 - i);
      }
    });
  });

  describe('removeReceiver', () => {
    it('should remove a specified receiver callback', () => {
      const chan = new Chan(1);
      const recvCallback = jest.fn();

      chan.addReceiver(recvCallback);
      chan.removeReceiver(recvCallback);
      chan.close();

      expect(recvCallback).not.toBeCalled();
    });

    test('zero length guard', () => {
      const chan = new Chan();
      chan.removeReceiver(jest.fn());
    });
  });

  describe('removeSender', () => {
    it('should remove a specified sender callback', () => {
      const chan = new Chan(0);
      const sendCallback = jest.fn();

      chan.addSender(sendCallback);
      chan.removeSender(sendCallback);
      chan.close();

      expect(sendCallback).not.toBeCalled();
    });

    test('zero length guard', () => {
      const chan = new Chan();
      chan.removeSender(jest.fn());
    });
  });

  describe('Multiple senders and receivers', () => {
    it('should handle multiple senders and receivers correctly', () => {
      const chan = new Chan<string>(5);
      const sendData = ['a', 'b', 'c', 'd', 'e'];
      const recvData: string[] = [];

      sendData.forEach(data => {
        chan.addSender(() => data);
      });

      for (let i = 0; i < 5; i++) {
        chan.addReceiver((value, ok) => {
          if (ok) {
            recvData.push(value);
          }
        });
      }

      expect(recvData).toEqual(sendData);
    });
  });

  describe('Different capacities and edge cases', () => {
    it('should handle edge case where channel is full', () => {
      const chan = new Chan(1);
      const data1 = 'test1';
      const data2 = 'test2';

      chan.addSender(() => data1);
      expect(chan.length).toBe(1);

      chan.addSender(() => data2);
      expect(chan.length).toBe(1); // Still 1, as capacity is full

      chan.addReceiver((data, success) => {
        expect(success).toBeTruthy();
        expect(data).toBe(data1); // Only the first message is received
      });
    });

    it('should handle edge case where channel is empty', () => {
      const chan = new Chan(1);
      const recvCallback = jest.fn();

      chan.addReceiver(recvCallback);
      chan.close();

      expect(recvCallback).toBeCalledWith(undefined, false);
    });
  });

  describe('Concurrency behavior', () => {
    it('should handle concurrent senders and receivers', done => {
      const chan = new Chan(1000);
      const totalOps = 1000;
      let receivedCount = 0;
      let sentCount = 0;

      // Simulating asynchronous sends and receives using setImmediate
      for (let i = 0; i < totalOps; i++) {
        setImmediate(() => {
          chan.addSender((_, success) => {
            if (success) sentCount++;
          });
          chan.addReceiver((_, success) => {
            if (success) receivedCount++;
            if (receivedCount === totalOps) {
              expect(sentCount).toBe(totalOps);
              done();
            }
          });
        });
      }
    });
  });

  describe('trySend', () => {
    it('should send a value successfully', () => {
      const chan = new Chan<number>(1);
      const result = chan.trySend(1);
      expect(result).toBe(true);
    });

    it('should not send when channel is full', () => {
      const chan = new Chan<number>(1);
      chan.trySend(1);
      const result = chan.trySend(2);
      expect(result).toBe(false);
    });

    it('should throw an error when sending on a closed channel', () => {
      const chan = new Chan<number>();
      chan.close();
      expect(() => chan.trySend(1)).toThrow(SendOnClosedChannelError);
    });
  });

  describe('send', () => {
    it('should send a value successfully', async () => {
      const chan = new Chan<number>(1);
      await expect(chan.send(1)).resolves.not.toThrow();
    });

    it('should return a promise', () => {
      const chan = new Chan<number>(1);
      expect(chan.send(1)).toBeInstanceOf(Promise);
    });

    it('should reject when the channel is closed', async () => {
      const chan = new Chan<number>();
      chan.close();
      await expect(chan.send(1)).rejects.toThrow(SendOnClosedChannelError);
    });

    test('bulk sends abort signal', async () => {
      const chan = new Chan<number>();
      const logs: unknown[] = [];
      const all: Promise<unknown>[] = [];
      const abort = new AbortController();
      for (let i = 0; i < 5; i++) {
        const j = i;
        all.push(
          (async () => {
            try {
              const result = await chan.send(j, abort.signal);
            } catch (e: unknown) {
              logs.push([j, `error: ${e}`]);
            }
          })()
        );
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(chan.concurrency).toBe(5);
      expect(chan.tryRecv()).toStrictEqual({value: 0});
      expect(chan.concurrency).toBe(4);
      expect(chan.tryRecv()).toStrictEqual({value: 1});
      expect(chan.concurrency).toBe(3);
      expect(chan.trySend(55)).toBe(false);
      expect(logs).toStrictEqual([]);
      abort.abort('some abort reason');
      expect(chan.concurrency).toBe(0);
      await Promise.all(all);
      expect(logs).toStrictEqual([
        [2, 'error: some abort reason'],
        [3, 'error: some abort reason'],
        [4, 'error: some abort reason'],
      ]);
    });

    test('bulk sends close channel', async () => {
      const chan = new Chan<number>();
      const logs: unknown[] = [];
      const all: Promise<unknown>[] = [];
      for (let i = 0; i < 3; i++) {
        const j = i;
        all.push(
          (async () => {
            try {
              const result = await chan.send(j);
            } catch (e: unknown) {
              logs.push([j, `error: ${e}`]);
            }
          })()
        );
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(chan.concurrency).toBe(3);
      chan.close();
      expect(chan.concurrency).toBe(0);
      await Promise.all(all);
      expect(logs).toStrictEqual([
        [0, 'error: Error: ts-chan: send on closed channel'],
        [1, 'error: Error: ts-chan: send on closed channel'],
        [2, 'error: Error: ts-chan: send on closed channel'],
      ]);
    });

    test('dodgy abort signal remove listener impl case 1', async () => {
      const chan = new Chan<unknown>();
      const addEventListener = jest.fn<AbortSignal['addEventListener']>();
      const someErr = new Error('some error');
      const removeEventListener = jest
        .fn<AbortSignal['removeEventListener']>()
        .mockImplementationOnce(() => {
          throw someErr;
        });
      const throwIfAborted = jest.fn<AbortSignal['throwIfAborted']>();
      const mockAbortSignal = {
        addEventListener,
        removeEventListener,
        throwIfAborted,
      } as Partial<AbortSignal> as AbortSignal;
      const sendPromise = chan.send(123, mockAbortSignal);
      expect(addEventListener).toBeCalledTimes(1);
      expect(addEventListener).toBeCalledWith('abort', expect.anything());
      expect(removeEventListener).toBeCalledTimes(0);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(chan.concurrency).toBe(1);
      try {
        chan.tryRecv();
        expect('did error').toBe('did not error');
      } catch (e: unknown) {
        expect(e).toBe(someErr);
      }
      expect(chan.concurrency).toBe(0);
      await expect(sendPromise).rejects.toBe(someErr);
      expect(addEventListener).toBeCalledTimes(1);
      expect(removeEventListener).toBeCalledTimes(1);
    });

    test('dodgy abort signal remove listener impl case 2', async () => {
      const chan = new Chan<unknown>();
      const addEventListener = jest.fn<AbortSignal['addEventListener']>();
      const someErr = new Error('some error');
      const removeEventListener = jest
        .fn<AbortSignal['removeEventListener']>()
        .mockImplementationOnce(() => {
          throw someErr;
        });
      const throwIfAborted = jest.fn<AbortSignal['throwIfAborted']>();
      const mockAbortSignal = {
        addEventListener,
        removeEventListener,
        throwIfAborted,
      } as Partial<AbortSignal> as AbortSignal;
      const sendPromise = chan.send(123, mockAbortSignal);
      expect(addEventListener).toBeCalledTimes(1);
      expect(addEventListener).toBeCalledWith('abort', expect.anything());
      expect(removeEventListener).toBeCalledTimes(0);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(chan.concurrency).toBe(1);
      (addEventListener.mock.calls[0][1] as any)();
      expect(chan.concurrency).toBe(0);
      await expect(sendPromise).rejects.toBe(someErr);
      expect(addEventListener).toBeCalledTimes(1);
      expect(removeEventListener).toBeCalledTimes(1);
    });
  });

  describe('tryRecv', () => {
    it('should receive a value successfully', () => {
      const chan = new Chan<number>(1);
      chan.trySend(1);
      const result = chan.tryRecv();
      expect(result).toHaveProperty('value', 1);
    });

    it('should not return a value when the channel is empty', () => {
      const chan = new Chan<number>(1);
      const result = chan.tryRecv();
      expect(result).toBeUndefined();
    });

    it('should return done when the channel is closed', () => {
      const chan = new Chan<number>();
      chan.close();
      const result = chan.tryRecv();
      expect(result).toHaveProperty('done', true);
    });
  });

  describe('recv', () => {
    it('should receive a value successfully', async () => {
      const chan = new Chan<number>(1);
      chan.trySend(1);
      const result = await chan.recv();
      expect(result).toHaveProperty('value', 1);
    });

    it('should return a promise', () => {
      const chan = new Chan<number>(1);
      expect(chan.recv()).toBeInstanceOf(Promise);
    });

    it('should resolve with done when the channel is closed', async () => {
      const chan = new Chan<number>();
      chan.close();
      const result = await chan.recv();
      expect(result).toHaveProperty('done', true);
    });

    test('bulk receives abort signal', async () => {
      const chan = new Chan<string>();
      const logs: unknown[] = [];
      const all: Promise<unknown>[] = [];
      const abort = new AbortController();
      for (let i = 0; i < 6; i++) {
        const j = i;
        all.push(
          (async () => {
            try {
              const result = await chan.recv(abort.signal);
              logs.push([j, result]);
            } catch (e: unknown) {
              logs.push([j, `error: ${e}`]);
            }
          })()
        );
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(chan.concurrency).toBe(-6);
      expect(chan.trySend('a')).toBe(true);
      expect(chan.concurrency).toBe(-5);
      expect(chan.trySend('b')).toBe(true);
      expect(chan.concurrency).toBe(-4);
      expect(chan.tryRecv()).toBe(undefined);
      abort.abort('some abort reason');
      expect(chan.concurrency).toBe(0);
      await Promise.all(all);
      expect(logs).toStrictEqual([
        [
          0,
          {
            value: 'a',
          },
        ],
        [
          1,
          {
            value: 'b',
          },
        ],
        [2, 'error: some abort reason'],
        [3, 'error: some abort reason'],
        [4, 'error: some abort reason'],
        [5, 'error: some abort reason'],
      ]);
    });

    test('bulk receives close channel with defaults', async () => {
      const chan = new Chan<string>(0, () => '');
      const logs: unknown[] = [];
      const all: Promise<unknown>[] = [];
      for (let i = 0; i < 3; i++) {
        const j = i;
        all.push(
          (async () => {
            try {
              const result = await chan.recv();
              logs.push([j, result]);
            } catch (e: unknown) {
              logs.push([j, `error: ${e}`]);
            }
          })()
        );
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(chan.concurrency).toBe(-3);
      chan.close();
      expect(chan.concurrency).toBe(0);
      await Promise.all(all);
      expect(logs).toStrictEqual([
        [
          0,
          {
            done: true,
            value: '',
          },
        ],
        [
          1,
          {
            done: true,
            value: '',
          },
        ],
        [
          2,
          {
            done: true,
            value: '',
          },
        ],
      ]);
    });
  });
});

describe('ChanIterator', () => {
  test('receives all values correctly when you send asynchronously no buffer', async () => {
    const chan = new Chan<number>();
    const promises: Array<Promise<unknown>> = [];
    for (let i = 0; i < 5; i++) {
      promises.push(chan.send(i));
    }
    const out: number[] = [];
    for (const v of chan) {
      out.push(v);
    }
    expect(out).toStrictEqual([0, 1, 2, 3, 4]);
    chan.close();
    await Promise.all(promises);
  });

  test('iterate on buffered channel synchronously', () => {
    const chan = new Chan<number>(5);
    for (let i = chan.length; i < chan.capacity; i++) {
      expect(chan.trySend(i)).toBe(true);
    }
    const values: number[] = [];
    for (const value of chan) {
      values.push(value);
    }
    expect(values).toStrictEqual([0, 1, 2, 3, 4]);
    expect(Array.from(chan)).toStrictEqual([]);
    expect(chan.trySend(55)).toBe(true);
    expect(Array.from(chan)).toStrictEqual([55]);
    expect(chan.trySend(-1)).toBe(true);
    const iter = chan[Symbol.iterator]();
    for (let i = -2; i > -5; i--) {
      expect(iter.next()).toStrictEqual({value: i + 1});
      expect(chan.trySend(i)).toBe(true);
    }
    expect(iter.next()).toStrictEqual({value: -4});
    expect(iter.next()).toStrictEqual({value: undefined, done: true});
    expect(iter.next()).toStrictEqual({value: undefined, done: true});
    expect(chan.trySend(Number.MAX_VALUE)).toBe(true);
    expect(iter.next()).toStrictEqual({value: Number.MAX_VALUE});
    for (let i = chan.length; i < chan.capacity; i++) {
      expect(chan.trySend(i)).toBe(true);
    }
    expect(iter).not.toBe(chan[Symbol.iterator]());
    const out: number[] = [];
    const expectedErr = new Error('some error');
    let didNotThrowOnThrowCall = 0;
    try {
      for (const v of iter) {
        out.push(v);
        if (v === 2) {
          iter.throw(expectedErr);
          didNotThrowOnThrowCall++;
        }
      }
      expect('should have thrown').toBe('did not throw');
    } catch (e: unknown) {
      expect(e).toBe(expectedErr);
    }
    expect(out).toStrictEqual([0, 1, 2]);
    expect(didNotThrowOnThrowCall).toBe(1);
    iter.return();
    iter.throw('something else');
    try {
      iter.next();
      expect('should have thrown').toBe('did not throw');
    } catch (e: unknown) {
      expect(e).toBe(expectedErr);
    }
    expect(chan.length).toBe(2);
    for (let i = chan.length; i < chan.capacity; i++) {
      expect(chan.trySend(i + 3)).toBe(true);
    }
    out.length = 0;
    for (const v of chan) {
      out.push(v);
      if (v === 5) {
        chan.close();
      }
    }
    expect(out).toStrictEqual([3, 4, 5, 6, 7]);
  });
});

describe('ChanAsyncIterator', () => {
  test('receives all values correctly when you send then close', async () => {
    const chan = new Chan<number>();
    await Promise.all([
      (async () => {
        for (let i = 0; i < 5; i++) {
          await chan.send(i);
        }
        chan.close();
      })(),
      (async () => {
        const out: number[] = [];
        for await (const v of chan) {
          out.push(v);
        }
        expect(out).toStrictEqual([0, 1, 2, 3, 4]);
      })(),
    ]);
  });

  test('unblocks on return', async () => {
    const chan = new Chan<number>(5);
    for (let i = chan.length; i < chan.capacity; i++) {
      expect(chan.trySend(i)).toBe(true);
    }
    const iter = chan[Symbol.asyncIterator]();
    const values: number[] = [];
    await Promise.all([
      (async () => {
        for await (const value of iter) {
          values.push(value);
        }
      })(),
      (async () => {
        // poll rapidly until chan has a length of 0, then call iter.return
        while (chan.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        await iter.return();
      })(),
    ]);
    expect(values).toStrictEqual([0, 1, 2, 3, 4]);
  });

  test('unblocks on throw for async iterator', async () => {
    const chan = new Chan<number>(5);
    for (let i = chan.length; i < chan.capacity; i++) {
      expect(chan.trySend(i)).toBe(true);
    }
    const iter = chan[Symbol.asyncIterator]();
    const values: number[] = [];
    const expectedErr = new Error('some error');
    let didNotThrowOnThrowCall = 0;

    await Promise.all([
      (async () => {
        try {
          for await (const value of iter) {
            values.push(value);
            if (value === 2) {
              await iter.throw(expectedErr);
              didNotThrowOnThrowCall++;
            }
          }
          expect('should have thrown').toBe('did not throw');
        } catch (e: unknown) {
          expect(e).toBe(expectedErr);
        }
      })(),
      (async () => {
        // poll rapidly until chan has a length of 2, then call iter.throw
        while (chan.length > 2) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        await iter.throw(expectedErr);
      })(),
    ]);

    expect(values).toStrictEqual([0, 1, 2]);
    expect(didNotThrowOnThrowCall).toBe(1);

    // Once the iterator has thrown, all subsequent calls should also throw the same error
    try {
      await iter.next();
      expect('should have thrown').toBe('did not throw');
    } catch (e: unknown) {
      expect(e).toBe(expectedErr);
    }

    expect(chan.length).toBe(2);
  });
});
