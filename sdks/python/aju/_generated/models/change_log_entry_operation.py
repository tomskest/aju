from enum import Enum

class ChangeLogEntryOperation(str, Enum):
    DELETE = "delete"
    INSERT = "insert"
    UPDATE = "update"

    def __str__(self) -> str:
        return str(self.value)
