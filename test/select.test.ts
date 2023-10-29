import {Select} from '../src/select';
import {recv, send} from '../src/case';
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
      send(chSend1, (err, ok) => {
        if (!ok) {
          throw err;
        }
        return 1;
      }),
      recv(chRecv2),
      send(chSend2, (err, ok) => {
        if (!ok) {
          throw err;
        }
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
                send(output, (err, ok) => {
                  if (!ok) {
                    throw err;
                  }
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
      const select = new Select([
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
        done: true,
        value: true,
      });
      expect(chanNumber.trySend(1235)).toBe(true);
      expect(select.poll()).toBe(0);
      const chanNumberResult: IteratorResult<number, number | undefined> =
        select.recv(select.cases[0]);
      expect(chanNumberResult).toStrictEqual({value: 1235});
    });
  });
});
