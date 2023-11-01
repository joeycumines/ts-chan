// eslint-disable-next-line no-undef
const http = require('node:http');

const buffer = Buffer.alloc(1024 * 1024);
for (let i = 0; i < buffer.length; i++) {
  buffer[i] = 100;
}

http
  .createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end(buffer);
  })
  .listen(8080);
