from enum import Enum

class DocumentVersionsListDirection(str, Enum):
    NEWEST = "newest"
    OLDEST = "oldest"

    def __str__(self) -> str:
        return str(self.value)
