import {Select} from '../src/select';
import {recv, send} from '../src/case';
import {Chan} from '../src/chan';

describe('Select', () => {
  test('simple send example - handle input and output with abort support', async () => {
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
