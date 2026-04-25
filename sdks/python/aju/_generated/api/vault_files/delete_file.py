from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.delete_file_body import DeleteFileBody
from ...models.delete_file_response_200 import DeleteFileResponse200
from ...models.error import Error
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    *,
    body: DeleteFileBody,
    brain: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}


    

    params: dict[str, Any] = {}

    params["brain"] = brain


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/vault/files/delete",
        "params": params,
    }

    _kwargs["json"] = body.to_dict()


    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> DeleteFileResponse200 | Error | None:
    if response.status_code == 200:
        response_200 = DeleteFileResponse200.from_dict(response.json())



        return response_200

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())



        return response_401

    if response.status_code == 403:
        response_403 = Error.from_dict(response.json())



        return response_403

    if response.status_code == 404:
        response_404 = Error.from_dict(response.json())



        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[DeleteFileResponse200 | Error]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: DeleteFileBody,
    brain: str | Unset = UNSET,

) -> Response[DeleteFileResponse200 | Error]:
    """ Delete a file by id.

    Args:
        brain (str | Unset):
        body (DeleteFileBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteFileResponse200 | Error]
     """


    kwargs = _get_kwargs(
        body=body,
brain=brain,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient | Client,
    body: DeleteFileBody,
    brain: str | Unset = UNSET,

) -> DeleteFileResponse200 | Error | None:
    """ Delete a file by id.

    Args:
        brain (str | Unset):
        body (DeleteFileBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteFileResponse200 | Error
     """


    return sync_detailed(
        client=client,
body=body,
brain=brain,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: DeleteFileBody,
    brain: str | Unset = UNSET,

) -> Response[DeleteFileResponse200 | Error]:
    """ Delete a file by id.

    Args:
        brain (str | Unset):
        body (DeleteFileBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteFileResponse200 | Error]
     """


    kwargs = _get_kwargs(
        body=body,
brain=brain,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: DeleteFileBody,
    brain: str | Unset = UNSET,

) -> DeleteFileResponse200 | Error | None:
    """ Delete a file by id.

    Args:
        brain (str | Unset):
        body (DeleteFileBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteFileResponse200 | Error
     """


    return (await asyncio_detailed(
        client=client,
body=body,
brain=brain,

    )).parsed
