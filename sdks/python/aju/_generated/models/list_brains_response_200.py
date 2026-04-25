from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.brain import Brain





T = TypeVar("T", bound="ListBrainsResponse200")



@_attrs_define
class ListBrainsResponse200:
    """ 
        Attributes:
            brains (list[Brain]):
     """

    brains: list[Brain]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.brain import Brain
        brains = []
        for brains_item_data in self.brains:
            brains_item = brains_item_data.to_dict()
            brains.append(brains_item)




        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "brains": brains,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.brain import Brain
        d = dict(src_dict)
        brains = []
        _brains = d.pop("brains")
        for brains_item_data in (_brains):
            brains_item = Brain.from_dict(brains_item_data)



            brains.append(brains_item)


        list_brains_response_200 = cls(
            brains=brains,
        )


        list_brains_response_200.additional_properties = d
        return list_brains_response_200

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
