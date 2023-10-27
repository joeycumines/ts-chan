import {type SenderCallback} from '../src/protocol';

describe('SenderCallback', () => {
  test('type sanity', () => {
    const callback: SenderCallback<number> = (err, ok) => {
      if (!ok) {
        throw err;
      }
      return 123;
    };
    const expectNumber = (a: number, b: number) => {
      expect(a).toBe(b);
    };
    expectNumber(callback(undefined, true), 123);
  });
});
