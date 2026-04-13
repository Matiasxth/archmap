from app.utils.config import get_config

class User:
    def __init__(self, id: str, name: str, email: str):
        self.id = id
        self.name = name
        self.email = email

    @classmethod
    def get_by_id(cls, user_id: str):
        return cls(user_id, "Test User", "test@example.com")
