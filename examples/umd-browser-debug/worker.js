/* eslint-disable */

importScripts('../../build/ts-chan.umd.js');

self.onmessage = async function (e) {
  if (e.data.command === 'start') {
    try {
      await self.tsChan.yieldToMacrotaskQueue();
      postMessage({status: 'success'});
    } catch (error) {
      postMessage({status: 'error', message: error.message});
    }
  }
};

self.onerror = function (e) {
  postMessage({
    status: 'uncaughtError',
    message: `Error in Worker: ${e.message || 'Unknown error'} at ${
      e.filename
    }:${e.lineno}:${e.colno}`,
  });
  return true;
};
