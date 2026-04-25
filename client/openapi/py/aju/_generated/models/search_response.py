from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.search_result import SearchResult





T = TypeVar("T", bound="SearchResponse")



@_attrs_define
class SearchResponse:
    """ 
        Attributes:
            query (str):
            count (int):
            results (list[SearchResult]):
            brains (list[str] | Unset):
     """

    query: str
    count: int
    results: list[SearchResult]
    brains: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.search_result import SearchResult
        query = self.query

        count = self.count

        results = []
        for results_item_data in self.results:
            results_item = results_item_data.to_dict()
            results.append(results_item)



        brains: list[str] | Unset = UNSET
        if not isinstance(self.brains, Unset):
            brains = self.brains




        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "query": query,
            "count": count,
            "results": results,
        })
        if brains is not UNSET:
            field_dict["brains"] = brains

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.search_result import SearchResult
        d = dict(src_dict)
        query = d.pop("query")

        count = d.pop("count")

        results = []
        _results = d.pop("results")
        for results_item_data in (_results):
            results_item = SearchResult.from_dict(results_item_data)



            results.append(results_item)


        brains = cast(list[str], d.pop("brains", UNSET))


        search_response = cls(
            query=query,
            count=count,
            results=results,
            brains=brains,
        )


        search_response.additional_properties = d
        return search_response

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
