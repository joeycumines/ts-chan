import {random} from '../src/math';

test('random', () => {
  const v = random();
  expect(v).toBeGreaterThanOrEqual(0);
  expect(v).toBeLessThan(1);
});
