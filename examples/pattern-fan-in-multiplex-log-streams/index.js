const net = require('node:net');
const fs = require('node:fs');
const {parseArgs} = require('node:util');
const {setMaxListeners, EventEmitter} = require('node:events');
const {pipeline, Readable} = require('node:stream');
const {Chan} = require('ts-chan');

const args = parseArgs({
  allowPositionals: false,
  options: {
    // output file
    output: {
      type: 'string',
      short: 'o',
    }, // format like "address:port"
    // e.g. ":::8125"
    // or "127.0.0.1:8125"
    listen: {
      type: 'string',
      short: 'l',
    }, // enable ts-chan
    'ts-chan': {
      type: 'boolean',
      short: 'c',
    },
  },
});
if (!args.values.output || !args.values.listen) {
  console.error('Usage: node ts-chan.js -l <listen> -o <output>');
  process.exit(1);
}

const lastIndexColon = args.values.listen.lastIndexOf(':');
if (lastIndexColon === -1) {
  console.error('invalid listen:', args.values.listen);
  process.exit(1);
}
const address = args.values.listen.slice(0, lastIndexColon);
if (!net.isIP(address)) {
  console.error('invalid address:', address);
  process.exit(1);
}
const portStr = args.values.listen.slice(lastIndexColon + 1);
const port = Number.parseInt(portStr, 10);
if (
  !Number.isSafeInteger(port) ||
  port < 0 ||
  port > 65535 ||
  `${port}` !== portStr
) {
  console.error('invalid port:', portStr);
  process.exit(1);
}
const useTsChan = Boolean(args.values['ts-chan']);

// note: only used for non-ts-chan
const messageEmitter = new EventEmitter();
messageEmitter.setMaxListeners(2000);

// note: only used for ts-chan
const chan = new Chan().setUnsafe(true);
const stopSentinel = Symbol('stopSentinel');
const catchSentinel = name => err => {
  if (err !== stopSentinel) {
    console.error(`${name} error:`, err);
    process.exit(1);
  }
};

// aborted on INT and TERM
const abort = new AbortController();
setMaxListeners(2000, abort.signal);
abort.signal.addEventListener('abort', () => {
  queueMicrotask(() => {
    chan.close();
  });
});

['SIGINT', 'SIGTERM'].forEach(signal =>
  process.on(signal, () => {
    abort.abort(stopSentinel);
  })
);

// output file, async file stream
const out = fs.createWriteStream(args.values.output, {flags: 'a'});
out.on('error', err => {
  console.error('out error:', err);
  process.exit(1);
});

// data source switched between ts-chan and vanilla JS
const readable = Readable.from(
  useTsChan
    ? chan
    : (async function* () {
        while (!abort.signal.aborted) {
          try {
            yield await new Promise((resolve, reject) => {
              messageEmitter.once('message', data => {
                abort.signal.removeEventListener('abort', reject);
                resolve(data);
              });
              messageEmitter.emit('result');
              abort.signal.addEventListener('abort', reject);
            });
          } catch (error) {
            if (abort.signal.aborted) {
              break;
            }
            throw error;
          }
        }
      })(),
  {
    highWaterMark: 1,
  }
);

// Pipe the multiplexed readable stream to the output file stream
pipeline(readable, out, err => {
  if (err) {
    console.error('Pipeline failed.', err);
    process.exit(1);
  }
  process.exit(0);
});

const newRunExclusive = () => {
  let runExclusivePromise = Promise.resolve();
  const runExclusive = fn => {
    const promise = runExclusivePromise.then(fn);
    runExclusivePromise = promise.catch(() => undefined);
    return promise;
  };
  return runExclusive;
};

const runExclusiveWrite = newRunExclusive();
const runExclusiveServer = newRunExclusive();

let streamIndex = 0;
let streamsDone = 0;

const writeToStream = useTsChan
  ? data =>
      new Promise((resolve, reject) => {
        // note: this is slightly faster than using chan.send, but chan.send would have been fine too
        chan.addSender((err, ok) => {
          if (err) {
            reject(err);
          } else {
            resolve();
            return data;
          }
        });
      })
  : data =>
      runExclusiveWrite(
        () =>
          new Promise(resolve => {
            messageEmitter.once('result', resolve);
            messageEmitter.emit('message', data);
          })
      );

const server = net
  .createServer(stream => {
    stream.setEncoding('ascii');

    const info = {
      index: streamIndex++,
      address: stream.remoteAddress,
      port: stream.remotePort,
      family: stream.address() ? stream.address().family : 'IPv4',
    };

    let lines = 0;

    void writeToStream(
      `${JSON.stringify({
        time: new Date().toISOString(),
        ...info,
        event: 'connected',
      })}\n`,
      abort.signal
    ).catch(catchSentinel('send connected'));

    const runExclusiveStream = newRunExclusive();

    let buffer = '';
    stream.on('data', async data => {
      const now = new Date();
      stream.pause();
      try {
        await runExclusiveStream(async () => {
          // console.log(
          //   `stream ${info.index} received ${
          //     data.length
          //   } bytes: ${JSON.stringify(
          //     data.length > 100 ? data.slice(0, 100) + '...' : data
          //   )}`
          // );
          buffer += data;
          let lastOffset = -1;
          for (
            let offset = buffer.indexOf('\n');
            offset > -1;
            offset = buffer.indexOf('\n', lastOffset + 1)
          ) {
            lines++;
            // note: doesn't include the newline
            const line = buffer.slice(
              lastOffset > -1 ? lastOffset + 1 : 0,
              offset
            );
            lastOffset = offset;
            await writeToStream(
              `${JSON.stringify({
                time: now.toISOString(),
                ...info,
                event: 'data',
                data: line,
              })}\n`,
              abort.signal
            );
          }
          if (lastOffset > -1) {
            buffer = buffer.slice(lastOffset + 1);
          }
        });
      } catch (e) {
        if (e !== stopSentinel) {
          console.error('data error:', e);
          process.exit(1);
        }
      } finally {
        stream.resume();
      }
    });

    stream.on('close', () => {
      void runExclusiveStream(async () => {
        await runExclusiveServer(async () => {
          streamsDone++;
          await writeToStream(
            `${JSON.stringify({
              time: new Date().toISOString(),
              ...info,
              event: 'disconnected',
            })}\n`,
            abort.signal
          ).catch(catchSentinel('send disconnected'));
          // console.warn(`stream ${info.index} disconnected after ${lines} lines\n`);
          if (streamsDone === streamIndex) {
            abort.abort(stopSentinel);
          }
        });
      });
    });

    // just ignores errors (as you might see on a disconnect, if the client just goes away)
    stream.on('error', () => {});
  })
  .on('error', err => {
    console.error('server error:', err);
    process.exit(1);
  });

server.listen(port, address);
