from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.brain_role import BrainRole
from ..models.brain_type import BrainType
from ..types import UNSET, Unset
from dateutil.parser import isoparse
from typing import cast
import datetime






T = TypeVar("T", bound="Brain")



@_attrs_define
class Brain:
    """ 
        Attributes:
            id (str):
            name (str):
            type_ (BrainType):
            role (BrainRole | Unset):
            document_count (int | Unset):
            created_at (datetime.datetime | Unset):
     """

    id: str
    name: str
    type_: BrainType
    role: BrainRole | Unset = UNSET
    document_count: int | Unset = UNSET
    created_at: datetime.datetime | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        type_ = self.type_.value

        role: str | Unset = UNSET
        if not isinstance(self.role, Unset):
            role = self.role.value


        document_count = self.document_count

        created_at: str | Unset = UNSET
        if not isinstance(self.created_at, Unset):
            created_at = self.created_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "name": name,
            "type": type_,
        })
        if role is not UNSET:
            field_dict["role"] = role
        if document_count is not UNSET:
            field_dict["documentCount"] = document_count
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        type_ = BrainType(d.pop("type"))




        _role = d.pop("role", UNSET)
        role: BrainRole | Unset
        if isinstance(_role,  Unset):
            role = UNSET
        else:
            role = BrainRole(_role)




        document_count = d.pop("documentCount", UNSET)

        _created_at = d.pop("createdAt", UNSET)
        created_at: datetime.datetime | Unset
        if isinstance(_created_at,  Unset):
            created_at = UNSET
        else:
            created_at = isoparse(_created_at)




        brain = cls(
            id=id,
            name=name,
            type_=type_,
            role=role,
            document_count=document_count,
            created_at=created_at,
        )


        brain.additional_properties = d
        return brain

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
