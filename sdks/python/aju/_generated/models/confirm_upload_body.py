from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="ConfirmUploadBody")



@_attrs_define
class ConfirmUploadBody:
    """ 
        Attributes:
            key (str):
            filename (str):
            mime_type (str):
            size_bytes (int | Unset):
            category (str | Unset):
     """

    key: str
    filename: str
    mime_type: str
    size_bytes: int | Unset = UNSET
    category: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        key = self.key

        filename = self.filename

        mime_type = self.mime_type

        size_bytes = self.size_bytes

        category = self.category


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "key": key,
            "filename": filename,
            "mimeType": mime_type,
        })
        if size_bytes is not UNSET:
            field_dict["sizeBytes"] = size_bytes
        if category is not UNSET:
            field_dict["category"] = category

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        key = d.pop("key")

        filename = d.pop("filename")

        mime_type = d.pop("mimeType")

        size_bytes = d.pop("sizeBytes", UNSET)

        category = d.pop("category", UNSET)

        confirm_upload_body = cls(
            key=key,
            filename=filename,
            mime_type=mime_type,
            size_bytes=size_bytes,
            category=category,
        )


        confirm_upload_body.additional_properties = d
        return confirm_upload_body

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
