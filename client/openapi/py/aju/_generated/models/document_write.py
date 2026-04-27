from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="DocumentWrite")



@_attrs_define
class DocumentWrite:
    """ 
        Attributes:
            path (str): Vault path, e.g. "journal/2026-04-24.md".
            content (str): Markdown body including optional YAML frontmatter.
            source (str): Free-form label for the origin of this write (e.g. "cli", "sdk-ts").
            base_hash (str | Unset): On update only. SHA-256 contentHash of the version the caller
                had at read time. Enables compare-and-swap: server fast-paths
                when the hash still matches, attempts a three-way merge (when
                baseContent is also supplied) if it does not, and returns 409
                with the current head when the merge cannot be resolved.

                Omitting baseHash falls back to legacy force-write and the
                response carries a `Deprecation: true` header.
            base_content (str | Unset): On update only. Exact content the caller had at read time.
                Required alongside baseHash for server-side three-way merge of
                concurrent edits to non-overlapping regions.
     """

    path: str
    content: str
    source: str
    base_hash: str | Unset = UNSET
    base_content: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        path = self.path

        content = self.content

        source = self.source

        base_hash = self.base_hash

        base_content = self.base_content


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "path": path,
            "content": content,
            "source": source,
        })
        if base_hash is not UNSET:
            field_dict["baseHash"] = base_hash
        if base_content is not UNSET:
            field_dict["baseContent"] = base_content

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        path = d.pop("path")

        content = d.pop("content")

        source = d.pop("source")

        base_hash = d.pop("baseHash", UNSET)

        base_content = d.pop("baseContent", UNSET)

        document_write = cls(
            path=path,
            content=content,
            source=source,
            base_hash=base_hash,
            base_content=base_content,
        )


        document_write.additional_properties = d
        return document_write

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
