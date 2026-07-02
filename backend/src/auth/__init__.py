from flask import Flask

__all__ = ["two_factor", "management", "account", "api_keys"]

from . import two_factor
from . import account
from . import management
from . import api_keys


def register_blueprint(app: Flask):
    app.register_blueprint(two_factor.two_fa_bp)
    app.register_blueprint(account.account_bp)
    app.register_blueprint(management.management_bp)
    app.register_blueprint(api_keys.api_keys_bp)
