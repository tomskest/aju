from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.document_summary import DocumentSummary





T = TypeVar("T", bound="BacklinksResponse200")



@_attrs_define
class BacklinksResponse200:
    """ 
        Attributes:
            backlinks (list[DocumentSummary] | Unset):
     """

    backlinks: list[DocumentSummary] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.document_summary import DocumentSummary
        backlinks: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.backlinks, Unset):
            backlinks = []
            for backlinks_item_data in self.backlinks:
                backlinks_item = backlinks_item_data.to_dict()
                backlinks.append(backlinks_item)




        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if backlinks is not UNSET:
            field_dict["backlinks"] = backlinks

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.document_summary import DocumentSummary
        d = dict(src_dict)
        _backlinks = d.pop("backlinks", UNSET)
        backlinks: list[DocumentSummary] | Unset = UNSET
        if _backlinks is not UNSET:
            backlinks = []
            for backlinks_item_data in _backlinks:
                backlinks_item = DocumentSummary.from_dict(backlinks_item_data)



                backlinks.append(backlinks_item)


        backlinks_response_200 = cls(
            backlinks=backlinks,
        )


        backlinks_response_200.additional_properties = d
        return backlinks_response_200

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
