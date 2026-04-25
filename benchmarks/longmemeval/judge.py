"""
Claude-based LongMemEval judge. Mirrors the upstream evaluate_qa.py contract:
given a hypothesis file + the oracle dataset, emit per-question pass/fail and
aggregate accuracy per category.

Why Claude as judge: we only have Anthropic credits. Known bias risk when the
answerer is also Claude-family — we use Sonnet to answer and Haiku to judge
(different size + RLHF), and publish the config so anyone can rerun with their
preferred judge model.

Prompt is adapted from LongMemEval's judge template: a strict yes/no on whether
the hypothesis is semantically equivalent to the gold answer for the question.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import anthropic
from dotenv import load_dotenv
from tqdm import tqdm


JUDGE_SYSTEM = (
    "You grade a question-answering system. Given a question, a gold answer, "
    "and a hypothesis, decide whether the hypothesis answers the question "
    "correctly.\n\n"
    "CORRECT (answer `yes`):\n"
    "- Hypothesis contains the gold answer verbatim or as a clear paraphrase, "
    "even if surrounded by extra correct details.\n"
    "- Hypothesis commits to the same fact(s) as the gold, with different "
    "wording or additional context.\n"
    "- Hypothesis adds qualifiers or richer description that does not "
    "contradict the gold answer. A hypothesis that says 'yellow dress and "
    "earrings' is correct for gold 'yellow dress'. 'Max is a Golden "
    "Retriever' is correct for gold 'Golden Retriever'.\n\n"
    "INCORRECT (answer `no`):\n"
    "- Hypothesis gives a different value than the gold.\n"
    "- Hypothesis says it doesn't know, or that the information isn't in "
    "memory, or hedges without committing.\n"
    "- Hypothesis is off-topic or answers a different question.\n\n"
    "Respond with exactly one token: `yes` or `no`."
)


def build_judge_prompt(question: str, gold: str, hypothesis: str, question_type: str | None) -> str:
    hint = ""
    if question_type == "temporal-reasoning":
        hint = (
            "\nThis is a temporal-reasoning question. Dates and times matter — "
            "if the hypothesis's timeframe does not match the gold answer's "
            "timeframe, mark it incorrect."
        )
    if question_type == "knowledge-update":
        hint = (
            "\nThis is a knowledge-update question. The correct answer is the "
            "MOST RECENT state described in the memory, not an earlier one."
        )
    return (
        f"Question: {question}\n\n"
        f"Gold answer: {gold}\n\n"
        f"Hypothesis: {hypothesis}"
        f"{hint}\n\n"
        "Is the hypothesis correct? Respond with `yes` or `no`."
    )


def judge_one(
    client: anthropic.Anthropic,
    model: str,
    question: str,
    gold: str,
    hypothesis: str,
    question_type: str | None,
) -> bool:
    msg = client.messages.create(
        model=model,
        max_tokens=4,
        temperature=0.0,
        system=JUDGE_SYSTEM,
        messages=[{"role": "user", "content": build_judge_prompt(question, gold, hypothesis, question_type)}],
    )
    parts = [b.text for b in msg.content if getattr(b, "type", None) == "text"]
    verdict = "".join(parts).strip().lower()
    return verdict.startswith("y")


def main() -> int:
    load_dotenv()

    parser = argparse.ArgumentParser()
    parser.add_argument("--hypotheses", required=True)
    parser.add_argument("--dataset", default="data/longmemeval_s.json")
    parser.add_argument("--out", default=None, help="per-instance judgments jsonl (default: <hypotheses>.judged.jsonl)")
    parser.add_argument("--report", default=None, help="aggregate report json (default: <hypotheses>.report.json)")
    args = parser.parse_args()

    hypo_path = Path(args.hypotheses)
    if not hypo_path.exists():
        print(f"hypotheses not found: {hypo_path}", file=sys.stderr)
        return 1

    dataset_path = Path(args.dataset)
    with dataset_path.open() as f:
        dataset: list[dict[str, Any]] = json.load(f)
    by_qid = {q["question_id"]: q for q in dataset}

    out_path = Path(args.out) if args.out else hypo_path.with_suffix(".judged.jsonl")
    report_path = Path(args.report) if args.report else hypo_path.with_suffix(".report.json")

    judge_model = os.environ.get("JUDGE_MODEL", "claude-haiku-4-5-20251001")
    anth = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    # Load any existing judgments to resume.
    already: set[str] = set()
    if out_path.exists():
        with out_path.open() as f:
            for line in f:
                try:
                    already.add(json.loads(line)["question_id"])
                except Exception:
                    continue

    per_category_correct: dict[str, int] = defaultdict(int)
    per_category_total: dict[str, int] = defaultdict(int)
    total_correct = 0
    total = 0

    with hypo_path.open() as hf, out_path.open("a") as of:
        hyps = [json.loads(line) for line in hf if line.strip()]
        for h in tqdm(hyps, desc="judging"):
            qid = h["question_id"]
            gold_q = by_qid.get(qid)
            if not gold_q:
                continue
            gold = gold_q.get("answer") or gold_q.get("gold_answer") or ""
            qtype = h.get("question_type") or gold_q.get("question_type")

            if qid in already:
                # replay from existing judgments
                continue
            try:
                correct = judge_one(anth, judge_model, gold_q.get("question", ""), gold, h.get("hypothesis", ""), qtype)
            except anthropic.APIError as e:
                print(f"[{qid}] judge failed: {e}", file=sys.stderr)
                continue

            of.write(json.dumps({
                "question_id": qid,
                "question_type": qtype,
                "autoeval_label": "yes" if correct else "no",
                "gold": gold,
                "hypothesis": h.get("hypothesis", ""),
            }) + "\n")
            of.flush()

    # Re-aggregate from the judgments file (includes prior resumed runs).
    with out_path.open() as f:
        for line in f:
            rec = json.loads(line)
            qtype = rec.get("question_type") or "unknown"
            correct = rec.get("autoeval_label") == "yes"
            per_category_total[qtype] += 1
            total += 1
            if correct:
                per_category_correct[qtype] += 1
                total_correct += 1

    report = {
        "hypotheses_file": str(hypo_path),
        "dataset": str(dataset_path),
        "judge_model": judge_model,
        "overall": {
            "correct": total_correct,
            "total": total,
            "accuracy": round(total_correct / total, 4) if total else None,
        },
        "per_category": {
            cat: {
                "correct": per_category_correct[cat],
                "total": per_category_total[cat],
                "accuracy": round(per_category_correct[cat] / per_category_total[cat], 4) if per_category_total[cat] else None,
            }
            for cat in sorted(per_category_total)
        },
    }
    report_path.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
