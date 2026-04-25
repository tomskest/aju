"""
LongMemEval runner for aju.

For each question in the dataset:
  1. Create a per-question brain (isolation matches per-user semantics).
  2. Ingest every session in `haystack_sessions` as its own markdown doc.
     Consecutive sessions get [[wikilinks]] so deep-search can traverse.
  3. Query aju via deep-search, fetch content for each hit.
  4. Pass retrieved context + question to Claude Sonnet 4.6.
  5. Append answer to hypothesis JSONL.

Output layout: out/<RUN_ID>/
  - hypotheses.jsonl   — one {question_id, hypothesis} per line
  - latencies.jsonl    — per-question timing breakdown
  - brains.jsonl       — provisioned brain ids (for cleanup / audit)

Re-running resumes: questions already present in hypotheses.jsonl are skipped.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import anthropic
import httpx
from dotenv import load_dotenv
from tqdm import tqdm

from aju_client import AjuClient


BRAIN_NAME_MAX = 64
BRAIN_NAME_RE = re.compile(r"[^a-zA-Z0-9._-]+")


def shared_brain_name(run_id: str) -> str:
    base = BRAIN_NAME_RE.sub("-", f"lme-{run_id}")
    return base[:BRAIN_NAME_MAX]


def question_doc_type(question_id: str) -> str:
    """Frontmatter `type:` value for all docs belonging to a question.
    Lets deep-search filter retrieval to just that question's sessions via
    `?type=q-<qid>` without needing per-question brains."""
    return f"q-{BRAIN_NAME_RE.sub('-', question_id)[:40]}"


def session_doc_path(question_id: str, index: int, session_id: str) -> str:
    """Namespace every session path with the question id so creating docs in
    a shared brain doesn't collide across questions."""
    qslug = BRAIN_NAME_RE.sub("-", question_id)[:40]
    sslug = BRAIN_NAME_RE.sub("-", session_id)[:40]
    return f"q-{qslug}/sessions/{index:04d}-{sslug}.md"


def format_session_doc(
    question_id: str,
    session_id: str,
    session_date: str,
    turns: list[dict[str, Any]],
    prev_path: str | None,
    next_path: str | None,
) -> str:
    """One markdown doc per session. Wikilinks use full vault paths (without
    the .md extension) so aju's path-based link resolver (strategy 1) picks
    them up deterministically; basename-based resolution fails when session
    ids share prefixes or include underscores that get normalized away.

    Frontmatter `type: q-<qid>` lets deep-search scope retrieval to this
    question only — avoids cross-question leakage in a shared brain."""
    qtype = question_doc_type(question_id)
    tags = ["session", f"date:{session_date}"]
    fm = [
        "---",
        f"type: {qtype}",
        f"question_id: {question_id}",
        f"session_id: {session_id}",
        f"date: {session_date}",
        f"tags: [{', '.join(tags)}]",
        "---",
        "",
    ]
    body = [f"# Session {session_id} ({session_date})", ""]
    for turn in turns:
        role = turn.get("role", "user")
        content = (turn.get("content") or "").strip()
        body.append(f"**{role}:** {content}")
        body.append("")
    links: list[str] = []
    if prev_path:
        links.append(f"Previous: [[{prev_path[:-3] if prev_path.endswith('.md') else prev_path}]]")
    if next_path:
        links.append(f"Next: [[{next_path[:-3] if next_path.endswith('.md') else next_path}]]")
    if links:
        body.append("---")
        body.append("  ·  ".join(links))
    return "\n".join(fm + body)


ANSWERER_SYSTEM = (
    "You answer questions about a single user's conversation history using "
    "only the retrieved memory excerpts provided. Every excerpt — regardless "
    "of session id — is part of the SAME user's chat history. Messages "
    "labelled `user:` are always that user speaking; do not interpret "
    "different sessions as different people.\n\n"
    "Commit to an answer. Give the best-supported factual answer in one or "
    "two short sentences. Do not hedge with 'it's unclear', do not list "
    "multiple candidates, do not narrate your reasoning. If there is a "
    "direct answer anywhere in the memory, report it plainly. Only say you "
    "don't know if no excerpt contains any relevant evidence at all.\n\n"
    "For temporal questions, use timestamps from the memory. For "
    "knowledge-update questions, report the most recent state described."
)


