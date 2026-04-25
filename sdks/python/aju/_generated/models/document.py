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

if TYPE_CHECKING:
  from ..models.document_frontmatter_type_0 import DocumentFrontmatterType0





T = TypeVar("T", bound="Document")



@_attrs_define
class Document:
    """ 
        Attributes:
            id (str):
            brain_id (str):
            path (str):
            title (str):
            content (str | Unset):
            content_hash (str | Unset):
            doc_type (None | str | Unset):
            doc_status (None | str | Unset):
            section (None | str | Unset):
            directory (None | str | Unset):
            tags (list[str] | Unset):
            wikilinks (list[str] | Unset):
            frontmatter (DocumentFrontmatterType0 | None | Unset):
            word_count (int | Unset):
            file_modified (datetime.datetime | Unset):
            synced_at (datetime.datetime | Unset):
            created_at (datetime.datetime | Unset):
            updated_at (datetime.datetime | Unset):
     """

    id: str
    brain_id: str
    path: str
    title: str
    content: str | Unset = UNSET
    content_hash: str | Unset = UNSET
    doc_type: None | str | Unset = UNSET
    doc_status: None | str | Unset = UNSET
    section: None | str | Unset = UNSET
    directory: None | str | Unset = UNSET
    tags: list[str] | Unset = UNSET
    wikilinks: list[str] | Unset = UNSET
    frontmatter: DocumentFrontmatterType0 | None | Unset = UNSET
    word_count: int | Unset = UNSET
    file_modified: datetime.datetime | Unset = UNSET
    synced_at: datetime.datetime | Unset = UNSET
    created_at: datetime.datetime | Unset = UNSET
    updated_at: datetime.datetime | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.document_frontmatter_type_0 import DocumentFrontmatterType0
        id = self.id

        brain_id = self.brain_id

        path = self.path

        title = self.title

        content = self.content

        content_hash = self.content_hash

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

        tags: list[str] | Unset = UNSET
        if not isinstance(self.tags, Unset):
            tags = self.tags



        wikilinks: list[str] | Unset = UNSET
        if not isinstance(self.wikilinks, Unset):
            wikilinks = self.wikilinks



        frontmatter: dict[str, Any] | None | Unset
        if isinstance(self.frontmatter, Unset):
            frontmatter = UNSET
        elif isinstance(self.frontmatter, DocumentFrontmatterType0):
            frontmatter = self.frontmatter.to_dict()
        else:
            frontmatter = self.frontmatter

        word_count = self.word_count

        file_modified: str | Unset = UNSET
        if not isinstance(self.file_modified, Unset):
            file_modified = self.file_modified.isoformat()

        synced_at: str | Unset = UNSET
        if not isinstance(self.synced_at, Unset):
            synced_at = self.synced_at.isoformat()

        created_at: str | Unset = UNSET
        if not isinstance(self.created_at, Unset):
            created_at = self.created_at.isoformat()

        updated_at: str | Unset = UNSET
        if not isinstance(self.updated_at, Unset):
            updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "brainId": brain_id,
            "path": path,
            "title": title,
        })
        if content is not UNSET:
            field_dict["content"] = content
        if content_hash is not UNSET:
            field_dict["contentHash"] = content_hash
        if doc_type is not UNSET:
            field_dict["docType"] = doc_type
        if doc_status is not UNSET:
            field_dict["docStatus"] = doc_status
        if section is not UNSET:
            field_dict["section"] = section
        if directory is not UNSET:
            field_dict["directory"] = directory
        if tags is not UNSET:
            field_dict["tags"] = tags
        if wikilinks is not UNSET:
            field_dict["wikilinks"] = wikilinks
        if frontmatter is not UNSET:
            field_dict["frontmatter"] = frontmatter
        if word_count is not UNSET:
            field_dict["wordCount"] = word_count
        if file_modified is not UNSET:
            field_dict["fileModified"] = file_modified
        if synced_at is not UNSET:
            field_dict["syncedAt"] = synced_at
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at
        if updated_at is not UNSET:
            field_dict["updatedAt"] = updated_at

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.document_frontmatter_type_0 import DocumentFrontmatterType0
        d = dict(src_dict)
        id = d.pop("id")

        brain_id = d.pop("brainId")

        path = d.pop("path")

        title = d.pop("title")

        content = d.pop("content", UNSET)

        content_hash = d.pop("contentHash", UNSET)

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


        tags = cast(list[str], d.pop("tags", UNSET))


        wikilinks = cast(list[str], d.pop("wikilinks", UNSET))


        def _parse_frontmatter(data: object) -> DocumentFrontmatterType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                frontmatter_type_0 = DocumentFrontmatterType0.from_dict(data)



                return frontmatter_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(DocumentFrontmatterType0 | None | Unset, data)

        frontmatter = _parse_frontmatter(d.pop("frontmatter", UNSET))


        word_count = d.pop("wordCount", UNSET)

        _file_modified = d.pop("fileModified", UNSET)
        file_modified: datetime.datetime | Unset
        if isinstance(_file_modified,  Unset):
            file_modified = UNSET
        else:
            file_modified = isoparse(_file_modified)




        _synced_at = d.pop("syncedAt", UNSET)
        synced_at: datetime.datetime | Unset
        if isinstance(_synced_at,  Unset):
            synced_at = UNSET
        else:
            synced_at = isoparse(_synced_at)




        _created_at = d.pop("createdAt", UNSET)
        created_at: datetime.datetime | Unset
        if isinstance(_created_at,  Unset):
            created_at = UNSET
        else:
            created_at = isoparse(_created_at)




        _updated_at = d.pop("updatedAt", UNSET)
        updated_at: datetime.datetime | Unset
        if isinstance(_updated_at,  Unset):
            updated_at = UNSET
        else:
            updated_at = isoparse(_updated_at)




        document = cls(
            id=id,
            brain_id=brain_id,
            path=path,
            title=title,
            content=content,
            content_hash=content_hash,
            doc_type=doc_type,
            doc_status=doc_status,
            section=section,
            directory=directory,
            tags=tags,
            wikilinks=wikilinks,
            frontmatter=frontmatter,
            word_count=word_count,
            file_modified=file_modified,
            synced_at=synced_at,
            created_at=created_at,
            updated_at=updated_at,
        )


        document.additional_properties = d
        return document

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
