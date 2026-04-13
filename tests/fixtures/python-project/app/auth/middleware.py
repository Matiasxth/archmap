from .jwt import verify_token
from app.models.user import User
from app.utils.config import get_config

def authenticate(request):
    token = request.headers.get("Authorization")
    payload = verify_token(token)
    user = User.get_by_id(payload["user_id"])
    return user
