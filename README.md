[![NPM Package](https://img.shields.io/badge/NPM-ts--chan-brightgreen)](https://www.npmjs.com/package/ts-chan)
[![GitHub Repo](https://img.shields.io/badge/GitHub-ts--chan-blue)](https://github.com/joeycumines/ts-chan)
[![Code Style: Google](https://img.shields.io/badge/code%20style-google-blueviolet.svg)](https://github.com/google/gts)

# ts-chan

Concurrency primitives for TypeScript and JavaScript.

## Introduction

Concurrency in JavaScript, frankly, sucks.

This module is an effort to provide concurrency primitives for
TypeScript/JavaScript that capture as much of the semantics of Go's channels as
possible, while remaining idiomatic to the language.

I'll be iterating on this for a few weeks, in my spare time, with the goal of
a production-ready module, which can be used any JS environment, including
browsers.

## Architecture

### Protocol

To facilitate arbitrary implementations, this module defines a protocol for
implementation of channels, modelled as [Sender](#sender) and
[Receiver](#receiver). This protocol is styled after JavaScript's
[iteration protocols](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols),
though it differs in that the outer types, [Sendable](#sendable) and
[Receivable](#receivable) (analogues to `Iterable`), are not intended to
support statefulness independently of the channel (no `return` analogue).

This documentation is a work in progress, so, for now, it may be easiest to
peruse [src/protocol.ts](src/protocol.ts).

### Chan class

The [Chan](#chan) class is a reference implementation of the channel protocol.
It has full support for the protocol, Go-like channel close semantics, and
supports buffered channel semantics.

Unlike Go's channel, all sends and receives are processed in FIFO order,
allowing it to function as a queue, if desired.
Also provided are a number of convenience methods and properties, that are not
part of the core protocol, but are useful for common use cases.

See the [API documentation](#api) for more details.

### Select class

The absence of an analogue to Go's
[select statement](https://go.dev/ref/spec#Select_statements)
would limit the usefulness of channels, as the select statement is Go's key to
implementing "reactive" software.
The [Select](#select) class provided by this module is intended to fill that
gap, and is modelled after Go's `select` statement, particularly regarding the
semantics of receiving and sending. This class utilizes the "channel protocol"
(as defined by this module). `AbortSignal` is fully supported, and (can)
function equivalently to including a `case <-ctx.Done():`, in Go. Promises are
also supported, though they have no analogue, in Go.

#### Comparison to Go's select statement

##### Similarities

1.  **Random Selection**: Just as Go's `select` statement picks one
    communicative operation using a uniform pseudo-random selection (if more
    than one is immediately available), the `Select` class does so too.
2.  **Blocking Behavior**: In Go, if no communication can proceed and there's
    no default case, the `select` statement blocks. Similarly, the `Select`
    class's `wait` method will also block until a case is ready.
3.  **Default Case Equivalence**: The `poll` method in the `Select` class
    serves a similar purpose as the `default` case in Go's `select` statement.
    If no case is ready, `poll` will return `undefined`, offering a
    non-blocking alternative.

##### Differences

1.  **Return Value from `wait` and `poll`**: The `Select` class's `wait` method
    returns a promise that resolves with the index of the next ready case.
    The `poll` method, on the other hand, returns the index directly or
    `undefined`. In contrast, Go's `select` statement does not return values in
    this manner. This is a mechanism used to provide type support.
2.  **Operation to "receive" value**: Once a receive case is ready, in
    the `Select` class, the result must be explicitly retrieved using the `recv`
    method, which must be provided with the case which is ready. This contrasts
    with Go, where the received value is directly assigned in the case clause.
    Again, this is a part of the mechanism used to provide type support.
3.  **Limited default value support**: Nil channels have not analogue in TS/JS.
    Additionally, while receiving a "default value" (on receive from a closed
    channel) *is* a supported part of the channel protocol, it's not required,
    and has no (type-based) mechanism to describe whether the channel supports
    it, or not.

##### Different, for now

1.  **Case Evaluation Order**: It's quite possible that some or all of the case
    evaluation semantics will be adopted, as an optional feature. The current
    implementation has the [SenderCallback](#sendercallback) acting as both
    the mechanism to evaluate expressions (for each value to send), and the
    mechanism to handle the outcome of the send operation (sends may fail with
    an error, i.e. if the channel is closed). Go's behavior can be simulated
    (using the current protocol and implementations), but it requires additional
    bits.

## API

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

#### Table of Contents

*   [Chan](#chan)
    *   [Parameters](#parameters)
    *   [capacity](#capacity)
    *   [length](#length)
    *   [concurrency](#concurrency)
    *   [trySend](#trysend)
        *   [Parameters](#parameters-1)
    *   [send](#send)
        *   [Parameters](#parameters-2)
    *   [tryRecv](#tryrecv)
    *   [recv](#recv)
        *   [Parameters](#parameters-3)
    *   [close](#close)
*   [ChanIterator](#chaniterator)
    *   [Parameters](#parameters-4)
    *   [iterator](#iterator)
    *   [next](#next)
    *   [return](#return)
    *   [throw](#throw)
        *   [Parameters](#parameters-5)
*   [ChanAsyncIterator](#chanasynciterator)
    *   [Parameters](#parameters-6)
    *   [asyncIterator](#asynciterator)
    *   [next](#next-1)
    *   [return](#return-1)
    *   [throw](#throw-1)
        *   [Parameters](#parameters-7)
*   [Receiver](#receiver)
    *   [Properties](#properties)
    *   [addReceiver](#addreceiver)
    *   [removeReceiver](#removereceiver)
*   [ReceiverCallback](#receivercallback)
*   [Receivable](#receivable)
    *   [Properties](#properties-1)
*   [getReceiver](#getreceiver)
*   [Sender](#sender)
    *   [Properties](#properties-2)
    *   [addSender](#addsender)
    *   [removeSender](#removesender)
    *   [close](#close-1)
*   [SenderCallback](#sendercallback)
*   [Sendable](#sendable)
    *   [Properties](#properties-3)
*   [getSender](#getsender)
*   [SendOnClosedChannelError](#sendonclosedchannelerror)
    *   [Parameters](#parameters-8)
*   [CloseOfClosedChannelError](#closeofclosedchannelerror)
    *   [Parameters](#parameters-9)
*   [SelectCase](#selectcase)
*   [recv](#recv-1)
    *   [Parameters](#parameters-10)
*   [send](#send-1)
    *   [Parameters](#parameters-11)
*   [Select](#select)
    *   [Parameters](#parameters-12)
    *   [cases](#cases)
        *   [Examples](#examples)
    *   [poll](#poll)
    *   [wait](#wait)
        *   [Parameters](#parameters-13)
    *   [recv](#recv-2)
        *   [Parameters](#parameters-14)

### Chan

Provides a communication mechanism between two or more concurrent
operations.

In addition to various utility methods, it implements:

*   [Sendable](#sendable) and [Sender](#sender) (including [Sender.close](#senderclose)).
*   [Receivable](#receivable) and [Receiver](#receiver)
*   [Iterable](Iterable) (see also [ChanIterator](#chaniterator))
*   [AsyncIterable](AsyncIterable) (see also [ChanAsyncIterator](#chanasynciterator))

#### Parameters

*   `capacity`   (optional, default `0`)
*   `newDefaultValue` **function (): T?**&#x20;

#### capacity

Returns the maximum number of items the channel can buffer.

Type: [number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)

Returns **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)**&#x20;

#### length

Returns the number of items in the channel buffer.

Type: [number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)

Returns **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)**&#x20;

#### concurrency

Returns an integer representing the number of blocking operations.
Positive values indicate senders, while negative values indicate
receivers.

Type: [number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)

Returns **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)**&#x20;

#### trySend

Performs a synchronous send operation on the channel, returning true if
it succeeds, or false if there are no waiting receivers, and the channel
is full.

Will throw [SendOnClosedChannelError](#sendonclosedchannelerror) if the channel is closed.

##### Parameters

*   `value` **T**&#x20;

Returns **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)**&#x20;

#### send

Sends a value to the channel, returning a promise that resolves when it
has been received, and rejects on error, or on abort signal.

##### Parameters

*   `value` **T**&#x20;
*   `abort` **AbortSignal?**&#x20;

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<void>**&#x20;

#### tryRecv

Like [trySend](trySend), this performs a synchronous recv operation on the
channel, returning undefined if no value is available, or an iterator
result, which models the received value, and whether the channel is open.

Returns **(IteratorResult\<T, (T | [undefined](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/undefined))> | [undefined](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/undefined))**&#x20;

#### recv

Receives a value from the channel, returning a promise that resolves with
an iterator (the value OR indicator that the channel is closed, possibly
with a default value), or rejects on error, or on abort signal.

##### Parameters

*   `abort` **AbortSignal?**&#x20;

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<IteratorResult\<T, (T | [undefined](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/undefined))>>**&#x20;

#### close

Closes the channel, preventing further sending of values.

See also [Sender](#sender) and [Sender.close](#senderclose), which this implements.

*   Once a channel is closed, no more values can be sent to it.
*   If the channel is buffered and there are still values in the buffer when
    the channel is closed, receivers will continue to receive those values
    until the buffer is empty.
*   Attempting to send to a closed channel will result in an error and
    unblock any senders.
*   If the channel is already closed, calling `close` again will throw a
    [CloseOfClosedChannelError](#closeofclosedchannelerror).
*   This method should be used to signal the end of data transmission or
    prevent potential deadlocks.

<!---->

*   Throws **[CloseOfClosedChannelError](#closeofclosedchannelerror)** When attempting to close a channel
    that is already closed.
*   Throws **[Error](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error)** When an error occurs while closing the channel, and no
    other specific error is thrown.

Returns **void**&#x20;

### ChanIterator

Iterates on all available values. May alternate between returning done and
not done, unless [ChanIterator.return](ChanIterator.return) or [ChanIterator.throw](ChanIterator.throw)
are called.

Only the type is exported - may be initialized only performing an
iteration on a [Chan](#chan) instance, or by calling
`chan[Symbol.iterator]()`.

#### Parameters

*   `chan` **[Chan](#chan)\<T>**&#x20;

#### iterator

Returns this.

Returns **Iterator\<T>**&#x20;

#### next

Next iteration.

Returns **IteratorResult\<T>**&#x20;

#### return

Ends the iterator, which is an idempotent operation.

Returns **IteratorResult\<T>**&#x20;

#### throw

Ends the iterator with an error, which is an idempotent operation.

##### Parameters

*   `e` **any?**&#x20;

Returns **IteratorResult\<T>**&#x20;

### ChanAsyncIterator

Iterates by receiving values from the channel, until it is closed, or the
[ChanAsyncIterator.return](ChanAsyncIterator.return) or [ChanAsyncIterator.throw](ChanAsyncIterator.throw) methods
are called.

Only the type is exported - may be initialized only performing an async
iteration on a [Chan](#chan) instance, or by calling
`chan[Symbol.asyncIterator]()`.

#### Parameters

*   `chan` **[Chan](#chan)\<T>**&#x20;

#### asyncIterator

Returns this.

Returns **AsyncIterator\<T>**&#x20;

#### next

Next iteration.

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<IteratorResult\<T>>**&#x20;

#### return

Ends the iterator, which is an idempotent operation.

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<IteratorResult\<T>>**&#x20;

#### throw

Ends the iterator with an error, which is an idempotent operation.

##### Parameters

*   `e` **any?**&#x20;

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<IteratorResult\<T>>**&#x20;

### Receiver

Receiver allows callers to receive values.
It uses a one-off callback that models what is going to receive the value.

Unlike [Iterator](Iterator), it is not intended to support statefulness - a
[Receivable](#receivable) should return equivalent (but not necessarily identical)
[Receiver](#receiver) instances on each call to [getReceiver](#getreceiver).

Type: {addReceiver: function (callback: [ReceiverCallback](#receivercallback)\<T>): [boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean), removeReceiver: function (callback: [ReceiverCallback](#receivercallback)\<T>): void}

#### Properties

*   `addReceiver` **function (callback: [ReceiverCallback](#receivercallback)\<T>): [boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)**&#x20;
*   `removeReceiver` **function (callback: [ReceiverCallback](#receivercallback)\<T>): void**&#x20;

#### addReceiver

Add a receiver callback to a list of receivers, or call it immediately if
there is an available sender.
Returns true if the receiver was called added to the receiver list.
Returns false if the receiver was called immediately.

Type: function (callback: [ReceiverCallback](#receivercallback)\<T>): [boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)

#### removeReceiver

Immediately removes the receiver from the receiver list, if it is there.

Type: function (callback: [ReceiverCallback](#receivercallback)\<T>): void

### ReceiverCallback

ReceiverCallback is a callback that receives a value from a sender and true,
or a default value (or undefined if unsupported), and false, if the channel
is closed.

Type: function (...(\[T, `true`] | \[(T | [undefined](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/undefined)), `false`])): void

### Receivable

Receivable is a value that can be converted to a [Receiver](#receiver).

Type: {getReceiver: function (): [Receiver](#receiver)\<T>}

#### Properties

*   `getReceiver` **function (): [Receiver](#receiver)\<T>**&#x20;

### getReceiver

See [Receivable](#receivable).

### Sender

Sender allows callers to send values.
It uses a one-off callback that models what is going to send the value.

Unlike [Iterator](Iterator), it is not intended to support statefulness - a
[Sendable](#sendable) should return equivalent (but not necessarily identical)
[Sender](#sender) instances on each call to [getSender](#getsender).

See also [SendOnClosedChannelError](#sendonclosedchannelerror), which SHOULD be raised on
[addSender](addSender) (if closed on add) or passed into send callbacks
(otherwise), when attempting to send on a closed channel.

Type: {addSender: function (callback: [SenderCallback](#sendercallback)\<T>): [boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean), removeSender: function (callback: [SenderCallback](#sendercallback)\<T>): void, close: function (): void?}

#### Properties

*   `addSender` **function (callback: [SenderCallback](#sendercallback)\<T>): [boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)**&#x20;
*   `removeSender` **function (callback: [SenderCallback](#sendercallback)\<T>): void**&#x20;
*   `close` **function (): void?**&#x20;

#### addSender

Add a sender callback to a list of senders, or call it immediately if
there is an available receiver.
Returns true if the sender was added to the sender list.
Returns false if the sender was called immediately.
If the channel is closed, SHOULD throw [SendOnClosedChannelError](#sendonclosedchannelerror).
If the channel is closed while the sender is waiting to be called, the
sender SHOULD be called with [SendOnClosedChannelError](#sendonclosedchannelerror).

Type: function (callback: [SenderCallback](#sendercallback)\<T>): [boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)

#### removeSender

Immediately removes the sender from the sender list, if it is there.

Type: function (callback: [SenderCallback](#sendercallback)\<T>): void

#### close

Closes the channel, adhering to the following semantics similar to Go's
channels:

*   Once a channel is closed, no more values can be sent to it.
*   If a channel is buffered, and there are still values in the buffer when
    the channel is closed, the receivers will continue to receive those
    values until the buffer is empty.
*   It's the responsibility of the sender to close the channel, signaling to
    the receiver that no more data will be sent.
*   Attempting to send to a closed channel MUST result in an error, and
    MUST un-block any such senders as part of said close.
*   The error thrown when attempting to send on a closed channel SHOULD be
    [SendOnClosedChannelError](#sendonclosedchannelerror), but MAY be another error.
*   Unless explicitly documented as idempotent, `close` SHOULD throw
    [CloseOfClosedChannelError](#closeofclosedchannelerror) on subsequent calls, but MAY throw
    other errors.
*   Channels should be closed to prevent potential deadlocks or to signal
    the end of data transmission. This ensures that receivers waiting on the
    channel don't do so indefinitely.

Note: This method is optional. Some [Sendable](#sendable) implementations may
specify their own rules and semantics for closing channels. Always refer
to the specific implementation's documentation to ensure correct usage and
to prevent potential memory leaks or unexpected behaviors.

See also [SendOnClosedChannelError](#sendonclosedchannelerror) and
[CloseOfClosedChannelError](#closeofclosedchannelerror).

Type: function (): void

### SenderCallback

SenderCallback is called as a value is received, or when an error or some
other event occurs, which prevents the value from being received.
It accepts two parameters, an error (if any), and the boolean `ok`,
indicating if the value has been (will be, after return) received.
It MUST return the value (or throw) if `ok` is true, and SHOULD throw
`err` if `ok` is false.

The `ok` parameter being true guarantees that a value (once returned) has
been received, though does not guarantee that anything will be done with it.

If the `ok` parameter is false, the first parameter will contain any error,
and no value (regardless of what is returned) will be received.

Note: The sender callback is *not* called on `removeSender`.

WARNING: If the same value (===) as err (when ok is false) is thrown, that
thrown error will not be bubbled - a mechanism used to avoid breaking the
typing of the return value.

Type: function (...(\[[undefined](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/undefined), `true`] | \[any, `false`])): T

### Sendable

Sendable is a value that can be converted to a [Sender](#sender).

Type: {getSender: function (): [Sender](#sender)\<T>}

#### Properties

*   `getSender` **function (): [Sender](#sender)\<T>**&#x20;

### getSender

See [Sendable](#sendable).

### SendOnClosedChannelError

**Extends Error**

Provided as a convenience, that SHOULD be used by [Sender](#sender)
implementations, to indicate that a channel is closed.
Should be raised as a result of send attempts on a closed channel, where
the send operation is not allowed to proceed.

#### Parameters

*   `args` **...ConstructorParameters\<any>**&#x20;

### CloseOfClosedChannelError

**Extends Error**

Provided as a convenience, that SHOULD be used by [Sender](#sender)
implementations, in the event that a channel close is attempted more than
once.

#### Parameters

*   `args` **...ConstructorParameters\<any>**&#x20;

### SelectCase

SelectCase models the state of a single case in a [Select](#select).

WARNING: The selectState symbol is deliberately not exported, as the
value of `SelectCase[selectState]` is not part of the API contract, and
is simply a mechanism to support typing.

Type: (SelectCaseSender\<T> | SelectCaseReceiver\<T> | SelectCasePromise\<T>)

### recv

Prepares a [SelectCaseReceiver](SelectCaseReceiver) case, to be used in a [Select](#select).

WARNING: Cases may only be used in a single select instance, though select
instances are intended to be reused, e.g. when implementing control loops.

#### Parameters

*   `from` **([Receivable](#receivable)\<T> | [Receiver](#receiver)\<T>)**&#x20;

Returns **SelectCaseReceiver\<T>**&#x20;

### send

Prepares a [SelectCaseSender](SelectCaseSender) case, to be used in a [Select](#select).

WARNING: Cases may only be used in a single select instance, though select
instances are intended to be reused, e.g. when implementing control loops.

#### Parameters

*   `to` **([Sendable](#sendable)\<T> | [Sender](#sender)\<T>)**&#x20;
*   `scb` **[SenderCallback](#sendercallback)\<T>**&#x20;

Returns **SelectCaseSender\<T>**&#x20;

### Select

Select implements the functionality of Go's select statement, with support
for support cases comprised of [Sender](#sender), [Receiver](#receiver), or values
(resolved as promises), which are treated as a single-value never-closed
channel.

#### Parameters

*   `cases` **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)<([SelectCase](#selectcase) | [Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise) | any)>** The cases to select from, which
    must be initialized using [.send](.send), [.recv](.recv), unless they are
    to be treated as a promise.

#### cases

Retrieves the cases associated with this select instance.

Each case corresponds to an input case (including order).
After selecting a case, via [poll](poll) or [wait](wait), received values
may be retrieved by calling [recv](#recv) with the corresponding case.

Type: SelectCases\<T>

##### Examples

Accessing a (typed) received value:
```ts
import {recv} from 'ts-chan';

const ch1 = new Chan<number>();
const ch2 = new Chan<string>();

void sendsToCh1ThenEventuallyClosesIt();
void sendsToCh2();

const select = new Select([recv(ch1), recv(ch2)]);
for (let running = true; running;) {
  const i = await select.wait();
  switch (i) {
  case 0: {
    const v = select.recv(select.cases[i]);
    if (v.done) {
      running = false;
      break;
    }
    console.log(`rounded value: ${Math.round(v.value)}`);
    break;
  }
  case 1: {
    const v = select.recv(select.cases[i]);
    if (v.done) {
      throw new Error('ch2 unexpectedly closed');
    }
    console.log(`uppercase string value: ${v.value.toUpperCase()}`);
    break;
  }
  default:
    throw new Error('unreachable');
  }
}
```

Returns **SelectCases\<T>**&#x20;

#### poll

Poll returns the next case that is ready, or undefined if none are
ready. It must not be called concurrently with [wait](wait) or
[recv](#recv).

This is effectively a non-blocking version of [wait](wait), and fills the
same role as the `default` select case, in Go's select statement.

Returns **([number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number) | [undefined](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/undefined))**&#x20;

#### wait

Wait returns a promise that will resolve with the index of the next case
that is ready, or reject with the first error.

##### Parameters

*   `abort` **AbortSignal?**&#x20;

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)<[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)>**&#x20;

#### recv

Consume the result of a ready case.

##### Parameters

*   `v` **[SelectCase](#selectcase)\<T>**&#x20;

Returns **IteratorResult\<T, (T | [undefined](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/undefined))>**&#x20;
