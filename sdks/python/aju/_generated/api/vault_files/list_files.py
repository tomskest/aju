from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error import Error
from ...models.list_files_response_200 import ListFilesResponse200
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    *,
    brain: str | Unset = UNSET,
    directory: str | Unset = UNSET,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    params["brain"] = brain

    params["directory"] = directory


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/vault/files/list",
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Error | ListFilesResponse200 | None:
    if response.status_code == 200:
        response_200 = ListFilesResponse200.from_dict(response.json())



        return response_200

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())



        return response_401

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Error | ListFilesResponse200]:
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
    directory: str | Unset = UNSET,

) -> Response[Error | ListFilesResponse200]:
    """ List binary files in a brain.

    Args:
        brain (str | Unset):
        directory (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | ListFilesResponse200]
     """


    kwargs = _get_kwargs(
        brain=brain,
directory=directory,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient | Client,
    brain: str | Unset = UNSET,
    directory: str | Unset = UNSET,

) -> Error | ListFilesResponse200 | None:
    """ List binary files in a brain.

    Args:
        brain (str | Unset):
        directory (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | ListFilesResponse200
     """


    return sync_detailed(
        client=client,
brain=brain,
directory=directory,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    brain: str | Unset = UNSET,
    directory: str | Unset = UNSET,

) -> Response[Error | ListFilesResponse200]:
    """ List binary files in a brain.

    Args:
        brain (str | Unset):
        directory (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | ListFilesResponse200]
     """


    kwargs = _get_kwargs(
        brain=brain,
directory=directory,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    brain: str | Unset = UNSET,
    directory: str | Unset = UNSET,

) -> Error | ListFilesResponse200 | None:
    """ List binary files in a brain.

    Args:
        brain (str | Unset):
        directory (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | ListFilesResponse200
     """


    return (await asyncio_detailed(
        client=client,
brain=brain,
directory=directory,

    )).parsed
