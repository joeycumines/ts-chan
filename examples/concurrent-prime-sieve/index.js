// eslint-disable-next-line no-undef
const {Chan} = require('ts-chan');
// eslint-disable-next-line no-undef
const bench = require('@stdlib/bench/harness');

async function generate(abort, ch) {
  try {
    let i = 2;
    while (true) {
      await ch.send(i++, abort);
    }
  } finally {
    ch.close();
  }
}

async function filter(abort, src, dst, prime) {
  for await (const i of src) {
    if (i % prime !== 0) {
      await dst.send(i, abort);
    }
  }
}

async function sieve(n) {
  const abort = new AbortController();
  try {
    const promises = [];
    promises.push(
      (async () => {
        const primes = [];
        let ch = new Chan();

        promises.push(generate(abort.signal, ch));

        for (let i = 0; i < n; i++) {
          const prime = (await ch.recv(abort.signal)).value;
          primes.push(prime);

          const ch1 = new Chan();
          filter(abort.signal, ch, ch1, prime);
          ch = ch1;
        }

        return primes;
      })()
    );
    return await Promise.race(promises);
  } finally {
    abort.abort();
  }
}

void (async () => {
  const numPrimes = 1000;

  const startTime = Date.now();
  console.log(JSON.stringify(await sieve(numPrimes)));
  console.log(`sieve: ${Date.now() - startTime}ms`);

  bench('sieve', async b => {
    let x;
    try {
      b.tic();
      for (let i = 0; i < b.iterations; i++) {
        x = await sieve(numPrimes);
        if (x !== x) {
          b.fail('something went wrong!');
        }
      }
      b.toc();
    } catch (e) {
      b.fail(`uncaught exception: ${e}`);
    } finally {
      if (x !== x) {
        b.fail('something went wrong!');
      }
      b.end();
    }
  });
})();
