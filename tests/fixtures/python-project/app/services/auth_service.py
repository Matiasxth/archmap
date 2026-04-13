from app.auth import authenticate, sign_token
from app.models.user import User

class AuthService:
    def login(self, credentials: dict) -> str:
        user = User.get_by_id(credentials["user_id"])
        return sign_token({"user_id": user.id, "role": "admin"})

    def verify(self, request) -> User:
        return authenticate(request)
