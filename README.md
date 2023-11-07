# ts-chan

[![NPM Package](https://img.shields.io/badge/NPM-ts--chan-brightgreen)](https://www.npmjs.com/package/ts-chan)
[![GitHub Repo](https://img.shields.io/badge/GitHub-ts--chan-blue)](https://github.com/joeycumines/ts-chan)
[![Code Style: Google](https://img.shields.io/badge/code%20style-google-blueviolet.svg)](https://github.com/google/gts)

Concurrency primitives for TypeScript and JavaScript.

## Introduction

Concurrency in JavaScript, frankly, sucks.

This module is an effort to provide concurrency primitives for
TypeScript/JavaScript that capture as much of the semantics of Go's channels as
possible, while remaining idiomatic to the language.

I'll be iterating on this for a few weeks, in my spare time, with the goal of
a production-ready module, which can be used any JS environment, including
browsers.

## Usage

### Installation

Install or import the NPM package `ts-chan`.
Supported platforms include Node.js, Deno, and browsers.

### The microtask queue: a footgun

This module takes steps to mitigate the risk of microtask cycles. They remain,
however, a real concern for any JavaScript program, that involves communication
between concurrent operations. Somewhat more insidious than plain call cycles,
as they are not visible in the call stack, it's important to know that promises
and async/await operate on the microtask queue, unless they wait on something
that operates on the macrotask queue (e.g. IO, timers).

While `queueMicrotask` is not used by this module, MDN's
[Using microtasks in JavaScript with queueMicrotask()](https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide)
guide is both informative and relevant.

The mitigation strategy used by this module is for high-level async methods
(including [Chan.send](#send), [Chan.recv](#recv), and [Select.wait](#wait))
to use [getYieldGeneration](#getyieldgeneration) and
[yieldToMacrotaskQueue](#yieldtomacrotaskqueue) like:

```ts
const exampleHighLevelAsyncMethod = async () => {
  // ...
  const yieldGeneration = getYieldGeneration();
  const yieldPromise = yieldToMacrotaskQueue();
  try {
    // ...
    return await result;
  } finally {
    if (getYieldGeneration() === yieldGeneration) {
      await yieldPromise;
    }
  }
};
```

The above is a simple (albeit unoptimised) pattern which ensures that, so long
as one side calls one of these methods, the event loop will not block.
This solution does have
[some performance impact](https://github.com/joeycumines/ts-chan/compare/66f30b78445636770d494629dbfb7c7a54132599...b03ab84947900f2b1a66f7802ec2ac56e26e1145),
and does not completely mitigate the risk, but seems a reasonable compromise.

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
4.  **Case Evaluation Order**: (Optional, see below) The
    [SelectFactory](#selectfactory) class may be used to evaluate senders,
    receivers, and values (to send), in source order, and is intended to be
    used within loops and similar. Use of this class may avoid unnecessary
    recreation of select cases, on each iteration, with the caveat that it
    does not (currently) support promises.

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
4.  **Case Evaluation Order**: This is an interesting topic, and I found that
    Go's behavior was not exactly what I expected. For simplicity, this
    functionality was omitted from `Select`, and is provided by
    `SelectFactory`, instead. For reference, from
    the [Go spec](https://go.dev/ref/spec#Select_statements):
    > For all the cases in the statement, the channel operands of receive
    > operations and the channel and right-hand-side expressions of send
    > statements are evaluated exactly once, in source order, upon entering the
    > "select" statement. The result is a set of channels to receive from or
    > send to, and the corresponding values to send. Any side effects in that
    > evaluation will occur irrespective of which (if any) communication
    > operation is selected to proceed. Expressions on the left-hand side of a
    > RecvStmt with a short variable declaration or assignment are not yet
    > evaluated.

## API

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

#### Table of Contents

*   [Chan](#chan)
    *   [Parameters](#parameters)
    *   [unsafe](#unsafe)
    *   [capacity](#capacity)
    *   [length](#length)
    *   [concurrency](#concurrency)
    *   [setUnsafe](#setunsafe)
        *   [Parameters](#parameters-1)
    *   [trySend](#trysend)
        *   [Parameters](#parameters-2)
    *   [send](#send)
        *   [Parameters](#parameters-3)
    *   [tryRecv](#tryrecv)
    *   [recv](#recv)
        *   [Parameters](#parameters-4)
    *   [close](#close)
*   [ChanIterator](#chaniterator)
    *   [Parameters](#parameters-5)
    *   [iterator](#iterator)
    *   [next](#next)
    *   [return](#return)
    *   [throw](#throw)
        *   [Parameters](#parameters-6)
*   [ChanAsyncIterator](#chanasynciterator)
    *   [Parameters](#parameters-7)
    *   [asyncIterator](#asynciterator)
    *   [next](#next-1)
    *   [return](#return-1)
    *   [throw](#throw-1)
        *   [Parameters](#parameters-8)
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
    *   [Parameters](#parameters-9)
*   [CloseOfClosedChannelError](#closeofclosedchannelerror)
    *   [Parameters](#parameters-10)
*   [SelectCase](#selectcase)
*   [SelectCaseSender](#selectcasesender)
    *   [Properties](#properties-4)
    *   [type](#type)
*   [SelectCaseReceiver](#selectcasereceiver)
    *   [Properties](#properties-5)
    *   [type](#type-1)
*   [SelectCasePromise](#selectcasepromise)
    *   [Properties](#properties-6)
    *   [type](#type-2)
*   [recv](#recv-1)
    *   [Parameters](#parameters-11)
*   [send](#send-1)
    *   [Parameters](#parameters-12)
*   [wait](#wait)
    *   [Parameters](#parameters-13)
*   [Select](#select)
    *   [Parameters](#parameters-14)
    *   [unsafe](#unsafe-1)
    *   [cases](#cases)
        *   [Examples](#examples)
    *   [length](#length-1)
    *   [pending](#pending)
    *   [setUnsafe](#setunsafe-1)
        *   [Parameters](#parameters-15)
    *   [poll](#poll)
    *   [wait](#wait-1)
        *   [Parameters](#parameters-16)
    *   [recv](#recv-2)
        *   [Parameters](#parameters-17)
    *   [promises](#promises)
        *   [Parameters](#parameters-18)
*   [SelectFactory](#selectfactory)
    *   [clear](#clear)
    *   [with](#with)
        *   [Parameters](#parameters-19)
*   [getYieldGeneration](#getyieldgeneration)
*   [yieldToMacrotaskQueue](#yieldtomacrotaskqueue)

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

#### unsafe

If set to true, the channel will skip the microtask cycle mitigation
mechanism, described by
[The microtask queue: a footgun](#the-microtask-queue-a-footgun), in the
project README.

Defaults to false.

See also [.setUnsafe](.setUnsafe).

Type: [boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)

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

#### setUnsafe

Sets the [.unsafe](.unsafe) property, and returns this.

##### Parameters

*   `unsafe` **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)**&#x20;

Returns **this**&#x20;

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

The [addReceiver](addReceiver) and [removeReceiver](removeReceiver) methods are low-level
constructs, and, in most scenarios, should not be called directly.
When using these methods, consider the impact of cycles, particularly
microtask cycles, and ways to mitigate them. See also
[getYieldGeneration](#getyieldgeneration) and [yieldToMacrotaskQueue](#yieldtomacrotaskqueue).

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

To facilitate "attempting synchronous receive", this method MUST only
remove the *last* matching occurrence of the callback, if it exists.

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

The [addSender](addSender) and [removeSender](removeSender) methods are low-level
constructs, and, in most scenarios, should not be called directly.
When using these methods, consider the impact of cycles, particularly
microtask cycles, and ways to mitigate them. See also
[getYieldGeneration](#getyieldgeneration) and [yieldToMacrotaskQueue](#yieldtomacrotaskqueue).

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

To facilitate "attempting synchronous send", this method MUST only
remove the *last* matching occurrence of the callback, if it exists.

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

Type: ([SelectCaseSender](#selectcasesender)\<T> | [SelectCaseReceiver](#selectcasereceiver)\<T> | [SelectCasePromise](#selectcasepromise)\<T>)

### SelectCaseSender

Sender select case.
See also [.send](.send).

Type: {type: `"Sender"`, selectState: CaseStateSender\<T>}

#### Properties

*   `type` **`"Sender"`**&#x20;
*   `selectState` **CaseStateSender\<T>**&#x20;

#### type

Type is provided to support type guards, and reflection-style logic.

Type: `"Sender"`

### SelectCaseReceiver

Receiver select case.
See also [.recv](.recv).

Type: {type: `"Receiver"`, selectState: CaseStateReceiver\<T>}

#### Properties

*   `type` **`"Receiver"`**&#x20;
*   `selectState` **CaseStateReceiver\<T>**&#x20;

#### type

Type is provided to support type guards, and reflection-style logic.

Type: `"Receiver"`

### SelectCasePromise

Promise (or PromiseLike) select case.
See also [.wait](.wait).

Type: {type: `"Promise"`, selectState: CaseStatePromise\<T>}

#### Properties

*   `type` **`"Promise"`**&#x20;
*   `selectState` **CaseStatePromise\<T>**&#x20;

#### type

Type is provided to support type guards, and reflection-style logic.

Type: `"Promise"`

### recv

Prepares a [SelectCaseReceiver](#selectcasereceiver) case, to be used in a [Select](#select).

WARNING: Cases may only be used in a single select instance, though select
instances are intended to be reused, e.g. when implementing control loops.

#### Parameters

*   `from` **([Receivable](#receivable)\<T> | [Receiver](#receiver)\<T>)**&#x20;

Returns **[SelectCaseReceiver](#selectcasereceiver)\<T>**&#x20;

### send

Prepares a [SelectCaseSender](#selectcasesender) case, to be used in a [Select](#select).

WARNING: Cases may only be used in a single select instance, though select
instances are intended to be reused, e.g. when implementing control loops.

#### Parameters

*   `to` **([Sendable](#sendable)\<T> | [Sender](#sender)\<T>)** Target Sendable or Sender.
*   `expr` **function (): T** Expression to evaluate when sending. WARNING: Unlike Go, this
    is only evaluated when the case is selected, and only for the selected
    case. See the project README for more details.

Returns **[SelectCaseSender](#selectcasesender)\<T>**&#x20;

### wait

Prepares a [SelectCasePromise](#selectcasepromise) case, to be used in a [Select](#select).

WARNING: Cases may only be used in a single select instance, though select
instances are intended to be reused, e.g. when implementing control loops.

#### Parameters

*   `value` **(PromiseLike\<T> | T)**&#x20;

Returns **[SelectCasePromise](#selectcasepromise)\<Awaited\<T>>**&#x20;

### Select

Select implements the functionality of Go's select statement, with support
for support cases comprised of [Sender](#sender), [Receiver](#receiver), or
[PromiseLike](PromiseLike), which are treated as a single-value never-closed
channel.

See also [promises](promises), which is a convenience method for creating a
select instance with promise cases, or a mix of both promises and other
cases.

#### Parameters

*   `cases` **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)<([SelectCase](#selectcase) | [Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise) | any)>** The cases to select from, which
    must be initialized using [.send](.send), [.recv](.recv), unless they are
    to be treated as a promise.

#### unsafe

If set to true, the select will skip the microtask cycle mitigation
mechanism, described by
[The microtask queue: a footgun](#the-microtask-queue-a-footgun), in the
project README.

Defaults to false.

See also [.setUnsafe](.setUnsafe).

Type: [boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)

#### cases

Retrieves the cases associated with this select instance.

Each case corresponds to an input case (including order).
After selecting a case, via [Select.poll](Select.poll) or [Select.wait](Select.wait),
received values may be retrieved by calling [Select.recv](Select.recv) with the
corresponding case.

Type: any

##### Examples

Accessing a (typed) received value:
```ts
import {recv, Chan, Select} from 'ts-chan';

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

Returns **any** T

#### length

Retrieves the number of the cases that are currently pending.

Will return the length of [cases](cases), less the number of *promise*
cases that have been resolved and received (or ignored).

Type: [number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)

Returns **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)**&#x20;

#### pending

Returns all the original values of all pending promise cases (cases that
haven't been consumed or ignored), in case order.

Type: [Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)\<any>

Returns **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)\<any>**&#x20;

#### setUnsafe

Sets the [.unsafe](.unsafe) property, and returns this.

##### Parameters

*   `unsafe` **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)**&#x20;

Returns **this**&#x20;

#### poll

Poll returns the next case that is ready, or undefined if none are
ready. It must not be called concurrently with [Select.wait](Select.wait) or
[Select.recv](Select.recv).

This is effectively a non-blocking version of [Select.wait](Select.wait), and
fills the same role as the `default` select case, in Go's select
statement.

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

#### promises

Promises is a convenience method for creating a select instance with
promise cases, or a mix of both promises and other cases.

Note that the behavior is identical to passing the same array to the
constructor. The constructor's typing is more strict, to simplify
implementations which encapsulate or construct select instances.

##### Parameters

*   `cases` **T**&#x20;

Returns **[Select](#select)\<any>**&#x20;

### SelectFactory

A wrapper of [Select](#select) that's intended for use within loops, that
allows the contents of select cases (but not the structure, namely the
direction/type of communication) to be updated, and evaluated as
expressions, in code order.

With the caveat that it does not support promises, this is the closest
analogue to Go's select statement, provided by this module.

#### clear

Clears references to values to send, receives and senders, but not the
select cases themselves. Use cases include avoiding retaining references
between iterations of a loop, if such references are not needed, or may
be problematic.

WARNING: Must not be called concurrently with [Select.wait](Select.wait) (on the
underlying instance for this factory). Calling this method then calling
either [Select.wait](Select.wait) or [Select.poll](Select.poll) (prior to another
[with](with)) may result in an error.

#### with

With should be to configure and retrieve (or initialize) the underlying
[Select](#select) instance.

Must be called with the same number of cases each time, with each case
having the same direction.

##### Parameters

*   `cases` **T**&#x20;

Returns **[Select](#select)\<any>**&#x20;

### getYieldGeneration

Returns the current yield generation. This value is incremented on each
[yieldToMacrotaskQueue](#yieldtomacrotaskqueue), which is a self-conflating operation.

See [The microtask queue: a footgun](#the-microtask-queue-a-footgun), in the
project README, for details on the purpose of this mechanism.

Returns **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)**&#x20;

### yieldToMacrotaskQueue

Returns a promise which will resolve on the next iteration of the event
loop. Intended to be used in concert with [getYieldGeneration](#getyieldgeneration), this
mechanism allows implementers to reduce the risk of the "footgun" that the
microtask queue represents.

Calls to this function are self-conflating, meaning that if this function is
called multiple times before the next iteration of the event loop, the same
promise will be returned.

See [The microtask queue: a footgun](#the-microtask-queue-a-footgun), in the
project README, for details on the purpose of this mechanism.

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)<[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)>**&#x20;
