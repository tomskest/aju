from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.create_document_defer_index import CreateDocumentDeferIndex
from ...models.document import Document
from ...models.document_write import DocumentWrite
from ...models.error import Error
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    *,
    body: DocumentWrite,
    brain: str | Unset = UNSET,
    defer_index: CreateDocumentDeferIndex | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}


    

    params: dict[str, Any] = {}

    params["brain"] = brain

    json_defer_index: str | Unset = UNSET
    if not isinstance(defer_index, Unset):
        json_defer_index = defer_index.value

    params["defer_index"] = json_defer_index


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/vault/create",
        "params": params,
    }

    _kwargs["json"] = body.to_dict()


    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Document | Error | None:
    if response.status_code == 201:
        response_201 = Document.from_dict(response.json())



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

    if response.status_code == 409:
        response_409 = Error.from_dict(response.json())



        return response_409

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
    body: DocumentWrite,
    brain: str | Unset = UNSET,
    defer_index: CreateDocumentDeferIndex | Unset = UNSET,

) -> Response[Document | Error]:
    """ Create a document.

    Args:
        brain (str | Unset):
        defer_index (CreateDocumentDeferIndex | Unset):
        body (DocumentWrite):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Document | Error]
     """


    kwargs = _get_kwargs(
        body=body,
brain=brain,
defer_index=defer_index,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient | Client,
    body: DocumentWrite,
    brain: str | Unset = UNSET,
    defer_index: CreateDocumentDeferIndex | Unset = UNSET,

) -> Document | Error | None:
    """ Create a document.

    Args:
        brain (str | Unset):
        defer_index (CreateDocumentDeferIndex | Unset):
        body (DocumentWrite):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Document | Error
     """


    return sync_detailed(
        client=client,
body=body,
brain=brain,
defer_index=defer_index,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: DocumentWrite,
    brain: str | Unset = UNSET,
    defer_index: CreateDocumentDeferIndex | Unset = UNSET,

) -> Response[Document | Error]:
    """ Create a document.

    Args:
        brain (str | Unset):
        defer_index (CreateDocumentDeferIndex | Unset):
        body (DocumentWrite):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Document | Error]
     """


    kwargs = _get_kwargs(
        body=body,
brain=brain,
defer_index=defer_index,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: DocumentWrite,
    brain: str | Unset = UNSET,
    defer_index: CreateDocumentDeferIndex | Unset = UNSET,

) -> Document | Error | None:
    """ Create a document.

    Args:
        brain (str | Unset):
        defer_index (CreateDocumentDeferIndex | Unset):
        body (DocumentWrite):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Document | Error
     """


    return (await asyncio_detailed(
        client=client,
body=body,
brain=brain,
defer_index=defer_index,

    )).parsed
