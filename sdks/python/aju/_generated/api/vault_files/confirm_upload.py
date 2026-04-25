from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.confirm_upload_body import ConfirmUploadBody
from ...models.error import Error
from ...models.vault_file import VaultFile
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    *,
    body: ConfirmUploadBody,
    brain: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}


    

    params: dict[str, Any] = {}

    params["brain"] = brain


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/vault/files/confirm-upload",
        "params": params,
    }

    _kwargs["json"] = body.to_dict()


    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Error | VaultFile | None:
    if response.status_code == 201:
        response_201 = VaultFile.from_dict(response.json())



        return response_201

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())



        return response_400

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())



        return response_401

    if response.status_code == 403:
        response_403 = Error.from_dict(response.json())



        return response_403

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Error | VaultFile]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: ConfirmUploadBody,
    brain: str | Unset = UNSET,

) -> Response[Error | VaultFile]:
    """ Finalize an upload after the client PUTs to the presigned URL.

    Args:
        brain (str | Unset):
        body (ConfirmUploadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | VaultFile]
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
    body: ConfirmUploadBody,
    brain: str | Unset = UNSET,

) -> Error | VaultFile | None:
    """ Finalize an upload after the client PUTs to the presigned URL.

    Args:
        brain (str | Unset):
        body (ConfirmUploadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | VaultFile
     """


    return sync_detailed(
        client=client,
body=body,
brain=brain,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: ConfirmUploadBody,
    brain: str | Unset = UNSET,

) -> Response[Error | VaultFile]:
    """ Finalize an upload after the client PUTs to the presigned URL.

    Args:
        brain (str | Unset):
        body (ConfirmUploadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | VaultFile]
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
    body: ConfirmUploadBody,
    brain: str | Unset = UNSET,

) -> Error | VaultFile | None:
    """ Finalize an upload after the client PUTs to the presigned URL.

    Args:
        brain (str | Unset):
        body (ConfirmUploadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | VaultFile
     """


    return (await asyncio_detailed(
        client=client,
body=body,
brain=brain,

    )).parsed
