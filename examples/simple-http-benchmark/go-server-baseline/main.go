package main

import "net/http"

var bytes = make([]byte, 1024*1024)

func main() {
	for i := range bytes {
		bytes[i] = 100
	}
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(bytes)
	})
	panic(http.ListenAndServe(`127.0.0.1:8080`, nil))
}
