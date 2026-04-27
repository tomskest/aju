from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.document_versions_list import DocumentVersionsList
from ...models.error import Error
from ...models.list_document_versions_direction import ListDocumentVersionsDirection
from ...types import UNSET, Unset
from dateutil.parser import isoparse
from typing import cast
import datetime



def _get_kwargs(
    *,
    brain: str | Unset = UNSET,
    path: str,
    limit: int | Unset = 50,
    cursor: datetime.datetime | Unset = UNSET,
    direction: ListDocumentVersionsDirection | Unset = ListDocumentVersionsDirection.NEWEST,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    params["brain"] = brain

    params["path"] = path

    params["limit"] = limit

    json_cursor: str | Unset = UNSET
    if not isinstance(cursor, Unset):
        json_cursor = cursor.isoformat()
    params["cursor"] = json_cursor

    json_direction: str | Unset = UNSET
    if not isinstance(direction, Unset):
        json_direction = direction.value

    params["direction"] = json_direction


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/vault/document/versions",
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> DocumentVersionsList | Error | None:
    if response.status_code == 200:
        response_200 = DocumentVersionsList.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[DocumentVersionsList | Error]:
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
    limit: int | Unset = 50,
    cursor: datetime.datetime | Unset = UNSET,
    direction: ListDocumentVersionsDirection | Unset = ListDocumentVersionsDirection.NEWEST,

) -> Response[DocumentVersionsList | Error]:
    """ List the version history of a document. Metadata only — fetch
    individual version bodies via /api/vault/document/version. Newest
    first by default.

    Args:
        brain (str | Unset):
        path (str):
        limit (int | Unset):  Default: 50.
        cursor (datetime.datetime | Unset):
        direction (ListDocumentVersionsDirection | Unset):  Default:
            ListDocumentVersionsDirection.NEWEST.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DocumentVersionsList | Error]
     """


    kwargs = _get_kwargs(
        brain=brain,
path=path,
limit=limit,
cursor=cursor,
direction=direction,

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
    limit: int | Unset = 50,
    cursor: datetime.datetime | Unset = UNSET,
    direction: ListDocumentVersionsDirection | Unset = ListDocumentVersionsDirection.NEWEST,

) -> DocumentVersionsList | Error | None:
    """ List the version history of a document. Metadata only — fetch
    individual version bodies via /api/vault/document/version. Newest
    first by default.

    Args:
        brain (str | Unset):
        path (str):
        limit (int | Unset):  Default: 50.
        cursor (datetime.datetime | Unset):
        direction (ListDocumentVersionsDirection | Unset):  Default:
            ListDocumentVersionsDirection.NEWEST.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DocumentVersionsList | Error
     """


    return sync_detailed(
        client=client,
brain=brain,
path=path,
limit=limit,
cursor=cursor,
direction=direction,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    brain: str | Unset = UNSET,
    path: str,
    limit: int | Unset = 50,
    cursor: datetime.datetime | Unset = UNSET,
    direction: ListDocumentVersionsDirection | Unset = ListDocumentVersionsDirection.NEWEST,

) -> Response[DocumentVersionsList | Error]:
    """ List the version history of a document. Metadata only — fetch
    individual version bodies via /api/vault/document/version. Newest
    first by default.

    Args:
        brain (str | Unset):
        path (str):
        limit (int | Unset):  Default: 50.
        cursor (datetime.datetime | Unset):
        direction (ListDocumentVersionsDirection | Unset):  Default:
            ListDocumentVersionsDirection.NEWEST.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DocumentVersionsList | Error]
     """


    kwargs = _get_kwargs(
        brain=brain,
path=path,
limit=limit,
cursor=cursor,
direction=direction,

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
    limit: int | Unset = 50,
    cursor: datetime.datetime | Unset = UNSET,
    direction: ListDocumentVersionsDirection | Unset = ListDocumentVersionsDirection.NEWEST,

) -> DocumentVersionsList | Error | None:
    """ List the version history of a document. Metadata only — fetch
    individual version bodies via /api/vault/document/version. Newest
    first by default.

    Args:
        brain (str | Unset):
        path (str):
        limit (int | Unset):  Default: 50.
        cursor (datetime.datetime | Unset):
        direction (ListDocumentVersionsDirection | Unset):  Default:
            ListDocumentVersionsDirection.NEWEST.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DocumentVersionsList | Error
     """


    return (await asyncio_detailed(
        client=client,
brain=brain,
path=path,
limit=limit,
cursor=cursor,
direction=direction,

    )).parsed
