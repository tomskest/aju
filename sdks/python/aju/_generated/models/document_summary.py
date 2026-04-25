from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from dateutil.parser import isoparse
from typing import cast
import datetime






T = TypeVar("T", bound="DocumentSummary")



@_attrs_define
class DocumentSummary:
    """ 
        Attributes:
            id (str):
            path (str):
            title (str):
            section (None | str | Unset):
            directory (None | str | Unset):
            doc_type (None | str | Unset):
            doc_status (None | str | Unset):
            tags (list[str] | Unset):
            word_count (int | Unset):
            updated_at (datetime.datetime | Unset):
     """

    id: str
    path: str
    title: str
    section: None | str | Unset = UNSET
    directory: None | str | Unset = UNSET
    doc_type: None | str | Unset = UNSET
    doc_status: None | str | Unset = UNSET
    tags: list[str] | Unset = UNSET
    word_count: int | Unset = UNSET
    updated_at: datetime.datetime | Unset = UNSET
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

        directory: None | str | Unset
        if isinstance(self.directory, Unset):
            directory = UNSET
        else:
            directory = self.directory

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

        updated_at: str | Unset = UNSET
        if not isinstance(self.updated_at, Unset):
            updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "path": path,
            "title": title,
        })
        if section is not UNSET:
            field_dict["section"] = section
        if directory is not UNSET:
            field_dict["directory"] = directory
        if doc_type is not UNSET:
            field_dict["docType"] = doc_type
        if doc_status is not UNSET:
            field_dict["docStatus"] = doc_status
        if tags is not UNSET:
            field_dict["tags"] = tags
        if word_count is not UNSET:
            field_dict["wordCount"] = word_count
        if updated_at is not UNSET:
            field_dict["updatedAt"] = updated_at

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


        def _parse_directory(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        directory = _parse_directory(d.pop("directory", UNSET))


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

        _updated_at = d.pop("updatedAt", UNSET)
        updated_at: datetime.datetime | Unset
        if isinstance(_updated_at,  Unset):
            updated_at = UNSET
        else:
            updated_at = isoparse(_updated_at)




        document_summary = cls(
            id=id,
            path=path,
            title=title,
            section=section,
            directory=directory,
            doc_type=doc_type,
            doc_status=doc_status,
            tags=tags,
            word_count=word_count,
            updated_at=updated_at,
        )


        document_summary.additional_properties = d
        return document_summary

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
