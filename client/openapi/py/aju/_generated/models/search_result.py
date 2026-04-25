from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.search_result_source_type import SearchResultSourceType
from ..types import UNSET, Unset
from typing import cast






T = TypeVar("T", bound="SearchResult")



@_attrs_define
class SearchResult:
    """ 
        Attributes:
            id (str):
            path (str):
            title (str):
            section (None | str | Unset):
            doc_type (None | str | Unset):
            doc_status (None | str | Unset):
            tags (list[str] | Unset):
            word_count (int | Unset):
            source_type (SearchResultSourceType | Unset):
            mime_type (None | str | Unset):
            brain (None | str | Unset):
            rank (float | Unset):
            snippet (str | Unset):
     """

    id: str
    path: str
    title: str
    section: None | str | Unset = UNSET
    doc_type: None | str | Unset = UNSET
    doc_status: None | str | Unset = UNSET
    tags: list[str] | Unset = UNSET
    word_count: int | Unset = UNSET
    source_type: SearchResultSourceType | Unset = UNSET
    mime_type: None | str | Unset = UNSET
    brain: None | str | Unset = UNSET
    rank: float | Unset = UNSET
    snippet: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        id = self.id

        path = self.path

        title = self.title

        section: None | str | Unset
        if isinstance(self.section, Unset):
            section = UNSET
        else:
            section = self.section

        doc_type: None | str | Unset
        if isinstance(self.doc_type, Unset):
            doc_type = UNSET
        else:
            doc_type = self.doc_type

        doc_status: None | str | Unset
        if isinstance(self.doc_status, Unset):
            doc_status = UNSET
        else:
            doc_status = self.doc_status

        tags: list[str] | Unset = UNSET
        if not isinstance(self.tags, Unset):
            tags = self.tags



        word_count = self.word_count

        source_type: str | Unset = UNSET
        if not isinstance(self.source_type, Unset):
            source_type = self.source_type.value


        mime_type: None | str | Unset
        if isinstance(self.mime_type, Unset):
            mime_type = UNSET
        else:
            mime_type = self.mime_type

        brain: None | str | Unset
        if isinstance(self.brain, Unset):
            brain = UNSET
        else:
            brain = self.brain

        rank = self.rank

        snippet = self.snippet


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "path": path,
            "title": title,
        })
        if section is not UNSET:
            field_dict["section"] = section
        if doc_type is not UNSET:
            field_dict["docType"] = doc_type
        if doc_status is not UNSET:
            field_dict["docStatus"] = doc_status
        if tags is not UNSET:
            field_dict["tags"] = tags
        if word_count is not UNSET:
            field_dict["wordCount"] = word_count
        if source_type is not UNSET:
            field_dict["sourceType"] = source_type
        if mime_type is not UNSET:
            field_dict["mimeType"] = mime_type
        if brain is not UNSET:
            field_dict["brain"] = brain
        if rank is not UNSET:
            field_dict["rank"] = rank
        if snippet is not UNSET:
            field_dict["snippet"] = snippet

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        path = d.pop("path")

        title = d.pop("title")

        def _parse_section(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        section = _parse_section(d.pop("section", UNSET))


        def _parse_doc_type(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        doc_type = _parse_doc_type(d.pop("docType", UNSET))


        def _parse_doc_status(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        doc_status = _parse_doc_status(d.pop("docStatus", UNSET))


        tags = cast(list[str], d.pop("tags", UNSET))


        word_count = d.pop("wordCount", UNSET)

        _source_type = d.pop("sourceType", UNSET)
        source_type: SearchResultSourceType | Unset
        if isinstance(_source_type,  Unset):
            source_type = UNSET
        else:
            source_type = SearchResultSourceType(_source_type)




        def _parse_mime_type(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        mime_type = _parse_mime_type(d.pop("mimeType", UNSET))


        def _parse_brain(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        brain = _parse_brain(d.pop("brain", UNSET))


        rank = d.pop("rank", UNSET)

        snippet = d.pop("snippet", UNSET)

        search_result = cls(
            id=id,
            path=path,
            title=title,
            section=section,
            doc_type=doc_type,
            doc_status=doc_status,
            tags=tags,
            word_count=word_count,
            source_type=source_type,
            mime_type=mime_type,
            brain=brain,
            rank=rank,
            snippet=snippet,
        )


        search_result.additional_properties = d
        return search_result

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
