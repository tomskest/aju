from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error import Error
from ...models.related_documents_response_200 import RelatedDocumentsResponse200
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    *,
    brain: str | Unset = UNSET,
    path: str,
    limit: int | Unset = 20,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    params["brain"] = brain

    params["path"] = path

    params["limit"] = limit


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/vault/related",
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Error | RelatedDocumentsResponse200 | None:
    if response.status_code == 200:
        response_200 = RelatedDocumentsResponse200.from_dict(response.json())



        return response_200

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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Error | RelatedDocumentsResponse200]:
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
    limit: int | Unset = 20,

) -> Response[Error | RelatedDocumentsResponse200]:
    """ Documents related to a given document by outgoing/incoming links and tag overlap.

    Args:
        brain (str | Unset):
        path (str):
        limit (int | Unset):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | RelatedDocumentsResponse200]
     """


    kwargs = _get_kwargs(
        brain=brain,
path=path,
limit=limit,

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
    limit: int | Unset = 20,

) -> Error | RelatedDocumentsResponse200 | None:
    """ Documents related to a given document by outgoing/incoming links and tag overlap.

    Args:
        brain (str | Unset):
        path (str):
        limit (int | Unset):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | RelatedDocumentsResponse200
     """


    return sync_detailed(
        client=client,
brain=brain,
path=path,
limit=limit,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    brain: str | Unset = UNSET,
    path: str,
    limit: int | Unset = 20,

) -> Response[Error | RelatedDocumentsResponse200]:
    """ Documents related to a given document by outgoing/incoming links and tag overlap.

    Args:
        brain (str | Unset):
        path (str):
        limit (int | Unset):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | RelatedDocumentsResponse200]
     """


    kwargs = _get_kwargs(
        brain=brain,
path=path,
limit=limit,

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
    limit: int | Unset = 20,

) -> Error | RelatedDocumentsResponse200 | None:
    """ Documents related to a given document by outgoing/incoming links and tag overlap.

    Args:
        brain (str | Unset):
        path (str):
        limit (int | Unset):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | RelatedDocumentsResponse200
     """


    return (await asyncio_detailed(
        client=client,
brain=brain,
path=path,
limit=limit,

    )).parsed
