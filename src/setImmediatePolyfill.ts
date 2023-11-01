/*
Copyright (c) 2012 Barnesandnoble.com, llc, Donavon West, and Domenic Denicola

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

// based on https://github.com/YuzuJS/setImmediate/tree/f1ccbfdf09cb93aadf77c4aa749ea554503b9234

export type SetImmediate = (fn: () => void) => void;

export const polyfillSetImmediate = (global: any): SetImmediate | undefined => {
  if (typeof global !== 'object' || global === null) {
    return;
  }

  if (global.setImmediate) {
    return global.setImmediate;
  }

  let nextHandle = 1; // Spec says greater than zero
  const tasksByHandle: {[key: number]: {callback: Function; args: any[]}} = {};
  let currentlyRunningATask = false;
  let registerImmediate: (handle: number) => void;

  function setImmediate(callback: any): number {
    if (typeof callback !== 'function') {
      callback = new Function('' + callback);
    }
    // eslint-disable-next-line prefer-rest-params
    const args = Array.prototype.slice.call(arguments, 1) as any[];
    const task = {callback: callback, args: args};
    tasksByHandle[nextHandle] = task;
    registerImmediate(nextHandle);
    return nextHandle++;
  }

  function clearImmediate(handle: number): void {
    delete tasksByHandle[handle];
  }

  function run(task: {callback: Function; args: any[]}): void {
    const callback = task.callback;
    const args = task.args;
    switch (args.length) {
      case 0:
        callback();
        break;
      case 1:
        callback(args[0]);
        break;
      case 2:
        callback(args[0], args[1]);
        break;
      case 3:
        callback(args[0], args[1], args[2]);
        break;
      default:
        // eslint-disable-next-line prefer-spread
        callback.apply(undefined, args);
        break;
    }
  }

  function runIfPresent(handle: number): void {
    if (currentlyRunningATask) {
      setTimeout(runIfPresent, 0, handle);
    } else {
      const task = tasksByHandle[handle];
      if (task) {
        currentlyRunningATask = true;
        try {
          run(task);
        } finally {
          clearImmediate(handle);
          currentlyRunningATask = false;
        }
      }
    }
  }

  function canUsePostMessage(): boolean {
    if (global.postMessage && !global.importScripts) {
      let postMessageIsAsynchronous = true;
      const oldOnMessage = global.onmessage;
      global.onmessage = function () {
        postMessageIsAsynchronous = false;
      };
      global.postMessage('', '*');
      global.onmessage = oldOnMessage;
      return postMessageIsAsynchronous;
    }
    return false;
  }

  function installPostMessageImplementation(): void {
    const messagePrefix = 'ts-chan.setImmediate$' + Math.random() + '$';
    const onGlobalMessage = (event: any) => {
      if (
        event.source === global &&
        typeof event.data === 'string' &&
        event.data.indexOf(messagePrefix) === 0
      ) {
        runIfPresent(+event.data.slice(messagePrefix.length));
      }
    };

    if (global.addEventListener) {
      global.addEventListener('message', onGlobalMessage, false);
    } else {
      global.attachEvent('onmessage', onGlobalMessage);
    }

    registerImmediate = function (handle) {
      global.postMessage(messagePrefix + handle, '*');
    };
  }

  function installMessageChannelImplementation(): void {
    const channel = new global.MessageChannel();
    channel.port1.onmessage = (event: any) => {
      const handle = event.data;
      runIfPresent(handle);
    };
    registerImmediate = function (handle) {
      channel.port2.postMessage(handle);
    };
  }

  function installSetTimeoutImplementation(): void {
    registerImmediate = function (handle) {
      setTimeout(runIfPresent, 0, handle);
    };
  }

  if (canUsePostMessage()) {
    installPostMessageImplementation();
  } else if (global.MessageChannel) {
    installMessageChannelImplementation();
  } else {
    installSetTimeoutImplementation();
  }

  return setImmediate;
};

export const setImmediatePolyfill: SetImmediate =
  typeof setImmediate === 'function'
    ? setImmediate
    : polyfillSetImmediate(
        // @ts-ignore
        // eslint-disable-next-line no-undef
        typeof self === 'undefined'
          ? typeof global === 'undefined'
            ? this
            : global
          : // @ts-ignore
            // eslint-disable-next-line no-undef
            self
      ) ?? (fn => setTimeout(fn, 0));
