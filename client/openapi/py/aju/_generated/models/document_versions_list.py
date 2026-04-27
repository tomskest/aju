from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.document_versions_list_direction import DocumentVersionsListDirection
from ..types import UNSET, Unset
from dateutil.parser import isoparse
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.document_version_meta import DocumentVersionMeta





T = TypeVar("T", bound="DocumentVersionsList")



@_attrs_define
class DocumentVersionsList:
    """ 
        Attributes:
            path (str):
            head_hash (str): contentHash of the document's current head.
            direction (DocumentVersionsListDirection):
            versions (list[DocumentVersionMeta]):
            next_cursor (datetime.datetime | None | Unset):
     """

    path: str
    head_hash: str
    direction: DocumentVersionsListDirection
    versions: list[DocumentVersionMeta]
    next_cursor: datetime.datetime | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.document_version_meta import DocumentVersionMeta
        path = self.path

        head_hash = self.head_hash

        direction = self.direction.value

        versions = []
        for versions_item_data in self.versions:
            versions_item = versions_item_data.to_dict()
            versions.append(versions_item)



        next_cursor: None | str | Unset
        if isinstance(self.next_cursor, Unset):
            next_cursor = UNSET
        elif isinstance(self.next_cursor, datetime.datetime):
            next_cursor = self.next_cursor.isoformat()
        else:
            next_cursor = self.next_cursor


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "path": path,
            "headHash": head_hash,
            "direction": direction,
            "versions": versions,
        })
        if next_cursor is not UNSET:
            field_dict["nextCursor"] = next_cursor

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.document_version_meta import DocumentVersionMeta
        d = dict(src_dict)
        path = d.pop("path")

        head_hash = d.pop("headHash")

        direction = DocumentVersionsListDirection(d.pop("direction"))




        versions = []
        _versions = d.pop("versions")
        for versions_item_data in (_versions):
            versions_item = DocumentVersionMeta.from_dict(versions_item_data)



            versions.append(versions_item)


        def _parse_next_cursor(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                next_cursor_type_0 = isoparse(data)



                return next_cursor_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        next_cursor = _parse_next_cursor(d.pop("nextCursor", UNSET))


        document_versions_list = cls(
            path=path,
            head_hash=head_hash,
            direction=direction,
            versions=versions,
            next_cursor=next_cursor,
        )


        document_versions_list.additional_properties = d
        return document_versions_list

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
