import os

DEFAULT_CONFIG = {
    "jwt_secret": "dev-secret",
    "database_url": "sqlite:///app.db",
    "debug": True,
}

def get_config() -> dict:
    return {
        "jwt_secret": os.environ.get("JWT_SECRET", DEFAULT_CONFIG["jwt_secret"]),
        "database_url": os.environ.get("DATABASE_URL", DEFAULT_CONFIG["database_url"]),
        "debug": os.environ.get("DEBUG", DEFAULT_CONFIG["debug"]),
    }
