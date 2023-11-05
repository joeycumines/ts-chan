import {SelectFactory} from '../src/select-factory';
import {Chan} from '../src/chan';

describe('SelectFactory', () => {
  describe('with', () => {
    test('send with stable targets', async () => {
      const selectFactory = new SelectFactory();
      // shouldn't break
      selectFactory.clear();
      const ch1 = new Chan<5 | 4>(1);
      const ch2 = new Chan<'A' | 'B'>(1);
      const ch3 = new Chan<'hello'>();
      for (let i = 0; i < 10; i++) {
        const value = (i % 2 === 0 ? 'A' : 'B') as 'A' | 'B';
        const select = selectFactory.with([
          {recv: ch1},
          {send: ch2, value},
          {recv: ch3},
        ]);
        const idx = await select.wait();
        switch (idx) {
          case 0: {
            const v: IteratorResult<4 | 5> = select.recv(select.cases[idx]);
            expect(v).toBe('should not have resolved this case');
            // @ts-expect-error -- intentionally invalid type
            const v2: IteratorResult<'A' | 'B'> = select.recv(
              select.cases[idx]
            );
            expect(v2).toBe('should never get here');
            // @ts-expect-error -- intentionally invalid type
            const v3: IteratorResult<'hello'> = select.recv(select.cases[idx]);
            expect(v3).toBe('should never get here');
            break;
          }
          case 1: {
            const v: IteratorResult<'A' | 'B'> | undefined = ch2.tryRecv();
            expect(v).toStrictEqual({value});
            break;
          }
          case 2: {
            const v: IteratorResult<'hello'> = select.recv(select.cases[idx]);
            expect(v).toBe('should not have resolved this case');
            // @ts-expect-error -- intentionally invalid type
            const v2: IteratorResult<4 | 5> = select.recv(select.cases[idx]);
            expect(v2).toBe('should never get here');
            // @ts-expect-error -- intentionally invalid type
            const v3: IteratorResult<'A' | 'B'> = select.recv(
              select.cases[idx]
            );
            expect(v3).toBe('should never get here');
            break;
          }
          default:
            throw new Error('unreachable');
        }
        selectFactory.clear();
      }
    });
  });
});
