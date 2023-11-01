// eslint-disable-next-line no-undef
const {Chan} = require('ts-chan');
// eslint-disable-next-line no-undef
const {Suite} = require('benchmark');

async function generate(ch) {
  let i = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await ch.send(i++);
  }
}

async function filter(src, dst, prime) {
  // eslint-disable-next-line node/no-unsupported-features/es-syntax
  for await (const i of src) {
    if (i % prime !== 0) {
      await dst.send(i);
    }
  }
}

async function sieve(n) {
  const primes = [];
  let ch = new Chan();

  generate(ch);

  for (let i = 0; i < n; i++) {
    if (i !== 0) {
      await new Promise(resolve => setImmediate(resolve));
    }

    const prime = (await ch.recv()).value;
    primes.push(prime);

    const ch1 = new Chan();
    filter(ch, ch1, prime);
    ch = ch1;
  }
  return primes;
}

void (async () => {
  const numPrimes = 1000;

  console.log(JSON.stringify(await sieve(numPrimes)));

  const bench = new Suite();

  bench.add('sieve', async () => {
    await sieve(numPrimes);
  });

  bench.on('complete', function () {
    console.log(this[0].toString(), 'DONE');
    // eslint-disable-next-line no-process-exit
    process.exit(0);
  });

  bench.run();
})();
