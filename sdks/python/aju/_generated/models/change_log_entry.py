from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.change_log_entry_operation import ChangeLogEntryOperation
from ..types import UNSET, Unset
from dateutil.parser import isoparse
from typing import cast
import datetime






T = TypeVar("T", bound="ChangeLogEntry")



@_attrs_define
class ChangeLogEntry:
    """ 
        Attributes:
            id (str | Unset):
            brain_id (str | Unset):
            document_id (None | str | Unset):
            path (str | Unset):
            operation (ChangeLogEntryOperation | Unset):
            source (str | Unset):
            changed_by (str | Unset):
            created_at (datetime.datetime | Unset):
     """

    id: str | Unset = UNSET
    brain_id: str | Unset = UNSET
    document_id: None | str | Unset = UNSET
    path: str | Unset = UNSET
    operation: ChangeLogEntryOperation | Unset = UNSET
    source: str | Unset = UNSET
    changed_by: str | Unset = UNSET
    created_at: datetime.datetime | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        id = self.id

        brain_id = self.brain_id

        document_id: None | str | Unset
        if isinstance(self.document_id, Unset):
            document_id = UNSET
        else:
            document_id = self.document_id

        path = self.path

        operation: str | Unset = UNSET
        if not isinstance(self.operation, Unset):
            operation = self.operation.value


        source = self.source

        changed_by = self.changed_by

        created_at: str | Unset = UNSET
        if not isinstance(self.created_at, Unset):
            created_at = self.created_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if id is not UNSET:
            field_dict["id"] = id
        if brain_id is not UNSET:
            field_dict["brainId"] = brain_id
        if document_id is not UNSET:
            field_dict["documentId"] = document_id
        if path is not UNSET:
            field_dict["path"] = path
        if operation is not UNSET:
            field_dict["operation"] = operation
        if source is not UNSET:
            field_dict["source"] = source
        if changed_by is not UNSET:
            field_dict["changedBy"] = changed_by
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id", UNSET)

        brain_id = d.pop("brainId", UNSET)

        def _parse_document_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        document_id = _parse_document_id(d.pop("documentId", UNSET))


        path = d.pop("path", UNSET)

        _operation = d.pop("operation", UNSET)
        operation: ChangeLogEntryOperation | Unset
        if isinstance(_operation,  Unset):
            operation = UNSET
        else:
            operation = ChangeLogEntryOperation(_operation)




        source = d.pop("source", UNSET)

        changed_by = d.pop("changedBy", UNSET)

        _created_at = d.pop("createdAt", UNSET)
        created_at: datetime.datetime | Unset
        if isinstance(_created_at,  Unset):
            created_at = UNSET
        else:
            created_at = isoparse(_created_at)




        change_log_entry = cls(
            id=id,
            brain_id=brain_id,
            document_id=document_id,
            path=path,
            operation=operation,
            source=source,
            changed_by=changed_by,
            created_at=created_at,
        )


        change_log_entry.additional_properties = d
        return change_log_entry

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
