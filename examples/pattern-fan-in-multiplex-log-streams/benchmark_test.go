package main

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"sync"
	"testing"
	"time"
)

const numConnections = 100
const numLinesPerUnit = 1000

// note: -c flag uses ts-chan
var command = []string{"/usr/bin/time", "-l", "node", "index.js", "-c"}

func findOpenPort() (int, error) {
	addr, err := net.ResolveTCPAddr("tcp", "localhost:0")
	if err != nil {
		return 0, err
	}

	l, err := net.ListenTCP("tcp", addr)
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func runServer(ctx context.Context, port int, logFilePath string) (*exec.Cmd, error) {
	cmd := exec.CommandContext(ctx, command[0], append(append([]string(nil), command[1:]...), "-l", fmt.Sprintf("127.0.0.1:%d", port), "-o", logFilePath)...)
	cmd.Stdout = nil
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return cmd, nil
}

func worker(ctx context.Context, wg *sync.WaitGroup, start <-chan struct{}, address string, linesToWrite int, workerID int) {
	defer wg.Done()

	select {
	case <-ctx.Done():
		return
	case <-start:
	}

	conn, err := net.Dial("tcp", address)
	if err != nil {
		log.Fatalf("Worker %d: Failed to connect to server: %v", workerID, err)
	}
	defer conn.Close()

	writer := bufio.NewWriter(conn)

WriteLoop:
	for i := 0; i < linesToWrite*numLinesPerUnit; i++ {
		select {
		case <-ctx.Done():
			break WriteLoop
		default:
			_, err := writer.WriteString(fmt.Sprintf("line %016d\n", i))
			if err == nil {
				err = writer.Flush()
			}
			if err != nil {
				log.Fatalf("Worker %d: Failed to write to server: %v", workerID, err)
			}
		}
	}

	if err := conn.Close(); err != nil {
		log.Fatalf("Worker %d: Failed to close connection: %v", workerID, err)
	}
}

func BenchmarkServer(b *testing.B) {
	port, err := findOpenPort()
	if err != nil {
		b.Fatalf("Failed to find an open port: %v", err)
	}

	localLogFilePath := fmt.Sprintf("%s-%d.log", "benchmark-server", port)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	serverCmd, err := runServer(ctx, port, localLogFilePath)
	if err != nil {
		b.Fatalf("Failed to start server: %v", err)
	}

	srvDone := make(chan struct{})
	go func() {
		defer close(srvDone)
		if err := serverCmd.Wait(); err != nil {
			b.Errorf("Failed to wait for server: %v", err)
		}
	}()

	// Wait for the server to be ready
	time.Sleep(1 * time.Second)

	start := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	for c := 0; c < numConnections; c++ {
		wg.Add(1)
		go worker(ctx, &wg, start, fmt.Sprintf("127.0.0.1:%d", port), b.N, c)
	}
	wg.Done()

	time.Sleep(100 * time.Millisecond)

	b.ResetTimer()

	close(start)

	wg.Wait()

	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()

	select {
	case <-timer.C:
		cancel()
		<-srvDone
	case <-srvDone:
	}

	b.StopTimer()
}
