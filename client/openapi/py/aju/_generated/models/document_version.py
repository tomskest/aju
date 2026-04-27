from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from dateutil.parser import isoparse
from typing import cast
import datetime






T = TypeVar("T", bound="DocumentVersion")



@_attrs_define
class DocumentVersion:
    """ A single historical version with its full content. The hash echoed
    as `contentHash` is the SHA-256 you can re-submit to /api/vault/update
    as `baseHash` to rebase a write onto this version.

        Attributes:
            id (str):
            path (str):
            version_n (int):
            content (str):
            content_hash (str):
            source (str):
            created_at (datetime.datetime):
            parent_hash (None | str | Unset):
            merge_parent_hash (None | str | Unset):
            changed_by (None | str | Unset):
            message (None | str | Unset):
     """

    id: str
    path: str
    version_n: int
    content: str
    content_hash: str
    source: str
    created_at: datetime.datetime
    parent_hash: None | str | Unset = UNSET
    merge_parent_hash: None | str | Unset = UNSET
    changed_by: None | str | Unset = UNSET
    message: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        id = self.id

        path = self.path

        version_n = self.version_n

        content = self.content

        content_hash = self.content_hash

        source = self.source

        created_at = self.created_at.isoformat()

        parent_hash: None | str | Unset
        if isinstance(self.parent_hash, Unset):
            parent_hash = UNSET
        else:
            parent_hash = self.parent_hash

        merge_parent_hash: None | str | Unset
        if isinstance(self.merge_parent_hash, Unset):
            merge_parent_hash = UNSET
        else:
            merge_parent_hash = self.merge_parent_hash

        changed_by: None | str | Unset
        if isinstance(self.changed_by, Unset):
            changed_by = UNSET
        else:
            changed_by = self.changed_by

        message: None | str | Unset
        if isinstance(self.message, Unset):
            message = UNSET
        else:
            message = self.message


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "path": path,
            "versionN": version_n,
            "content": content,
            "contentHash": content_hash,
            "source": source,
            "createdAt": created_at,
        })
        if parent_hash is not UNSET:
            field_dict["parentHash"] = parent_hash
        if merge_parent_hash is not UNSET:
            field_dict["mergeParentHash"] = merge_parent_hash
        if changed_by is not UNSET:
            field_dict["changedBy"] = changed_by
        if message is not UNSET:
            field_dict["message"] = message

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        path = d.pop("path")

        version_n = d.pop("versionN")

        content = d.pop("content")

        content_hash = d.pop("contentHash")

        source = d.pop("source")

        created_at = isoparse(d.pop("createdAt"))




        def _parse_parent_hash(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        parent_hash = _parse_parent_hash(d.pop("parentHash", UNSET))


        def _parse_merge_parent_hash(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        merge_parent_hash = _parse_merge_parent_hash(d.pop("mergeParentHash", UNSET))


        def _parse_changed_by(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        changed_by = _parse_changed_by(d.pop("changedBy", UNSET))


        def _parse_message(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        message = _parse_message(d.pop("message", UNSET))


        document_version = cls(
            id=id,
            path=path,
            version_n=version_n,
            content=content,
            content_hash=content_hash,
            source=source,
            created_at=created_at,
            parent_hash=parent_hash,
            merge_parent_hash=merge_parent_hash,
            changed_by=changed_by,
            message=message,
        )


        document_version.additional_properties = d
        return document_version

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
