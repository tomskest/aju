BINARY := aju
ARGS ?=

.PHONY: build install clean run

build:
	go build -o $(BINARY) ./

install: build
	mkdir -p $(HOME)/.local/bin
	cp $(BINARY) $(HOME)/.local/bin/$(BINARY)
	chmod +x $(HOME)/.local/bin/$(BINARY)

clean:
	rm -f $(BINARY)

run:
	go run . $(ARGS)
