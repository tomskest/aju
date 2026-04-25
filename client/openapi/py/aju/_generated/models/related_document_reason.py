from enum import Enum

class RelatedDocumentReason(str, Enum):
    BACKLINK = "backlink"
    EMBEDDING = "embedding"
    TAG = "tag"
    WIKILINK = "wikilink"

    def __str__(self) -> str:
        return str(self.value)
