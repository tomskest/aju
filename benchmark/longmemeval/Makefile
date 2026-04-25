SHELL := /bin/bash
PY := .venv/bin/python
PIP := .venv/bin/pip
RUN_ID ?= run-01
DATASET ?= data/longmemeval_s.json

.PHONY: venv install download run judge report clean-out clean-brains smoke

venv:
	python3 -m venv .venv

install: venv
	$(PIP) install -U pip
	$(PIP) install -r requirements.txt

download:
	@mkdir -p data
	@if [ ! -f $(DATASET) ]; then \
	  echo "LongMemEval distributes via HuggingFace. Download manually:"; \
	  echo "  huggingface-cli download xiaowu/LongMemEval --repo-type=dataset --local-dir data/"; \
	  echo "Then rename the appropriate file to longmemeval_s.json."; \
	  exit 1; \
	fi

smoke:
	$(PY) run.py --run-id $(RUN_ID)-smoke --limit 2 --dataset $(DATASET)

run:
	$(PY) run.py --run-id $(RUN_ID) --dataset $(DATASET)

judge:
	$(PY) judge.py --hypotheses out/$(RUN_ID)/hypotheses.jsonl --dataset $(DATASET)

report:
	@cat out/$(RUN_ID)/hypotheses.report.json

clean-out:
	rm -rf out/$(RUN_ID)

clean-brains:
	@echo "brains are per-question; use --cleanup on run.py to delete as you go,"
	@echo "or delete via the aju web UI using out/$(RUN_ID)/brains.jsonl"
