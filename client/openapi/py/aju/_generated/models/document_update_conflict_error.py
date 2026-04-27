from enum import Enum

class DocumentUpdateConflictError(str, Enum):
    MERGE_CONFLICT = "merge_conflict"
    STALE_BASE_HASH = "stale_base_hash"

    def __str__(self) -> str:
        return str(self.value)
