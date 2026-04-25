from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error import Error
from ...models.vault_file_with_download_url import VaultFileWithDownloadUrl
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    *,
    brain: str | Unset = UNSET,
    id: str,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    params["brain"] = brain

    params["id"] = id


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/vault/files/read",
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Error | VaultFileWithDownloadUrl | None:
    if response.status_code == 200:
        response_200 = VaultFileWithDownloadUrl.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Error | VaultFileWithDownloadUrl]:
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
    id: str,

) -> Response[Error | VaultFileWithDownloadUrl]:
    """ Get a file's metadata and a short-lived download URL.

    Args:
        brain (str | Unset):
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | VaultFileWithDownloadUrl]
     """


    kwargs = _get_kwargs(
        brain=brain,
id=id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient | Client,
    brain: str | Unset = UNSET,
    id: str,

) -> Error | VaultFileWithDownloadUrl | None:
    """ Get a file's metadata and a short-lived download URL.

    Args:
        brain (str | Unset):
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | VaultFileWithDownloadUrl
     """


    return sync_detailed(
        client=client,
brain=brain,
id=id,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    brain: str | Unset = UNSET,
    id: str,

) -> Response[Error | VaultFileWithDownloadUrl]:
    """ Get a file's metadata and a short-lived download URL.

    Args:
        brain (str | Unset):
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | VaultFileWithDownloadUrl]
     """


    kwargs = _get_kwargs(
        brain=brain,
id=id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    brain: str | Unset = UNSET,
    id: str,

) -> Error | VaultFileWithDownloadUrl | None:
    """ Get a file's metadata and a short-lived download URL.

    Args:
        brain (str | Unset):
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | VaultFileWithDownloadUrl
     """


    return (await asyncio_detailed(
        client=client,
brain=brain,
id=id,

    )).parsed
