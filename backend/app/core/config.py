from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET = "dev-only-insecure-secret-change-me-in-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    database_url: str = "sqlite:///./edgepulse.db"
    jwt_secret: str = DEV_SECRET
    jwt_expire_minutes: int = 720
    llm_base_url: str = "https://api.openai.com/v1"
    llm_api_key: str = ""
    llm_model: str = "gpt-4o-mini"
    mqtt_host: str = ""
    mqtt_port: int = 1883
    mqtt_username: str = ""
    mqtt_password: str = ""
    mqtt_topic_prefix: str = "edgepulse"
    seed_demo_devices: bool = False
    offline_after_seconds: int = 30
    cors_origins: str = "http://localhost:5173"
    assistant_rate_limit_per_minute: int = 20

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.environment == "production" and settings.jwt_secret == DEV_SECRET:
        raise RuntimeError("JWT_SECRET must be set in production")
    return settings
