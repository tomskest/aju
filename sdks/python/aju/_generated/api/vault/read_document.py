from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.document import Document
from ...models.error import Error
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    *,
    brain: str | Unset = UNSET,
    path: str,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    params["brain"] = brain

    params["path"] = path


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/vault/document",
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Document | Error | None:
    if response.status_code == 200:
        response_200 = Document.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Document | Error]:
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

) -> Response[Document | Error]:
    """ Read a single document by path.

    Args:
        brain (str | Unset):
        path (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Document | Error]
     """


    kwargs = _get_kwargs(
        brain=brain,
path=path,

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

) -> Document | Error | None:
    """ Read a single document by path.

    Args:
        brain (str | Unset):
        path (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Document | Error
     """


    return sync_detailed(
        client=client,
brain=brain,
path=path,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    brain: str | Unset = UNSET,
    path: str,

) -> Response[Document | Error]:
    """ Read a single document by path.

    Args:
        brain (str | Unset):
        path (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Document | Error]
     """


    kwargs = _get_kwargs(
        brain=brain,
path=path,

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

) -> Document | Error | None:
    """ Read a single document by path.

    Args:
        brain (str | Unset):
        path (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Document | Error
     """


    return (await asyncio_detailed(
        client=client,
brain=brain,
path=path,

    )).parsed
