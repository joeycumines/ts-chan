import {CircularBuffer} from '../src/buffer';

describe('CircularBuffer', () => {
  let buffer: CircularBuffer<number>;

  beforeEach(() => {
    buffer = new CircularBuffer<number>(3); // A buffer with a capacity of 3 for demonstration.
  });

  test('initial state', () => {
    expect(buffer.empty).toBe(true);
    expect(buffer.full).toBe(false);
    expect(buffer.length).toBe(0);
    expect(buffer.peek()).toBeUndefined();
  });

  test('pushing items', () => {
    buffer.push(1);
    expect(buffer.empty).toBe(false);
    expect(buffer.full).toBe(false);
    expect(buffer.length).toBe(1);
    expect(buffer.peek()).toBe(1);

    buffer.push(2);
    expect(buffer.length).toBe(2);
    expect(buffer.peek()).toBe(1);

    buffer.push(3);
    expect(buffer.full).toBe(true);
    expect(buffer.length).toBe(3);
    expect(buffer.peek()).toBe(1);
  });

  test('pushing items beyond capacity', () => {
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    expect(() => buffer.push(4)).toThrow('js-chan: buffer full');
    expect(buffer.full).toBe(true);
    expect(buffer.length).toBe(3);
    expect(buffer.peek()).toBe(1);
  });

  test('shifting items', () => {
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);

    expect(buffer.shift()).toBe(1);
    expect(buffer.length).toBe(2);

    expect(buffer.shift()).toBe(2);
    expect(buffer.length).toBe(1);

    expect(buffer.shift()).toBe(3);
    expect(buffer.empty).toBe(true);
  });

  test('shifting from an empty buffer', () => {
    expect(buffer.shift()).toBeUndefined();
  });

  test('peek does not modify the buffer', () => {
    buffer.push(1);
    buffer.push(2);

    expect(buffer.peek()).toBe(1);
    expect(buffer.length).toBe(2);
  });

  test('resetting the buffer', () => {
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);

    buffer.reset();

    expect(buffer.empty).toBe(true);
    expect(buffer.full).toBe(false);
    expect(buffer.length).toBe(0);
    expect(buffer.peek()).toBeUndefined();
  });

  test('clearing the buffer', () => {
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);

    buffer.clear();

    expect(buffer.empty).toBe(true);
    expect(buffer.full).toBe(false);
    expect(buffer.length).toBe(0);
    expect(buffer.peek()).toBeUndefined();

    // Check internals to ensure references are cleared.
    expect((buffer as any).buffer[0]).toBeUndefined();
    expect((buffer as any).buffer[1]).toBeUndefined();
    expect((buffer as any).buffer[2]).toBeUndefined();
  });

  test('clearing an already empty buffer', () => {
    buffer.clear();

    expect(buffer.empty).toBe(true);
    expect(buffer.full).toBe(false);
    expect(buffer.length).toBe(0);
    expect(buffer.peek()).toBeUndefined();

    // Check internals to ensure references are cleared.
    expect((buffer as any).buffer[0]).toBeUndefined();
    expect((buffer as any).buffer[1]).toBeUndefined();
    expect((buffer as any).buffer[2]).toBeUndefined();
  });

  test('interaction of push, shift, and clear', () => {
    buffer.push(1);
    buffer.push(2);
    buffer.shift();
    buffer.push(3);
    buffer.push(4);
    buffer.clear();

    expect(buffer.empty).toBe(true);
    expect(buffer.full).toBe(false);
    expect(buffer.length).toBe(0);
    expect(buffer.peek()).toBeUndefined();

    // Check internals to ensure references are cleared.
    expect((buffer as any).buffer[0]).toBeUndefined();
    expect((buffer as any).buffer[1]).toBeUndefined();
    expect((buffer as any).buffer[2]).toBeUndefined();
  });
});
