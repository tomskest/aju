"""aju — Python SDK.

Thin wrapper around the generated client in ``aju._generated``. Re-exports the
most common entry points so users can ``from aju import AjuClient`` without
knowing about the generated layout.
"""

from __future__ import annotations

try:
    from ._generated.client import AuthenticatedClient
except ImportError as exc:  # pragma: no cover - raised pre-generation
    raise ImportError(
        "aju._generated is missing. Run `sdks/scripts/generate.sh` or "
        "`openapi-python-client generate --path ../openapi/openapi.yaml "
        "--config openapi-python-client.yaml` from sdks/python/."
    ) from exc


DEFAULT_BASE_URL = "https://aju.sh"


class AjuClient(AuthenticatedClient):
    """Authenticated aju API client.

    Example::

        from aju import AjuClient
        from aju._generated.api.vault import search_vault

        client = AjuClient(api_key="aju_live_...")
        resp = search_vault.sync(client=client, q="ndc pricing", brain="Personal")
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        *,
        timeout: float = 30.0,
        verify_ssl: bool = True,
    ) -> None:
        super().__init__(
            base_url=base_url,
            token=api_key,
            prefix="Bearer",
            auth_header_name="Authorization",
            timeout=timeout,
            verify_ssl=verify_ssl,
        )


__all__ = ["AjuClient", "DEFAULT_BASE_URL"]
