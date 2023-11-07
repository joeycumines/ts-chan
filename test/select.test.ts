import {Select} from '../src/select';
import {
  recv,
  type SelectCasePromise,
  type SelectCaseReceiver,
  type SelectCaseSender,
  send,
  wait,
} from '../src/case';
import {Chan} from '../src/chan';

describe('Select', () => {
  it('should fairly select both send and recv', async () => {
    // https://go.dev/play/p/ktfcf1R7Tsv
    // https://gist.github.com/joeycumines/d30579b3eb11bd3fbfc3033078dd6429

    const iterations = 10000;

    const chRecv1 = new Chan<number>(1);
    const chRecv2 = new Chan<number>(1);
    const chSend1 = new Chan<number>(1);
    const chSend2 = new Chan<number>(1);

    let chRecv1Count = 0;
    let chRecv2Count = 0;
    let chSend1Count = 0;
    let chSend2Count = 0;

    const timeToStop = Symbol('timeToStop');
    const catchTimeToStop = (reason: unknown) => {
      if (reason !== timeToStop) {
        throw reason;
      }
    };
    const abort = new AbortController();

    const workers = Promise.all([
      (async () => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await chRecv1.send(1, abort.signal);
        }
      })().catch(catchTimeToStop),
      (async () => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await chRecv2.send(1, abort.signal);
        }
      })().catch(catchTimeToStop),
      (async () => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await chSend1.recv(abort.signal);
        }
      })().catch(catchTimeToStop),
      (async () => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await chSend2.recv(abort.signal);
        }
      })().catch(catchTimeToStop),
    ]);

    const select = new Select([
      recv(chRecv1),
      send(chSend1, () => {
        return 1;
      }),
      recv(chRecv2),
      send(chSend2, () => {
        return 1;
      }),
    ]);
    for (let i = 0; i < 4 * iterations; i++) {
      const idx = await select.wait(abort.signal);
      switch (idx) {
        case 0:
          chRecv1Count++;
          break;
        case 1:
          chSend1Count++;
          break;
        case 2:
          chRecv2Count++;
          break;
        case 3:
          chSend2Count++;
          break;
      }
    }

    abort.abort(timeToStop);
    await workers;

    const calculateDeltaPercent = (count: number) =>
      ((count - iterations) / iterations) * 100;

    // console.log({
    //   chRecv1: `${chRecv1Count} (delta ${calculateDeltaPercent(
    //     chRecv1Count
    //   )}%)`,
    //   chRecv2: `${chRecv2Count} (delta ${calculateDeltaPercent(
    //     chRecv2Count
    //   )}%)`,
    //   chSend1: `${chSend1Count} (delta ${calculateDeltaPercent(
    //     chSend1Count
    //   )}%)`,
    //   chSend2: `${chSend2Count} (delta ${calculateDeltaPercent(
    //     chSend2Count
    //   )}%)`,
    // });

    const thresholdPercent = 3;
    expect(Math.abs(calculateDeltaPercent(chRecv1Count))).toBeLessThan(
      thresholdPercent
    );
    expect(Math.abs(calculateDeltaPercent(chRecv2Count))).toBeLessThan(
      thresholdPercent
    );
    expect(Math.abs(calculateDeltaPercent(chSend1Count))).toBeLessThan(
      thresholdPercent
    );
    expect(Math.abs(calculateDeltaPercent(chSend2Count))).toBeLessThan(
      thresholdPercent
    );
  });

  describe('examples', () => {
    test('mixing promises with channels', async () => {
      const ch = new Chan<number>(1);
      let chCount = 0;
      let promiseImmediateResolveCount = 0;
      let promiseDelayedResolveCount = 0;
      let promiseRejectCount = 0;

      const timeToStop = Symbol('timeToStop');
      const catchTimeToStop = (reason: unknown) => {
        if (reason !== timeToStop) {
          throw reason;
        }
      };
      const abort = new AbortController();

      const workers: Promise<void>[] = [
        (async () => {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            await ch.send(1, abort.signal);
          }
        })().catch(catchTimeToStop),
      ];

      const immediateResolvedPromise = Promise.resolve('immediate');
      const delayedResolvedPromise = new Promise<string>(resolve => {
        setTimeout(() => {
          resolve('delayed');
        }, 10);
      });
      const rejectedPromise = Promise.reject('error');

      const select = Select.promises([
        recv(ch),
        immediateResolvedPromise,
        delayedResolvedPromise,
        rejectedPromise,
      ]);
      const doIteration = async () => {
        const result = await select.wait(abort.signal);
        switch (result) {
          case 0:
            chCount++;
            break;
          case 1:
            promiseImmediateResolveCount++;
            expect(select.recv(select.cases[result])).toStrictEqual({
              value: 'immediate',
            });
            break;
          case 2:
            promiseDelayedResolveCount++;
            expect(select.recv(select.cases[result])).toStrictEqual({
              value: 'delayed',
            });
            break;
          case 3: {
            promiseRejectCount++;
            const c = select.cases[result];
            try {
              select.recv(c);
              expect('to be unreachable').toBe('unreachable');
            } catch (e) {
              expect(e).toBe('error');
            }
            break;
          }
          default:
            throw new Error('unreachable');
        }
      };

      for (let i = 0; i < 20; i++) {
        await doIteration();
      }
      expect(promiseRejectCount).toBe(1);
      expect(promiseImmediateResolveCount).toBe(1);
      expect(chCount).toBe(18);

      workers.push(
        (async () => {
          // eslint-disable-next-line no-constant-condition -- stopped by abort
          while (true) {
            await doIteration();
          }
        })().catch(catchTimeToStop)
      );

      await delayedResolvedPromise;
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      expect(promiseDelayedResolveCount).toBe(1);
      expect(chCount).toBeGreaterThan(18);

      abort.abort(timeToStop);
      await Promise.all(workers);
    });

    test('documented example on Select.cases - Accessing a (typed) received value', async () => {
      const ch1Values: readonly number[] = [
        4.6, 8.2, 104.523, -451.2, 2.01, 24.88, 99,
      ];

      function* ch2Values() {
        for (let i = 0; ; i++) {
          yield `ch2:${i}`;
        }
      }

      const runTestReturnLog = async (
        ch1Cap: number,
        ch2Cap: number,
        delay: number | undefined
      ) => {
        const abort = new AbortController();
        const log: ['ch1' | 'ch2', unknown][] = [];
        const ch1 = new Chan<number>(ch1Cap);
        const ch2 = new Chan<string>(ch2Cap);

        async function sendsToCh1ThenEventuallyClosesIt() {
          for (const v of ch1Values) {
            if (delay !== undefined) {
              await new Promise(resolve =>
                setTimeout(resolve, delay * Math.random())
              );
            }
            await ch1.send(v, abort.signal);
          }
          ch1.close();
        }

        async function sendsToCh2() {
          for (const v of ch2Values()) {
            if (delay !== undefined) {
              await new Promise(resolve =>
                setTimeout(resolve, delay * Math.random())
              );
            }
            await ch2.send(v, abort.signal);
          }
        }

        const sentinel = Symbol('sentinel');
        const bg = Promise.all([
          sendsToCh1ThenEventuallyClosesIt(),
          sendsToCh2().catch(e => {
            if (e !== sentinel) {
              throw e;
            }
          }),
        ]);

        // start with the channels somewhat buffered
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, delay ?? 0));
        }

        const select = new Select([recv(ch1), recv(ch2)]);
        for (let running = true; running; ) {
          const i = await select.wait();
          switch (i) {
            case 0: {
              const v = select.recv(select.cases[i]);
              if (v.done) {
                running = false;
                break;
              }
              log.push(['ch1', Math.round(v.value)]);
              break;
            }
            case 1: {
              const v = select.recv(select.cases[i]);
              if (v.done) {
                throw new Error('ch2 unexpectedly closed');
              }
              log.push(['ch2', v.value.toUpperCase()]);
              break;
            }
            default:
              throw new Error('unreachable');
          }
        }

        const result = log.slice();
        log.length = 0;

        abort.abort(sentinel);
        await bg;

        expect(log).toStrictEqual([]);

        return result;
      };

      const promises = new Array<ReturnType<typeof runTestReturnLog>>();
      for (let ch1Cap = 0; ch1Cap < 10; ch1Cap++) {
        for (let ch2Cap = 0; ch2Cap < 10; ch2Cap++) {
          for (let i = 0; i < 5; i++) {
            promises.push(runTestReturnLog(ch1Cap, ch2Cap, undefined));
            for (let delay = 0; delay <= 30; delay += 10) {
              promises.push(runTestReturnLog(ch1Cap, ch2Cap, delay));
            }
          }
        }
      }

      const testResults = await Promise.all(promises);

      // each result must have ALL of ch1Values, and any number of ch2Values, ALWAYS in order
      const ch1Expected: (typeof testResults)[0] = ch1Values.map(v => [
        'ch1',
        Math.round(v),
      ]);
      for (const results of testResults) {
        const ch1Results = results.filter(r => r[0] === 'ch1');
        const ch2Results = results.filter(r => r[0] === 'ch2');
        expect(ch1Results).toStrictEqual(ch1Expected);
        const ch2Expected: typeof ch2Results = [];
        for (const v of ch2Values()) {
          if (ch2Expected.length === ch2Results.length) {
            break;
          }
          ch2Expected.push(['ch2', v.toUpperCase()]);
        }
        expect(ch2Results).toStrictEqual(ch2Expected);
      }
    });

    test('send example - handle input and output with abort support', async () => {
      const runTest = async () => {
        const abort = new AbortController();
        const input = new Chan<string>();
        const output = new Chan<number>();
        let outputCount = 0;
        const inputValues: string[] = [];
        const outputValues: number[] = [];
        const abortReason = Symbol('some abort reason');
        await Promise.all([
          expect(
            (async () => {
              let outputValue = 0;
              const select = new Select([
                recv(input),
                send(output, () => {
                  return outputValue++;
                }),
              ]);
              // eslint-disable-next-line no-constant-condition
              while (true) {
                const i = await select.wait(abort.signal);
                switch (i) {
                  case 0: {
                    const v = select.recv(select.cases[i]);
                    if (v.done) {
                      throw new Error(`unexpected recv: ${JSON.stringify(v)}`);
                    }
                    inputValues.push(v.value);
                    break;
                  }
                  case 1: {
                    outputCount++;
                    break;
                  }
                  default:
                    throw new Error('unreachable');
                }
              }
            })()
          ).rejects.toBe(abortReason),
          (async () => {
            const inputValues = ['a', 'b', 'c'];
            for (const v of inputValues) {
              await input.send(v);
              const r = await output.recv();
              if (r.done) {
                throw new Error(`unexpected recv: ${JSON.stringify(r)}`);
              }
              outputValues.push(r.value);
            }
            abort.abort(abortReason);
          })(),
        ]);
        expect(outputCount).toBe(3);
        expect(inputValues).toStrictEqual(['a', 'b', 'c']);
        expect(outputValues).toStrictEqual([0, 1, 2]);
      };

      await Promise.all([
        runTest(),
        runTest(),
        runTest(),
        runTest(),
        runTest(),
        runTest(),
        runTest(),
        runTest(),
        runTest(),
      ]);
    });
  });

  describe('recv', () => {
    it('should facilitate handling multiple return types', async () => {
      const chanNumber = new Chan<number>(1);
      const chanString = new Chan<string>(1);
      const promiseBoolean = Promise.resolve<true>(true);
      const select = Select.promises([
        recv(chanNumber),
        recv(chanString),
        promiseBoolean,
      ]);
      let ci = select.poll();
      expect(ci).toBeUndefined();
      await new Promise(resolve => setTimeout(resolve, 0));
      ci = select.poll();
      if (ci === undefined) {
        throw new Error('ci is undefined');
      }
      expect(ci).toBe(2);
      const promiseBooleanResult: IteratorResult<true, true | undefined> =
        select.recv(select.cases[2]);
      expect(promiseBooleanResult).toStrictEqual({
        value: true,
      });
      expect(chanNumber.trySend(1235)).toBe(true);
      expect(select.poll()).toBe(0);
      const chanNumberResult: IteratorResult<number, number | undefined> =
        select.recv(select.cases[0]);
      expect(chanNumberResult).toStrictEqual({value: 1235});
    });
  });

  describe('wait', () => {
    describe('comparison to Promise.race', () => {
      const tests = async (race: typeof Promise.race | undefined) => {
        it('should always resolve or reject with the first settled promise', async () => {
          // Helper function: Fisher-Yates Shuffle algorithm
          function shuffleArray<T>(array: T[]): T[] {
            for (let i = array.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
          }

          const runs = 1000; // Number of fuzz test iterations

          for (let i = 0; i < runs; i++) {
            // 1. Decide how many promises we want to test
            const numPromises = Math.floor(Math.random() * 10) + 1; // Between 1 and 10 inclusive

            // 2. Create promises and extract their resolve/reject callbacks
            const promises: Promise<string>[] = [];
            const callbacksMap = new Map<
              Promise<string>,
              {
                id: number;
                resolve: (value: string) => void;
                reject: (reason: any) => void;
              }
            >();

            for (let j = 0; j < numPromises; j++) {
              let resolver: (value: string) => void = () => {};
              let rejecter: (reason: any) => void = () => {};
              const promise = new Promise<string>((resolve, reject) => {
                resolver = resolve;
                rejecter = reject;
              });

              promises.push(promise);
              callbacksMap.set(promise, {
                id: j,
                resolve: resolver,
                reject: rejecter,
              });
            }

            // 4. Call Promise.race but do not await
            const racePromise =
              race === undefined ? Promise.race(promises) : race(promises);

            // 5. Shuffle the promises array
            shuffleArray(promises);

            // 6. Resolve some promises randomly
            const numToResolve = Math.floor(Math.random() * numPromises) + 1; // At least 1
            let expectedValue: unknown;
            let expectedReject = false;
            for (let j = 0; j < numToResolve; j++) {
              const outcome = Math.random() < 0.5 ? 'resolve' : 'reject'; // Randomly decide the outcome
              const {id, resolve, reject} = callbacksMap.get(promises[j])!;

              if (outcome === 'resolve') {
                const value = `Resolved: ${id}`;
                // console.log(value);
                if (j === 0) {
                  expectedValue = value;
                  expectedReject = false;
                }
                resolve(value);
              } else {
                const reason = `Rejected: ${id}`;
                // console.log(reason);
                if (j === 0) {
                  expectedValue = reason;
                  expectedReject = true;
                }
                reject(reason);
              }

              // console.log(
              //   'expectedValue',
              //   expectedValue,
              //   'expectedReject',
              //   expectedReject
              // );

              // 7. Test the result
              await expect(racePromise)[
                expectedReject ? 'rejects' : 'resolves'
              ].toStrictEqual(expectedValue);
            }
          }
        });
      };
      describe('baseline Promise.race', () => {
        tests(undefined);
      });
      describe('Select used as Promise.race', () => {
        tests(
          async <T>(values: Iterable<PromiseLike<T>>): Promise<Awaited<T>> => {
            const select = Select.promises(Array.from(values));
            // eslint-disable-next-line no-constant-condition
            while (true) {
              const v = select.recv(select.cases[await select.wait()]);
              if (v.done) {
                throw new Error('promises should never indicate closed');
              }
              return v.value;
            }
          }
        );
      });
    });
  });

  test('promise cases built using the wait function', async () => {
    const resolves: Record<string, (v: any) => void> = {};
    const a = new Promise<'A'>(resolve => {
      resolves['a'] = resolve;
    });
    const b = new Promise<'B'>(resolve => {
      resolves['b'] = resolve;
    });
    const c = new Promise<'C'>(resolve => {
      resolves['c'] = resolve;
    });
    const ch1 = new Chan<'CH1'>();
    const ch2 = new Chan<'CH2'>();
    const select = new Select([
      wait(a),
      wait(b),
      wait(c),
      send(ch1, (): 'CH1' => 'CH1'),
      recv(ch2),
      wait(new Promise<'P1'>(() => {})),
    ]);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(select.poll()).toBeUndefined();

    resolves['b']('B');
    resolves['a']('A');

    await expect(select.wait()).resolves.toBe(1);
    const bv: IteratorResult<
      Awaited<typeof b>,
      Awaited<typeof b> | undefined
    > = select.recv(select.cases[1]);
    expect(bv).toStrictEqual({value: 'B'});

    resolves['c']('C');

    await expect(select.wait()).resolves.toBe(0);
    const av: IteratorResult<
      Awaited<typeof a>,
      Awaited<typeof a> | undefined
    > = select.recv(select.cases[0]);
    expect(av).toStrictEqual({value: 'A'});

    await expect(select.wait()).resolves.toBe(2);
    // @ts-expect-error -- testing that fails on invalid type
    const cv: IteratorResult<
      Awaited<typeof a>,
      Awaited<typeof a> | undefined
    > = select.recv(select.cases[2]);
    expect(cv).toStrictEqual({value: 'C'});

    const sendCaseCh1: SelectCaseSender<'CH1'> = select.cases[3];
    expect(sendCaseCh1).not.toBeUndefined();

    const recvCaseCh2: SelectCaseReceiver<'CH2'> = select.cases[4];
    expect(recvCaseCh2).not.toBeUndefined();

    const waitCaseP1: SelectCasePromise<'P1'> = select.cases[5];
    expect(waitCaseP1).not.toBeUndefined();

    // more type assertions to ensure it fails when used incorrectly

    // @ts-expect-error -- testing that fails on invalid type
    const sendCaseCh1_2: SelectCaseSender<'CH1'> = select.cases[4];
    expect(sendCaseCh1_2).not.toBeUndefined();
    // @ts-expect-error -- testing that fails on invalid type
    const recvCaseCh2_2: SelectCaseReceiver<'CH2'> = select.cases[3];
    expect(recvCaseCh2_2).not.toBeUndefined();
    // @ts-expect-error -- testing that fails on invalid type
    const waitCaseP1_2: SelectCasePromise<'P1'> = select.cases[3];
    expect(waitCaseP1_2).not.toBeUndefined();
    // @ts-expect-error -- testing that fails on invalid type
    const waitCaseP1_3: SelectCasePromise<'P1'> = select.cases[4];
    expect(waitCaseP1_3).not.toBeUndefined();
    // @ts-expect-error -- testing that fails on invalid type
    const waitCaseP1_5: SelectCasePromise<'P1'> = select.cases[0];
    expect(waitCaseP1_5).not.toBeUndefined();
    // @ts-expect-error -- testing that fails on invalid type
    const waitCaseP1_6: SelectCasePromise<'P1'> = select.cases[1];
    expect(waitCaseP1_6).not.toBeUndefined();
    // @ts-expect-error -- testing that fails on invalid type
    const waitCaseP1_7: SelectCasePromise<'P1'> = select.cases[2];
    expect(waitCaseP1_7).not.toBeUndefined();
    // @ts-expect-error -- testing that fails on invalid type
    const waitCaseP1_8: SelectCasePromise<'P1'> = select.cases[6];
    expect(waitCaseP1_8).toBeUndefined();
  });

  test('promise cases built using using Select.promises', async () => {
    const resolves: Record<string, (v: any) => void> = {};
    const a = new Promise<'A'>(resolve => {
      resolves['a'] = resolve;
    });
    const b = new Promise<'B'>(resolve => {
      resolves['b'] = resolve;
    });
    const c = new Promise<'C'>(resolve => {
      resolves['c'] = resolve;
    });
    const ch1 = new Chan<'CH1'>();
    const ch2 = new Chan<'CH2'>();
    const select = Select.promises([
      a,
      b,
      c,
      send(ch1, (): 'CH1' => 'CH1'),
      recv(ch2),
      wait(new Promise<'P1'>(() => {})),
    ]);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(select.poll()).toBeUndefined();

    resolves['b']('B');
    resolves['a']('A');

    await expect(select.wait()).resolves.toBe(1);
    const bv: IteratorResult<
      Awaited<typeof b>,
      Awaited<typeof b> | undefined
    > = select.recv(select.cases[1]);
    expect(bv).toStrictEqual({value: 'B'});

    resolves['c']('C');

    await expect(select.wait()).resolves.toBe(0);
    const av: IteratorResult<
      Awaited<typeof a>,
      Awaited<typeof a> | undefined
    > = select.recv(select.cases[0]);
    expect(av).toStrictEqual({value: 'A'});

    await expect(select.wait()).resolves.toBe(2);
    // @ts-expect-error -- testing that fails on invalid type
    const cv: IteratorResult<
      Awaited<typeof a>,
      Awaited<typeof a> | undefined
    > = select.recv(select.cases[2]);
    expect(cv).toStrictEqual({value: 'C'});

    const sendCaseCh1: SelectCaseSender<'CH1'> = select.cases[3];
    expect(sendCaseCh1).not.toBeUndefined();

    const recvCaseCh2: SelectCaseReceiver<'CH2'> = select.cases[4];
    expect(recvCaseCh2).not.toBeUndefined();

    const waitCaseP1: SelectCasePromise<'P1'> = select.cases[5];
    expect(waitCaseP1).not.toBeUndefined();

    // more type assertions to ensure it fails when used incorrectly

    // @ts-expect-error -- testing that fails on invalid type
    const sendCaseCh1_2: SelectCaseSender<'CH1'> = select.cases[4];
    expect(sendCaseCh1_2).not.toBeUndefined();
    // @ts-expect-error -- testing that fails on invalid type
    const recvCaseCh2_2: SelectCaseReceiver<'CH2'> = select.cases[3];
    expect(recvCaseCh2_2).not.toBeUndefined();
    // @ts-expect-error -- testing that fails on invalid type
    const waitCaseP1_2: SelectCasePromise<'P1'> = select.cases[3];
    expect(waitCaseP1_2).not.toBeUndefined();
    // @ts-expect-error -- testing that fails on invalid type
    const waitCaseP1_3: SelectCasePromise<'P1'> = select.cases[4];
    expect(waitCaseP1_3).not.toBeUndefined();
    // @ts-expect-error -- testing that fails on invalid type
    const waitCaseP1_5: SelectCasePromise<'P1'> = select.cases[0];
    expect(waitCaseP1_5).not.toBeUndefined();
    // @ts-expect-error -- testing that fails on invalid type
    const waitCaseP1_6: SelectCasePromise<'P1'> = select.cases[1];
    expect(waitCaseP1_6).not.toBeUndefined();
    // @ts-expect-error -- testing that fails on invalid type
    const waitCaseP1_7: SelectCasePromise<'P1'> = select.cases[2];
    expect(waitCaseP1_7).not.toBeUndefined();
    // @ts-expect-error -- testing that fails on invalid type
    const waitCaseP1_8: SelectCasePromise<'P1'> = select.cases[6];
    expect(waitCaseP1_8).toBeUndefined();
  });

  test('types stop you mutating the cases', () => {
    const select = new Select<[SelectCaseReceiver<number>]>([recv(new Chan())]);
    // @ts-expect-error -- testing that fails on operation
    select.cases[0] = recv(new Chan());
    // @ts-expect-error -- testing that fails on operation
    select.cases.length = 5;
  });

  describe('pending', () => {
    test('using pending to facilitate cleanup', async () => {
      const promiseArr = new Array<Promise<number>>();
      const promiseMap = new Map<
        Promise<number>,
        {
          index: number;
          resolve: (value: number) => void;
          reject: (reason: number) => void;
          // true for resolved false for rejected
          input?: boolean;
          // true for resolved false for rejected
          output?: boolean;
          // order received from the select (some will be undefined, see below)
          order?: number;
        }
      >();
      for (let i = 0; i < 15_000; i++) {
        let resolveV: ((value: number) => void) | undefined;
        let rejectV: ((reason: number) => void) | undefined;
        promiseArr.push(
          new Promise<number>((resolve, reject) => {
            resolveV = resolve;
            rejectV = reject;
          })
        );
        if (resolveV === undefined || rejectV === undefined) {
          throw new Error('unreachable');
        }
        promiseMap.set(promiseArr[i], {
          index: i,
          resolve: resolveV,
          reject: rejectV,
        });
      }

      const select = Select.promises(promiseArr);

      // simulate promises resolving in random order, in batches of 1-100, each
      // 0-2ms (rounded), with each promise having a 1/10 chance of rejecting
      // instead
      //
      // additionally, consume until there's 2723 left, which should always be
      // exact, since it's independent of the promises resolving
      // then, retrieve those 2723 from the select, verify, then await those
      // promises, and verify again
      await Promise.all([
        (async () => {
          // use a fair, fisher-yates shuffle, to stage up the resolve order
          const promises = promiseArr.slice();
          for (let i = promises.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [promises[i], promises[j]] = [promises[j], promises[i]];
          }
          // resolve promises in batches
          for (let i = 0; i < promises.length; ) {
            // Determine the size of the current batch (1-100)
            const batchSize = Math.floor(Math.random() * 100) + 1;
            const batchPromises: Promise<void>[] = [];
            for (let j = 0; j < batchSize && i < promises.length; j++, i++) {
              const promise = promises[i];
              const promiseInfo = promiseMap.get(promise)!;
              // Wrap the resolve/reject in a setTimeout to introduce the delay of 0-2ms
              const delay = Math.round(Math.random() * 2);
              batchPromises.push(
                new Promise<void>(resolve => {
                  setTimeout(() => {
                    const shouldReject = Math.random() < 0.1; // 1/10 chance of rejecting
                    if (shouldReject) {
                      promiseInfo.reject(promiseInfo.index);
                    } else {
                      promiseInfo.resolve(promiseInfo.index);
                    }
                    promiseInfo.input = !shouldReject;
                    resolve();
                  }, delay);
                })
              );
            }
            // Wait for the entire batch to be processed before moving to the next
            await Promise.all(batchPromises);
          }
        })(),
        (async () => {
          // consume until there's 2723 left
          let remaining = promiseArr.length;
          for (let order = 0; remaining > 2723; order++) {
            const i = await select.wait();
            const promise = promiseArr[i];
            const promiseInfo = promiseMap.get(promise)!;
            promiseInfo.order = order;
            expect(promiseInfo.input).not.toBeUndefined();
            expect(promiseInfo.output).toBeUndefined();
            try {
              const v = select.recv(select.cases[i]);
              expect(v.done).toBe(undefined);
              expect(v.value).toBe(i);
              promiseInfo.output = true;
            } catch (e) {
              if (e !== i) {
                throw e;
              }
              promiseInfo.output = false;
            }
            expect(promiseInfo.output).toBe(promiseInfo.input);
            remaining--;
          }

          const unhandled = select.pending;
          expect(unhandled.length).toBe(2723);
          expect(select.length).toBe(2723);
          for (const v of unhandled) {
            expect(promiseMap.has(v as any)).toBe(true);
            expect(promiseMap.get(v as any)!.output).toBeUndefined();
          }
        })(),
      ]);

      const unhandled = select.pending;

      await Promise.all(promiseArr.map(p => p.catch(() => {})));

      expect(unhandled.length).toBe(2723);
      expect(select.length).toBe(2723);
      for (const v of unhandled) {
        expect(promiseMap.has(v as any)).toBe(true);
        expect(promiseMap.get(v as any)!.output).toBeUndefined();
        promiseMap.delete(v as any);
      }

      for (const v of promiseMap.values()) {
        expect(v.output).not.toBeUndefined();
      }

      expect(unhandled).toStrictEqual(select.pending);
    });
  });

  test('support for value undefined', async () => {
    const select = new Select([wait(undefined)]);
    await expect(select.wait()).resolves.toBe(0);
    expect(select.recv(select.cases[0])).toStrictEqual({value: undefined});
  });

  test('setUnsafe', () => {
    const select = new Select([]);
    expect(select.unsafe).toBe(false);
    expect(select.setUnsafe(true)).toBe(select);
    expect(select.unsafe).toBe(true);
    expect(select.setUnsafe(false)).toBe(select);
    expect(select.unsafe).toBe(false);
  });
});
