# Pattern: Fan-in in JavaScript

## Preface

This section illustrates the fan-in pattern using `ts-chan` and vanilla
JavaScript, without providing an exhaustive list of use cases.

## What is Fan-in?

Fan-in allows multiple concurrent sources to send data to a single channel,
commonly used in concurrent programming to merge data streams. It typically
involves buffering to manage asynchronicity, improving IO efficiency and
providing back-pressure to limit the memory footprint on the receiver's side.

## Related Patterns

### Fan-in + Fan-out

Fan-in is often paired with fan-out to enable concurrent data processing across
multiple producers and consumers. Bounded concurrency with multiple sources is
a typical application. `AsyncIterator` interfaces, like async generators, can
simplify fan-out implementations.

## Related examples

### Multiplexing log streams

Source at
[/examples/pattern-fan-in-multiplex-log-streams](../examples/pattern-fan-in-multiplex-log-streams).

## With ts-chan

Implementing fan-in with `ts-chan` is extremely trivial.

```js
const {Chan} = require('ts-chan');

const chan = new Chan();

// Example usage:

(async () => {
  // Send values
  for (let i = 0; i < 3; i++) {
    console.log('Sending', i);
    await chan.send(i);
  }
})();

(async () => {
  // Receive values
  for await (const value of chan) {
    console.log(`Received ${value}`);
    // simulate slow processing
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
})();
```

Note that there are currently three ways `Chan` instances may be configured:

1. Buffer capacity (default `0`, potentially useful for this pattern)
2. Default value (values provided to calls to `Chan.recv` on close)
3. Enabling "unsafe" mode (default `false`) (potentially useful for this
   pattern, see the [API docs](../README.md))

For example:

```js
const {Chan} = require('ts-chan');
const chan = new Chan(64, () => new YourDefaultValue()).setUnsafe(true);
```

## Without ts-chan

Implementing fan-in amounts to implementing an async iterator (or equivalent)
that can be "sent" data, in manner that allows senders to wait for it to be
received. That is, it needs to provide back-pressure, in order to prevent
senders from overwhelming the receiver.

This can be achieved using an async generator function, an
[EventEmitter](https://nodejs.org/api/events.html#class-eventemitter)
(or equivalent implementation, such as
[mitt](https://github.com/developit/mitt)), and a mechanism to block more than
one sender at a time.

Note that the following example does not support aborting sends, has no easy
way to buffer data(*), and has questionable "close" semantics (senders will
block forever).

(*) It may not be necessary to buffer data within the fan-in itself, e.g. if
using Node.js, and passing the generator to `Readable.from`, depending on the
mechanics of closing the fan-in.

```js
const {EventEmitter} = require('node:events');

const emitter = new EventEmitter();

const generator = (async function* () {
  let ready = false;
  while (true) {
    const promise = new Promise((resolve) => {
      emitter.once('ping', data => {
        resolve(data);
      });
    });

    if (ready) {
      // Unblock the previous sender only after listening for 'ping'.
      emitter.emit('pong');
    } else {
      ready = true;
      // This yield ensures 'ping' is registered before accepting sends.
      yield undefined;
    }

    yield await promise;
  }
})();

const send = (() => {
  // Note: Waits for the generator to be ready.
  let ok = false;
  let last = generator.next().then(({done}) => {
    ok = !done;
  }).catch(() => undefined);

  return async value => {
    if (!ok) {
      await last;
      if (!ok) {
        throw new Error('unable to send');
      }
    }
    const promise = last.then(() => new Promise(resolve => {
      emitter.once('pong', resolve);
      emitter.emit('ping', value);
    }));
    last = promise.catch(() => undefined);
    return promise;
  };
})();

// Example usage:

(async () => {
  // Send values
  for (let i = 0; i < 3; i++) {
    console.log('Sending', i);
    await send(i);
  }
})();

(async () => {
  // Receive values
  for await (const value of generator) {
    console.log(`Received ${value}`);
    // simulate slow processing
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
})();
```
