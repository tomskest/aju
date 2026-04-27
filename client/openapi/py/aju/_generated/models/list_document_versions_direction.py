from enum import Enum

class ListDocumentVersionsDirection(str, Enum):
    NEWEST = "newest"
    OLDEST = "oldest"

    def __str__(self) -> str:
        return str(self.value)
