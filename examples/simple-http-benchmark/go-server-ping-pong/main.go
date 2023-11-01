package main

import "net/http"

var (
	bytes = make([]byte, 1024*1024)
	reqCh = make(chan *http.Request)
	resCh = make(chan []byte)
)

func main() {
	for i := range bytes {
		bytes[i] = 100
	}
	go func() {
		for range reqCh {
			resCh <- bytes
		}
	}()
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		reqCh <- r
		_, _ = w.Write(<-resCh)
	})
	panic(http.ListenAndServe(`127.0.0.1:8080`, nil))
}
