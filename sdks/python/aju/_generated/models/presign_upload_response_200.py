from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.presign_upload_response_200_headers import PresignUploadResponse200Headers





T = TypeVar("T", bound="PresignUploadResponse200")



@_attrs_define
class PresignUploadResponse200:
    """ 
        Attributes:
            upload_url (str | Unset):
            key (str | Unset):
            headers (PresignUploadResponse200Headers | Unset):
     """

    upload_url: str | Unset = UNSET
    key: str | Unset = UNSET
    headers: PresignUploadResponse200Headers | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.presign_upload_response_200_headers import PresignUploadResponse200Headers
        upload_url = self.upload_url

        key = self.key

        headers: dict[str, Any] | Unset = UNSET
        if not isinstance(self.headers, Unset):
            headers = self.headers.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if upload_url is not UNSET:
            field_dict["uploadUrl"] = upload_url
        if key is not UNSET:
            field_dict["key"] = key
        if headers is not UNSET:
            field_dict["headers"] = headers

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.presign_upload_response_200_headers import PresignUploadResponse200Headers
        d = dict(src_dict)
        upload_url = d.pop("uploadUrl", UNSET)

        key = d.pop("key", UNSET)

        _headers = d.pop("headers", UNSET)
        headers: PresignUploadResponse200Headers | Unset
        if isinstance(_headers,  Unset):
            headers = UNSET
        else:
            headers = PresignUploadResponse200Headers.from_dict(_headers)




        presign_upload_response_200 = cls(
            upload_url=upload_url,
            key=key,
            headers=headers,
        )


        presign_upload_response_200.additional_properties = d
        return presign_upload_response_200

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
