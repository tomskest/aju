from enum import Enum

class SearchResultSourceType(str, Enum):
    DOCUMENT = "document"
    FILE = "file"

    def __str__(self) -> str:
        return str(self.value)
