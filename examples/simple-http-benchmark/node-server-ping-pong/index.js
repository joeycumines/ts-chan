// eslint-disable-next-line no-undef
const http = require('node:http');
// eslint-disable-next-line no-undef
const {Chan} = require('ts-chan');

const buffer = Buffer.alloc(1024 * 1024);
for (let i = 0; i < buffer.length; i++) {
  buffer[i] = 100;
}

const reqCh = new Chan();
const resCh = new Chan();

void (async () => {
  // eslint-disable-next-line n/no-unsupported-features/es-syntax,no-unused-vars
  for await (const req of reqCh) {
    await resCh.send(buffer);
  }
})();

http
  .createServer(async (req, res) => {
    await reqCh.send(req);
    const next = await resCh.recv();
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end(next.value);
  })
  .listen(8080);
