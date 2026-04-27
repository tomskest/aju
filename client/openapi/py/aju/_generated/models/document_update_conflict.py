from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.document_update_conflict_error import DocumentUpdateConflictError
from ..types import UNSET, Unset






T = TypeVar("T", bound="DocumentUpdateConflict")



@_attrs_define
class DocumentUpdateConflict:
    """ 409 response payload for /api/vault/update. Returned when the
    supplied baseHash does not match the current head AND either no
    baseContent was supplied (`error: stale_base_hash`) or the
    attempted three-way merge had unresolved overlapping conflicts
    (`error: merge_conflict`).

        Attributes:
            error (DocumentUpdateConflictError):
            head_hash (str): Current contentHash on the server.
            head_content (str): Current content on the server. Use as `theirs` in a client-side merge.
            message (str | Unset):
            base_hash (str | Unset): The baseHash the caller supplied (echoed back).
            base_content (str | Unset): Echoed baseContent — only present on `merge_conflict`.
            mine_content (str | Unset): The caller's content — only present on `merge_conflict`.
            conflicted_content (str | Unset): Diff3 output with `<<<<<<<` / `=======` / `>>>>>>>` markers — only present on
                `merge_conflict`.
     """

    error: DocumentUpdateConflictError
    head_hash: str
    head_content: str
    message: str | Unset = UNSET
    base_hash: str | Unset = UNSET
    base_content: str | Unset = UNSET
    mine_content: str | Unset = UNSET
    conflicted_content: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        error = self.error.value

        head_hash = self.head_hash

        head_content = self.head_content

        message = self.message

        base_hash = self.base_hash

        base_content = self.base_content

        mine_content = self.mine_content

        conflicted_content = self.conflicted_content


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "error": error,
            "headHash": head_hash,
            "headContent": head_content,
        })
        if message is not UNSET:
            field_dict["message"] = message
        if base_hash is not UNSET:
            field_dict["baseHash"] = base_hash
        if base_content is not UNSET:
            field_dict["baseContent"] = base_content
        if mine_content is not UNSET:
            field_dict["mineContent"] = mine_content
        if conflicted_content is not UNSET:
            field_dict["conflictedContent"] = conflicted_content

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        error = DocumentUpdateConflictError(d.pop("error"))




        head_hash = d.pop("headHash")

        head_content = d.pop("headContent")

        message = d.pop("message", UNSET)

        base_hash = d.pop("baseHash", UNSET)

        base_content = d.pop("baseContent", UNSET)

        mine_content = d.pop("mineContent", UNSET)

        conflicted_content = d.pop("conflictedContent", UNSET)

        document_update_conflict = cls(
            error=error,
            head_hash=head_hash,
            head_content=head_content,
            message=message,
            base_hash=base_hash,
            base_content=base_content,
            mine_content=mine_content,
            conflicted_content=conflicted_content,
        )


        document_update_conflict.additional_properties = d
        return document_update_conflict

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
