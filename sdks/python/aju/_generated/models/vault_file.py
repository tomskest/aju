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






T = TypeVar("T", bound="VaultFile")



@_attrs_define
class VaultFile:
    """ 
        Attributes:
            id (str):
            filename (str):
            mime_type (str):
            brain_id (str | Unset):
            size_bytes (int | Unset):
            category (None | str | Unset):
            tags (list[str] | Unset):
            s_3_key (str | Unset):
            created_at (datetime.datetime | Unset):
            updated_at (datetime.datetime | Unset):
     """

    id: str
    filename: str
    mime_type: str
    brain_id: str | Unset = UNSET
    size_bytes: int | Unset = UNSET
    category: None | str | Unset = UNSET
    tags: list[str] | Unset = UNSET
    s_3_key: str | Unset = UNSET
    created_at: datetime.datetime | Unset = UNSET
    updated_at: datetime.datetime | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        id = self.id

        filename = self.filename

        mime_type = self.mime_type

        brain_id = self.brain_id

        size_bytes = self.size_bytes

        category: None | str | Unset
        if isinstance(self.category, Unset):
            category = UNSET
        else:
            category = self.category

        tags: list[str] | Unset = UNSET
        if not isinstance(self.tags, Unset):
            tags = self.tags



        s_3_key = self.s_3_key

        created_at: str | Unset = UNSET
        if not isinstance(self.created_at, Unset):
            created_at = self.created_at.isoformat()

        updated_at: str | Unset = UNSET
        if not isinstance(self.updated_at, Unset):
            updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "filename": filename,
            "mimeType": mime_type,
        })
        if brain_id is not UNSET:
            field_dict["brainId"] = brain_id
        if size_bytes is not UNSET:
            field_dict["sizeBytes"] = size_bytes
        if category is not UNSET:
            field_dict["category"] = category
        if tags is not UNSET:
            field_dict["tags"] = tags
        if s_3_key is not UNSET:
            field_dict["s3Key"] = s_3_key
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at
        if updated_at is not UNSET:
            field_dict["updatedAt"] = updated_at

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        filename = d.pop("filename")

        mime_type = d.pop("mimeType")

        brain_id = d.pop("brainId", UNSET)

        size_bytes = d.pop("sizeBytes", UNSET)

        def _parse_category(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        category = _parse_category(d.pop("category", UNSET))


        tags = cast(list[str], d.pop("tags", UNSET))


        s_3_key = d.pop("s3Key", UNSET)

        _created_at = d.pop("createdAt", UNSET)
        created_at: datetime.datetime | Unset
        if isinstance(_created_at,  Unset):
            created_at = UNSET
        else:
            created_at = isoparse(_created_at)




        _updated_at = d.pop("updatedAt", UNSET)
        updated_at: datetime.datetime | Unset
        if isinstance(_updated_at,  Unset):
            updated_at = UNSET
        else:
            updated_at = isoparse(_updated_at)




        vault_file = cls(
            id=id,
            filename=filename,
            mime_type=mime_type,
            brain_id=brain_id,
            size_bytes=size_bytes,
            category=category,
            tags=tags,
            s_3_key=s_3_key,
            created_at=created_at,
            updated_at=updated_at,
        )


        vault_file.additional_properties = d
        return vault_file

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
