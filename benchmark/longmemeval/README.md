# LongMemEval on aju

Runs the [LongMemEval](https://arxiv.org/abs/2410.10813) benchmark against a
running aju instance, using Claude for both the answerer and the judge. No
OpenAI dependency — embeddings stay on Voyage (aju's default) and every LLM
call is Anthropic.

## What this produces

- `out/<run-id>/hypotheses.jsonl` — one line per question with the answer
- `out/<run-id>/latencies.jsonl`  — ingest / retrieve / answer timings
- `out/<run-id>/brains.jsonl`     — provisioned brain ids (for audit / cleanup)
- `out/<run-id>/hypotheses.judged.jsonl` — per-question pass/fail from the judge
- `out/<run-id>/hypotheses.report.json`  — aggregate accuracy + per-category split

## Config choices worth defending

| Choice | Value | Reason |
|---|---|---|
| Answerer | `claude-sonnet-4-6` | Strong reasoner, ~20% pricier than GPT-4o but we have credits |
| Judge | `claude-haiku-4-5-20251001` | Different size + RLHF from the answerer to blunt preference leakage |
| Embeddings | Voyage `voyage-4-large` (1024d) | aju's default; asymmetric query/doc embedding |
| Retrieval | aju deep-search (hybrid RRF + 1-hop graph expansion) | Uses the differentiating capability |
| Isolation | One brain per question | True data isolation via aju's per-tenant DB semantics |
| Live brain cap | 50 (`--batch-size`) | Provision up to N brains, delete the batch, repeat — keeps us inside per-org brain quotas |
| Ingestion | One markdown doc per session, wikilinks between neighbors | Lets graph expansion stitch multi-session evidence |
| Seeds / Limit / Depth | 5 / 15 / 1 | Tunable via env or CLI |
| Temperature | 0.0 everywhere | Reproducibility |

## Setup

```sh
make install
cp .env.example .env
# fill in AJU_API_KEY and ANTHROPIC_API_KEY
```

Dataset: LongMemEval is distributed via HuggingFace. Download
`longmemeval_s.json` (the 115K-token "S" set — the one every vendor reports)
into `data/`:

```sh
# one option — adjust if the repo path moves
huggingface-cli download xiaowu/LongMemEval --repo-type=dataset --local-dir data/
mv data/longmemeval_s_*.json data/longmemeval_s.json
```

## Smoke test (2 questions, ~$0.20)

```sh
make smoke
```

Verifies auth, ingest, retrieval, and answer generation end-to-end without
spending real money. Cleans up with `make clean-out RUN_ID=run-01-smoke`.

## Full run (~$50 per pass)

```sh
make run RUN_ID=run-01
make judge RUN_ID=run-01
make report RUN_ID=run-01
```

`run.py` is resumable — if it crashes or you interrupt, re-run the same command
and it picks up from where `hypotheses.jsonl` left off.

For a 3-run publishable average (~$150 total on Claude credits):

```sh
for i in 01 02 03; do
  make run RUN_ID=run-$i
  make judge RUN_ID=run-$i
done
```

## Cleanup

Every question spawns a brain named `lme-<run-id>-<question_id>`. The runner
holds up to `--batch-size` (default 50) live brains, then deletes the batch
and continues — so we never exceed the per-org brain quota and there's
nothing to clean up at the end of a successful run.

If a run crashes mid-batch, orphaned brains can be reaped via the aju web UI
using `out/<run-id>/brains.jsonl` as the audit trail.

## Known limitations / caveats to publish alongside results

- **Single-family judge**: answerer and judge are both Claude. We mitigate by
  splitting model sizes, but anyone re-running with a GPT-4o or Gemini judge
  will get slightly different numbers. That's fine — the point is
  reproducibility, not a single canonical score.
- **No chunking**: aju stores each session as one doc and embeds the full text
  (up to 96K chars). Long sessions may lose precision vs. chunked systems.
- **Oracle baseline not run**: we do not also run `longmemeval_oracle.json`.
  The oracle score is an upper bound; ours is the realistic retrieval score.
- **Cost is approximate**: actual cost depends on session-history length in
  the dataset variant you use. The ~$50/run figure is for `longmemeval_s`.

## Why this repo is structured the way it is

Every competitor published LongMemEval numbers in 2025, nobody published a
fully-reproducible harness with pinned judge + seed + adapter code. This
directory is that harness for aju.
