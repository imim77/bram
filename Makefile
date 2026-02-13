build:
	tsc
	go build -o bin/bram ./server
run: build
	./bin/bram
watch-ts:
	tsc --watch
