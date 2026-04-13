import jwt
from app.utils.config import get_config

SECRET = "dev-secret"

def verify_token(token: str) -> dict:
    config = get_config()
    return jwt.decode(token, config["jwt_secret"], algorithms=["HS256"])

def sign_token(payload: dict) -> str:
    config = get_config()
    return jwt.encode(payload, config["jwt_secret"], algorithm="HS256")
