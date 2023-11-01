# Simple HTTP Benchmark

Using Apache Benchmark, and GNU Time. Not very scientific, quite contrived, and
these are both garbage collected languages, so it's not an indicative test.
It is interesting, however.

The actual tests involve HTTP servers that respond with a fixed payload, with
the baselines writing the response directly, and the ping-pong server handlers
sending the request to a worker, which replies with the payload, which the
server handler then writes to the response. The Go variant using Go's channels,
and the Node variant using `ts-chan`'s `Chan` class.

## Usage

Run the servers one at a time, running:

```sh
ab -c 100 -n 10000 http://127.0.0.1:8080/
```

Against each server, running each server with:

```sh
/usr/bin/time -l timeout 5 server command
```

## Results

### [node-server-baseline](node-server-baseline)

```
Server Software:
Server Hostname:        127.0.0.1
Server Port:            8080

Document Path:          /
Document Length:        1048576 bytes

Concurrency Level:      100
Time taken for tests:   1.928 seconds
Complete requests:      10000
Failed requests:        0
Total transferred:      10486770000 bytes
HTML transferred:       10485760000 bytes
Requests per second:    5185.43 [#/sec] (mean)
Time per request:       19.285 [ms] (mean)
Time per request:       0.193 [ms] (mean, across all concurrent requests)
Transfer rate:          5310395.56 [Kbytes/sec] received

Connection Times (ms)
              min  mean[+/-sd] median   max
Connect:        0    0   0.5      0       5
Processing:     9   19   2.5     19      41
Waiting:        0    1   1.9      0      18
Total:          9   19   2.9     19      46

Percentage of the requests served within a certain time (ms)
  50%     19
  66%     19
  75%     20
  80%     20
  90%     20
  95%     21
  98%     23
  99%     34
 100%     46 (longest request)
```

```
        5.01 real         0.51 user         0.89 sys
            87474176  maximum resident set size
                   0  average shared memory size
                   0  average unshared data size
                   0  average unshared stack size
                7053  page reclaims
                   2  page faults
                   0  swaps
                   0  block input operations
                   0  block output operations
               75930  messages sent
               10000  messages received
                   3  signals received
                   6  voluntary context switches
               38290  involuntary context switches
            11108122  instructions retired
             5581341  cycles elapsed
             1164032  peak memory footprint
```

### [node-server-ping-pong](node-server-ping-pong)

```
Server Software:
Server Hostname:        127.0.0.1
Server Port:            8080

Document Path:          /
Document Length:        1048576 bytes

Concurrency Level:      100
Time taken for tests:   2.017 seconds
Complete requests:      10000
Failed requests:        0
Total transferred:      10486770000 bytes
HTML transferred:       10485760000 bytes
Requests per second:    4957.38 [#/sec] (mean)
Time per request:       20.172 [ms] (mean)
Time per request:       0.202 [ms] (mean, across all concurrent requests)
Transfer rate:          5076842.47 [Kbytes/sec] received

Connection Times (ms)
              min  mean[+/-sd] median   max
Connect:        0    0   0.6      0      10
Processing:     8   20   3.1     19      54
Waiting:        0    1   2.8      0      33
Total:          9   20   3.4     20      58

Percentage of the requests served within a certain time (ms)
  50%     20
  66%     20
  75%     20
  80%     20
  90%     21
  95%     22
  98%     27
  99%     33
 100%     58 (longest request)
```

```
        5.02 real         0.63 user         0.93 sys
            94601216  maximum resident set size
                   0  average shared memory size
                   0  average unshared data size
                   0  average unshared stack size
                7917  page reclaims
                   5  page faults
                   0  swaps
                   0  block input operations
                   0  block output operations
               76668  messages sent
               10000  messages received
                   3  signals received
                   3  voluntary context switches
               41528  involuntary context switches
            12676040  instructions retired
             6148728  cycles elapsed
             1180416  peak memory footprint
```

### [go-server-baseline](go-server-baseline)

```
Server Software:
Server Hostname:        127.0.0.1
Server Port:            8080

Document Path:          /
Document Length:        1048576 bytes

Concurrency Level:      100
Time taken for tests:   2.147 seconds
Complete requests:      10000
Failed requests:        0
Total transferred:      10486730000 bytes
HTML transferred:       10485760000 bytes
Requests per second:    4658.53 [#/sec] (mean)
Time per request:       21.466 [ms] (mean)
Time per request:       0.215 [ms] (mean, across all concurrent requests)
Transfer rate:          4770775.77 [Kbytes/sec] received

Connection Times (ms)
              min  mean[+/-sd] median   max
Connect:        0    1   1.7      0      91
Processing:     8   21   9.2     20     110
Waiting:        0    1   1.7      0      92
Total:          8   21   9.4     20     111

Percentage of the requests served within a certain time (ms)
  50%     20
  66%     20
  75%     21
  80%     21
  90%     21
  95%     22
  98%     43
  99%     44
 100%    111 (longest request)
```

```
        5.01 real         0.38 user         1.71 sys
            20201472  maximum resident set size
                   0  average shared memory size
                   0  average unshared data size
                   0  average unshared stack size
                1802  page reclaims
                   1  page faults
                   0  swaps
                   0  block input operations
                   0  block output operations
              147597  messages sent
               10000  messages received
                 114  signals received
                  21  voluntary context switches
              227067  involuntary context switches
            10880087  instructions retired
             5713784  cycles elapsed
             1164032  peak memory footprint
```

### [go-server-ping-pong](go-server-ping-pong)

Note: The following results can occasionally vary significantly, on my local
machine. I didn't bother poking at it, but I'd guess at GC related.

```
Server Software:
Server Hostname:        127.0.0.1
Server Port:            8080

Document Path:          /
Document Length:        1048576 bytes

Concurrency Level:      100
Time taken for tests:   2.113 seconds
Complete requests:      10000
Failed requests:        0
Total transferred:      10486730000 bytes
HTML transferred:       10485760000 bytes
Requests per second:    4732.85 [#/sec] (mean)
Time per request:       21.129 [ms] (mean)
Time per request:       0.211 [ms] (mean, across all concurrent requests)
Transfer rate:          4846890.88 [Kbytes/sec] received

Connection Times (ms)
              min  mean[+/-sd] median   max
Connect:        0    0   1.0      0      92
Processing:     8   21   9.3     20     112
Waiting:        0    0   1.4      0      92
Total:          8   21   9.4     20     112

Percentage of the requests served within a certain time (ms)
  50%     20
  66%     20
  75%     20
  80%     20
  90%     21
  95%     21
  98%     25
  99%     48
 100%    112 (longest request)
```

```
        5.01 real         0.38 user         1.75 sys
            20840448  maximum resident set size
                   0  average shared memory size
                   0  average unshared data size
                   0  average unshared stack size
                1816  page reclaims
                   1  page faults
                   0  swaps
                   0  block input operations
                   0  block output operations
              147588  messages sent
               10000  messages received
                  91  signals received
                  23  voluntary context switches
              227404  involuntary context switches
            10879220  instructions retired
             4807014  cycles elapsed
             1164032  peak memory footprint
```
