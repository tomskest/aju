from enum import Enum

class SemanticSearchVaultMode(str, Enum):
    HYBRID = "hybrid"
    KEYWORD = "keyword"
    VECTOR = "vector"

    def __str__(self) -> str:
        return str(self.value)
