from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error import Error
from ...models.search_response import SearchResponse
from ...models.semantic_search_vault_mode import SemanticSearchVaultMode
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    *,
    q: str,
    brain: str | Unset = UNSET,
    section: str | Unset = UNSET,
    type_: str | Unset = UNSET,
    mode: SemanticSearchVaultMode | Unset = SemanticSearchVaultMode.HYBRID,
    limit: int | Unset = 20,
    threshold: float | Unset = 0.0,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    params["q"] = q

    params["brain"] = brain

    params["section"] = section

    params["type"] = type_

    json_mode: str | Unset = UNSET
    if not isinstance(mode, Unset):
        json_mode = mode.value

    params["mode"] = json_mode

    params["limit"] = limit

    params["threshold"] = threshold


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/vault/semantic-search",
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Error | SearchResponse | None:
    if response.status_code == 200:
        response_200 = SearchResponse.from_dict(response.json())



        return response_200

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())



        return response_400

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())



        return response_401

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Error | SearchResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    q: str,
    brain: str | Unset = UNSET,
    section: str | Unset = UNSET,
    type_: str | Unset = UNSET,
    mode: SemanticSearchVaultMode | Unset = SemanticSearchVaultMode.HYBRID,
    limit: int | Unset = 20,
    threshold: float | Unset = 0.0,

) -> Response[Error | SearchResponse]:
    """ Vector / hybrid semantic search.

    Args:
        q (str):
        brain (str | Unset):
        section (str | Unset):
        type_ (str | Unset):
        mode (SemanticSearchVaultMode | Unset):  Default: SemanticSearchVaultMode.HYBRID.
        limit (int | Unset):  Default: 20.
        threshold (float | Unset):  Default: 0.0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | SearchResponse]
     """


    kwargs = _get_kwargs(
        q=q,
brain=brain,
section=section,
type_=type_,
mode=mode,
limit=limit,
threshold=threshold,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient | Client,
    q: str,
    brain: str | Unset = UNSET,
    section: str | Unset = UNSET,
    type_: str | Unset = UNSET,
    mode: SemanticSearchVaultMode | Unset = SemanticSearchVaultMode.HYBRID,
    limit: int | Unset = 20,
    threshold: float | Unset = 0.0,

) -> Error | SearchResponse | None:
    """ Vector / hybrid semantic search.

    Args:
        q (str):
        brain (str | Unset):
        section (str | Unset):
        type_ (str | Unset):
        mode (SemanticSearchVaultMode | Unset):  Default: SemanticSearchVaultMode.HYBRID.
        limit (int | Unset):  Default: 20.
        threshold (float | Unset):  Default: 0.0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | SearchResponse
     """


    return sync_detailed(
        client=client,
q=q,
brain=brain,
section=section,
type_=type_,
mode=mode,
limit=limit,
threshold=threshold,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    q: str,
    brain: str | Unset = UNSET,
    section: str | Unset = UNSET,
    type_: str | Unset = UNSET,
    mode: SemanticSearchVaultMode | Unset = SemanticSearchVaultMode.HYBRID,
    limit: int | Unset = 20,
    threshold: float | Unset = 0.0,

) -> Response[Error | SearchResponse]:
    """ Vector / hybrid semantic search.

    Args:
        q (str):
        brain (str | Unset):
        section (str | Unset):
        type_ (str | Unset):
        mode (SemanticSearchVaultMode | Unset):  Default: SemanticSearchVaultMode.HYBRID.
        limit (int | Unset):  Default: 20.
        threshold (float | Unset):  Default: 0.0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | SearchResponse]
     """


    kwargs = _get_kwargs(
        q=q,
brain=brain,
section=section,
type_=type_,
mode=mode,
limit=limit,
threshold=threshold,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    q: str,
    brain: str | Unset = UNSET,
    section: str | Unset = UNSET,
    type_: str | Unset = UNSET,
    mode: SemanticSearchVaultMode | Unset = SemanticSearchVaultMode.HYBRID,
    limit: int | Unset = 20,
    threshold: float | Unset = 0.0,

) -> Error | SearchResponse | None:
    """ Vector / hybrid semantic search.

    Args:
        q (str):
        brain (str | Unset):
        section (str | Unset):
        type_ (str | Unset):
        mode (SemanticSearchVaultMode | Unset):  Default: SemanticSearchVaultMode.HYBRID.
        limit (int | Unset):  Default: 20.
        threshold (float | Unset):  Default: 0.0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | SearchResponse
     """


    return (await asyncio_detailed(
        client=client,
q=q,
brain=brain,
section=section,
type_=type_,
mode=mode,
limit=limit,
threshold=threshold,

    )).parsed
