export class CircularBuffer<T> {
  // The maximum number of items the buffer can hold.
  readonly capacity: number;
  private readonly buffer: T[];
  private head = 0;
  private tail = 0;
  private size = 0;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new Error(`js-chan: invalid capacity: ${capacity}`);
    }
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  // True if the buffer is empty.
  get empty(): boolean {
    return this.size === 0;
  }

  // True if the buffer is full.
  get full(): boolean {
    return this.size === this.capacity;
  }

  // The number of elements in the buffer.
  get length(): number {
    return this.size;
  }

  // Adds an item to the buffer. Throws an error if full.
  push(item: T): void {
    if (this.size >= this.capacity) {
      throw new Error('js-chan: buffer full');
    }
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    this.size++;
  }

  // Removes and returns the oldest item from the buffer, or undefined (empty).
  shift(): T | undefined {
    if (this.empty) {
      return undefined;
    }
    const item = this.buffer[this.head];
    this.buffer[this.head] = undefined!;
    this.head = (this.head + 1) % this.capacity;
    this.size--;
    return item;
  }

  // Returns the oldest item without removing it, or undefined if empty.
  peek(): T | undefined {
    if (this.empty) {
      return undefined;
    }
    return this.buffer[this.head];
  }

  // Reset the buffer, emptying it without clearing references.
  // WARNING: Use with caution - prefer the `clear` method if GC is a concern.
  reset(): void {
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  // Clears the buffer and removes references to all items.
  clear() {
    while (!this.empty) {
      this.shift();
    }
    this.reset();
  }
}
