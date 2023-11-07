# Multiplex log files

See [/docs/pattern-fan-in.md](../../docs/pattern-fan-in.md) for more
information regarding the pattern used by this example.

## Benchmarks

tl;dr the performance is slightly faster than the baseline, if the `addSender`
method is used directly, or slightly worse than the baseline, if the `send`
method is used, and "unsafe" mode (comparable safety to the baseline) is used.

### Baseline

```
        1.49 real         0.37 user         0.08 sys
            85590016  maximum resident set size
                   0  average shared memory size
                   0  average unshared data size
                   0  average unshared stack size
                6227  page reclaims
                   1  page faults
                   0  swaps
                   0  block input operations
                   0  block output operations
                   0  messages sent
                3212  messages received
                   0  signals received
                   7  voluntary context switches
                3641  involuntary context switches
          4527097787  instructions retired
          1384933405  cycles elapsed
            62282240  peak memory footprint
goos: darwin
goarch: arm64
pkg: github.com/joeycumines/ts-chan/examples/pattern-fan-in-multiplex-log-streams
BenchmarkServer-10    	        1.83 real         0.60 user         0.14 sys
            94208000  maximum resident set size
                   0  average shared memory size
                   0  average unshared data size
                   0  average unshared stack size
                6721  page reclaims
                   0  page faults
                   0  swaps
                   0  block input operations
                   0  block output operations
                   0  messages sent
                5070  messages received
                   0  signals received
                   1  voluntary context switches
                7141  involuntary context switches
          7722671426  instructions retired
          2275783700  cycles elapsed
            71278400  peak memory footprint
        2.17 real         0.83 user         0.16 sys
           100155392  maximum resident set size
                   0  average shared memory size
                   0  average unshared data size
                   0  average unshared stack size
                7453  page reclaims
                   0  page faults
                   0  swaps
                   0  block input operations
                   0  block output operations
                   0  messages sent
                4470  messages received
                   0  signals received
                   5  voluntary context switches
               10330  involuntary context switches
         11204091386  instructions retired
          3087215269  cycles elapsed
            77340928  peak memory footprint
       3	 358758236 ns/op
PASS
ok  	github.com/joeycumines/ts-chan/examples/pattern-fan-in-multiplex-log-streams	5.892s
```

### With ts-chan, using `addSender`

```
        1.47 real         0.33 user         0.10 sys
            78004224  maximum resident set size
                   0  average shared memory size
                   0  average unshared data size
                   0  average unshared stack size
                5584  page reclaims
                   0  page faults
                   0  swaps
                   0  block input operations
                   0  block output operations
                   0  messages sent
                4629  messages received
                   0  signals received
                   1  voluntary context switches
                3518  involuntary context switches
          4232900468  instructions retired
          1306707881  cycles elapsed
            52706240  peak memory footprint
goos: darwin
goarch: arm64
pkg: github.com/joeycumines/ts-chan/examples/pattern-fan-in-multiplex-log-streams
BenchmarkServer-10    	        1.81 real         0.55 user         0.13 sys
            96567296  maximum resident set size
                   0  average shared memory size
                   0  average unshared data size
                   0  average unshared stack size
                6982  page reclaims
                   0  page faults
                   0  swaps
                   0  block input operations
                   0  block output operations
                   0  messages sent
                4902  messages received
                   0  signals received
                   1  voluntary context switches
                6732  involuntary context switches
          7609886387  instructions retired
          2122566682  cycles elapsed
            73604800  peak memory footprint
        2.10 real         0.79 user         0.17 sys
            99385344  maximum resident set size
                   0  average shared memory size
                   0  average unshared data size
                   0  average unshared stack size
                7338  page reclaims
                  10  page faults
                   0  swaps
                   0  block input operations
                   0  block output operations
                   0  messages sent
                5166  messages received
                   0  signals received
                   7  voluntary context switches
               10635  involuntary context switches
         10823723224  instructions retired
          2959375437  cycles elapsed
            76554432  peak memory footprint
       3	 335016111 ns/op
PASS
ok  	github.com/joeycumines/ts-chan/examples/pattern-fan-in-multiplex-log-streams	5.771s
```

### With `ts-chan`, using `send`

```
        1.73 real         0.41 user         0.06 sys
            79904768  maximum resident set size
                   0  average shared memory size
                   0  average unshared data size
                   0  average unshared stack size
                5929  page reclaims
                   0  page faults
                   0  swaps
                   0  block input operations
                   0  block output operations
                   0  messages sent
                1064  messages received
                   0  signals received
                   4  voluntary context switches
                3991  involuntary context switches
          4450953879  instructions retired
          1316011002  cycles elapsed
            54458944  peak memory footprint
goos: darwin
goarch: arm64
pkg: github.com/joeycumines/ts-chan/examples/pattern-fan-in-multiplex-log-streams
BenchmarkServer-10    	        2.08 real         0.86 user         0.14 sys
           126468096  maximum resident set size
                   0  average shared memory size
                   0  average unshared data size
                   0  average unshared stack size
               12178  page reclaims
                   0  page faults
                   0  swaps
                   0  block input operations
                   0  block output operations
                   0  messages sent
                3578  messages received
                   0  signals received
                   2  voluntary context switches
                7755  involuntary context switches
         10882463945  instructions retired
          3105663639  cycles elapsed
           108013184  peak memory footprint
        2.41 real         1.15 user         0.19 sys
           132464640  maximum resident set size
                   0  average shared memory size
                   0  average unshared data size
                   0  average unshared stack size
               14210  page reclaims
                   1  page faults
                   0  swaps
                   0  block input operations
                   0  block output operations
                   0  messages sent
                4936  messages received
                   0  signals received
                   8  voluntary context switches
               11012  involuntary context switches
         15707563396  instructions retired
          4242077637  cycles elapsed
           114584640  peak memory footprint
       3	 438283069 ns/op
PASS
ok  	github.com/joeycumines/ts-chan/examples/pattern-fan-in-multiplex-log-streams	6.612s
```

### With `ts-chan`, using `send`, with microtask cycle mitigations

```
        2.50 real         1.09 user         0.73 sys
           116473856  maximum resident set size
                   0  average shared memory size
                   0  average unshared data size
                   0  average unshared stack size
               10333  page reclaims
                   0  page faults
                   0  swaps
                   0  block input operations
                   0  block output operations
                   0  messages sent
                4282  messages received
                   0  signals received
                   3  voluntary context switches
              142523  involuntary context switches
         12629572175  instructions retired
          5431023659  cycles elapsed
            96718592  peak memory footprint
goos: darwin
goarch: arm64
pkg: github.com/joeycumines/ts-chan/examples/pattern-fan-in-multiplex-log-streams
BenchmarkServer-10    	       1	1406625875 ns/op
PASS
ok  	github.com/joeycumines/ts-chan/examples/pattern-fan-in-multiplex-log-streams	2.664s
```
