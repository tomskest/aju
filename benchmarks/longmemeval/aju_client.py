"""Minimal REST client for aju, scoped to the endpoints the benchmark needs."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass
class SearchHit:
    path: str
    title: str
    score: float
    source: str  # "seed" | "graph"
    hop: int


class AjuClient:
    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        env_key: str = "AJU_API_KEY",
        timeout: float = 60.0,
    ):
        self.base_url = (base_url or os.environ["AJU_BASE_URL"]).rstrip("/")
        self.api_key = api_key or os.environ[env_key]
        self._client = httpx.Client(
            base_url=self.base_url,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "AjuClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ------------------------------------------------------------------ brains

    def create_brain(self, name: str, type_: str = "personal") -> dict[str, Any]:
        r = self._client.post("/api/brains", json={"name": name, "type": type_})
        if r.status_code == 409:
            # Already exists — treat as idempotent and look it up.
            for b in self.list_brains():
                if b["name"] == name:
                    return b
            raise RuntimeError(f"brain {name!r} 409 but not found in list")
        r.raise_for_status()
        return r.json()["brain"]

    def list_brains(self) -> list[dict[str, Any]]:
        r = self._client.get("/api/brains")
        r.raise_for_status()
        return r.json()["brains"]

    def delete_brain(self, brain_id: str) -> None:
        r = self._client.delete(f"/api/brains/{brain_id}")
        if r.status_code not in (200, 204, 404):
            r.raise_for_status()

    # ---------------------------------------------------------------- grants

    def rebuild_links(self, brain: str) -> dict[str, Any]:
        """Deterministically resolve wikilinks into the document_links graph.
        Per-create rebuilds are fire-and-forget and can still be in flight
        when we query; calling this after ingest completes guarantees the
        graph is consistent before deep-search runs."""
        r = self._client.post("/api/vault/rebuild-links", params={"brain": brain})
        r.raise_for_status()
        return r.json()

    def grant_agent_brain(
        self,
        agent_id: str,
        brain_name: str,
        role: str = "editor",
    ) -> None:
        """Grant an agent access to a brain. Must be called with a user-bound
        key that owns the brain — agent principals cannot grant themselves."""
        r = self._client.post(
            f"/api/agents/{agent_id}/brains",
            json={"brainName": brain_name, "role": role},
        )
        if r.status_code in (200, 201):
            return
        r.raise_for_status()

    # --------------------------------------------------------------- documents

    def create_document(
        self,
        brain: str,
        path: str,
        content: str,
        source: str = "benchmark",
        defer_index: bool = False,
    ) -> dict[str, Any]:
        """Create a document. When `defer_index=True` the server skips the
        per-create link rebuild + embedding generation — caller must invoke
        `reindex(brain)` after the import completes. Use for bulk ingest.

        Retries on 5xx with exponential backoff; duplicate (409) is treated
        as idempotent success."""
        params: dict[str, Any] = {"brain": brain}
        if defer_index:
            params["defer_index"] = "1"
        backoffs = [0.0, 1.5, 4.0]
        last_status = None
        r = None
        for delay in backoffs:
            if delay:
                time.sleep(delay)
            r = self._client.post(
                "/api/vault/create",
                params=params,
                json={"path": path, "content": content, "source": source},
            )
            last_status = r.status_code
            if r.status_code == 409:
                return {"path": path, "duplicate": True}
            if r.status_code < 500:
                r.raise_for_status()
                return r.json()
        raise httpx.HTTPStatusError(
            f"create_document {path!r} failed after {len(backoffs)} attempts (last status {last_status})",
            request=r.request if r else None,  # type: ignore[arg-type]
            response=r,  # type: ignore[arg-type]
        )

    def reindex(
        self,
        brain: str,
        refresh_all: bool = False,
        fts: bool = True,
        embeddings: bool = True,
        links: bool = True,
    ) -> dict[str, Any]:
        """Rebuild derived indexes (FTS, embeddings, link graph) for a brain
        in one batched pass. Voyage calls are batched up to 100 docs at a
        time so this is dramatically faster than letting per-create
        fire-and-forget jobs catch up serially."""
        r = self._client.post(
            "/api/vault/reindex",
            params={"brain": brain},
            json={
                "refreshAll": refresh_all,
                "fts": fts,
                "embeddings": embeddings,
                "links": links,
            },
            timeout=120.0,
        )
        r.raise_for_status()
        return r.json()

    def get_document(self, brain: str, path: str) -> dict[str, Any] | None:
        r = self._client.get(
            "/api/vault/document",
            params={"brain": brain, "path": path},
        )
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    # ---------------------------------------------------------------- retrieval

    def deep_search(
        self,
        brain: str,
        query: str,
        seeds: int = 5,
        limit: int = 15,
        depth: int = 1,
        doc_type: str | None = None,
    ) -> list[SearchHit]:
        params: dict[str, Any] = {
            "brain": brain,
            "q": query,
            "seeds": seeds,
            "limit": limit,
            "depth": depth,
        }
        if doc_type:
            params["type"] = doc_type
        r = self._client.get("/api/vault/deep-search", params=params)
        r.raise_for_status()
        results = r.json().get("results", [])
        return [
            SearchHit(
                path=h["path"],
                title=h.get("title") or h["path"],
                score=float(h.get("score") or 0.0),
                source=h.get("source") or "seed",
                hop=int(h.get("hop") or 0),
            )
            for h in results
        ]

    def retrieve_with_content(
        self,
        brain: str,
        query: str,
        seeds: int = 5,
        limit: int = 15,
        depth: int = 1,
        doc_type: str | None = None,
    ) -> list[dict[str, Any]]:
        """Deep-search then fetch full content for each hit. Preserves rank order."""
        hits = self.deep_search(brain, query, seeds=seeds, limit=limit, depth=depth, doc_type=doc_type)
        out: list[dict[str, Any]] = []
        for h in hits:
            doc = self.get_document(brain, h.path)
            if not doc:
                continue
            out.append(
                {
                    "path": h.path,
                    "title": h.title,
                    "score": h.score,
                    "source": h.source,
                    "hop": h.hop,
                    "content": doc.get("content") or "",
                }
            )
        return out
