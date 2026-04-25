from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.related_document import RelatedDocument





T = TypeVar("T", bound="RelatedDocumentsResponse200")



@_attrs_define
class RelatedDocumentsResponse200:
    """ 
        Attributes:
            related (list[RelatedDocument] | Unset):
     """

    related: list[RelatedDocument] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.related_document import RelatedDocument
        related: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.related, Unset):
            related = []
            for related_item_data in self.related:
                related_item = related_item_data.to_dict()
                related.append(related_item)




        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if related is not UNSET:
            field_dict["related"] = related

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.related_document import RelatedDocument
        d = dict(src_dict)
        _related = d.pop("related", UNSET)
        related: list[RelatedDocument] | Unset = UNSET
        if _related is not UNSET:
            related = []
            for related_item_data in _related:
                related_item = RelatedDocument.from_dict(related_item_data)



                related.append(related_item)


        related_documents_response_200 = cls(
            related=related,
        )


        related_documents_response_200.additional_properties = d
        return related_documents_response_200

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