def build_answer_prompt(question: str, retrieved: list[dict[str, Any]]) -> str:
    blocks = []
    for i, r in enumerate(retrieved, 1):
        blocks.append(f"--- Memory {i} (path={r['path']}, score={r['score']:.3f}, source={r['source']}, hop={r['hop']}) ---\n{r['content']}")
    ctx = "\n\n".join(blocks) if blocks else "(no memories retrieved)"
    return f"{ctx}\n\n---\nQuestion: {question}\nAnswer:"


def answer_with_claude(
    client: anthropic.Anthropic,
    model: str,
    question: str,
    retrieved: list[dict[str, Any]],
) -> str:
    prompt = build_answer_prompt(question, retrieved)
    msg = client.messages.create(
        model=model,
        max_tokens=512,
        temperature=0.0,
        system=ANSWERER_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    parts = [b.text for b in msg.content if getattr(b, "type", None) == "text"]
    return "".join(parts).strip()


def ensure_shared_brain(
    aju_agent: AjuClient,
    aju_admin: AjuClient,
    agent_id: str | None,
    brain_name: str,
) -> str:
    """Create the shared brain (via admin/user key) and grant the agent
    editor access. Idempotent — safe to call every run; 409 on create is
    treated as success and the existing brain is looked up."""
    brain = aju_admin.create_brain(brain_name, type_="personal")
    if agent_id:
        # grant is upsert-ish on the server — re-running is safe.
        aju_admin.grant_agent_brain(agent_id, brain_name, role="editor")
    return brain["id"]


def ingest_question(
    aju_agent: AjuClient,
    brain_name: str,
    question: dict[str, Any],
) -> int:
    """Ingest a question's sessions into the SHARED brain, tagged with
    `type: q-<qid>` in frontmatter so deep-search can scope retrieval to
    this question via `?type=...`. Returns ingested_count."""
    qid = question["question_id"]
    sessions = question.get("haystack_sessions") or []
    session_ids = question.get("haystack_session_ids") or [
        f"session-{i:03d}" for i in range(len(sessions))
    ]
    session_dates = question.get("haystack_dates") or [""] * len(sessions)

    resolved_ids = [
        session_ids[i] if i < len(session_ids) else f"session-{i:03d}"
        for i in range(len(sessions))
    ]
    # Paths are namespaced with q-<qid>/ so different questions never collide
    # in the shared brain. Wikilinks stay within a single question's paths,
    # keeping graph expansion scoped.
    paths = [session_doc_path(qid, i, resolved_ids[i]) for i in range(len(sessions))]

    # Bulk ingest path: creates use `defer_index=1` so the server skips
    # per-create link rebuild + embedding generation. We flush everything in
    # one batched reindex call after all creates land. Safe to parallelize
    # creates now — no more fire-and-forget races on document_links.
    def _ingest_one(i: int) -> bool:
        sid = resolved_ids[i]
        sdate = session_dates[i] if i < len(session_dates) else ""
        prev_path = paths[i - 1] if i > 0 else None
        next_path = paths[i + 1] if i + 1 < len(sessions) else None
        body = format_session_doc(qid, sid, sdate, sessions[i], prev_path, next_path)
        aju_agent.create_document(
            brain_name, paths[i], body, source="longmemeval", defer_index=True,
        )
        return True

    ingested = 0
    with ThreadPoolExecutor(max_workers=6) as pool:
        for ok in pool.map(_ingest_one, range(len(sessions))):
            if ok:
                ingested += 1

    # One batched reindex flush for this question's docs.
    aju_agent.reindex(brain_name)

    return ingested


def load_done(hypo_path: Path) -> set[str]:
    done: set[str] = set()
    if hypo_path.exists():
        with hypo_path.open() as f:
            for line in f:
                try:
                    done.add(json.loads(line)["question_id"])
                except Exception:
                    continue
    return done


def main() -> int:
    load_dotenv()

    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="data/longmemeval_s.json")
    parser.add_argument("--run-id", default=os.environ.get("RUN_ID", "run-01"))
    parser.add_argument("--limit", type=int, default=0, help="0 = all")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--seeds", type=int, default=int(os.environ.get("SEEDS", "5")))
    parser.add_argument("--retrieve-limit", type=int, default=int(os.environ.get("LIMIT", "15")))
    parser.add_argument("--depth", type=int, default=int(os.environ.get("DEPTH", "1")))
    parser.add_argument("--cleanup", action="store_true", help="Delete benchmark brains after answering")
    parser.add_argument("--dry-run", action="store_true", help="Ingest but skip answer generation")
    args = parser.parse_args()

    answerer_model = os.environ.get("ANSWERER_MODEL", "claude-sonnet-4-6")

    dataset_path = Path(args.dataset)
    if not dataset_path.exists():
        print(f"dataset not found: {dataset_path}", file=sys.stderr)
        print("run `make download` first", file=sys.stderr)
        return 1
    with dataset_path.open() as f:
        questions: list[dict[str, Any]] = json.load(f)
    if args.offset:
        questions = questions[args.offset :]
    if args.limit:
        questions = questions[: args.limit]

    out_dir = Path("out") / args.run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    hypo_path = out_dir / "hypotheses.jsonl"
    lat_path = out_dir / "latencies.jsonl"
    brains_path = out_dir / "brains.jsonl"

    done = load_done(hypo_path)
    print(f"resuming run {args.run_id}: {len(done)} questions already answered")

    anth = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    admin_api_key = os.environ.get("AJU_ADMIN_API_KEY")
    agent_id = os.environ.get("AJU_AGENT_ID")
    if not admin_api_key or not agent_id:
        print(
            "AJU_ADMIN_API_KEY and AJU_AGENT_ID must be set — admin key creates "
            "the per-question brain and grants the agent editor access.",
            file=sys.stderr,
        )
        return 1

    aju_agent = AjuClient()
    aju_admin = AjuClient(api_key=admin_api_key)

    # Single shared brain for the whole run. Doc paths and `type:` frontmatter
    # scope each question's data so retrieval stays isolated via ?type=q-<qid>.
    # Works inside a 1-brain plan cap and avoids the delete-endpoint bug.
    brain_name = shared_brain_name(args.run_id)
    shared_brain_id = ensure_shared_brain(aju_agent, aju_admin, agent_id, brain_name)
    print(f"shared brain: {brain_name} (id={shared_brain_id})")

    try:
        with hypo_path.open("a") as hf, \
             lat_path.open("a") as lf, \
             brains_path.open("a") as bf:
            for q in tqdm(questions, desc="questions"):
                qid = q["question_id"]
                if qid in done:
                    continue

                qtype = question_doc_type(qid)
                t0 = time.perf_counter()
                try:
                    ingested = ingest_question(aju_agent, brain_name, q)
                except httpx.HTTPError as e:
                    print(f"[{qid}] ingest failed: {e}", file=sys.stderr)
                    continue
                t_ingest = time.perf_counter() - t0
                bf.write(json.dumps({
                    "question_id": qid,
                    "brain_id": shared_brain_id,
                    "brain_name": brain_name,
                    "doc_type": qtype,
                    "ingested": ingested,
                }) + "\n")
                bf.flush()

                if args.dry_run:
                    continue

                t1 = time.perf_counter()
                try:
                    retrieved = aju_agent.retrieve_with_content(
                        brain_name,
                        q["question"],
                        seeds=args.seeds,
                        limit=args.retrieve_limit,
                        depth=args.depth,
                        doc_type=qtype,
                    )
                except httpx.HTTPError as e:
                    print(f"[{qid}] retrieve failed: {e}", file=sys.stderr)
                    retrieved = []
                t_retrieve = time.perf_counter() - t1

                t2 = time.perf_counter()
                try:
                    hypothesis = answer_with_claude(anth, answerer_model, q["question"], retrieved)
                except anthropic.APIError as e:
                    print(f"[{qid}] answer failed: {e}", file=sys.stderr)
                    hypothesis = ""
                t_answer = time.perf_counter() - t2

                hf.write(json.dumps({
                    "question_id": qid,
                    "question_type": q.get("question_type"),
                    "hypothesis": hypothesis,
                    "retrieved_paths": [r["path"] for r in retrieved],
                }) + "\n")
                hf.flush()

                lf.write(json.dumps({
                    "question_id": qid,
                    "ingest_s": round(t_ingest, 3),
                    "retrieve_s": round(t_retrieve, 3),
                    "answer_s": round(t_answer, 3),
                    "retrieved_count": len(retrieved),
                }) + "\n")
                lf.flush()
    finally:
        aju_agent.close()
        aju_admin.close()

    print(f"done. hypotheses: {hypo_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
