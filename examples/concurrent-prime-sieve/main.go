package main

import "fmt"

func generate(ch chan<- int) {
	for i := 2; ; i++ {
		ch <- i
	}
}

func filter(src <-chan int, dst chan<- int, prime int) {
	for i := range src {
		if i%prime != 0 {
			dst <- i
		}
	}
}

func Sieve(n int) (primes []int) {
	ch := make(chan int)
	go generate(ch)
	for i := 0; i < n; i++ {
		prime := <-ch
		primes = append(primes, prime)
		ch1 := make(chan int)
		go filter(ch, ch1, prime)
		ch = ch1
	}
	return
}

func main() {
	fmt.Printf("%#v\n", Sieve(1000))
}
