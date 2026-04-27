from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.document_version import DocumentVersion
from ...models.error import Error
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    *,
    brain: str | Unset = UNSET,
    path: str,
    n: int | Unset = UNSET,
    hash_: str | Unset = UNSET,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    params["brain"] = brain

    params["path"] = path

    params["n"] = n

    params["hash"] = hash_


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/vault/document/version",
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> DocumentVersion | Error | None:
    if response.status_code == 200:
        response_200 = DocumentVersion.from_dict(response.json())



        return response_200

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())



        return response_400

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())



        return response_401

    if response.status_code == 404:
        response_404 = Error.from_dict(response.json())



        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[DocumentVersion | Error]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    brain: str | Unset = UNSET,
    path: str,
    n: int | Unset = UNSET,
    hash_: str | Unset = UNSET,

) -> Response[DocumentVersion | Error]:
    """ Fetch a single historical version of a document, including its
    full content. Address by either `n` (versionN) or `hash` (contentHash).

    Args:
        brain (str | Unset):
        path (str):
        n (int | Unset):
        hash_ (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DocumentVersion | Error]
     """


    kwargs = _get_kwargs(
        brain=brain,
path=path,
n=n,
hash_=hash_,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient | Client,
    brain: str | Unset = UNSET,
    path: str,
    n: int | Unset = UNSET,
    hash_: str | Unset = UNSET,

) -> DocumentVersion | Error | None:
    """ Fetch a single historical version of a document, including its
    full content. Address by either `n` (versionN) or `hash` (contentHash).

    Args:
        brain (str | Unset):
        path (str):
        n (int | Unset):
        hash_ (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DocumentVersion | Error
     """


    return sync_detailed(
        client=client,
brain=brain,
path=path,
n=n,
hash_=hash_,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    brain: str | Unset = UNSET,
    path: str,
    n: int | Unset = UNSET,
    hash_: str | Unset = UNSET,

) -> Response[DocumentVersion | Error]:
    """ Fetch a single historical version of a document, including its
    full content. Address by either `n` (versionN) or `hash` (contentHash).

    Args:
        brain (str | Unset):
        path (str):
        n (int | Unset):
        hash_ (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DocumentVersion | Error]
     """


    kwargs = _get_kwargs(
        brain=brain,
path=path,
n=n,
hash_=hash_,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    brain: str | Unset = UNSET,
    path: str,
    n: int | Unset = UNSET,
    hash_: str | Unset = UNSET,

) -> DocumentVersion | Error | None:
    """ Fetch a single historical version of a document, including its
    full content. Address by either `n` (versionN) or `hash` (contentHash).

    Args:
        brain (str | Unset):
        path (str):
        n (int | Unset):
        hash_ (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DocumentVersion | Error
     """


    return (await asyncio_detailed(
        client=client,
brain=brain,
path=path,
n=n,
hash_=hash_,

    )).parsed
