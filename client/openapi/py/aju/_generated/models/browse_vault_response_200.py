from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.document_summary import DocumentSummary





T = TypeVar("T", bound="BrowseVaultResponse200")



@_attrs_define
class BrowseVaultResponse200:
    """ 
        Attributes:
            count (int):
            documents (list[DocumentSummary]):
     """

    count: int
    documents: list[DocumentSummary]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.document_summary import DocumentSummary
        count = self.count

        documents = []
        for documents_item_data in self.documents:
            documents_item = documents_item_data.to_dict()
            documents.append(documents_item)




        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "count": count,
            "documents": documents,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.document_summary import DocumentSummary
        d = dict(src_dict)
        count = d.pop("count")

        documents = []
        _documents = d.pop("documents")
        for documents_item_data in (_documents):
            documents_item = DocumentSummary.from_dict(documents_item_data)



            documents.append(documents_item)


        browse_vault_response_200 = cls(
            count=count,
            documents=documents,
        )


        browse_vault_response_200.additional_properties = d
        return browse_vault_response_200

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
